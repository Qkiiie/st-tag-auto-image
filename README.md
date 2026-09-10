# 🍑 桃桃绘图

SillyTavern 扩展：读取正文末尾的 <@tags>，自动调用图片接口生图，并把图片写回「生图Tag美化」正则里的图片槽。
手机原生客户端（TauriTavern）与标准电脑版酒馆都能用。

---

## 特性

- **三种渠道**：NovelAI 官方（直连）、OpenAI 兼容（含各类中转站）、通用 JSON（自定义请求体 + 响应路径）
- **自动生图**：AI 每次输出 <@tags>…</@tags> 就自动出图，单槽替换，新图覆盖旧图
- **面板操作**：手动生图、写入 tag 美化、下载（不消耗额度）、丢弃
- **一键配套资源**：世界书「生图Tag输出规范」+ 两条全局正则（「生图Tag美化」「生图Tag不对AI发送」）
- **移动端友好**：面板适配手机；在 TauriTavern 上自动隐藏用不到的项
- **可选服务端**：标准酒馆可把生图放到 Node 服务端插件里（无跨域、可在服务端保存 Key）

---

## 安装

### 一、安装扩展（必装，所有平台通用）

1. 酒馆 → 扩展面板 → Install extension
2. 填入仓库地址：

    https://github.com/Qkiiie/st-tag-auto-image

   - 勾选 Install for all users（需要管理员）会装到 public/scripts/extensions/third-party/
   - 不勾选则装到当前用户目录 data/<user>/extensions/
3. 到 Manage extensions 里启用「桃桃绘图」，然后**刷新页面**
4. 扩展菜单（🔌 图标）里点「桃桃绘图」打开面板；也可在聊天框输入 /生图 或 /桃桃绘图

> 手动安装：把仓库放进 public/scripts/extensions/third-party/（或 data/<user>/extensions/）即可，仓库根的 manifest.json 会被自动识别。

### 二、安装 Node 服务端插件（可选，仅标准电脑版酒馆）

TauriTavern 等原生客户端用不了这一项（其后端是 Rust、没有 Node 运行时）。标准酒馆按下面做：

    cd /path/to/SillyTavern
    git clone https://github.com/Qkiiie/st-tag-auto-image plugins/taotao-draw

然后在酒馆根目录的 config.yaml 里打开开关：

    enableServerPlugins: true

重启酒馆，日志里出现 `[tag-auto-image] 服务端插件已加载` 即成功。插件路由固定在 /api/plugins/tag-auto-image/（用的是插件 id，与文件夹名无关）。

> ⚠️ 服务端插件不受沙箱保护，能访问整个文件系统。只从你信任的仓库安装。

---

## 面板说明

| 面板项 | 说明 |
| --- | --- |
| 接口类型 | NovelAI 官方 / OpenAI 兼容 / 通用 JSON |
| API Key | NovelAI 官方填 pst- 开头的 Persistent Token；中转渠道填站点发给你的 sk- Key |
| 接口地址 | NovelAI 官方留空即用官方地址；OpenAI 兼容填完整接口路径（**结尾不要带斜杠**） |
| 模型 | 照站点给的名字填；NovelAI 官方可直接用内置预置 |
| 代理前缀 | **固定、不可编辑**，见下方「内置反代」。仅在 OpenAI 兼容 / 通用 JSON 下显示 |
| 模型列表 | 没有输入框：点「📡 拉取模型」会自动从接口地址推导 …/v1/models，并走反代 |
| 认证方式 | Authorization: Bearer / x-api-key / 原样 / 无认证 |
| 正向提示词 | 原样发送；自动生图时 <@tags> 内容会追加在它后面 |
| 负向提示词 | 负向提示词（OpenAI 兼容渠道下按 negative_prompt 发送） |
| 参数组 | 画面尺寸 / 步数 / Scale / 采样器 / 张数（NovelAI 官方与 OpenAI 兼容渠道都可用） |
| 自动读取 <@tags> | 打开后，AI 每次输出 tag 块就自动生图 |
| 最近生成 | 出图后可「写入 tag 美化」「下载」「丢弃」 |
| 配套资源 | 一键安装 / 检查世界书与两条正则 |

### 三种渠道怎么选

| 渠道 | 适合场景 | 是否走反代 |
| --- | --- | --- |
| NovelAI 官方 | 手上有 NAI 的 pst- Token，直连官方 image.novelai.net | 否（直连） |
| OpenAI 兼容 | 各类中转站 / 兼容渠道（本站默认适配 router.momotale.com 的 v4_5） | 是 |
| 通用 JSON | 特殊接口：自定义请求体模板 + 响应图片路径（占位符 {model}{prompt}{negative}{width}{height}{steps}{seed}{scale}{sampler}） | 是 |

OpenAI 兼容渠道推荐配置：

- 接口地址：https://router.momotale.com/v1/images/generations（**结尾不要斜杠**，带斜杠会返回 405）
- 模型：v4_5（NovelAI V4.5 通道；也支持站点提供的其它模型）
- 认证方式：Authorization: Bearer <你的 sk- Key>

---

## 内置反代（Cloudflare Worker）

**它解决什么**：客户端的网络层（跨域 / 风控）可能直接拦掉发往图片接口的请求，表现为 Failed to fetch。反代把请求经由 Cloudflare 转发一次，并补上 CORS 响应头，请求就能正常送达。

**地址写在哪**：shared/resources.mjs 里的 PROXY_PREFIX 常量。面板里是只读的，用户改不了——要换地址只改这一处。

**自己部署一个**：仓库里已经带了 Worker 源码与配置：

- worker/worker.js：转发逻辑（含请求头规范化与 CORS）
- worker/wrangler.toml、worker/package.json、根目录 wrangler.toml
- 用 Cloudflare 的 Deploy to Cloudflare 按钮一键部署，或手动新建 Worker 粘贴代码

部署后把新地址（形如 https://<worker名>.<子域>.workers.dev/<口令>/）写进 PROXY_PREFIX 即可。

**注意**：所有使用本插件的这些请求都会经过同一个反代（额度与风险都在部署者账号上）。自行分发时请留意这一点，或让上游站点给白名单、彻底不用反代。

---

## 配套资源

面板里的「🛠 安装/检查配套资源」会直接写入运行时存储（缺什么补什么，不会覆盖已有同名资源）：

- 世界书「生图Tag输出规范」：要求 AI 在正文末尾输出 <@tags>…</@tags>（常驻、system、depth 0）
- 正则「生图Tag美化」：把 tag 块渲染成折叠卡片 + 图片槽
- 正则「生图Tag不对AI发送」：发送给 AI 前把 tag 块剥掉

需要手动搬运配置时：

    node tools/export-resources.mjs

会在 resources/ 生成可导入的正则 JSON 与世界书 JSON。

---

## 常见问题

**更新扩展后没变化？**
扩展代码是刷新页面后才重新加载的：扩展面板点 Update（或卸载重装）→ **刷新酒馆页面**。面板里看不到版本号时，可在扩展列表里核对 manifest 的版本（当前 1.2.0）。

**生图报 HTTP 405，响应是 {"detail":"Method Not Allowed"}**
接口地址不对。最常见是**结尾多了一个斜杠**（/v1/images/generations/ 会 405，去掉斜杠才对），或只填到了 /v1。

**生图报 HTTP 502 / 523**
中转站上游故障，与本插件无关。自检地址（把 <口令> 换成 PROXY_PREFIX 里的那串）：

    https://<worker名>.<子域>.workers.dev/<口令>/https://router.momotale.com/v1/models

看到 Invalid or missing API Key 说明链路正常（没带 key 就会是这个回答）；还是 502/523 就是站点还没恢复。

**报错里带「｜请求：https://…」**
这是实际发出的完整地址，用它就能判断是地址拼错、还是被反代/站点改了路径。

**拉取模型失败？**
NovelAI 官方没有模型列表接口，点「📡 拉取模型」会把内置预置填进下拉，这是正常的。OpenAI 兼容渠道会从接口地址推导 …/v1/models，务必确认接口地址是完整路径。

**图片出来了，但没写进 tag 美化块**
说明没找到「生图Tag美化」正则，或该正则里没有图片占位。点「🛠 安装/检查配套资源」，并确认这条正则没被停用或删除。

**卡片里的「复制 tag」按钮点不动**
美化块里有一小段内联脚本（读取最近一张图、复制按钮），浏览器直出时会被 HTML 过滤剥掉；用酒馆助手渲染 HTML 代码块时功能完整。不影响图片显示与自动生图。

**面板点不开 / 报错**
把浏览器控制台的报错或面板状态栏那行文字发出来即可定位。

---

## 开发与维护

    目录结构
    manifest.json            扩展清单（仓库根必须有）
    client/                  扩展前端：入口 / 状态 / 管线 / 面板 / 样式 / TauriTavern 适配
    server/                  Node 服务端插件：路由 / 渠道实现 / 工具 / 配置
    shared/resources.mjs     两端共用常量（含 PROXY_PREFIX）、正则对象、世界书条目
    worker/                  中转 Worker 源码（可选部署）
    tools/export-resources.mjs
    diag/                    排障用页面（中转站体检）

    npm run check            语法自检（node --check 全量）

**发新版本**：改 manifest.json 里的 version（用户端才会显示可更新）→ 提交推送 → 用户在扩展面板点 Update。

**要改的东西集中在两处**：换反代地址改 shared/resources.mjs 的 PROXY_PREFIX；改默认提示词 / 尺寸等默认值改 DEFAULTS。

---

## 许可

MIT（见 LICENSE）。
