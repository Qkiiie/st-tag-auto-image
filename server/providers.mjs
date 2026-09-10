/**
 * 服务端生图后端：NovelAI 官方 / OpenAI 兼容 / 通用 JSON 三种渠道。
 * 请求在服务端发出，天然绕开浏览器 CORS。
 */
import {
    describeError,
    proxied,
    fetchWithTimeout,
    fillTemplate,
    getPath,
    extractBase64,
    extractModelIds,
    toDataUrl,
    isZipBuffer,
    isPngBuffer,
    extractPngFromZipBuffer,
    deriveModelsEndpoint,
} from './util.mjs';

/** NAI 判定：v2/v3 走旧格式，v4+ 走新格式 */
function isNaiV3(model) {
    return /nai-diffusion-(2|3)/.test(model || '') || /furry/.test(model || '');
}

function naiLegacyBody(prompt, cfg) {
    return {
        input: prompt,
        model: cfg.model || 'nai-diffusion-3',
        action: 'generate',
        parameters: {
            width: cfg.width || 832,
            height: cfg.height || 1216,
            scale: cfg.scale || 5,
            sampler: cfg.sampler || 'k_euler',
            steps: cfg.steps || 28,
            n_samples: cfg.nSamples || 1,
            ucPreset: 0,
            qualityToggle: true,
            sm: false,
            sm_dyn: false,
            dynamic_thresholding: false,
            controlnet_strength: 1,
            legacy: false,
            add_original_image: false,
            cfg_rescale: 0,
            noise_schedule: 'native',
            negative_prompt: cfg.negativePrompt || '',
            uncond_scale: 1,
        },
    };
}

function naiV4Body(prompt, cfg) {
    const neg = cfg.negativePrompt || '';
    return {
        action: 'generate',
        input: prompt,
        model: cfg.model,
        parameters: {
            params_version: 3,
            prefer_brownian: true,
            negative_prompt: neg,
            height: cfg.height || 1216,
            width: cfg.width || 832,
            scale: cfg.scale || 9,
            seed: Math.floor(Math.random() * 9999999999),
            sampler: cfg.sampler || 'k_dpmpp_2m',
            noise_schedule: 'karras',
            steps: cfg.steps || 28,
            n_samples: cfg.nSamples || 1,
            ucPreset: 0,
            qualityToggle: false,
            add_original_image: false,
            controlnet_strength: 1,
            deliberate_euler_ancestral_bug: false,
            dynamic_thresholding: false,
            legacy: false,
            legacy_v3_extend: false,
            sm: false,
            sm_dyn: false,
            uncond_scale: 1,
            skip_cfg_above_sigma: null,
            use_coords: false,
            characterPrompts: [],
            reference_image_multiple: [],
            reference_information_extracted_multiple: [],
            reference_strength_multiple: [],
            v4_negative_prompt: { caption: { base_caption: neg, char_captions: [] } },
            v4_prompt: { caption: { base_caption: prompt, char_captions: [] }, use_coords: false, use_order: true },
        },
    };
}

function naiBody(prompt, cfg) {
    return isNaiV3(cfg.model) ? naiLegacyBody(prompt, cfg) : naiV4Body(prompt, cfg);
}

function openaiBody(prompt, cfg) {
    const size = (cfg.openaiSize || '') || `${cfg.width || 832}x${cfg.height || 1216}`;
    return {
        model: cfg.model || 'gpt-image-1',
        prompt,
        n: cfg.nSamples || 1,
        size,
        response_format: cfg.openaiResponseFormat || 'b64_json',
        negative_prompt: cfg.negativePrompt || '',
        width: cfg.width || 832,
        height: cfg.height || 1216,
        steps: cfg.steps || 28,
        scale: cfg.scale || 9,
        sampler: cfg.sampler || 'k_dpmpp_2m',
        n_samples: cfg.nSamples || 1,
        noise_schedule: 'karras',
    };
}

function genericBody(prompt, cfg) {
    const tpl = cfg.genericBodyTemplate;
    if (!tpl) throw new Error('通用渠道需要填写「请求体模板」');
    const vars = {
        model: cfg.model || '',
        prompt,
        negative: cfg.negativePrompt || '',
        width: cfg.width || 832,
        height: cfg.height || 1216,
        steps: cfg.steps || 28,
        scale: cfg.scale || 9,
        sampler: cfg.sampler || 'k_dpmpp_2m',
        seed: Math.floor(Math.random() * 9999999999),
    };
    const json = fillTemplate(tpl, vars);
    try {
        return JSON.parse(json);
    } catch (e) {
        throw new Error('通用请求体模板不是合法 JSON：' + describeError(e));
    }
}

/**
 * 构造认证头。
 * @param {Record<string, any>} cfg
 * @returns {Record<string, string>}
 */
function authHeaders(cfg) {
    /** @type {Record<string, string>} */
    const headers = {};
    const key = String(cfg.apiKey || '').trim();
    const mode = cfg.authMode || cfg.modelsAuth || 'bearer';
    if (key && mode !== 'none') {
        if (mode === 'x-api-key') headers['x-api-key'] = key;
        else if (mode === 'raw') headers['Authorization'] = key;
        else headers['Authorization'] = 'Bearer ' + key;
    }
    return headers;
}

/** 桌面浏览器 UA：与中转 Worker 用的是同一串 */
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/**
 * 出站请求头伪装层（对齐中转 Worker 的行为）。
 *
 * Node 的 fetch 默认带 node UA，且不带 Origin/Referer；部分中转站 / 反代会因此直接拒绝。
 * 这里补上桌面 UA，并把 Origin/Referer 写成真实上游站的同源值——等价于中转 Worker 里那几行。
 * @param {string} target 已套过代理前缀的最终地址
 * @param {string} [originSource] 未套代理的真实上游地址；有值时用它的 origin 生成 Origin/Referer
 * @returns {Record<string, string>}
 */
function transportHeaders(target, originSource) {
    /** @type {Record<string, string>} */
    const headers = {
        'User-Agent': DESKTOP_UA,
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    };
    for (const candidate of [originSource, target]) {
        try {
            const u = new URL(candidate);
            headers['Origin'] = u.origin;
            headers['Referer'] = u.origin + '/';
            break;
        } catch (e) {
            /* 候选地址不可解析，试下一个 */
        }
    }
    return headers;
}

/**
 * 发送 JSON 请求。
 * @param {string} url
 * @param {Record<string, any>} bodyObj
 * @param {Record<string, any>} cfg
 * @returns {Promise<Response>}
 */
async function postJson(url, bodyObj, cfg) {
    const target = proxied(url, cfg.proxyBase);
    const res = await fetchWithTimeout(
        target,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json, */*',
                ...transportHeaders(target, url),
                ...authHeaders(cfg),
            },
            body: JSON.stringify(bodyObj),
        },
        cfg.timeoutMs,
    );
    if (!res.ok) {
        let detail = '';
        try {
            detail = (await res.text()).slice(0, 500);
        } catch (e) {
            /* ignore */
        }
        throw new Error(`上游返回 HTTP ${res.status}${detail ? '：' + detail : ''}｜地址：${target}`);
    }
    return res;
}

/**
 * 把 URL 图片在服务端下载下来转成 data URL（浏览器端会被 CORS 拦的场景）。
 * @param {string} url
 * @param {Record<string, any>} cfg
 * @returns {Promise<{ mime: string, base64: string, dataUrl: string, bytes: number }>}
 */
async function urlToImage(url, cfg) {
    const target = proxied(url, cfg.proxyBase);
    const res = await fetchWithTimeout(target, { method: 'GET', headers: { ...transportHeaders(target, url), ...authHeaders(cfg) } }, cfg.timeoutMs);
    if (!res.ok) throw new Error(`下载图片失败 HTTP ${res.status}｜地址：${target}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const mime = (res.headers.get('content-type') || 'image/png').split(';')[0].trim() || 'image/png';
    return { mime, base64: buf.toString('base64'), dataUrl: toDataUrl(buf.toString('base64'), mime), bytes: buf.length };
}

/**
 * 把上游响应体解析成图片。
 * @param {Response} res
 * @param {Record<string, any>} cfg
 * @returns {Promise<{ mime: string, base64: string, dataUrl: string, bytes: number }>}
 */
async function responseToImage(res, cfg) {
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    const buf = Buffer.from(await res.arrayBuffer());

    // 直接返回二进制图片
    if (isPngBuffer(buf) || (contentType.startsWith('image/') && !isZipBuffer(buf))) {
        const mime = contentType.startsWith('image/') ? contentType.split(';')[0].trim() : 'image/png';
        return { mime, base64: buf.toString('base64'), dataUrl: toDataUrl(buf.toString('base64'), mime), bytes: buf.length };
    }

    // NovelAI 官方返回 zip 包裹的 png
    if (isZipBuffer(buf)) {
        const { mime, buffer } = extractPngFromZipBuffer(buf);
        const base64 = buffer.toString('base64');
        return { mime, base64, dataUrl: toDataUrl(base64, mime), bytes: buffer.length };
    }

    // JSON 响应
    const text = buf.toString('utf8');
    let json;
    try {
        json = JSON.parse(text);
    } catch (e) {
        throw new Error(`无法解析上游响应（既非图片、也非 ZIP、也不是 JSON）：${text.slice(0, 300)}`);
    }

    const item = (json.data && json.data[0]) || json;
    if (item && item.url) return await urlToImage(String(item.url), cfg);

    const b64 = extractBase64(json);
    if (b64) {
        const dataUrlStr = toDataUrl(b64);
        return { mime: 'image/png', base64: b64, dataUrl: dataUrlStr, bytes: Math.floor((b64.length * 3) / 4) };
    }
    throw new Error('上游响应里没有找到图片数据：' + JSON.stringify(json).slice(0, 300));
}

/**
 * 通用渠道：按配置的路径从 JSON 里取图。
 * @param {Response} res
 * @param {Record<string, any>} cfg
 */
async function genericResponseToImage(res, cfg) {
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    const buf = Buffer.from(await res.arrayBuffer());
    if (isZipBuffer(buf)) {
        const { mime, buffer } = extractPngFromZipBuffer(buf);
        const base64 = buffer.toString('base64');
        return { mime, base64, dataUrl: toDataUrl(base64, mime), bytes: buffer.length };
    }
    if (isPngBuffer(buf) || contentType.startsWith('image/')) {
        const mime = contentType.startsWith('image/') ? contentType.split(';')[0].trim() : 'image/png';
        return { mime, base64: buf.toString('base64'), dataUrl: toDataUrl(buf.toString('base64'), mime), bytes: buf.length };
    }
    const text = buf.toString('utf8');
    let json;
    try {
        json = JSON.parse(text);
    } catch (e) {
        throw new Error('无法解析上游响应 JSON：' + text.slice(0, 300));
    }
    const path = cfg.genericImagePath || 'data[0].b64_json';
    const raw = getPath(json, path);
    if (!raw) throw new Error(`未找到图片数据（路径：${path}）｜响应片段：${JSON.stringify(json).slice(0, 300)}`);
    if (cfg.genericImageIsUrl) return await urlToImage(String(raw), cfg);
    const str = String(raw);
    const mime = /^data:(image\/[a-z+]+)/i.test(str) ? /^data:(image\/[a-z+]+)/i.exec(str)[1] : 'image/png';
    return { mime, base64: str, dataUrl: toDataUrl(str, mime), bytes: Math.floor((str.length * 3) / 4) };
}

/**
 * 生成图片。
 * @param {string} prompt
 * @param {Record<string, any>} cfg
 * @returns {Promise<{ mime: string, base64: string, dataUrl: string, bytes: number, provider: string, model: string }>}
 */
export async function generateImage(prompt, cfg) {
    const provider = cfg.provider || 'nai';
    const started = Date.now();
    let image;

    if (provider === 'nai') {
        if (!cfg.endpoint) throw new Error('请填写 NovelAI 接口地址');
        const res = await postJson(cfg.endpoint, naiBody(prompt, cfg), cfg);
        image = await responseToImage(res, cfg);
    } else if (provider === 'openai') {
        const endpoint = cfg.endpoint || 'https://api.openai.com/v1/images/generations';
        const res = await postJson(endpoint, openaiBody(prompt, cfg), cfg);
        image = await responseToImage(res, cfg);
    } else if (provider === 'generic') {
        if (!cfg.endpoint) throw new Error('请填写通用渠道的接口地址');
        const res = await postJson(cfg.endpoint, genericBody(prompt, cfg), cfg);
        image = await genericResponseToImage(res, cfg);
    } else {
        throw new Error('未知的接口类型：' + provider);
    }

    return {
        ...image,
        provider,
        model: cfg.model || '',
        elapsedMs: Date.now() - started,
        prompt,
    };
}

/**
 * 拉取模型列表。
 * @param {Record<string, any>} cfg
 * @returns {Promise<{ models: string[], endpoint: string }>}
 */
export async function fetchModels(cfg) {
    const explicit = String(cfg.modelsEndpoint || '').trim();
    const url = explicit || deriveModelsEndpoint(cfg.endpoint || '');
    if (!url) throw new Error('请填写「模型列表地址」，或填写可推导出模型的「接口地址」');
    const target = proxied(url, cfg.proxyBase);
    const res = await fetchWithTimeout(
        target,
        { method: 'GET', headers: { Accept: 'application/json', ...transportHeaders(target, url), ...authHeaders(cfg) } },
        Math.min(Number(cfg.timeoutMs) || 60000, 60000),
    );
    if (!res.ok) {
        let detail = '';
        try {
            detail = (await res.text()).slice(0, 300);
        } catch (e) {
            /* ignore */
        }
        throw new Error(`拉取模型失败 HTTP ${res.status}${detail ? '：' + detail : ''}｜地址：${target}`);
    }
    let json;
    try {
        json = await res.json();
    } catch (e) {
        throw new Error('模型列表响应不是 JSON｜地址：' + target);
    }
    const models = extractModelIds(json);
    if (!models.length) {
        throw new Error('响应中没有找到模型 id｜响应片段：' + JSON.stringify(json).slice(0, 300));
    }
    return { models, endpoint: target };
}
