# Tag 自动生图（服务端版）

把原来的「Tag自动生图」酒馆助手脚本改写成 **SillyTavern UI 扩展 + Node 服务端插件** 的形式：

- **UI 扩展**：扩展面板里填 GitHub 地址即可安装，负责面板、自动检测 `<@tags>`、写回正则。
- **服务端插件（Node）**：跑在酒馆的 Node 进程里，负责真正调用 NovelAI / OpenAI 兼容 / 通用 JSON 图片接口。

两者装在同一个仓库里，可以只用扩展（浏览器直连），也可以装上插件把生图搬到服务端。

---

## 为什么要服务端版

| 问题 | 原「酒馆助手脚本」 | 本仓库 |
| --- | --- | --- |
| 浏览器 CORS 拦截图片接口 | 需要自建反代，或依赖渠道放开跨域 | 服务端请求，天然没有 CORS |
| API Key 位置 | 存在浏览器端脚本变量里 | 可选只存服务端（`data/config.json`）或环境变量 |
| NovelAI 返回的 ZIP 解包 | 浏览器 `DecompressionStream`（老浏览器不支持） | Node `zlib` 解包，稳定且省内存 |
| 长耗时请求 | 标签页一关就断 | 服务端可设超时（默认 180s） |
| 拉取模型列表 | 常被 CORS 拦 | 服务端代拉 |
| 安装方式 | 手动导入脚本 | 扩展面板一键从 GitHub 安装 |

---

## 目录结构

```
st-tag-auto-image/
├── manifest.json            # UI 扩展清单（仓库根必须有，扩展安装器据此识别）
├── index.mjs                # 服务端插件入口（导出 info / init / exit）
├── package.json             # 插件入口指向 index.mjs；同时用于 node --check
├── client/                  # 扩展前端
│   ├── index.js             #   入口：菜单按钮 / 消息事件 / Slash 命令
│   ├── state.js             #   酒馆上下文、设置持久化、服务端探测
│   ├── tauritavern.js       #   TauriTavern 宿主适配（环境探测与提示）
│   ├── pipeline.js          #   生图、图床、正则与世界书写入
│   ├── panel.js             #   生图面板 UI
│   └── style.css            #   面板样式
├── server/                  # 服务端插件实现
│   ├── routes.mjs           #   /ping /config /generate /models /status
│   ├── providers.mjs        #   NovelAI / OpenAI 兼容 / 通用 JSON
│   ├── util.mjs             #   请求、ZIP→PNG、模板填充等
│   └── config.mjs           #   服务端配置持久化（data/config.json）
├── shared/resources.mjs     # 两端共用的常量、正则对象、世界书条目
├── resources/               # 可由工具导出的可导入资源
├── tools/export-resources.mjs
└── README.md
```

---

## 安装

### 第一步：安装 UI 扩展（必装）

1. 打开酒馆 → **扩展**（Extensions）面板 → **Install extension**。
2. 在输入框里填本仓库地址：

   ```
   https://github.com/Qkiiie/st-tag-auto-image
   ```

   - 勾选 **Install for all users**（推荐，需要管理员）会装到 `public/scripts/extensions/third-party/`；
     不勾选则装到当前用户目录 `data/<user>/extensions/`。
3. 装好后到 **Manage extensions** 里启用「Tag 自动生图（服务端版）」，刷新页面。
4. 刷新后扩展菜单（🔌 图标）里会多出 **生图面板**，也可在聊天框输入 `/生图` 打开。

> 手动安装：把整个仓库 clone/解压到 `public/scripts/extensions/third-party/st-tag-auto-image/`（或
> `data/<user>/extensions/st-tag-auto-image/`）即可，仓库根的 `manifest.json` 会被酒馆自动识别。

### 第二步：安装服务端插件（可选，但推荐；TauriTavern 不适用）

服务端插件必须放在酒馆的 `plugins/` 目录里，并且要在 `config.yaml` 里打开开关：

```bash
cd /path/to/SillyTavern

# 1) 把本仓库 clone 进 plugins/（目录名随意，路由用的是插件 id）
git clone https://github.com/Qkiiie/st-tag-auto-image plugins/tag-auto-image
```

然后编辑酒馆根目录的 `config.yaml`：

```yaml
# 允许加载服务端插件（默认 false）
enableServerPlugins: true

# 可选：启动时自动 git pull 更新插件（默认 true）
enableServerPluginsAutoUpdate: true
```

重启酒馆。启动日志里应该能看到：

```
Initializing plugin from .../plugins/tag-auto-image/index.mjs
[tag-auto-image] 服务端插件已加载（v1.0.0）…
```

插件路由固定在 `/api/plugins/tag-auto-image/…`（用的是插件 `info.id`，跟文件夹名无关），可用这些地址自检：

```
GET  /api/plugins/tag-auto-image/ping      → {"ok":true,"id":"tag-auto-image","version":"1.0.0"}
GET  /api/plugins/tag-auto-image/status    → 是否已保存服务端 API Key
POST /api/plugins/tag-auto-image/generate  → 生图（面板调用）
POST /api/plugins/tag-auto-image/models    → 拉模型列表（面板调用）
```

> ⚠️ 服务端插件**不受沙箱保护**，能访问你的整个文件系统。只从你信任的仓库安装，别乱开 `enableServerPlugins`。
> 本插件的所有路由都在酒馆 `/api/*` 之下，会经过酒馆自身的登录与 CSRF 校验。

### 只装扩展也能用

扩展面板里的「生图位置」选 **只用浏览器直连**，行为就和原脚本一致（请求从浏览器发出，可能被 CORS 拦）。
默认的 **自动** 模式会先探测服务端插件，探不到就自动回退直连，并在面板底部给出原因。

### TauriTavern 用户（安卓 / iOS / 桌面原生版）

TauriTavern 用 Rust 重写了后端、**没有 Node.js 运行时**，因此：

- **服务端插件在 TauriTavern 上无法使用**（它没有 `plugins/` 与 `enableServerPlugins` 这套机制）。扩展会自动切换到客户端直连模式，面板里也会把服务端相关开关禁用；
- **扩展本身完全可用**：TauriTavern 保留了上游的扩展管理 API 与 `/scripts/extensions/third-party/*` 静态资源端点，在扩展面板里填 GitHub 地址即可安装；
- 生图请求由本机直接发给图片接口。若被跨域拦，只能用 `proxyBase` 走你自己的反代 / 中转（TauriTavern 只拦截同源请求，外部请求仍是 WebView 原生请求）。

---

## 使用

1. 扩展菜单点 **生图面板**（或 `/生图`）。
2. 选接口类型、填 API Key / 接口地址 / 模型，点 **💾 保存设置**。
3. 点 **🛠 安装/检查配套资源** 安装：
   - 全局世界书 **生图Tag输出规范**（要求 AI 在正文末尾输出 `<@tags>…</@tags>`）
   - 全局正则 **生图Tag美化**（把 tag 渲染成折叠卡片 + 图片）
   - 全局正则 **生图Tag不对AI发送**（发送前把 tag 从提示里剥掉）
4. 之后 AI 每次在正文末尾输出 tag 块，扩展会自动生图，并把图片写进「生图Tag美化」块。
5. 面板里可手动输入提示词生图，支持 **💾 写入 tag 美化** / **⬇️ 下载**（下载不消耗生成额度）/ **🗑 丢弃**。

### 支持的接口

| 类型 | 说明 |
| --- | --- |
| **NovelAI 官方** | 自动区分 V3 旧格式与 V4+ 新格式；需要 NAI 的 Persistent API Token；返回的 ZIP 由服务端解包 |
| **OpenAI 兼容** | 任意 `/v1/images/generations` 渠道，支持 `b64_json` 与 `url`（`url` 由服务端下载后转 data URL） |
| **通用 JSON** | 自定义请求体模板 + 响应图片路径 |

通用模板占位符：`{model}` `{prompt}` `{negative}` `{width}` `{height}` `{steps}` `{seed}` `{scale}` `{sampler}`；
响应路径写法：`data[0].b64_json` / `images[0]` / `image`，勾选「返回的是 URL」则由服务端下载。

### 拉取模型

「模型列表地址」留空时，服务端会从「接口地址」推导（如 `…/v1/images/generations` → `…/v1/models`），
也支持 `models` / `data` / `result` / `items` 等常见响应结构。
**NovelAI 官方没有模型列表接口**，选 NAI 时点「📡 拉取模型」会直接填入内置预置模型（V3 / V4.5 / V5）。

---

## 面板配置项

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `mode` | `auto` | `auto` 服务端优先并回退直连；`server` 只用服务端；`direct` 只用浏览器 |
| `serverBase` | 空 | 服务端插件地址，留空用 `/api/plugins/tag-auto-image` |
| `storeKeyOnServer` | `false` | 勾选后把 API Key 等配置写进 `plugins/<目录>/data/config.json` |
| `provider` | `nai` | `nai` / `openai` / `generic` |
| `apiKey` / `endpoint` / `model` | - | 接口凭据与目标 |
| `width` / `height` / `steps` / `scale` / `sampler` / `nSamples` | 832 / 1216 / 28 / 9 / `k_dpmpp_2m` / 1 | NAI 参数 |
| `promptTemplate` | 通用质量词 | 正向提示词，tag 会追加其后 |
| `negativePrompt` | 通用负面词 | 负向提示词 |
| `openaiSize` / `openaiResponseFormat` | 空 / `b64_json` | OpenAI 渠道专用 |
| `genericBodyTemplate` / `genericImagePath` / `genericImageIsUrl` | 见面板 | 通用渠道专用 |
| `modelsEndpoint` / `modelsAuth` | 空 / `bearer` | 拉模型地址与认证方式（`bearer` / `x-api-key` / `raw` / `none`） |
| `proxyBase` | 空 | 代理前缀，服务端与直连都生效 |
| `timeoutMs` | `180000` | 服务端请求超时 |
| `autoDetect` | `true` | 收到新消息自动识别 `<@tags>` 并生图 |

服务端还支持环境变量兜底（用于"浏览器不留 Key"）：

```bash
TAG_AUTO_IMAGE_API_KEY=xxx
TAG_AUTO_IMAGE_ENDPOINT=https://image.novelai.net/ai/generate-image
```

优先级：面板请求 > 服务端 `data/config.json` > 环境变量。服务端从不把 Key 明文回传给浏览器（`/config` 只返回掩码）。

---

## 配套资源与手动导入

面板的「🛠 安装/检查配套资源」会直接写入运行时存储，一般不需要手动导入。若要手动搬运配置：

```bash
node tools/export-resources.mjs
```

会在 `resources/` 生成：

- `regex-tag-beautify.json`、`regex-tag-hide.json` —— SillyTavern 原生正则结构，可在 Regex 扩展里 Import
- `worldbook-tag-output-rules.json` —— 世界书格式，可在 World Info 里 Import（导入后名称：`生图Tag输出规范`）

规则细节：美化正则把 `<@tags>…</@tags>` 渲染成折叠卡片，图片槽是 `<img id="tag-gen-img" src="…">`；
每次生成是**单槽替换**，新图会覆盖上一张。图片先上传到酒馆本地图床（`Tag生图` 目录），失败且图片较小时以内嵌 base64 兜底。

---

## 常见问题

**面板提示「未检测到服务端插件」**
检查：① 仓库是否真的在 `SillyTavern/plugins/` 下（不是 `data/` 里）；② `config.yaml` 里 `enableServerPlugins: true` 并已重启；③ 启动日志有没有 `Failed to load plugin from …` 报错。仍不行就在面板里手动填「服务端插件地址」再点 🔌 检测。

**生图报 403 / CSRF**
插件路由会经过酒馆鉴权，扩展已自动带 `SillyTavern.getRequestHeaders()`。若是自己用 `curl` 测试，需要带上酒馆的 CSRF token 与 Cookie。

**图片生成成功但没写进 tag 美化**
说明没找到「生图Tag美化」正则，或该正则里没有图片槽。点「🛠 安装/检查配套资源」，或确认这条正则没被删除/停用。

**有酒馆助手（TavernHelper）会不会冲突？**
不会。扩展优先写酒馆原生的 `extension_settings.regex`；只有当原生里找不到这条正则时，才回退到酒馆助手的全局正则。
两套都装着时建议**只启用一套自动生图**（本扩展或老脚本），否则同一条消息会被两个插件各生一张图。

**美化块里的「复制 tag」按钮点不动？**
`生图Tag美化` 渲染出的折叠卡片里带一小段内联脚本（负责读取最近一张图、提供复制按钮），浏览器直出时会被酒馆的 HTML 过滤剥掉。
装了酒馆助手（TavernHelper）并由它渲染 HTML 代码块时功能完整；没装时卡片依旧会显示 tag 与图片，只是复制按钮退化成手动选中复制。

**能不能提交到酒馆官方扩展仓库？**
官方要求「扩展不能强依赖服务端插件才能工作」（见官方 Writing Extensions 文档），本仓库依赖是可选的（可退回直连），但提交前建议先与官方确认。许可证用 MIT，如需提交官方仓库可换成 AGPL-3.0。

---

## 开发

```bash
npm run check          # node --check 全量语法自检
node tools/export-resources.mjs
```

- 客户端改动后刷新酒馆页面即可；服务端插件改动需要重启酒馆。
- 服务端插件是被酒馆用 `import()` 动态加载的 ES 模块，入口导出 `info` / `init(router)` / `exit()`，路由挂载在 `/api/plugins/<info.id>`。
- 想在控制台调试：`window.__tagAutoImage` 暴露了 `openPanel()` / `ensureResources()` / `runGeneration(prompt)` / `detectServer()` / `settings()`。

### 发布到 GitHub

```bash
git init
git add .
git commit -m "feat: Tag 自动生图服务端版"
git branch -M main
git remote add origin https://github.com/Qkiiie/st-tag-auto-image.git
git push -u origin main
```

---

## 许可

MIT（见 `LICENSE`）。
