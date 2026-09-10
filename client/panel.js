/**
 * 生图面板 UI：把原「Tag自动生图」面板搬到扩展里，并新增服务端相关选项。
 * 样式在 client/style.css（由 manifest.json 的 css 字段加载）。
 */
import { SCRIPT_TAG, DEFAULTS, MODEL_PRESETS, PROXY_PREFIX } from '../shared/resources.mjs';
import * as S from './state.js';
import * as P from './pipeline.js';
import * as T from './tauritavern.js';

const PANEL_ID = 'taggen-root';
const STYLE_ID = 'taggen-style';

/** @type {HTMLElement|null} */
let panelRoot = null;
/** @type {string|null} 面板里最近一次生成、尚未写入的图片 */
let lastGenerated = null;

/** 面板结构（保持与原脚本一致的 id，方便老用户上手） */
const PANEL_HTML = `
<div id="taggen-card">
  <div class="tg-head">
    <span class="tg-title">🍑 桃桃绘图</span>
    <button class="tg-close" id="tg-close" type="button">×</button>
  </div>

  <div class="tg-sec">接口设置</div>
  <label>接口类型</label>
  <select id="tg-provider">
    <option value="nai">NovelAI 官方</option>
    <option value="openai">OpenAI 兼容</option>
    <option value="generic">通用 JSON</option>
  </select>
  <label>API Key</label>
  <input type="password" id="tg-key" autocomplete="off" placeholder="Bearer Token（通用/本地接口可留空）">
  <label>接口地址</label>
  <input type="text" id="tg-endpoint" autocomplete="off" placeholder="https://...">
  <div id="tg-proxy-wrap" style="display:none">
    <label>代理前缀（固定，不可修改）</label>
    <input type="text" id="tg-proxy-base" autocomplete="off" disabled>
    <div style="font-size:11.5px;color:#8f97ad;margin-top:4px;line-height:1.5">「OpenAI 兼容 / 通用 JSON」渠道经此反代转发；「NovelAI 官方」直连不走代理。</div>
  </div>
  <label>模型</label>
  <input type="text" id="tg-model" list="tg-model-presets" autocomplete="off">
  <datalist id="tg-model-presets"></datalist>
  <div class="tg-row" style="margin-top:6px">
    <button class="tg-btn" id="tg-fetch-models" type="button">📡 拉取模型</button>
  </div>
  <label>认证方式（生图与拉取模型共用）</label>
  <select id="tg-models-auth">
    <option value="bearer">Authorization: Bearer &lt;key&gt;</option>
    <option value="x-api-key">x-api-key: &lt;key&gt;</option>
    <option value="raw">Authorization: &lt;key&gt;（key 已含前缀）</option>
    <option value="none">无认证</option>
  </select>
  <label>请求超时（毫秒，服务端生效）</label>
  <input type="text" id="tg-timeout" autocomplete="off" placeholder="180000">

  <div id="tg-nai-extra">
    <label>画面尺寸（宽 × 高）</label>
    <div class="tg-row">
      <input type="text" id="tg-width" class="w60">
      <span style="flex:0 0 auto;color:#aeb4c8">×</span>
      <input type="text" id="tg-height" class="w60">
      <span style="flex:1;font-size:12px;color:#aeb4c8">常用 832×1216 / 1216×832</span>
    </div>
    <div class="tg-row">
      <span style="flex:1"><label>步数</label><input type="text" id="tg-steps"></span>
      <span style="flex:1"><label>Scale</label><input type="text" id="tg-scale"></span>
    </div>
    <div class="tg-row">
      <span style="flex:1"><label>采样器</label><input type="text" id="tg-sampler"></span>
      <span style="flex:1"><label>张数</label><input type="text" id="tg-nsamples"></span>
    </div>
  </div>

  <div id="tg-openai-extra" style="display:none">
    <label>尺寸（留空则用 宽×高）</label>
    <input type="text" id="tg-openai-size" placeholder="1024x1024 / 1536x1024 / 1024x1536">
    <label>返回格式</label>
    <select id="tg-openai-format">
      <option value="b64_json">b64_json</option>
      <option value="url">url</option>
    </select>
  </div>

  <div id="tg-generic-extra" style="display:none">
    <label>请求体模板（JSON，占位符 {model} {prompt} {negative} {width} {height} {steps} {seed} {scale} {sampler}）</label>
    <textarea id="tg-generic-template"></textarea>
    <label>响应图片路径</label>
    <input type="text" id="tg-generic-path" placeholder="data[0].b64_json / images[0] / image">
    <label class="tg-toggle"><input type="checkbox" id="tg-generic-isurl"><span class="tg-track"><span class="tg-thumb"></span></span><span>图片路径返回的是 URL（而非 base64）</span></label>
  </div>

  <div class="tg-sec">提示词</div>
  <label>正向提示词（原样发送，tag 会追加其后）</label>
  <textarea id="tg-pos"></textarea>
  <label>负向提示词</label>
  <textarea id="tg-neg"></textarea>
  <label class="tg-toggle"><input type="checkbox" id="tg-auto"><span class="tg-track"><span class="tg-thumb"></span></span><span>自动读取正文末尾 &lt;@tags&gt; 并生图</span></label>

  <div class="tg-sec">生图</div>
  <label>直接输入提示词（可选，会追加到正向提示词后）</label>
  <textarea id="tg-custom" placeholder="例如：1girl, solo, long silver hair, ..."></textarea>
  <div class="tg-actions">
    <button class="tg-btn" id="tg-gen-custom" type="button">✨ 用上方提示词生图</button>
  </div>

  <div class="tg-sec">最近生成</div>
  <div id="tg-preview-wrap" style="display:none;text-align:center;">
    <img id="tg-preview" alt="最近生成">
    <div class="tg-actions" style="justify-content:center;">
      <button class="tg-btn primary" id="tg-preview-apply" type="button">💾 写入 tag 美化</button>
      <button class="tg-btn" id="tg-preview-download" type="button">⬇️ 下载</button>
      <button class="tg-btn" id="tg-preview-discard" type="button">🗑 丢弃</button>
    </div>
  </div>

  <div class="tg-sec">配套资源</div>
  <div class="tg-actions">
    <button class="tg-btn" id="tg-ensure" type="button">🛠 安装/检查配套资源（世界书 + 2 正则）</button>
  </div>

  <div class="tg-actions">
    <button class="tg-btn primary" id="tg-save" type="button">💾 保存设置</button>
  </div>
  <div class="tg-status" id="tg-status"></div>
</div>`;

/**
 * 创建（或复用）面板。
 * @returns {HTMLElement}
 */
export function ensurePanel() {
    if (panelRoot && document.body.contains(panelRoot)) return panelRoot;

    const old = document.getElementById(PANEL_ID);
    if (old && old.parentNode) old.parentNode.removeChild(old);

    if (!document.getElementById(STYLE_ID)) {
        // style.css 由 manifest 加载；这里只是兜底（例如用户在酒馆外部加载脚本时）
        if (!document.querySelector('link[href$="style.css"], link[data-tag-auto-image]')) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.id = STYLE_ID;
            link.href = new URL('./style.css', import.meta.url).href;
            link.setAttribute('data-tag-auto-image', '1');
            document.head.appendChild(link);
        }
    }

    const root = document.createElement('dialog');
    root.id = PANEL_ID;
    root.setAttribute('hidden', '');
    root.innerHTML = PANEL_HTML;
    root.style.position = 'fixed';
    root.style.inset = '0';
    root.style.width = '100%';
    root.style.height = '100%';
    root.style.maxWidth = 'none';
    root.style.maxHeight = 'none';
    root.style.margin = '0';
    root.style.padding = '0';
    root.style.zIndex = '2147483000';
    root.style.border = '0';
    root.style.background = 'rgba(5,8,16,.62)';
    document.body.appendChild(root);
    panelRoot = root;

    root.querySelector('#tg-close').addEventListener('click', closePanel);
    root.addEventListener('click', (e) => {
        if (e.target === root) closePanel();
    });
    root.querySelector('#tg-save').addEventListener('click', () => {
        savePanel().catch(S.toastError);
    });
    root.querySelector('#tg-gen-custom').addEventListener('click', () => {
        genCustomFromPanel().catch(S.toastError);
    });
    root.querySelector('#tg-ensure').addEventListener('click', () => {
        setPanelStatus('正在安装/检查配套资源…');
        P.ensureResources()
            .then((r) => setPanelStatus(`✅ 正则:${r.regexCreated ? '新建' : '已存在'}｜世界书:${r.wbCreated ? '新建' : '已存在'}｜全局勾选:${r.wbBound ? '是' : '否'}`))
            .catch((e) => {
                setPanelStatus('❌ ' + S.describeError(e));
                S.toastError(e);
            });
    });
    root.querySelector('#tg-preview-apply').addEventListener('click', () => {
        reapplyPreview().catch(S.toastError);
    });
    root.querySelector('#tg-preview-download').addEventListener('click', downloadPreview);
    root.querySelector('#tg-preview-discard').addEventListener('click', discardPreview);
    root.querySelector('#tg-provider').addEventListener('change', refreshProviderFields);
    root.querySelector('#tg-fetch-models').addEventListener('click', () => {
        fetchModelsFromPanel().catch(S.toastError);
    });
    root.querySelector('#tg-probe').addEventListener('click', () => {
        probeFromPanel().catch(S.toastError);
    });
    return root;
}

/**
 * 显示/隐藏与接口类型相关的字段。
 */
/** TauriTavern 没有 Node 后端：确保运行模式不会卡在「只用服务端」 */
function applyTauriTavernUi() {
    const s = S.getSettings();
    if (s.mode === 'server') {
        s.mode = 'auto';
        S.saveSettings();
    }
}

export function refreshProviderFields() {
    const root = panelRoot;
    if (!root) return;
    const p = root.querySelector('#tg-provider').value;
    const proxyWrap = root.querySelector('#tg-proxy-wrap');
    if (proxyWrap) proxyWrap.style.display = p === 'nai' ? 'none' : '';
    root.querySelector('#tg-nai-extra').style.display = p === 'nai' ? '' : 'none';
    root.querySelector('#tg-openai-extra').style.display = p === 'openai' ? '' : 'none';
    root.querySelector('#tg-generic-extra').style.display = p === 'generic' ? '' : 'none';
}

function modelLabel(id) {
    const hit = MODEL_PRESETS.find((p) => p[0] === id);
    return hit ? `${hit[0]}（${hit[1]}）` : `${id}（自定义）`;
}

function fillModelDatalist(extraIds, currentModel) {
    const dl = ensurePanel().querySelector('#tg-model-presets');
    if (!dl) return;
    const opts = MODEL_PRESETS.map((p) => p[0]);
    for (const id of extraIds || []) if (!opts.includes(id)) opts.push(id);
    if (currentModel && !opts.includes(currentModel)) opts.unshift(currentModel);
    dl.innerHTML = '';
    for (const id of opts) {
        const o = document.createElement('option');
        o.value = id;
        o.textContent = modelLabel(id);
        dl.appendChild(o);
    }
}

/**
 * 把设置填进面板。
 * @param {Record<string, any>} cfg
 */
function fillPanel(cfg) {
    const root = ensurePanel();
    const set = (sel, val) => {
        const el = root.querySelector(sel);
        if (el) el.value = val ?? '';
    };
    set('#tg-provider', cfg.provider || 'nai');
    set('#tg-key', cfg.apiKey || '');
    set('#tg-endpoint', cfg.endpoint || '');
    set('#tg-proxy-base', PROXY_PREFIX);
    set('#tg-width', cfg.width);
    set('#tg-height', cfg.height);
    set('#tg-steps', cfg.steps);
    set('#tg-scale', cfg.scale);
    set('#tg-sampler', cfg.sampler);
    set('#tg-nsamples', cfg.nSamples);
    set('#tg-openai-size', cfg.openaiSize || '');
    set('#tg-openai-format', cfg.openaiResponseFormat || 'b64_json');
    set('#tg-generic-template', cfg.genericBodyTemplate);
    set('#tg-generic-path', cfg.genericImagePath);
    set('#tg-models-auth', cfg.modelsAuth || 'bearer');
    set('#tg-timeout', cfg.timeoutMs || DEFAULTS.timeoutMs);
    set('#tg-pos', cfg.promptTemplate);
    set('#tg-neg', cfg.negativePrompt);

    const isurl = root.querySelector('#tg-generic-isurl');
    if (isurl) isurl.checked = !!cfg.genericImageIsUrl;
    const auto = root.querySelector('#tg-auto');
    if (auto) auto.checked = !!cfg.autoDetect;
    const input = root.querySelector('#tg-model');
    const cur = cfg.model || DEFAULTS.model;
    input.value = cur;
    fillModelDatalist(cfg.fetchedModels || [], cur);
    refreshProviderFields();
}

/**
 * 读取面板内容。
 * @returns {Record<string, any>}
 */
function readPanel() {
    const root = ensurePanel();
    const num = (sel, fallback) => {
        const v = parseInt(root.querySelector(sel).value, 10);
        return v > 0 ? v : fallback;
    };
    const scale = parseFloat(root.querySelector('#tg-scale').value);
    return {
        storeKeyOnServer: false,
        provider: root.querySelector('#tg-provider').value,
        apiKey: root.querySelector('#tg-key').value.trim(),
        endpoint: root.querySelector('#tg-endpoint').value.trim(),
        proxyBase: PROXY_PREFIX,
        model: root.querySelector('#tg-model').value.trim(),
        width: num('#tg-width', DEFAULTS.width),
        height: num('#tg-height', DEFAULTS.height),
        steps: num('#tg-steps', DEFAULTS.steps),
        scale: scale > 0 ? scale : DEFAULTS.scale,
        sampler: root.querySelector('#tg-sampler').value.trim() || DEFAULTS.sampler,
        nSamples: num('#tg-nsamples', DEFAULTS.nSamples),
        openaiSize: root.querySelector('#tg-openai-size').value.trim(),
        openaiResponseFormat: root.querySelector('#tg-openai-format').value,
        genericBodyTemplate: root.querySelector('#tg-generic-template').value,
        genericImagePath: root.querySelector('#tg-generic-path').value.trim(),
        genericImageIsUrl: root.querySelector('#tg-generic-isurl').checked,
        modelsEndpoint: '',
        modelsAuth: root.querySelector('#tg-models-auth').value,
        timeoutMs: num('#tg-timeout', DEFAULTS.timeoutMs),
        promptTemplate: root.querySelector('#tg-pos').value,
        negativePrompt: root.querySelector('#tg-neg').value,
        autoDetect: root.querySelector('#tg-auto').checked,
    };
}

/**
 * 面板底部状态文本。
 * @param {string} msg
 */
export function setPanelStatus(msg) {
    try {
        const el = ensurePanel().querySelector('#tg-status');
        if (el) el.textContent = msg;
    } catch (e) {
        /* ignore */
    }
}

/**
 * 打开面板。
 */
export async function openPanel() {
    const root = ensurePanel();
    const cfg = S.getSettings();
    fillPanel(cfg);
    root.removeAttribute('hidden');
    try {
        if (typeof root.showModal === 'function' && !root.open) root.showModal();
    } catch (e) {
        /* ignore */
    }

    if (T.describeRuntime().kind === 'tauritavern') {
        applyTauriTavernUi();
        setPanelStatus('ℹ️ TauriTavern 原生客户端模式：生图由本机直接请求接口，不需要也无法使用服务端插件');
        if (lastGenerated) showPreviewImage(lastGenerated);
        return;
    }

    // 打开时顺便看一下服务端状态，并把状态写进面板
    setPanelStatus('正在检测服务端插件…');
    try {
        const { available, base } = await S.detectServer(true);
        setPanelStatus(
            available
                ? `✅ 服务端插件已连接：${base}`
                : `⚠️ 未检测到服务端插件（将按运行模式回退到浏览器直连）${S.getLastProbeDetail() ? '｜' + S.getLastProbeDetail() : ''}`,
        );
    } catch (e) {
        setPanelStatus('服务端检测失败：' + S.describeError(e));
    }

    if (lastGenerated) showPreviewImage(lastGenerated);
}

/**
 * 关闭面板。
 */
export function closePanel() {
    if (!panelRoot) return;
    try {
        if (typeof panelRoot.close === 'function' && panelRoot.open) panelRoot.close();
    } catch (e) {
        /* ignore */
    }
    panelRoot.setAttribute('hidden', '');
}

/**
 * 保存面板设置（并在勾选时把关键配置同步到服务端）。
 */
export async function savePanel() {
    const values = readPanel();
    const settings = S.getSettings();
    Object.assign(settings, values);
    S.saveSettings();

    if (values.storeKeyOnServer) {
        try {
            await S.callServer('/config', {
                config: {
                    provider: values.provider,
                    endpoint: values.endpoint,
                    model: values.model,
                    apiKey: values.apiKey,
                    width: values.width,
                    height: values.height,
                    steps: values.steps,
                    scale: values.scale,
                    sampler: values.sampler,
                    nSamples: values.nSamples,
                    negativePrompt: values.negativePrompt,
                    promptTemplate: values.promptTemplate,
                    proxyBase: values.proxyBase,
                    modelsEndpoint: values.modelsEndpoint,
                    modelsAuth: values.modelsAuth,
                    timeoutMs: values.timeoutMs,
                    genericBodyTemplate: values.genericBodyTemplate,
                    genericImagePath: values.genericImagePath,
                    genericImageIsUrl: values.genericImageIsUrl,
                    openaiSize: values.openaiSize,
                    openaiResponseFormat: values.openaiResponseFormat,
                },
            });
            setPanelStatus('设置已保存，并同步到服务端');
            S.toastSuccess('设置已保存（API Key 已存到服务端）');
            return;
        } catch (e) {
            setPanelStatus('设置已保存，但同步到服务端失败：' + S.describeError(e));
            S.toastWarn('同步到服务端失败：' + S.describeError(e));
            return;
        }
    }

    setPanelStatus('设置已保存');
    S.toastSuccess('生图设置已保存');
}

/**
 * 保存面板内容到设置但不提示。
 */
async function syncPanelToSettings() {
    Object.assign(S.getSettings(), readPanel());
    S.saveSettings();
}

/**
 * 检测服务端按钮。
 */
async function probeFromPanel() {
    await syncPanelToSettings();
    setPanelStatus('正在检测服务端插件…');
    const { available, base } = await S.detectServer(true);
    if (available) {
        try {
            const info = await S.callServer('/ping');
            setPanelStatus(`✅ 服务端可用：${base}（v${info.version}）`);
            S.toastSuccess('服务端插件可用');
        } catch (e) {
            setPanelStatus('服务端可用但 /ping 异常：' + S.describeError(e));
        }
    } else {
        setPanelStatus('❌ 未检测到服务端插件：请确认已 clone 到 plugins/ 且 config.yaml 里 enableServerPlugins: true，然后重启酒馆');
        S.toastWarn('未检测到服务端插件');
    }
}

/**
 * 拉取模型列表（服务端优先，失败退回浏览器直连）。
 */
async function fetchModelsFromPanel() {
    await syncPanelToSettings();
    const cfg = S.getSettings();
    setPanelStatus('正在拉取模型列表…');
    // NovelAI 官方没有模型列表接口（/v1/models 不存在），直接用内置预置，避免误报"拉取失败"
    if ((cfg.provider || 'nai') === 'nai') {
        const presetIds = MODEL_PRESETS.map((p) => p[0]);
        fillModelDatalist(presetIds, cfg.model);
        setPanelStatus('ℹ️ NovelAI 没有模型列表接口，已填入内置预置；请在「模型」下拉里选择或直接手填');
        S.toastInfo('NovelAI 请直接从模型下拉里选（已内置预置）');
        return;
    }
    try {
        let models = null;
        if ((cfg.mode || 'auto') !== 'direct') {
            try {
                const json = await S.callServer('/models', cfg, { force: cfg.mode === 'server' });
                models = json.models;
            } catch (e) {
                if (cfg.mode === 'server') throw e;
                S.toastWarn('服务端拉取失败，改用浏览器直连：' + S.describeError(e));
            }
        }
        if (!models) models = await directFetchModels(cfg);
        if (!models.length) throw new Error('没有拿到任何模型');

        S.getSettings().fetchedModels = models;
        S.saveSettings();
        fillModelDatalist(models, models[0]);
        ensurePanel().querySelector('#tg-model').value = models[0];
        setPanelStatus(`✅ 已拉取 ${models.length} 个模型`);
        S.toastSuccess(`已拉取 ${models.length} 个模型`);
    } catch (e) {
        setPanelStatus('❌ ' + S.describeError(e));
        S.toastError(e);
    }
}

/**
 * 浏览器直连拉模型（原脚本逻辑）。
 * @param {Record<string, any>} cfg
 * @returns {Promise<string[]>}
 */
/** 把用户填的模型列表地址补全：base 或 …/v1 → …/models */
function normalizeModelsEndpoint(url) {
    const s = String(url || '').trim();
    if (!s) return '';
    if (/\/models\/?$/i.test(s)) return s.replace(/\/+$/, '');
    if (/\/(v1|api|openai)\/?$/i.test(s)) return s.replace(/\/+$/, '') + '/models';
    return s;
}

async function directFetchModels(cfg) {
    const explicit = normalizeModelsEndpoint(String(cfg.modelsEndpoint || '').trim());
    const url = explicit || (() => {
        try {
            const u = new URL(cfg.endpoint || '');
            const parts = u.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
            const i = parts.lastIndexOf('v1');
            if (i >= 0) {
                parts.length = i + 1;
                u.pathname = '/' + parts.join('/') + '/models';
            } else {
                u.pathname = u.pathname.replace(/\/(images\/generations|images\/edits|generations|generate-image).*$/i, '') + '/models';
            }
            u.search = '';
            return u.toString();
        } catch (e) {
            return '';
        }
    })();
    if (!url) throw new Error('请填写「模型列表地址」');
    const target = P.proxiedUrl(url, cfg);

    const headers = { Accept: 'application/json' };
    const key = String(cfg.apiKey || '').trim();
    const mode = cfg.modelsAuth || 'bearer';
    if (key && mode !== 'none') {
        if (mode === 'x-api-key') headers['x-api-key'] = key;
        else if (mode === 'raw') headers['Authorization'] = key;
        else headers['Authorization'] = 'Bearer ' + key;
    }
    let res;
    try {
        res = await fetch(target, { method: 'GET', headers });
    } catch (e) {
        throw new Error(`访问模型列表地址失败（常见原因：跨域被拦 / 地址拼错 / 证书问题）｜地址：${target}｜${S.describeError(e)}`);
    }
    if (!res.ok) throw new Error(`拉取模型失败 HTTP ${res.status}｜地址：${target}`);
    const json = await res.json();
    const ids = [];
    const push = (v) => {
        if (typeof v === 'string' && v && !ids.includes(v)) ids.push(v);
    };
    [json.data, json.models, json.result, json.items].forEach((arr) => {
        if (!Array.isArray(arr)) return;
        arr.forEach((it) => {
            if (typeof it === 'string') push(it);
            else if (it && typeof it === 'object') push(it.id || it.name || it.model || it.value);
        });
    });
    push(json.id);
    push(json.model);
    if (!ids.length) throw new Error('响应中没有找到模型 id');
    return ids;
}

/**
 * 用面板里的提示词生图。
 */
async function genCustomFromPanel() {
    await syncPanelToSettings();
    const extra = ensurePanel().querySelector('#tg-custom').value.trim();
    const cfg = S.getSettings();
    const prompt = P.joinPrompt(extra, cfg.promptTemplate);
    if (!prompt) {
        setPanelStatus('请先填写正向提示词模板或直接输入提示词');
        S.toastWarn('请先填写提示词');
        return;
    }
    setPanelStatus('正在生图…');
    try {
        const { dataUrl, via } = await P.generateImage(prompt, cfg);
        lastGenerated = dataUrl;
        showPreviewImage(dataUrl);
        setPanelStatus(`✅ 已生成（${via === 'server' ? '服务端' : '浏览器直连'}），可下载或写入 tag 美化`);
    } catch (e) {
        setPanelStatus('❌ ' + S.describeError(e));
        S.toastError(e);
    }
}

function showPreviewImage(dataUrl) {
    const root = ensurePanel();
    const img = root.querySelector('#tg-preview');
    const wrap = root.querySelector('#tg-preview-wrap');
    if (img) img.src = dataUrl;
    if (wrap) wrap.style.display = '';
}

function clearPreview() {
    lastGenerated = null;
    const root = panelRoot;
    if (!root) return;
    const img = root.querySelector('#tg-preview');
    const wrap = root.querySelector('#tg-preview-wrap');
    if (img) img.src = '';
    if (wrap) wrap.style.display = 'none';
}

async function reapplyPreview() {
    if (!lastGenerated) {
        setPanelStatus('没有待写入的图片');
        return;
    }
    setPanelStatus('正在写入 tag 美化…');
    try {
        const { inline } = await P.handleGenerated(lastGenerated);
        setPanelStatus(inline ? '✅ 已以内嵌图片写入 tag 美化' : '✅ 已写入 tag 美化');
    } catch (e) {
        setPanelStatus('❌ ' + S.describeError(e));
        S.toastError(e);
    }
}

function downloadPreview() {
    if (!lastGenerated) {
        setPanelStatus('没有可下载的图片');
        return;
    }
    const ok = P.downloadDataUrl(lastGenerated, P.newImageFileName());
    setPanelStatus(ok ? '已开始下载' : '下载失败，请手动复制生成结果');
}

function discardPreview() {
    if (!lastGenerated) {
        setPanelStatus('没有可丢弃的图片');
        return;
    }
    clearPreview();
    setPanelStatus('已丢弃图片');
}

/**
 * 自动生图完成后刷新面板里的预览。
 * @param {string} dataUrl
 */
export function setLastGenerated(dataUrl) {
    lastGenerated = dataUrl;
    if (panelRoot && !panelRoot.hasAttribute('hidden')) showPreviewImage(dataUrl);
}

/** 面板是否处于打开状态 */
export function isPanelOpen() {
    return !!panelRoot && !panelRoot.hasAttribute('hidden');
}

/** 供外部日志用 */
export const panelTag = SCRIPT_TAG;
