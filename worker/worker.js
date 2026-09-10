// Tag 自动生图 · 中转 Worker（绕过中转站 WAF / 跨域限制）
// 用法：https://<你的worker域名>/<口令>/https://目标地址/路径
const SECRET = 'ttqk91f3';

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

const text = (msg, status) =>
  new Response(msg, { status, headers: Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, CORS) });

export default {
  async fetch(request) {
    const reqUrl = new URL(request.url);
    let rest = reqUrl.pathname.replace(/^\/+/, '');

    if (SECRET) {
      const seg = rest.split('/')[0];
      if (seg !== SECRET) {
        return text('口令不对。代理前缀请用：' + reqUrl.origin + '/' + SECRET + '/', 403);
      }
      rest = rest.slice(seg.length).replace(/^\/+/, '');
    }

    const target = rest + reqUrl.search;

    if (!target) {
      return text(
        '中转 Worker 已部署。在酒馆生图面板的「代理前缀」里填：\n' +
        reqUrl.origin + (SECRET ? '/' + SECRET : '') + '/\n',
        200,
      );
    }

    if (!/^https?:\/\//i.test(target)) {
      return text('目标地址必须以 http:// 或 https:// 开头', 400);
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    let t;
    try {
      t = new URL(target);
    } catch (e) {
      return text('目标地址解析失败：' + target, 400);
    }

    const headers = new Headers(request.headers);
    for (const h of [
      'host', 'origin', 'referer', 'content-length', 'accept-encoding',
      'connection', 'cf-connecting-ip', 'cf-ipcountry', 'cf-ray',
      'x-forwarded-for', 'x-forwarded-proto', 'x-real-ip',
    ]) {
      headers.delete(h);
    }
    headers.set('User-Agent', DESKTOP_UA);
    headers.set('Origin', t.origin);
    headers.set('Referer', t.origin + '/');
    if (!headers.has('Accept')) headers.set('Accept', 'application/json, */*');
    if (!headers.has('Accept-Language')) headers.set('Accept-Language', 'zh-CN,zh;q=0.9,en;q=0.8');

    const init = { method: request.method, headers, redirect: 'follow' };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = await request.arrayBuffer();
    }

    let resp;
    try {
      resp = await fetch(t.toString(), init);
    } catch (e) {
      return text('中转请求失败：' + (e && e.message ? e.message : e), 502);
    }

    const out = new Headers(resp.headers);
    out.delete('content-encoding');
    out.delete('content-length');
    for (const k of Object.keys(CORS)) out.set(k, CORS[k]);
    return new Response(resp.body, { status: resp.status, headers: out });
  },
};
