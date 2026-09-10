/**
 * 客户端基础层：酒馆上下文、设置持久化、toast、以及服务端插件探测。
 * 扩展入口为 /scripts/extensions/third-party/<本目录>/client/index.js。
 */
import { DEFAULTS, SCRIPT_TAG, PLUGIN_ID } from '../shared/resources.mjs';
import { isTauriTavern as ttIsTauriTavern, describeRuntime as ttDescribeRuntime } from './tauritavern.js';

export { DEFAULTS, SCRIPT_TAG, PLUGIN_ID };
export { ttIsTauriTavern as isTauriTavern, ttDescribeRuntime as describeRuntime };

/** extension_settings 里的唯一键 */
export const MODULE_NAME = 'tag_auto_image';

/** 服务端插件的固定路由前缀（SillyTavern 用插件 info.id 挂载） */
export const DEFAULT_SERVER_BASE = `/api/plugins/${PLUGIN_ID}`;

/**
 * 当前窗口的 SillyTavern 全局对象。
 * @returns {any}
 */
export function getSt() {
    try {
        return window.SillyTavern || (window.parent && window.parent.SillyTavern) || null;
    } catch (e) {
        try {
            return window.SillyTavern || null;
        } catch (e2) {
            return null;
        }
    }
}

/**
 * 酒馆上下文（getContext）。
 * @returns {any}
 */
export function getContext() {
    const ST = getSt();
    try {
        return ST && typeof ST.getContext === 'function' ? ST.getContext() : null;
    } catch (e) {
        return null;
    }
}

/**
 * 酒馆助手（TavernHelper）全局对象。存在时优先用它写正则 / 世界书，兼容老配置。
 * @returns {any}
 */
export function tavernHelper() {
    try {
        return window.TavernHelper || (window.parent && window.parent.TavernHelper) || null;
    } catch (e) {
        return null;
    }
}

/**
 * 读取扩展设置（带默认值补全）。
 * @returns {Record<string, any>}
 */
export function getSettings() {
    const ctx = getContext();
    const fallback = () => ({ ...structuredClone(DEFAULTS) });
    if (!ctx || !ctx.extensionSettings) return fallback();
    if (!ctx.extensionSettings[MODULE_NAME] || typeof ctx.extensionSettings[MODULE_NAME] !== 'object') {
        ctx.extensionSettings[MODULE_NAME] = structuredClone(DEFAULTS);
    }
    const s = ctx.extensionSettings[MODULE_NAME];
    for (const key of Object.keys(DEFAULTS)) {
        if (!(key in s)) s[key] = structuredClone(DEFAULTS[key]);
    }
    return s;
}

/**
 * 持久化扩展设置。
 */
export function saveSettings() {
    try {
        const ctx = getContext();
        if (ctx && typeof ctx.saveSettingsDebounced === 'function') ctx.saveSettingsDebounced();
    } catch (e) {
        console.warn(`[${SCRIPT_TAG}] 保存设置失败`, e);
    }
}

/**
 * 酒馆请求头（含 CSRF），调用 /api/* 必需。
 * @returns {Record<string, string>}
 */
export function getRequestHeaders() {
    const ST = getSt();
    try {
        if (ST && typeof ST.getRequestHeaders === 'function') return ST.getRequestHeaders();
    } catch (e) {
        /* ignore */
    }
    try {
        const ctx = getContext();
        if (ctx && typeof ctx.getRequestHeaders === 'function') return ctx.getRequestHeaders();
    } catch (e) {
        /* ignore */
    }
    return { 'Content-Type': 'application/json' };
}

/**
 * 错误转字符串。
 * @param {unknown} e
 * @returns {string}
 */
export function describeError(e) {
    if (e instanceof Error && e.message) return e.message;
    if (e && typeof e === 'object' && 'message' in e) return String(/** @type {{message: unknown}} */ (e).message);
    return String(e || '未知错误');
}

/**
 * HTML 转义。
 * @param {unknown} s
 * @returns {string}
 */
export function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function toast(type, msg, title = SCRIPT_TAG) {
    let t = null;
    try {
        t = window.toastr || (window.parent && window.parent.toastr) || null;
    } catch (e) {
        t = null;
    }
    if (t && typeof t[type] === 'function') {
        try {
            t[type](msg, title);
            return;
        } catch (e) {
            /* fallthrough */
        }
    }
    const fn = type === 'error' ? 'error' : 'log';
    console[fn](`[${title}] ${msg}`);
}

export const toastInfo = (m) => toast('info', m);
export const toastSuccess = (m) => toast('success', m);
export const toastWarn = (m) => toast('warning', m);
export const toastError = (e) => toast('error', describeError(e));

/**
 * 当前聊天的元数据对象（用于记住"本楼最近生成的图"）。
 * @returns {Record<string, any>|null}
 */
export function getChatMeta() {
    const ctx = getContext();
    return ctx && ctx.chatMetadata ? ctx.chatMetadata : null;
}

/**
 * 写入当前聊天的元数据并保存。
 * @param {Record<string, any>} patch
 */
export async function saveChatMeta(patch) {
    const ctx = getContext();
    const meta = getChatMeta();
    if (!meta) return false;
    Object.assign(meta, patch);
    try {
        if (ctx && typeof ctx.saveMetadata === 'function') await ctx.saveMetadata();
        return true;
    } catch (e) {
        console.warn(`[${SCRIPT_TAG}] 保存聊天元数据失败`, e);
        return false;
    }
}

// ---------------------------------------------------------------------------
// 服务端插件探测
// ---------------------------------------------------------------------------

/** @type {{base: string|null, checkedAt: number, available: boolean}} */
const serverState = { base: null, checkedAt: 0, available: false };

/** 最近一次探测失败的原因，用于面板提示 */
let lastProbeDetail = '';

/** 探测结果缓存时长（毫秒） */
const PROBE_TTL = 30000;

/**
 * 服务端插件的候选地址。
 * @returns {string[]}
 */
function serverCandidates() {
    const s = getSettings();
    /** @type {string[]} */
    const list = [];
    const manual = String(s.serverBase || '').trim().replace(/\/+$/, '');
    if (manual) list.push(manual);
    if (!list.includes(DEFAULT_SERVER_BASE)) list.push(DEFAULT_SERVER_BASE);
    return list;
}

/**
 * 探测服务端插件是否可用。
 * @param {boolean} [force]
 * @returns {Promise<{ available: boolean, base: string|null }>}
 */
export async function detectServer(force = false) {
    // TauriTavern 后端是 Rust、没有 Node 运行时，不存在服务端插件：直接判定不可用，避免无意义探测
    if (ttIsTauriTavern() && !String(getSettings().serverBase || '').trim()) {
        serverState.available = false;
        serverState.base = null;
        serverState.checkedAt = Date.now();
        lastProbeDetail = 'TauriTavern 无 Node 后端，已按客户端直连模式运行';
        return { available: false, base: null };
    }
    const now = Date.now();
    if (!force && now - serverState.checkedAt < PROBE_TTL) {
        return { available: serverState.available, base: serverState.base };
    }
    for (const base of serverCandidates()) {
        try {
            const res = await fetch(`${base}/ping`, { method: 'GET', headers: getRequestHeaders(), cache: 'no-store' });
            if (!res.ok) {
                lastProbeDetail = `HTTP ${res.status}`;
                continue;
            }
            const json = await res.json();
            if (json && json.ok) {
                serverState.base = base;
                serverState.available = true;
                serverState.checkedAt = now;
                return { available: true, base };
            }
        } catch (e) {
            lastProbeDetail = describeError(e);
            /* 试下一个候选 */
        }
    }
    serverState.base = null;
    serverState.available = false;
    serverState.checkedAt = now;
    return { available: false, base: null };
}

/** 读取最近一次探测失败的原因 */
export function getLastProbeDetail() {
    return lastProbeDetail;
}

/**
 * 调用服务端插件接口。
 * @param {string} path
 * @param {Record<string, any>} [body]
 * @param {{ method?: string, force?: boolean }} [options]
 * @returns {Promise<any>}
 */
export async function callServer(path, body, options = {}) {
    const { available, base } = await detectServer(!!options.force);
    if (!available || !base) {
        throw new Error('未检测到服务端插件，请确认已 clone 到 plugins/ 并在 config.yaml 里开启 enableServerPlugins');
    }
    const method = options.method || (body ? 'POST' : 'GET');
    const res = await fetch(`${base}${path}`, {
        method,
        headers: getRequestHeaders(),
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
    });
    const text = await res.text();
    let json = null;
    try {
        json = text ? JSON.parse(text) : null;
    } catch (e) {
        throw new Error(`服务端返回了非 JSON 响应（HTTP ${res.status}）：${text.slice(0, 200)}`);
    }
    if (!res.ok) {
        throw new Error(json && json.error ? json.error : `服务端返回 HTTP ${res.status}`);
    }
    if (json && json.ok === false) throw new Error(json.error || '服务端处理失败');
    return json;
}

/**
 * 服务端是否已探测为可用（不发起请求）。
 * @returns {boolean}
 */
export function isServerCached() {
    return serverState.available;
}

/**
 * 当前使用的服务端基地址。
 * @returns {string|null}
 */
export function getServerBase() {
    return serverState.base;
}
