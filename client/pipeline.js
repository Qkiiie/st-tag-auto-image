/**
 * 客户端管线层：调用服务端（或直连）生图 → 上传酒馆图床 → 把图片写进「生图Tag美化」正则，
 * 并负责配套资源（世界书 + 2 条正则）的安装与检查。
 *
 * 写入策略：优先写酒馆原生的正则存储（extension_settings.regex / 正则引擎 engine.js），
 * 找不到时再写酒馆助手（TavernHelper）的全局正则，保持与老脚本的兼容。
 */
import {
    SCRIPT_TAG,
    TAG_REGEX_NAME,
    TAG_REGEX_ID,
    TAG_HIDE_REGEX_NAME,
    TAG_HIDE_REGEX_ID,
    WB_NAME,
    IMG_ID,
    IMG_SLOT,
    LAST_IMG_KEY,
    UPLOAD_FOLDER,
    DEFAULTS,
    makeTagBeautifyRegex,
    makeTagHideRegex,
    makeNativeWorldbookData,
    WB_ENTRY_CONTENT,
    normalizedToNativeRegex,
} from '../shared/resources.mjs';
import * as S from './state.js';

// ---------------------------------------------------------------------------
// 动态导入酒馆内部模块（路径失败时退回绝对路径；整体包在 try/catch 里，避免拖垮扩展加载）
// ---------------------------------------------------------------------------

/**
 * 依次尝试多个候选路径导入模块。
 * @param {string[]} paths
 * @returns {Promise<any|null>}
 */
async function importAny(paths) {
    for (const p of paths) {
        try {
            const mod = await import(/* webpackIgnore: true */ p);
            if (mod) return mod;
        } catch (e) {
            /* 试下一个 */
        }
    }
    return null;
}

/** 酒馆正则引擎（提供 getScriptsByType / saveScriptsByType / SCRIPT_TYPES） */
export function loadRegexEngine() {
    return importAny(['../../../regex/engine.js', '/scripts/extensions/regex/engine.js']);
}

/** 世界书模块（提供 updateWorldInfoList / onWorldInfoChange 等） */
export function loadWorldInfoModule() {
    return importAny(['../../../../world-info.js', '/scripts/world-info.js']);
}

/** Slash 命令解析器 */
export function loadSlashCommandParser() {
    return importAny(['../../../../slash-commands/SlashCommandParser.js', '/scripts/slash-commands/SlashCommandParser.js']);
}

// ---------------------------------------------------------------------------
// tag 提取与提示词
// ---------------------------------------------------------------------------

/**
 * 取正文末尾 <@tags>…</@tags> 的内容。
 * @param {string} text
 * @returns {string}
 */
export function extractTags(text) {
    const m = /<@tags>([\s\S]*?)<\/@tags>/.exec(text || '');
    return m ? m[1].trim() : '';
}

/**
 * 正向模板 + tag/自定义提示词 拼接。
 * @param {string} extra
 * @param {string} base
 * @returns {string}
 */
export function joinPrompt(extra, base) {
    const e = (extra || '').trim();
    const b = (base || '').trim();
    if (e && b) return `${b}, ${e}`;
    return e || b;
}

// ---------------------------------------------------------------------------
// 生图：服务端优先，失败/不可用时退回浏览器直连
// ---------------------------------------------------------------------------

function naiIsV3(model) {
    return /nai-diffusion-(2|3)/.test(model || '') || /furry/.test(model || '');
}

function naiBody(prompt, cfg) {
    const neg = cfg.negativePrompt || '';
    if (naiIsV3(cfg.model)) {
        return {
            input: prompt,
            model: cfg.model || 'nai-diffusion-3',
            action: 'generate',
            parameters: {
                width: cfg.width, height: cfg.height, scale: cfg.scale, sampler: cfg.sampler, steps: cfg.steps,
                n_samples: cfg.nSamples, ucPreset: 0, qualityToggle: true, sm: false, sm_dyn: false,
                dynamic_thresholding: false, controlnet_strength: 1, legacy: false, add_original_image: false,
                cfg_rescale: 0, noise_schedule: 'native', negative_prompt: neg, uncond_scale: 1,
            },
        };
    }
    return {
        action: 'generate',
        input: prompt,
        model: cfg.model,
        parameters: {
            params_version: 3, prefer_brownian: true, negative_prompt: neg,
            height: cfg.height, width: cfg.width, scale: cfg.scale,
            seed: Math.floor(Math.random() * 9999999999), sampler: cfg.sampler,
            noise_schedule: 'karras', steps: cfg.steps, n_samples: cfg.nSamples, ucPreset: 0,
            qualityToggle: false, add_original_image: false, controlnet_strength: 1,
            deliberate_euler_ancestral_bug: false, dynamic_thresholding: false, legacy: false,
            legacy_v3_extend: false, sm: false, sm_dyn: false, uncond_scale: 1,
            skip_cfg_above_sigma: null, use_coords: false, characterPrompts: [],
            reference_image_multiple: [], reference_information_extracted_multiple: [],
            reference_strength_multiple: [],
            v4_negative_prompt: { caption: { base_caption: neg, char_captions: [] } },
            v4_prompt: { caption: { base_caption: prompt, char_captions: [] }, use_coords: false, use_order: true },
        },
    };
}

function fillTemplate(tpl, vars) {
    return String(tpl || '').replace(/\{(\w+)\}/g, (m, key) => {
        if (!(key in vars)) return m;
        const v = vars[key];
        if (typeof v === 'number') return String(v);
        return JSON.stringify(String(v)).slice(1, -1);
    });
}

function getPath(obj, path) {
    if (!obj || !path) return null;
    const parts = String(path).replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
    let cur = obj;
    for (const part of parts) {
        if (cur == null) return null;
        cur = cur[part];
    }
    return cur;
}

function toDataUrl(b64) {
    if (typeof b64 !== 'string') return null;
    const s = b64.trim();
    return /^data:/.test(s) ? s : `data:image/png;base64,${s}`;
}

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = () => reject(new Error('读取图片失败'));
        fr.readAsDataURL(blob);
    });
}

/**
 * 浏览器端解 ZIP 取第一张 PNG（直连模式的 NovelAI 兼容）。
 * @param {ArrayBuffer} arrayBuffer
 * @returns {Promise<string>}
 */
async function extractPngFromZip(arrayBuffer) {
    const u8 = new Uint8Array(arrayBuffer);
    const dv = new DataView(arrayBuffer);
    let eocd = -1;
    const minStart = Math.max(0, u8.length - 22 - 65536);
    for (let i = u8.length - 22; i >= minStart; i--) {
        if (u8[i] === 0x50 && u8[i + 1] === 0x4b && u8[i + 2] === 0x05 && u8[i + 3] === 0x06) {
            eocd = i;
            break;
        }
    }
    if (eocd < 0) throw new Error('响应不是有效的 ZIP');
    const cdOffset = dv.getUint32(eocd + 16, true);
    const total = dv.getUint16(eocd + 10, true);
    let p = cdOffset;
    for (let j = 0; j < total; j++) {
        if (dv.getUint32(p, true) !== 0x02014b50) break;
        const method = dv.getUint16(p + 10, true);
        const compSize = dv.getUint32(p + 20, true);
        const nameLen = dv.getUint16(p + 28, true);
        const extraLen = dv.getUint16(p + 30, true);
        const commentLen = dv.getUint16(p + 32, true);
        const localOffset = dv.getUint32(p + 42, true);
        const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen));
        if (/\.(png|jpg|jpeg|webp)$/i.test(name) && !name.startsWith('__MACOSX')) {
            const lnameLen = dv.getUint16(localOffset + 26, true);
            const lextraLen = dv.getUint16(localOffset + 28, true);
            const dataStart = localOffset + 30 + lnameLen + lextraLen;
            const comp = u8.subarray(dataStart, dataStart + compSize);
            let out;
            if (method === 0) {
                out = comp;
            } else if (method === 8) {
                const ds = new DecompressionStream('deflate-raw');
                const stream = new Blob([comp]).stream().pipeThrough(ds);
                out = new Uint8Array(await new Response(stream).arrayBuffer());
            } else {
                throw new Error('不支持的 ZIP 压缩方式：' + method);
            }
            const mime = /\.png$/i.test(name) ? 'image/png' : /\.webp$/i.test(name) ? 'image/webp' : 'image/jpeg';
            return blobToDataUrl(new Blob([out], { type: mime }));
        }
        p += 46 + nameLen + extraLen + commentLen;
    }
    throw new Error('ZIP 中未找到图片文件');
}

/** 从各种常见响应结构里抽取 base64 图片（与 server/util.mjs 的 extractBase64 保持一致） */
function extractImageBase64(json) {
    if (!json) return null;
    if (typeof json === 'string') return json;
    if (json.data && Array.isArray(json.data.images) && json.data.images[0]) {
        const img = json.data.images[0];
        return typeof img === 'string' ? img : (img.image || null);
    }
    if (json.data && typeof json.data.image === 'string') return json.data.image;
    if (Array.isArray(json.data)) {
        if (json.data[0] && json.data[0].image) return json.data[0].image;
        if (json.data[0] && json.data[0].b64_json) return json.data[0].b64_json;
        if (typeof json.data[0] === 'string') return json.data[0];
    }
    if (Array.isArray(json.images)) {
        if (json.images[0] && json.images[0].image) return json.images[0].image;
        if (typeof json.images[0] === 'string') return json.images[0];
    }
    if (typeof json.image === 'string') return json.image;
    if (typeof json.images === 'string') return json.images;
    if (typeof json.b64_json === 'string') return json.b64_json;
    return null;
}

/** 抽取图片 URL（有的渠道返回 url 而不是 base64） */
function extractImageUrl(json) {
    if (!json || typeof json !== 'object') return null;
    const cands = [
        json.url,
        json.image_url,
        Array.isArray(json.data) && json.data[0] ? (json.data[0].url || json.data[0].image_url) : null,
        Array.isArray(json.images) && json.images[0] ? (json.images[0].url || json.images[0].image_url) : null,
        json.data && !Array.isArray(json.data) ? (json.data.url || json.data.image_url) : null,
    ];
    for (const c of cands) {
        if (typeof c === 'string' && /^https?:/i.test(c)) return c;
    }
    return null;
}

function proxied(url, cfg) {
    const base = cfg.proxyBase ? String(cfg.proxyBase).trim() : '';
    if (!base || !/^https?:\/\//i.test(url || '')) return url;
    return base + url;
}

/**
 * 浏览器直连生成（原脚本行为，服务端插件不可用时使用）。
 * @param {string} prompt
 * @param {Record<string, any>} cfg
 * @returns {Promise<string>} data URL
 */
export async function directGenerate(prompt, cfg) {
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, */*' };
    const key = String(cfg.apiKey || '').trim();
    const mode = cfg.modelsAuth || 'bearer';
    if (key && mode !== 'none') {
        if (mode === 'x-api-key') headers['x-api-key'] = key;
        else if (mode === 'raw') headers['Authorization'] = key;
        else headers['Authorization'] = 'Bearer ' + key;
    }

    let url;
    let body;
    if (cfg.provider === 'nai') {
        url = cfg.endpoint || DEFAULTS.endpoint;
        body = naiBody(prompt, cfg);
    } else if (cfg.provider === 'openai') {
        url = cfg.endpoint || 'https://api.openai.com/v1/images/generations';
        body = {
            model: cfg.model || 'gpt-image-1',
            prompt,
            n: cfg.nSamples || 1,
            size: (cfg.openaiSize || '') || `${cfg.width}x${cfg.height}`,
            response_format: cfg.openaiResponseFormat || 'b64_json',
        };
    } else {
        url = cfg.endpoint;
        if (!url) throw new Error('请填写通用渠道的接口地址');
        const vars = {
            model: cfg.model || '', prompt, negative: cfg.negativePrompt || '',
            width: cfg.width, height: cfg.height, steps: cfg.steps, scale: cfg.scale,
            sampler: cfg.sampler, seed: Math.floor(Math.random() * 9999999999),
        };
        const json = fillTemplate(cfg.genericBodyTemplate || DEFAULTS.genericBodyTemplate, vars);
        try {
            body = JSON.parse(json);
        } catch (e) {
            throw new Error('通用请求体模板不是合法 JSON：' + S.describeError(e));
        }
    }

    const res = await fetch(proxied(url, cfg), { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) {
        let detail = '';
        try {
            detail = (await res.text()).slice(0, 300);
        } catch (e) {
            /* ignore */
        }
        throw new Error(`HTTP ${res.status}${detail ? '：' + detail : ''}`);
    }

    const buf = await res.arrayBuffer();
    const u8 = new Uint8Array(buf);
    if (u8.length >= 2 && u8[0] === 0x50 && u8[1] === 0x4b) return await extractPngFromZip(buf);

    const text = new TextDecoder().decode(u8);
    let json;
    try {
        json = JSON.parse(text);
    } catch (e) {
        throw new Error('无法解析响应（既非图片、也非 ZIP、也不是 JSON）');
    }

    if (cfg.provider === 'generic') {
        const path = cfg.genericImagePath || DEFAULTS.genericImagePath;
        const raw = getPath(json, path);
        if (!raw) throw new Error(`未找到图片数据（路径：${path}）`);
        if (cfg.genericImageIsUrl) return await fetchImageAsDataUrl(String(raw), cfg);
        return toDataUrl(String(raw));
    }

    const item = (json.data && json.data[0]) || json;
    if (item && item.b64_json) return toDataUrl(item.b64_json);
    if (item && item.url) return await fetchImageAsDataUrl(item.url, cfg);

    // NovelAI 官方现在返回 JSON：{"images":[{"image":"<base64 png>"}]}（早期是 zip 包，两种都兼容）
    const b64 = extractImageBase64(json);
    if (b64) return toDataUrl(b64);
    const imgUrl = extractImageUrl(json);
    if (imgUrl) return await fetchImageAsDataUrl(imgUrl, cfg);

    throw new Error('响应里没有找到图片数据｜响应片段：' + text.slice(0, 300));
}

/**
 * 下载 URL 图片转 data URL（浏览器直连用，可能被 CORS 拦）。
 * @param {string} url
 * @param {Record<string, any>} cfg
 * @returns {Promise<string>}
 */
export async function fetchImageAsDataUrl(url, cfg) {
    const res = await fetch(proxied(url, cfg));
    if (!res.ok) throw new Error('下载图片失败 HTTP ' + res.status);
    return blobToDataUrl(await res.blob());
}

/**
 * 统一入口：按设置选择服务端或直连。
 * @param {string} prompt
 * @param {Record<string, any>} cfg
 * @returns {Promise<{ dataUrl: string, via: 'server'|'direct', elapsedMs?: number }>}
 */
export async function generateImage(prompt, cfg) {
    const mode = cfg.mode || 'auto';
    const started = Date.now();

    if (mode !== 'direct') {
        try {
            const json = await S.callServer('/generate', { ...cfg, prompt }, { force: mode === 'server' });
            if (!json || !json.dataUrl) throw new Error('服务端没有返回图片数据');
            return { dataUrl: json.dataUrl, via: 'server', elapsedMs: json.elapsedMs ?? Date.now() - started };
        } catch (e) {
            if (mode === 'server') throw e;
            S.toastWarn('服务端生图失败，改用浏览器直连：' + S.describeError(e));
        }
    }

    const dataUrl = await directGenerate(prompt, cfg);
    return { dataUrl, via: 'direct', elapsedMs: Date.now() - started };
}

// ---------------------------------------------------------------------------
// 酒馆图床
// ---------------------------------------------------------------------------

/**
 * 上传到酒馆本地图床，返回可访问 URL。
 * @param {string} dataUrl
 * @returns {Promise<string>}
 */
export async function uploadToTavern(dataUrl) {
    const m = /^data:([^;,]+)?(;base64)?,(.*)$/.exec(dataUrl);
    const format = m && m[1] === 'image/jpeg' ? 'jpg' : m && m[1] === 'image/webp' ? 'webp' : 'png';
    const b64 = m && m[3] ? m[3] : dataUrl;
    const res = await fetch('/api/images/upload', {
        method: 'POST',
        headers: S.getRequestHeaders(),
        body: JSON.stringify({ image: b64, format, ch_name: UPLOAD_FOLDER, filename: 'tag_' + Date.now() }),
    });
    if (!res.ok) {
        let detail = '';
        try {
            detail = (await res.text()).slice(0, 200);
        } catch (e) {
            /* ignore */
        }
        throw new Error(`HTTP ${res.status}${detail ? '：' + detail : ''}`);
    }
    const json = await res.json();
    if (!json || !json.path) throw new Error('图床响应缺少 path');
    return toAbsoluteUrl(json.path);
}

/**
 * 相对路径转绝对 URL。
 * @param {string} path
 * @returns {string}
 */
export function toAbsoluteUrl(path) {
    if (/^(https?:|data:)/.test(path)) return path;
    try {
        return window.location.origin + (path.startsWith('/') ? path : '/' + path);
    } catch (e) {
        return path;
    }
}

/**
 * 生成一张可下载的图片文件名。
 * @returns {string}
 */
export function newImageFileName() {
    return 'tag_' + Date.now() + '.png';
}

/**
 * 触发浏览器下载 data URL。
 * @param {string} dataUrl
 * @param {string} [filename]
 * @returns {boolean}
 */
export function downloadDataUrl(dataUrl, filename) {
    try {
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = filename || newImageFileName();
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        return true;
    } catch (e) {
        return false;
    }
}

// ---------------------------------------------------------------------------
// 「生图Tag美化」正则：读取 / 写入
// ---------------------------------------------------------------------------

/**
 * 替换替换串里的图片槽（<img id="tag-gen-img" src="…"> 或 __TAG_GEN_IMG__）。
 * @param {string} replaceString
 * @param {string} url
 * @returns {string}
 */
export function setImgSrcInReplaceString(replaceString, url) {
    const re = /(<img\b[^>]*\bid=["']tag-gen-img["'][^>]*\bsrc=["'])[^"']*(["'])/i;
    if (re.test(replaceString)) {
        return replaceString.replace(re, (m, p1, p2) => p1 + url + p2);
    }
    return replaceString.split(IMG_SLOT).join(url);
}

/** 读取原生全局正则列表（优先 engine.js，退回 extension_settings.regex） */
async function getNativeScripts() {
    const engine = await loadRegexEngine();
    if (engine && typeof engine.getScriptsByType === 'function' && engine.SCRIPT_TYPES) {
        try {
            const scripts = engine.getScriptsByType(engine.SCRIPT_TYPES.GLOBAL);
            if (Array.isArray(scripts)) return { scripts, engine };
        } catch (e) {
            console.warn(`[${SCRIPT_TAG}] 读取原生正则失败`, e);
        }
    }
    const ctx = S.getContext();
    if (ctx && ctx.extensionSettings && Array.isArray(ctx.extensionSettings.regex)) {
        return { scripts: ctx.extensionSettings.regex, engine: null };
    }
    return { scripts: [], engine: null };
}

/** 写入原生全局正则列表 */
async function saveNativeScripts(scripts, engine) {
    if (engine && typeof engine.saveScriptsByType === 'function') {
        await engine.saveScriptsByType(scripts, engine.SCRIPT_TYPES.GLOBAL);
        return true;
    }
    const ctx = S.getContext();
    if (ctx && ctx.extensionSettings) {
        ctx.extensionSettings.regex = scripts;
        S.saveSettings();
        return true;
    }
    throw new Error('无法写入酒馆正则：拿不到 extension_settings');
}

function isNativeTagBeautify(script) {
    return script && (script.id === TAG_REGEX_ID || script.scriptName === TAG_REGEX_NAME);
}

function isNativeTagHide(script) {
    return script && (script.id === TAG_HIDE_REGEX_ID || script.scriptName === TAG_HIDE_REGEX_NAME);
}

function isThTagBeautify(script) {
    return script && (script.id === TAG_REGEX_ID || script.script_name === TAG_REGEX_NAME || script.name === TAG_REGEX_NAME);
}

async function getThRegexes() {
    const TH = S.tavernHelper();
    if (!TH || typeof TH.getTavernRegexes !== 'function') return null;
    try {
        const list = await TH.getTavernRegexes({ type: 'global' });
        return Array.isArray(list) ? list : null;
    } catch (e) {
        return null;
    }
}

/**
 * 把图片 URL 写进「生图Tag美化」正则。
 * @param {string} url
 * @returns {Promise<string>} 实际写入的位置描述
 */
export async function writeTagImage(url) {
    // 1) 原生正则
    const { scripts, engine } = await getNativeScripts();
    const nativeTarget = scripts.find(isNativeTagBeautify);
    if (nativeTarget) {
        const after = setImgSrcInReplaceString(nativeTarget.replaceString || nativeTarget.replace_string || '', url);
        if (after === (nativeTarget.replaceString || nativeTarget.replace_string || '')) {
            throw new Error('「' + TAG_REGEX_NAME + '」正则里没有图片占位，无法写入');
        }
        const next = scripts.map((s) => (s === nativeTarget ? { ...s, replaceString: after } : s));
        await saveNativeScripts(next, engine);
        return 'native';
    }

    // 2) 酒馆助手全局正则
    const thList = await getThRegexes();
    if (thList) {
        const thTarget = thList.find(isThTagBeautify);
        if (thTarget) {
            const TH = S.tavernHelper();
            const after = setImgSrcInReplaceString(thTarget.replace_string || '', url);
            if (after === (thTarget.replace_string || '')) {
                throw new Error('「' + TAG_REGEX_NAME + '」正则里没有图片占位，无法写入');
            }
            await TH.updateTavernRegexesWith(
                (list) => (list || []).map((r) => (isThTagBeautify(r) ? { ...r, replace_string: after } : r)),
                { type: 'global' },
            );
            return 'tavern-helper';
        }
    }

    throw new Error('未找到「' + TAG_REGEX_NAME + '」正则，请先点「安装/检查配套资源」');
}

/**
 * 更新页面上已经渲染出来的 tag 图片（包含 TavernHelper 的 iframe）。
 * @param {string} url
 */
export function updateLiveTagImages(url) {
    const apply = (img) => {
        try {
            img.src = url;
            img.style.display = 'block';
        } catch (e) {
            /* ignore */
        }
    };
    try {
        document.querySelectorAll('#' + IMG_ID).forEach(apply);
        document.querySelectorAll('iframe').forEach((f) => {
            try {
                const doc = f.contentDocument;
                if (doc) doc.querySelectorAll('#' + IMG_ID).forEach(apply);
            } catch (e) {
                /* 跨域 iframe 忽略 */
            }
        });
    } catch (e) {
        /* ignore */
    }
}

/**
 * 记录本楼最近生成的图（同时写聊天元数据与酒馆助手的 chat 变量，供美化块读取）。
 * @param {string} url
 */
export async function storeLastImage(url) {
    await S.saveChatMeta({ [LAST_IMG_KEY]: url });
    const TH = S.tavernHelper();
    try {
        if (TH && typeof TH.updateVariablesWith === 'function') {
            await TH.updateVariablesWith(
                (vars) => {
                    vars = vars || {};
                    vars[LAST_IMG_KEY] = url;
                    return vars;
                },
                { type: 'chat' },
            );
        }
    } catch (e) {
        /* 没有酒馆助手也能用（美化块会退回读聊天元数据） */
    }
}

/**
 * 生成完成后的统一处理：上传图床 → 写正则 → 记录 → 刷新已渲染图片。
 * @param {string} dataUrl
 * @returns {Promise<{ url: string, inline: boolean }>}
 */
export async function handleGenerated(dataUrl) {
    let url = dataUrl;
    let inline = true;
    try {
        url = await uploadToTavern(dataUrl);
        inline = false;
    } catch (e) {
        // 图片不太大时用内嵌 base64 兜底
        if (dataUrl.length > 600000) {
            S.toastWarn('图片已生成，但上传酒馆图床失败：' + S.describeError(e));
            throw e;
        }
        S.toastWarn('上传图床失败，改用内嵌图片：' + S.describeError(e));
    }
    await writeTagImage(url);
    await storeLastImage(url);
    updateLiveTagImages(url);
    return { url, inline };
}

// ---------------------------------------------------------------------------
// 配套资源：2 条全局正则 + 1 本全局世界书
// ---------------------------------------------------------------------------

/**
 * 确保两条全局正则存在。
 * @returns {Promise<boolean>} 是否有新建
 */
export async function ensureRegexes() {
    let created = false;

    // 原生
    const { scripts, engine } = await getNativeScripts();
    if (scripts.length || engine || (S.getContext() && S.getContext().extensionSettings)) {
        const next = scripts.slice();
        if (!next.some(isNativeTagBeautify)) {
            next.push(normalizedToNativeRegex(makeTagBeautifyRegex()));
            created = true;
        }
        if (!next.some(isNativeTagHide)) {
            next.push(normalizedToNativeRegex(makeTagHideRegex()));
            created = true;
        }
        if (created) {
            await saveNativeScripts(next, engine);
            return true;
        }
        return false;
    }

    // 退回酒馆助手
    const TH = S.tavernHelper();
    if (TH && typeof TH.getTavernRegexes === 'function' && typeof TH.updateTavernRegexesWith === 'function') {
        const list = (await getThRegexes()) || [];
        const need = [];
        if (!list.some(isThTagBeautify)) need.push(makeTagBeautifyRegex());
        if (!list.some((r) => r.id === TAG_HIDE_REGEX_ID || r.script_name === TAG_HIDE_REGEX_NAME || r.name === TAG_HIDE_REGEX_NAME)) {
            need.push(makeTagHideRegex());
        }
        if (!need.length) return false;
        await TH.updateTavernRegexesWith((l) => {
            const arr = (l || []).slice();
            for (const r of need) if (!arr.some((x) => x.id === r.id || x.script_name === r.script_name)) arr.push(r);
            return arr;
        }, { type: 'global' });
        return true;
    }

    throw new Error('既没有酒馆原生正则存储，也没有酒馆助手，无法安装正则');
}

/**
 * 世界书是否已存在（原生端点）。
 * @returns {Promise<boolean>}
 */
async function nativeWorldbookExists() {
    try {
        const res = await fetch('/api/worldinfo/get', {
            method: 'POST',
            headers: S.getRequestHeaders(),
            body: JSON.stringify({ name: WB_NAME }),
        });
        if (!res.ok) return false;
        const json = await res.json();
        return !!(json && json.entries && Object.keys(json.entries).length > 0);
    } catch (e) {
        return false;
    }
}

/**
 * 世界书是否已被选为全局（原生或酒馆助手）。
 * @returns {Promise<boolean>}
 */
async function isWorldbookGlobal() {
    try {
        const wi = await loadWorldInfoModule();
        const list = wi && wi.world_info && Array.isArray(wi.world_info.globalSelect) ? wi.world_info.globalSelect : null;
        if (list && list.includes(WB_NAME)) return true;
    } catch (e) {
        /* ignore */
    }
    const TH = S.tavernHelper();
    try {
        if (TH && typeof TH.getGlobalWorldbookNames === 'function') {
            const names = await TH.getGlobalWorldbookNames();
            if (Array.isArray(names) && names.includes(WB_NAME)) return true;
        }
    } catch (e) {
        /* ignore */
    }
    return false;
}

/**
 * 把世界书挂为全局（原生方式：刷新列表 → 勾选 option → 触发酒馆自身的保存逻辑）。
 * @returns {Promise<boolean>}
 */
async function bindWorldbookGlobal() {
    // 酒馆助手优先（老配置就在它的列表里）
    const TH = S.tavernHelper();
    try {
        if (TH && typeof TH.getGlobalWorldbookNames === 'function' && typeof TH.rebindGlobalWorldbooks === 'function') {
            const names = (await TH.getGlobalWorldbookNames()) || [];
            if (Array.isArray(names) && !names.includes(WB_NAME)) {
                await TH.rebindGlobalWorldbooks(names.concat(WB_NAME));
                return true;
            }
        }
    } catch (e) {
        /* 继续尝试原生 */
    }

    try {
        const wi = await loadWorldInfoModule();
        if (!wi || typeof wi.onWorldInfoChange !== 'function') return false;
        if (typeof wi.updateWorldInfoList === 'function') await wi.updateWorldInfoList();

        const $ = window.jQuery || window.$;
        if (!$) return false;
        const $options = $('#world_info option');
        let matched = false;
        $options.each(function () {
            if ($(this).text() === WB_NAME) {
                $(this).prop('selected', true);
                matched = true;
            }
        });
        if (!matched) return false;

        // 酒馆自身处理 #world_info 的 change 时会重建 selected_world_info 并保存设置
        wi.onWorldInfoChange('__notSlashCommand__');
        $('#world_info').trigger('change');
        return true;
    } catch (e) {
        console.warn(`[${SCRIPT_TAG}] 全局世界书绑定失败`, e);
        return false;
    }
}

/**
 * 确保世界书「生图Tag输出规范」存在并勾选为全局。
 * @returns {Promise<{ created: boolean, bound: boolean }>}
 */
export async function ensureWorldbook() {
    let created = false;
    let bound = false;

    // 1) 酒馆助手的 getWorldbookNames 能列出所有世界书，先看它
    const TH = S.tavernHelper();
    let names = null;
    try {
        if (TH && typeof TH.getWorldbookNames === 'function') names = await TH.getWorldbookNames();
    } catch (e) {
        names = null;
    }
    const existsByList = Array.isArray(names) ? names.includes(WB_NAME) : null;

    if (existsByList === false) {
        try {
            if (TH && typeof TH.createWorldbook === 'function') {
                await TH.createWorldbook(WB_NAME, [makeThWorldbookEntry()]);
                created = true;
            } else if (TH && typeof TH.createOrReplaceWorldbook === 'function') {
                await TH.createOrReplaceWorldbook(WB_NAME, [makeThWorldbookEntry()]);
                created = true;
            }
        } catch (e) {
            console.warn(`[${SCRIPT_TAG}] 用酒馆助手创建世界书失败，改用原生端点`, e);
        }
    }

    // 2) 原生兜底：直接写世界书文件（已存在则跳过，避免覆盖用户改动）
    if (!created) {
        const exists = await nativeWorldbookExists();
        if (!exists) {
            const res = await fetch('/api/worldinfo/edit', {
                method: 'POST',
                headers: S.getRequestHeaders(),
                body: JSON.stringify({ name: WB_NAME, data: makeNativeWorldbookData() }),
            });
            if (!res.ok) throw new Error('创建世界书失败：HTTP ' + res.status);
            created = true;
        }
    }

    // 3) 勾选为全局
    if (!(await isWorldbookGlobal())) {
        bound = await bindWorldbookGlobal();
    } else {
        bound = true;
    }

    return { created, bound };
}

/**
 * 酒馆助手格式的世界书条目（与原脚本一致）。
 * @returns {object}
 */
function makeThWorldbookEntry() {
    return {
        uid: 1,
        name: WB_NAME,
        enabled: true,
        strategy: {
            type: 'constant',
            keys: [],
            keys_secondary: { logic: 'and_any', keys: [] },
            scan_depth: 'same_as_global',
        },
        position: { type: 'at_depth', role: 'system', depth: 0, order: 100 },
        content: WB_ENTRY_CONTENT,
        probability: 100,
        recursion: { prevent_incoming: false, prevent_outgoing: false, delay_until: null },
        effect: { sticky: null, cooldown: null, delay: null },
    };
}

/**
 * 一键安装/检查配套资源。
 * @returns {Promise<{ regexCreated: boolean, wbCreated: boolean, wbBound: boolean }>}
 */
export async function ensureResources() {
    const regexCreated = await ensureRegexes();
    const { created, bound } = await ensureWorldbook();
    const parts = [];
    if (regexCreated) parts.push('已安装 2 条全局正则');
    if (created) parts.push('已创建世界书「' + WB_NAME + '」');
    if (bound) parts.push('世界书已勾选为全局');
    if (!parts.length) S.toastInfo('配套资源已就绪');
    else S.toastSuccess(parts.join('；'));
    return { regexCreated, wbCreated: created, wbBound: bound };
}

// ---------------------------------------------------------------------------
// 生图流程
// ---------------------------------------------------------------------------

/**
 * 用一段提示词跑完整流程。
 * @param {string} prompt
 * @param {{ silent?: boolean }} [options]
 * @returns {Promise<{ dataUrl: string, url: string, via: string }>}
 */
export async function runGeneration(prompt, options = {}) {
    const cfg = S.getSettings();
    const text = String(prompt || '').trim();
    if (!text) throw new Error('提示词为空');
    if (!cfg.apiKey && !(await S.detectServer()).available) {
        throw new Error('尚未设置 API Key，请打开「生图面板」填写');
    }

    if (!options.silent) S.toastInfo('正在请求生图，请稍候…');
    const { dataUrl, via } = await generateImage(text, cfg);
    const { url, inline } = await handleGenerated(dataUrl);
    if (!options.silent) S.toastSuccess(inline ? '已以内嵌图片写入 tag 美化' : '已替换 tag 美化块中的图片');
    return { dataUrl, url, via };
}

/**
 * 自动检测流程：从最新一条助手消息里找 <@tags>。
 * @param {number} messageId
 * @param {{ onGenerated?: (dataUrl: string) => void }} [hooks]
 * @returns {Promise<boolean>} 是否触发了生图
 */
export async function handleMessageTags(messageId, hooks = {}) {
    const cfg = S.getSettings();
    if (!cfg.autoDetect) return false;
    const ctx = S.getContext();
    if (!ctx || !Array.isArray(ctx.chat)) return false;
    const msg = ctx.chat[messageId];
    if (!msg || msg.is_user) return false;

    const tags = extractTags(msg.mes || '');
    if (!tags) return false;

    const settings = S.getSettings();
    if (settings.lastHandledMessageId === messageId) return false;
    settings.lastHandledMessageId = messageId;
    S.saveSettings();

    const prompt = joinPrompt(tags, cfg.promptTemplate);
    const { dataUrl } = await runGeneration(prompt);
    if (typeof hooks.onGenerated === 'function') hooks.onGenerated(dataUrl);
    return true;
}
