/**
 * 服务端配置持久化。
 *
 * 配置文件位于插件目录下的 data/config.json（.gitignore 已排除），
 * 用于可选的「API Key 只存服务端」模式：面板勾选后，Key 不再依赖浏览器本地存储。
 * 也可以用环境变量覆盖：TAG_AUTO_IMAGE_API_KEY / TAG_AUTO_IMAGE_ENDPOINT。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeError } from './util.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(here, '..', 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

/** 允许写入服务端配置文件的键（避免面板塞入任意内容） */
const ALLOWED_KEYS = [
    'provider', 'apiKey', 'endpoint', 'model', 'width', 'height', 'steps', 'scale', 'sampler', 'nSamples',
    'promptTemplate', 'negativePrompt', 'openaiSize', 'openaiResponseFormat', 'genericBodyTemplate',
    'genericImagePath', 'genericImageIsUrl', 'modelsEndpoint', 'modelsAuth', 'proxyBase', 'timeoutMs',
];

/**
 * 读取服务端配置（不存在或损坏时返回空对象）。
 * @returns {Record<string, any>}
 */
export function readServerConfig() {
    try {
        if (!fs.existsSync(CONFIG_PATH)) return {};
        const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (e) {
        console.warn('[tag-auto-image] 读取服务端配置失败：' + describeError(e));
        return {};
    }
}

/**
 * 合并写入服务端配置。
 * @param {Record<string, any>} patch
 * @returns {Record<string, any>} 写入后的完整配置（apiKey 已被掩码）
 */
export function writeServerConfig(patch) {
    const current = readServerConfig();
    for (const [k, v] of Object.entries(patch || {})) {
        if (k === 'apiKey' && (v === '' || v === null)) {
            delete current.apiKey;
            continue;
        }
        if (ALLOWED_KEYS.includes(k)) current[k] = v;
    }
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(current, null, 4), 'utf8');
    } catch (e) {
        throw new Error('写入服务端配置失败（插件目录不可写？）：' + describeError(e));
    }
    return current;
}

/**
 * 返回给面板查看的配置（掩码 API Key，不回传明文）。
 * @returns {Record<string, any>}
 */
export function publicServerConfig() {
    const cfg = readServerConfig();
    const out = { ...cfg };
    if (out.apiKey) out.apiKey = maskKey(String(out.apiKey));
    out.hasApiKey = !!cfg.apiKey || !!process.env.TAG_AUTO_IMAGE_API_KEY;
    out.envApiKey = !!process.env.TAG_AUTO_IMAGE_API_KEY;
    return out;
}

/**
 * 掩码显示 Key，只保留首尾少量字符。
 * @param {string} key
 * @returns {string}
 */
export function maskKey(key) {
    if (!key) return '';
    if (key.length <= 10) return '*'.repeat(key.length);
    return key.slice(0, 4) + '****' + key.slice(-4);
}

/**
 * 合并优先级：请求体（面板） > 服务端配置文件 > 环境变量。
 * 面板只在勾选「把 Key 存到服务端」时才会把 Key 发给服务端，
 * 因此这里在请求体为空时回落到配置文件 / 环境变量，便于"浏览器不留 Key"的用法。
 * @param {Record<string, any>} body 请求体（面板当前设置）
 * @returns {Record<string, any>}
 */
export function resolveConfig(body = {}) {
    const file = readServerConfig();
    const merged = { ...file };
    for (const [k, v] of Object.entries(body || {})) {
        if (v === undefined || v === null || v === '') continue;
        merged[k] = v;
    }
    if (!merged.apiKey && process.env.TAG_AUTO_IMAGE_API_KEY) merged.apiKey = process.env.TAG_AUTO_IMAGE_API_KEY;
    if (!merged.endpoint && process.env.TAG_AUTO_IMAGE_ENDPOINT) merged.endpoint = process.env.TAG_AUTO_IMAGE_ENDPOINT;
    return merged;
}
