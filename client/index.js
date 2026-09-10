/**
 * Tag 自动生图（服务端版）—— UI 扩展入口
 *
 * 结构：
 *   client/index.js    入口：扩展菜单按钮、事件监听、Slash 命令、首次运行安装配套资源
 *   client/state.js    酒馆上下文 / 设置 / 服务端插件探测
 *   client/pipeline.js 生图、图床、正则与世界书写入
 *   client/panel.js    生图面板 UI
 *
 * 生图默认走服务端插件（需要在 config.yaml 开启 enableServerPlugins 并把本仓库 clone 进 plugins/），
 * 检测不到时按设置回退到浏览器直连（原「Tag自动生图」脚本的行为）。
 */
import { SCRIPT_TAG } from '../shared/resources.mjs';
import * as S from './state.js';
import * as P from './pipeline.js';
import * as UI from './panel.js';

/** 防止同一条消息重复触发 */
let busy = false;

/**
 * 在扩展菜单里加一个「生图面板」按钮。
 */
function addExtensionMenuButton() {
    const $ = window.jQuery || window.$;
    const menu = document.getElementById('extensionsMenu');
    if (!$ || !menu) {
        console.warn(`[${SCRIPT_TAG}] 未找到 #extensionsMenu，跳过菜单按钮`);
        return false;
    }
    if (document.getElementById('taggen-menu-button')) return true;
    const button = $(
        `<div id="taggen-menu-button" class="list-group-item flex-container flexGap5 interactable" tabindex="0" title="桃桃绘图">
            <div class="fa-solid fa-palette extensionsMenuExtensionButton"></div>
            <span>桃桃绘图</span>
        </div>`,
    );
    button.on('click', () => UI.openPanel().catch(S.toastError));
    $('#extensionsMenu').append(button);
    return true;
}

/**
 * 监听新消息，自动识别正文末尾的 <@tags>。
 */
function registerMessageHook() {
    const ctx = S.getContext();
    if (!ctx || !ctx.eventSource || !ctx.eventTypes) {
        console.warn(`[${SCRIPT_TAG}] 拿不到 eventSource，自动生图不可用`);
        return;
    }
    const eventName = ctx.eventTypes.MESSAGE_RECEIVED;
    if (!eventName) {
        console.warn(`[${SCRIPT_TAG}] 找不到 MESSAGE_RECEIVED 事件`);
        return;
    }
    ctx.eventSource.on(eventName, async (payload) => {
        if (busy) return;
        busy = true;
        try {
            const c = S.getContext();
            let messageId = typeof payload === 'number' ? payload : Number.parseInt(String(payload), 10);
            if (!Number.isInteger(messageId) && c && Array.isArray(c.chat) && c.chat.length) {
                messageId = c.chat.length - 1;
            }
            if (!Number.isInteger(messageId)) return;
            await P.handleMessageTags(messageId, {
                onGenerated: (dataUrl) => UI.setLastGenerated(dataUrl),
            });
        } catch (e) {
            S.toastError(e);
        } finally {
            busy = false;
        }
    });
}

/**
 * 注册 /生图 等 Slash 命令。
 */
async function registerSlashCommands() {
    try {
        const mod = await P.loadSlashCommandParser();
        const parser = mod && (mod.SlashCommandParser || mod.default);
        if (!parser || typeof parser.addCommandObject !== 'function') return false;
        parser.addCommandObject({
            command: '生图',
            aliases: ['tag生图', '自动生图', '桃桃绘图', '桃桃'],
            helpString: '打开桃桃绘图面板',
            returns: '无',
            namedArgumentList: [],
            unnamedArgumentList: [],
            callback: async () => {
                await UI.openPanel();
                return '';
            },
        });
        return true;
    } catch (e) {
        console.warn(`[${SCRIPT_TAG}] Slash 命令注册失败（不影响面板按钮）`, e);
        return false;
    }
}

/**
 * 首次运行自动安装配套资源（只在缺失时创建）。
 */
function ensureResourcesLater(delay = 1200) {
    setTimeout(() => {
        P.ensureResources().catch((e) => {
            console.warn(`[${SCRIPT_TAG}] 配套资源自动安装失败`, e);
        });
    }, delay);
}

function boot() {
    if (!S.getContext()) {
        console.warn(`[${SCRIPT_TAG}] 未检测到 SillyTavern 上下文，扩展可能不是被酒馆加载的`);
        return;
    }

    addExtensionMenuButton();
    registerMessageHook();
    registerSlashCommands().then((ok) => {
        if (!ok) console.warn(`[${SCRIPT_TAG}] 未注册 /生图 命令，可改用扩展菜单里的「生图面板」按钮`);
    });

    // 提前探测一次服务端，日志里给出结论，方便排查安装问题
    S.detectServer(true)
        .then(({ available, base }) => {
            if (available) console.log(`[${SCRIPT_TAG}] 服务端插件已连接：${base}`);
            else {
                console.warn(
                    `[${SCRIPT_TAG}] 未检测到服务端插件，将按设置回退到浏览器直连。` +
                        `若要用服务端生图：clone 本仓库到 plugins/，并在 config.yaml 设置 enableServerPlugins: true 后重启酒馆。` +
                        (S.getLastProbeDetail() ? `（探测详情：${S.getLastProbeDetail()}）` : ''),
                );
            }
        })
        .catch((e) => console.warn(`[${SCRIPT_TAG}] 服务端探测异常`, e));

    ensureResourcesLater();

    // 给进阶用户留一个控制台入口
    window.__tagAutoImage = {
        openPanel: () => UI.openPanel(),
        ensureResources: () => P.ensureResources(),
        runGeneration: (prompt) => P.runGeneration(prompt),
        detectServer: () => S.detectServer(true),
        settings: () => S.getSettings(),
    };

    console.log(`[${SCRIPT_TAG}] 已加载（v1.0.0）`);
}

boot();
