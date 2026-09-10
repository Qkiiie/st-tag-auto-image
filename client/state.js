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
 * 酒馆助手（TavernHelper）全局对象。存在时优先用它写正则 / 世界书，保持与原脚本一致。
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
