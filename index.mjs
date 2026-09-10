/**
 * Tag 自动生图 —— SillyTavern 服务端插件入口
 *
 * 用法：把本仓库 clone 进 SillyTavern 的 plugins/ 目录，并在 config.yaml 中设置
 *   enableServerPlugins: true
 * 然后重启酒馆。插件路由挂载在 /api/plugins/tag-auto-image/…
 *
 * SillyTavern 的插件加载器约定：
 *   - 目录插件按 package.json 的 "main" → index.js/index.cjs → index.mjs 的顺序寻找入口；
 *   - 入口模块必须导出 info { id, name, description } 与 init(router)，可选 exit()；
 *   - id 只允许小写字母、数字、连字符与下划线。
 *
 * @typedef {import('express').Router} Router
 */
import { attachRoutes } from './server/routes.mjs';
import { PLUGIN_ID, PLUGIN_VERSION } from './shared/resources.mjs';

export const info = {
    id: PLUGIN_ID,
    name: 'Tag Auto Image',
    description: '服务端生图后端：转发 NovelAI / OpenAI 兼容 / 通用 JSON 图片接口，规避浏览器 CORS，可选在服务端保存 API Key。',
};

/**
 * 初始化插件，注册 API 路由。
 * @param {Router} router 由 SillyTavern 为本插件创建的 Express Router
 * @returns {Promise<void>}
 */
export async function init(router) {
    attachRoutes(router);
    console.log(`[${PLUGIN_ID}] 服务端插件已加载（v${PLUGIN_VERSION}），路由：/api/plugins/${PLUGIN_ID}/{ping|generate|models|config}`);
    return Promise.resolve();
}

/**
 * 关闭时的清理钩子。
 * @returns {Promise<void>}
 */
export async function exit() {
    console.log(`[${PLUGIN_ID}] 已卸载`);
    return Promise.resolve();
}
