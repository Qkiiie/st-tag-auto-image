/**
 * TauriTavern 宿主适配（可选）。
 *
 * TauriTavern 用 Rust 重写了后端、没有 Node.js 运行时，因此：
 *   - 不存在 plugins/ + enableServerPlugins 这套服务端插件机制；
 *   - 宿主只拦截「同源」请求，外部生图接口仍然是 WebView 原生请求。
 * 结论：在 TauriTavern 上应当使用「浏览器直连」模式，不需要（也无法）使用服务端插件。
 *
 * 本模块只做最小探测与提示，不依赖任何 TauriTavern 专有接口，缺失时全部安全降级。
 */

/**
 * 是否运行在 TauriTavern 里。
 * @returns {boolean}
 */
export function isTauriTavern() {
    try {
        return !!(window.__TAURITAVERN__ || window.__TAURITAVERN_MAIN_READY__ || window.__TAURI_RUNNING__);
    } catch (e) {
        return false;
    }
}

/**
 * 宿主 ABI 入口（可能尚未就绪，用 waitHostReady() 等待）。
 * @returns {any|null}
 */
export function getHost() {
    try {
        return window.__TAURITAVERN__ || null;
    } catch (e) {
        return null;
    }
}

/**
 * 等待宿主层初始化完成（超时或非 TauriTavern 环境时直接返回）。
 * @param {number} [timeoutMs]
 * @returns {Promise<any|null>}
 */
export async function waitHostReady(timeoutMs = 8000) {
    if (!isTauriTavern()) return null;
    const pending = (() => {
        try {
            const host = window.__TAURITAVERN__;
            if (host && host.ready && typeof host.ready.then === 'function') return host.ready;
            if (window.__TAURITAVERN_MAIN_READY__ && typeof window.__TAURITAVERN_MAIN_READY__.then === 'function') {
                return window.__TAURITAVERN_MAIN_READY__;
            }
        } catch (e) {
            /* ignore */
        }
        return null;
    })();
    if (!pending) return getHost();
    try {
        await Promise.race([
            pending,
            new Promise((resolve) => setTimeout(resolve, timeoutMs)),
        ]);
    } catch (e) {
        /* 宿主初始化失败时继续，扩展自身功能不依赖它 */
    }
    return getHost();
}

/**
 * 全局持久化存储（api.extension.store）。可用时可以把设置存在这里，
 * 不依赖酒馆的 extension_settings；不可用时返回 null。
 * @returns {any|null}
 */
export function getHostStore() {
    try {
        const host = getHost();
        return (host && host.api && host.api.extension && host.api.extension.store) || null;
    } catch (e) {
        return null;
    }
}

/** 扩展在宿主存储里的命名空间（只允许 [A-Za-z0-9_.-]） */
export const HOST_NAMESPACE = 'tag-auto-image';

/**
 * 从宿主存储读一份 JSON（失败或不存在返回 null）。
 * @param {string} key
 * @returns {Promise<any|null>}
 */
export async function hostGetJson(key) {
    const store = getHostStore();
    if (!store || typeof store.tryGetJson !== 'function') return null;
    try {
        const r = await store.tryGetJson({ namespace: HOST_NAMESPACE, key });
        return r && r.found ? r.value : null;
    } catch (e) {
        return null;
    }
}

/**
 * 往宿主存储写一份 JSON（失败静默）。
 * @param {string} key
 * @param {any} value
 * @returns {Promise<boolean>}
 */
export async function hostSetJson(key, value) {
    const store = getHostStore();
    if (!store || typeof store.setJson !== 'function') return false;
    try {
        await store.setJson({ namespace: HOST_NAMESPACE, key, value });
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * 运行环境摘要，用于面板状态与日志。
 * @returns {{ kind: 'tauritavern'|'sillytavern', hasNodeBackend: boolean, label: string }}
 */
export function describeRuntime() {
    if (isTauriTavern()) {
        return { kind: 'tauritavern', hasNodeBackend: false, label: 'TauriTavern 原生客户端模式' };
    }
    return { kind: 'sillytavern', hasNodeBackend: true, label: 'SillyTavern（可使用 Node 服务端插件）' };
}
