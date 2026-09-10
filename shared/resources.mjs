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
