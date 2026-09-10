/**
 * 服务端插件的 API 路由。
 *
 * 由 index.mjs 的 init(router) 调用；SillyTavern 会把本 router 挂载到
 * /api/plugins/tag-auto-image/ 之下，因此这些路径最终形如：
 *   GET  /api/plugins/tag-auto-image/ping
 *   GET  /api/plugins/tag-auto-image/config
 *   POST /api/plugins/tag-auto-image/config
 *   POST /api/plugins/tag-auto-image/generate
 *   POST /api/plugins/tag-auto-image/models
 *
 * 注意：/api/* 会经过 SillyTavern 自身的鉴权与 CSRF 校验，
 * 因此面板必须带上酒馆的请求头（扩展里用 SillyTavern.getRequestHeaders()）。
 */
import { PLUGIN_ID, PLUGIN_VERSION } from '../shared/resources.mjs';
import { describeError, readJsonBody } from './util.mjs';
import { publicServerConfig, resolveConfig, writeServerConfig, readServerConfig } from './config.mjs';
import { generateImage, fetchModels } from './providers.mjs';

/**
 * 统一的 JSON 响应。
 * @param {import('express').Response} res
 * @param {number} status
 * @param {Record<string, any>} payload
 */
function sendJson(res, status, payload) {
    try {
        res.status(status).set('Cache-Control', 'no-store').json(payload);
    } catch (e) {
        console.error(`[${PLUGIN_ID}] 响应失败`, e);
    }
}

/**
 * 挂载路由。
 * @param {import('express').Router} router
 */
export function attachRoutes(router) {
    router.get('/ping', (_req, res) => {
        sendJson(res, 200, {
            ok: true,
            id: PLUGIN_ID,
            version: PLUGIN_VERSION,
            modelsEndpointSupported: true,
            serverTime: new Date().toISOString(),
        });
    });

    router.get('/config', (_req, res) => {
        sendJson(res, 200, { ok: true, config: publicServerConfig() });
    });

    router.post('/config', async (req, res) => {
        try {
            const body = await readJsonBody(req);
            const saved = writeServerConfig(body && body.config ? body.config : body);
            sendJson(res, 200, { ok: true, config: publicServerConfig(), keys: Object.keys(saved) });
        } catch (e) {
            sendJson(res, 400, { ok: false, error: describeError(e) });
        }
    });

    router.post('/generate', async (req, res) => {
        let cfgForLog = {};
        try {
            const body = await readJsonBody(req);
            const prompt = String(body.prompt || '').trim();
            if (!prompt) return sendJson(res, 400, { ok: false, error: 'prompt 不能为空' });

            const cfg = resolveConfig(body);
            cfgForLog = { provider: cfg.provider, model: cfg.model, endpoint: cfg.endpoint };

            const image = await generateImage(prompt, cfg);

            // ?raw=1 时直接回流二进制图片（方便调试或直接当作 <img src> 使用）
            const wantRaw = String(req.query?.raw || '') === '1';
            if (wantRaw) {
                res.status(200).set('Content-Type', image.mime).set('Cache-Control', 'no-store').send(Buffer.from(image.base64, 'base64'));
                return;
            }

            sendJson(res, 200, {
                ok: true,
                mime: image.mime,
                dataUrl: image.dataUrl,
                bytes: image.bytes,
                provider: image.provider,
                model: image.model,
                elapsedMs: image.elapsedMs,
            });
        } catch (e) {
            console.error(`[${PLUGIN_ID}] 生图失败`, cfgForLog, e);
            sendJson(res, 200, { ok: false, error: describeError(e) });
        }
    });

    router.post('/models', async (req, res) => {
        try {
            const body = await readJsonBody(req);
            const cfg = resolveConfig(body);
            const result = await fetchModels(cfg);
            sendJson(res, 200, { ok: true, models: result.models, endpoint: result.endpoint });
        } catch (e) {
            sendJson(res, 200, { ok: false, error: describeError(e) });
        }
    });

    router.get('/status', (_req, res) => {
        const cfg = readServerConfig();
        sendJson(res, 200, {
            ok: true,
            id: PLUGIN_ID,
            version: PLUGIN_VERSION,
            hasServerApiKey: !!cfg.apiKey || !!process.env.TAG_AUTO_IMAGE_API_KEY,
            configKeys: Object.keys(cfg),
        });
    });
}
