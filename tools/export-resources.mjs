#!/usr/bin/env node
/**
 * 生成 resources/ 下可直接导入酒馆的资源文件。
 *
 *   node tools/export-resources.mjs
 *
 * 产出：
 *   resources/regex-tag-beautify.json        「生图Tag美化」正则（SillyTavern 原生正则结构）
 *   resources/regex-tag-hide.json            「生图Tag不对AI发送」正则
 *   resources/worldbook-tag-output-rules.json 世界书「生图Tag输出规范」（酒馆世界书导入格式）
 *
 * 面板里的「🛠 安装/检查配套资源」会直接写入运行时存储，一般用不到这些文件；
 * 它们主要用于手动导入、版本管理或在别的设备上搬运配置。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    makeTagBeautifyRegex,
    makeTagHideRegex,
    normalizedToNativeRegex,
    makeNativeWorldbookData,
    WB_NAME,
} from '../shared/resources.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..', 'resources');
fs.mkdirSync(outDir, { recursive: true });

const files = [
    ['regex-tag-beautify.json', normalizedToNativeRegex(makeTagBeautifyRegex())],
    ['regex-tag-hide.json', normalizedToNativeRegex(makeTagHideRegex())],
    ['worldbook-tag-output-rules.json', makeNativeWorldbookData()],
];

for (const [name, data] of files) {
    const target = path.join(outDir, name);
    fs.writeFileSync(target, JSON.stringify(data, null, 4) + '\n', 'utf8');
    console.log(`已写入 ${path.relative(process.cwd(), target)}`);
}

console.log(`\n世界书导入后的名称：${WB_NAME}`);
console.log('正则文件可在酒馆「Regex」扩展里用 Import 导入，或直接使用面板上的「安装/检查配套资源」。');
