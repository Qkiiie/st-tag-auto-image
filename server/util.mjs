/**
 * 服务端通用工具：网络请求、ZIP/PNG 解析、模板填充、响应取值。
 * 只依赖 Node 内置模块，方便被扩展面板与服务端插件共用逻辑保持行为一致。
 */
import zlib from 'node:zlib';

/**
 * 把任意错误转成可读字符串。
 * @param {unknown} e
 * @returns {string}
 */
export function describeError(e) {
    if (e instanceof Error && e.message) return e.message;
    if (e && typeof e === 'object' && 'message' in e) return String(/** @type {{message: unknown}} */ (e).message);
    return String(e || '未知错误');
}

/**
 * 拼接代理前缀（用于自建反代 / 中转）。
 * @param {string} url
 * @param {string} [proxyBase]
 * @returns {string}
 */
export function proxied(url, proxyBase) {
    const base = proxyBase ? String(proxyBase).trim() : '';
    if (!base || !/^https?:\/\//i.test(url || '')) return url;
    return base + url;
}

/**
 * 带超时的 fetch。
 * @param {string} url
 * @param {RequestInit} options
 * @param {number} [timeoutMs]
 * @returns {Promise<Response>}
 */
export async function fetchWithTimeout(url, options = {}, timeoutMs = 180000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || 180000));
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } catch (e) {
        if (e && (e.name === 'AbortError' || describeError(e).includes('aborted'))) {
            throw new Error(`请求超时（${timeoutMs} ms）｜地址：${url}`);
        }
        throw new Error(`请求失败（地址不可达 / 证书错误 / 上游拒绝连接）：${describeError(e)}｜地址：${url}`);
    } finally {
        clearTimeout(timer);
    }
}

/**
 * 读取 JSON 请求体。SillyTavern 通常已经挂好 body parser，
 * 这里额外兼容未解析的情况，避免插件因为中间件差异拿不到 body。
 * @param {import('express').Request} req
 * @returns {Promise<any>}
 */
export async function readJsonBody(req) {
    if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
    /** @type {Buffer[]} */
    const chunks = [];
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const text = Buffer.concat(chunks).toString('utf8').trim();
    if (!text) return {};
    try {
        return JSON.parse(text);
    } catch (e) {
        throw new Error('请求体不是合法 JSON：' + describeError(e));
    }
}

/**
 * 用 {占位符} 填充模板（字符串值会被 JSON 转义，数字原样写入）。
 * @param {string} tpl
 * @param {Record<string, string|number>} vars
 * @returns {string}
 */
export function fillTemplate(tpl, vars) {
    return String(tpl || '').replace(/\{(\w+)\}/g, (m, key) => {
        if (!(key in vars)) return m;
        const v = vars[key];
        if (typeof v === 'number') return String(v);
        return JSON.stringify(String(v)).slice(1, -1);
    });
}

/**
 * 按 "a.b[0].c" 形式取嵌套值。
 * @param {any} obj
 * @param {string} path
 * @returns {any}
 */
export function getPath(obj, path) {
    if (!obj || !path) return null;
    const parts = String(path).replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
    let cur = obj;
    for (const part of parts) {
        if (cur == null) return null;
        cur = cur[part];
    }
    return cur;
}

/**
 * 从各种常见响应结构里抽取 base64 图片数据。
 * @param {any} json
 * @returns {string|null}
 */
export function extractBase64(json) {
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

/**
 * 从模型列表响应里抽取模型 id。
 * @param {any} json
 * @returns {string[]}
 */
export function extractModelIds(json) {
    /** @type {string[]} */
    const ids = [];
    const push = (v) => {
        if (typeof v === 'string' && v && !ids.includes(v)) ids.push(v);
    };
    if (!json || typeof json !== 'object') return ids;
    [json.data, json.models, json.result, json.items].forEach((arr) => {
        if (!Array.isArray(arr)) return;
        arr.forEach((item) => {
            if (typeof item === 'string') push(item);
            else if (item && typeof item === 'object') push(item.id || item.name || item.model || item.value);
        });
    });
    push(json.id);
    push(json.model);
    return ids;
}

/**
 * 补全 data URL 前缀。
 * @param {string} b64
 * @param {string} [mime]
 * @returns {string|null}
 */
export function toDataUrl(b64, mime = 'image/png') {
    if (typeof b64 !== 'string') return null;
    const s = b64.trim();
    if (/^data:/.test(s)) return s;
    return `data:${mime};base64,${s}`;
}

/** 判断 Buffer 是否是 ZIP（PK\x03\x04） */
export function isZipBuffer(buf) {
    return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
}

/** 判断 Buffer 是否是 PNG */
export function isPngBuffer(buf) {
    return buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
}

/**
 * 从 ZIP 中取出第一个 PNG（NovelAI 官方接口返回的就是 zip）。
 * 支持 store（method 0）与 deflate（method 8），用 Node 的 zlib 解压。
 * @param {Buffer} buf
 * @returns {{ mime: string, buffer: Buffer, name: string }}
 */
export function extractPngFromZipBuffer(buf) {
    const u8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

    // 找 EOCD
    let eocd = -1;
    const minStart = Math.max(0, u8.length - 22 - 65536);
    for (let i = u8.length - 22; i >= minStart; i--) {
        if (u8[i] === 0x50 && u8[i + 1] === 0x4b && u8[i + 2] === 0x05 && u8[i + 3] === 0x06) {
            eocd = i;
            break;
        }
    }
    if (eocd < 0) throw new Error('响应不是有效的 ZIP（找不到中央目录）');

    const cdOffset = dv.getUint32(eocd + 16, true);
    const total = dv.getUint16(eocd + 10, true);
    const decoder = new TextDecoder();
    let p = cdOffset;

    for (let j = 0; j < total; j++) {
        if (p + 46 > u8.length || dv.getUint32(p, true) !== 0x02014b50) break;
        const method = dv.getUint16(p + 10, true);
        const compSize = dv.getUint32(p + 20, true);
        const nameLen = dv.getUint16(p + 28, true);
        const extraLen = dv.getUint16(p + 30, true);
        const commentLen = dv.getUint16(p + 32, true);
        const localOffset = dv.getUint32(p + 42, true);
        const name = decoder.decode(u8.subarray(p + 46, p + 46 + nameLen));

        if (!name.startsWith('__MACOSX') && /\.(png|jpg|jpeg|webp)$/i.test(name)) {
            if (localOffset + 30 > u8.length) throw new Error('ZIP 局部头越界');
            const lnameLen = dv.getUint16(localOffset + 26, true);
            const lextraLen = dv.getUint16(localOffset + 28, true);
            const dataStart = localOffset + 30 + lnameLen + lextraLen;
            const comp = Buffer.from(u8.subarray(dataStart, dataStart + compSize));
            let out;
            if (method === 0) out = comp;
            else if (method === 8) out = zlib.inflateRawSync(comp);
            else throw new Error('不支持的 ZIP 压缩方式：' + method);
            const mime = /\.png$/i.test(name) ? 'image/png' : /\.webp$/i.test(name) ? 'image/webp' : 'image/jpeg';
            return { mime, buffer: Buffer.from(out), name };
        }
        p += 46 + nameLen + extraLen + commentLen;
    }
    throw new Error('ZIP 中未找到图片文件');
}

/**
 * 从接口地址推导模型列表地址（…/v1/images/generations → …/v1/models）。
 * @param {string} endpoint
 * @returns {string}
 */
export function deriveModelsEndpoint(endpoint) {
    const url = String(endpoint || '').trim();
    if (!url) return '';
    try {
        const u = new URL(url);
        const parts = u.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
        const idx = parts.lastIndexOf('v1');
        if (idx >= 0) {
            parts.length = idx + 1;
            u.pathname = '/' + parts.join('/') + '/models';
        } else {
            u.pathname = u.pathname.replace(/\/(images\/generations|images\/edits|generations|generate-image).*$/i, '') + '/models';
        }
        u.search = '';
        return u.toString();
    } catch (e) {
        return '';
    }
}
