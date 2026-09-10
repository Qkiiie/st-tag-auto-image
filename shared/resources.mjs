/**
 * 共享资源定义：客户端扩展与服务端插件共用的常量、正则对象与世界书条目。
 *
 * 客户端路径：/scripts/extensions/third-party/<本扩展名>/client/…
 * 服务端路径：SillyTavern/plugins/<本仓库名>/…
 * 两边都可以相对导入本文件。
 */

export const PLUGIN_ID = 'tag-auto-image';
export const PLUGIN_VERSION = '1.0.0';

/** 酒馆助手（TavernHelper）脚本时代沿用下来的标识，改动会破坏已有配置 */
export const TAG_REGEX_ID = '7a2b0d3f-4c5e-4b6f-9a0d-2e3f4a5b6c7d';
export const TAG_REGEX_NAME = '生图Tag美化';
export const TAG_HIDE_REGEX_ID = '8b3c1e4a-5d6f-4c7a-a1b2-3f4a5b6c7d8e';
export const TAG_HIDE_REGEX_NAME = '生图Tag不对AI发送';
export const WB_NAME = '生图Tag输出规范';

export const IMG_ID = 'tag-gen-img';
export const IMG_SLOT = '__TAG_GEN_IMG__';
export const LAST_IMG_KEY = '__tagGen_lastImage__';
export const UPLOAD_FOLDER = 'Tag生图';

export const TAG_OPEN = '<@tags>';
export const TAG_CLOSE = '</@tags>';

/** 正文末尾 tag 块：美化用（捕获组 $1 是 tag 文本） */
export const TAG_FIND_REGEX = '/<@tags>([\\s\\S]*?)<\\/@tags>/g';
/** 正文末尾 tag 块：发送前给 AI 剥离用 */
export const TAG_STRIP_REGEX = '/<@tags>[\\s\\S]*?<\\/@tags>/g';

export const SCRIPT_TAG = 'Tag自动生图';

export const DEFAULTS = {
    /** 生成模式：'auto' 自动探测服务端插件，'server' 强制服务端，'direct' 浏览器直连（原脚本行为） */
    mode: 'auto',
    /** 服务端插件基地址；留空则自动探测 /api/plugins/<id> */
    serverBase: '',
    provider: 'nai', // 'nai' | 'openai' | 'generic'
    endpoint: 'https://image.novelai.net/ai/generate-image',
    apiKey: '',
    model: 'nai-diffusion-4-5-full',
    width: 832,
    height: 1216,
    steps: 28,
    scale: 9,
    sampler: 'k_dpmpp_2m',
    nSamples: 1,
    promptTemplate: 'masterpiece, best quality, very aesthetic, 1girl, solo, looking at viewer, soft light, detailed face, detailed eyes, upper body',
    negativePrompt: 'lowres, bad anatomy, bad hands, missing fingers, extra digits, worst quality, low quality, blurry, jpeg artifacts, watermark, text, signature, artist name',
    autoDetect: true,
    // OpenAI 兼容
    openaiSize: '',
    openaiResponseFormat: 'b64_json',
    // 通用 JSON
    genericBodyTemplate: '{"model":"{model}","prompt":"{prompt}","negative_prompt":"{negative}","width":{width},"height":{height},"steps":{steps}}',
    genericImagePath: 'data[0].b64_json',
    genericImageIsUrl: false,
    // 模型列表地址（留空则从接口地址自动推导，如 …/v1/models）
    modelsEndpoint: '',
    modelsAuth: 'bearer', // 'bearer' | 'x-api-key' | 'raw' | 'none'
    fetchedModels: [],
    // CORS / 反代代理前缀（服务端模式下也生效）
    proxyBase: '',
    /** 请求超时（毫秒） */
    timeoutMs: 180000,
    /** 把 API Key 保存到服务端（data/config.json），浏览器不再长期保留 */
    storeKeyOnServer: false,
    /** 面板里最近一次自动生图是否弹出面板 */
    openPanelOnAuto: false,
};

export const MODEL_PRESETS = [
    ['nai-diffusion-5-full', 'NAI V5 Full'],
    ['nai-diffusion-5-curated', 'NAI V5 Curated'],
    ['nai-diffusion-4-5-full', 'NAI V4.5 Full'],
    ['nai-diffusion-4-5-curated', 'NAI V4.5 Curated'],
    ['nai-diffusion-3', 'NAI V3'],
    ['gpt-image-1', 'GPT Image 1'],
    ['dall-e-3', 'DALL·E 3'],
];

/**
 * 「生图Tag美化」正则的替换内容：把 <@tags>…</@tags> 渲染成折叠卡片 + 图片槽。
 * 图片 URL 会被写回 <img id="tag-gen-img"> 的 src；未生成图片时用 __TAG_GEN_IMG__ 占位。
 */
export const TAG_BEAUTIFY_REPLACE_STRING = [
    '```',
    '<style>',
    '  :root { color-scheme: dark; }',
    '  body { margin: 0; padding: 4px; background: transparent; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }',
    '  .rt { border: 1px solid rgba(255,255,255,0.12); border-radius: 16px; background: linear-gradient(160deg, rgba(255,122,184,0.10), rgba(122,184,255,0.10)); padding: 10px 12px; }',
    '  .rt summary { cursor: pointer; font-size: 13px; font-weight: 800; letter-spacing: 0.02em; background: linear-gradient(90deg, #ff7ab8, #7ab8ff); -webkit-background-clip: text; background-clip: text; color: transparent; user-select: none; }',
    '  .rt pre { white-space: pre-wrap; word-break: break-all; margin: 9px 0 0; padding: 9px 11px; background: rgba(255,255,255,0.045); border: 1px solid rgba(255,255,255,0.10); border-radius: 12px; font-size: 12.5px; line-height: 1.7; color: #f4f5fa; }',
    '  .rt img { display: block; max-width: 100%; margin-top: 9px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.15); background: rgba(0,0,0,0.25); }',
    '  .rt button { margin-top: 9px; padding: 5px 14px; font-size: 12px; font-weight: 700; color: #f4f5fa; background: rgba(255,255,255,0.055); border: 1px solid rgba(255,255,255,0.12); border-radius: 999px; cursor: pointer; transition: background .15s ease; }',
    '  .rt button:hover { background: rgba(255,255,255,0.12); }',
    '</style>',
    '<!DOCTYPE html>',
    '<html lang="zh-CN">',
    '<head>',
    '  <meta charset="UTF-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    '</head>',
    '<body>',
    '  <details class="rt">',
    '    <summary>🖼 生图 Tag（点击展开）</summary>',
    '    <pre id="t">$1</pre>',
    '    <img id="' + IMG_ID + '" alt="最近生成" src="' + IMG_SLOT + '" style="display:none" />',
    '    <button id="c" type="button">复制 tag</button>',
    '  </details>',
    '  <script>',
    '    (function () {',
    '      var img = document.getElementById("' + IMG_ID + '");',
    '      var pre = document.getElementById("t");',
    '      var btn = document.getElementById("c");',
    '      if (btn) {',
    '        btn.addEventListener("click", function () {',
    '          var text = pre ? pre.textContent : "";',
    '          var self = this;',
    '          function ok() { self.textContent = "已复制"; }',
    '          function fallback() {',
    '            var ta = document.createElement("textarea");',
    '            ta.value = text; document.body.appendChild(ta); ta.select();',
    '            try { document.execCommand("copy"); ok(); } catch (e) {}',
    '            document.body.removeChild(ta);',
    '          }',
    '          if (navigator.clipboard && navigator.clipboard.writeText) {',
    '            navigator.clipboard.writeText(text).then(ok, fallback);',
    '          } else { fallback(); }',
    '        });',
    '      }',
    '      function showImg(url) {',
    '        if (!img) return;',
    '        if (url && url.indexOf("__") !== 0) { img.src = url; img.style.display = "block"; }',
    '        else { img.style.display = "none"; }',
    '      }',
    '      showImg(img ? img.getAttribute("src") : "");',
    '      function readVars() {',
    '        try {',
    '          var w = window;',
    '          var TH = w.TavernHelper || (w.parent && w.parent.TavernHelper);',
    '          if (TH && TH.getVariables) return TH.getVariables({ type: "chat" });',
    '          var ST = w.SillyTavern || (w.parent && w.parent.SillyTavern);',
    '          if (ST && ST.getContext) return Promise.resolve(ST.getContext().chatMetadata || {});',
    '        } catch (e) {}',
    '        return Promise.resolve(null);',
    '      }',
    '      readVars().then(function (vars) {',
    '        var url = vars && vars.' + LAST_IMG_KEY + ';',
    '        if (url) showImg(url);',
    '      }).catch(function () {});',
    '    })();',
    '  <\/script>',
    '</body>',
    '</html>',
    '```',
].join('\n');

/**
 * 「生图Tag美化」正则（酒馆助手归一化字段格式，与原脚本一致）。
 * @returns {object}
 */
export function makeTagBeautifyRegex() {
    return {
        id: TAG_REGEX_ID,
        script_name: TAG_REGEX_NAME,
        enabled: true,
        find_regex: TAG_FIND_REGEX,
        replace_string: TAG_BEAUTIFY_REPLACE_STRING,
        trim_strings: [],
        source: { user_input: false, ai_output: true, slash_command: false, world_info: false, reasoning: false },
        destination: { display: true, prompt: false },
        run_on_edit: true,
        min_depth: null,
        max_depth: null,
    };
}

/**
 * 「生图Tag不对AI发送」正则：把 tag 块从发给 AI 的提示里剥掉。
 * @returns {object}
 */
export function makeTagHideRegex() {
    return {
        id: TAG_HIDE_REGEX_ID,
        script_name: TAG_HIDE_REGEX_NAME,
        enabled: true,
        find_regex: TAG_STRIP_REGEX,
        replace_string: '',
        trim_strings: [],
        source: { user_input: false, ai_output: true, slash_command: false, world_info: false, reasoning: false },
        destination: { display: false, prompt: true },
        run_on_edit: true,
        min_depth: null,
        max_depth: null,
    };
}

/**
 * 世界书条目正文（要求 AI 在正文末尾输出 danbooru 风格英文 tag）。
 */
export const WB_ENTRY_CONTENT = [
    '<生图Tag输出规则>',
    '触发时机: 每次正文回复结束后，在正文末尾追加一个「生图 tag」块。',
    '',
    '包裹格式: 用 <@tags> 与 </@tags> 包裹，且每次只输出一个该块。',
    '',
    '内容要求:',
    '  - 只描述「本次正文中出现的某一个具体场景」，只能使用正文已出现的信息，禁止杜撰正文没有的内容。',
    '  - 只输出英文 NovelAI / Stable Diffusion 通用的 danbooru 风格 tag，用英文逗号分隔。',
    '  - 禁止中文（人物名除外）、禁止完整句子、禁止解释说明、禁止 :: 权重符号、禁止负面 tag。',
    '  - 每次覆盖的维度必须完整，不得省略。',
    '',
    '必须覆盖的维度（按顺序，缺一不可）:',
    '  1. 人物数量与关系: solo / 1girl / 1boy / 2girls / couple 等',
    '  2. 人物身份: 当前角色名（可用原文）、称谓',
    '  3. 外貌: 年龄感、体型、身高、肤色、发色、发型、瞳色、脸型、五官',
    '  4. 表情: 当下神情（如微笑、惊讶、害羞、平静、生气）',
    '  5. 衣着: 服装款式、颜色、材质、配饰、鞋袜',
    '  6. 动作与姿态: 当下动作（如站、坐、跑、转身、伸手、拥抱）',
    '  7. 视角与构图: 景别（upper body / full body / close-up / cowboy shot）、镜头角度、构图',
    '  8. 场景与环境: 地点、背景、时间、天气、季节、氛围',
    '  9. 光影与色彩: 光照方向、色温、色调、明暗',
    '  10. 风格与质感: 画风、媒介、质量词（masterpiece、best quality 等）',
    '',
    '格式示例:',
    '<@tags>',
    '1girl, solo, <角色名>, long silver hair, blue eyes, gentle smile, white dress, standing, looking at viewer, upper body, garden, daytime, soft light, masterpiece, best quality',
    '</@tags>',
    '',
    '注意: 示例中的 <角色名> 只是占位，实际必须替换为当前场景中的真实角色名；负面 tag 一律不写在这里。',
    '</生图Tag输出规则>',
].join('\n');

/**
 * 构造符合 SillyTavern 原生 World Info 结构的条目（字段对齐 newWorldInfoEntryTemplate）。
 * 常驻（constant）、插入位置 atDepth(4)、role=system(0)、depth 0、order 100。
 * @returns {object}
 */
export function makeNativeWorldbookEntry() {
    return {
        uid: 0,
        key: [],
        keysecondary: [],
        comment: WB_NAME,
        content: WB_ENTRY_CONTENT,
        constant: true,
        vectorized: false,
        selective: false,
        selectiveLogic: 0,
        addMemo: true,
        order: 100,
        position: 4,
        disable: false,
        ignoreBudget: false,
        excludeRecursion: false,
        preventRecursion: false,
        matchPersonaDescription: false,
        matchCharacterDescription: false,
        matchCharacterPersonality: false,
        matchCharacterDepthPrompt: false,
        matchScenario: false,
        matchCreatorNotes: false,
        delayUntilRecursion: 0,
        probability: 100,
        useProbability: true,
        depth: 0,
        outletName: '',
        group: '',
        groupOverride: false,
        groupWeight: 100,
        scanDepth: null,
        caseSensitive: null,
        matchWholeWords: null,
        useGroupScoring: null,
        automationId: '',
        role: 0,
        sticky: null,
        cooldown: null,
        delay: null,
        triggers: [],
        displayIndex: 0,
    };
}

/**
 * 完整的原生世界书文件内容。
 * @returns {{ entries: Record<string, object> }}
 */
export function makeNativeWorldbookData() {
    return { entries: { 0: makeNativeWorldbookEntry() } };
}

// ---------------------------------------------------------------------------
// 酒馆助手归一化正则 <-> SillyTavern 原生正则 互转
// 原生结构：{ id, scriptName, findRegex, replaceString, trimStrings[], placement[],
//            disabled, markdownOnly, promptOnly, runOnEdit, substituteRegex, minDepth, maxDepth }
// ---------------------------------------------------------------------------

/** 原生的 placement 数值见 ST 的 regex_placement：USER_INPUT=1, AI_OUTPUT=2, SLASH_COMMAND=3, WORLD_INFO=5, REASONING=6 */
export function normalizedToNativeRegex(r) {
    const src = r.source || {};
    const dst = r.destination || {};
    const placement = [];
    if (src.user_input) placement.push(1);
    if (src.ai_output) placement.push(2);
    if (src.slash_command) placement.push(3);
    if (src.world_info) placement.push(5);
    if (src.reasoning) placement.push(6);
    if (!placement.length) placement.push(2);
    return {
        id: r.id,
        scriptName: r.script_name || TAG_REGEX_NAME,
        findRegex: r.find_regex || '',
        replaceString: r.replace_string || '',
        trimStrings: Array.isArray(r.trim_strings) ? r.trim_strings : [],
        placement,
        disabled: r.enabled === false,
        markdownOnly: !!dst.display && !dst.prompt,
        promptOnly: !!dst.prompt && !dst.display,
        runOnEdit: !!r.run_on_edit,
        substituteRegex: 0,
        minDepth: r.min_depth ?? null,
        maxDepth: r.max_depth ?? null,
    };
}

/** SillyTavern 原生正则 -> 酒馆助手归一化结构 */
export function nativeToNormalizedRegex(n) {
    const placement = Array.isArray(n.placement) ? n.placement : [];
    // markdownOnly = 只作用于显示；promptOnly = 只作用于发给 AI 的内容；都为 false = 两边都生效
    const markdownOnly = n.markdownOnly === true;
    const promptOnly = n.promptOnly === true;
    const display = markdownOnly || (!markdownOnly && !promptOnly);
    const prompt = promptOnly || (!markdownOnly && !promptOnly);
    return {
        id: n.id,
        script_name: n.scriptName || '',
        enabled: n.disabled !== true,
        find_regex: n.findRegex || '',
        replace_string: n.replaceString || '',
        trim_strings: Array.isArray(n.trimStrings) ? n.trimStrings : [],
        source: {
            user_input: placement.includes(1),
            ai_output: placement.includes(2),
            slash_command: placement.includes(3),
            world_info: placement.includes(5),
            reasoning: placement.includes(6),
        },
        destination: { display: !!display, prompt: !!prompt },
        run_on_edit: !!n.runOnEdit,
        min_depth: n.minDepth ?? null,
        max_depth: n.maxDepth ?? null,
    };
}
