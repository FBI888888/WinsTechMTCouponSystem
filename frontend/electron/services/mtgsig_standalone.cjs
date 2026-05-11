/**
 * mtgsig_standalone.js — 美团 H5guard mtgsig 签名引擎（纯算独立版）
 *
 * 与 mtgsig_fresh.js 完全兼容，无需 H5guard.js 依赖。
 * mtgsig_core.js 由 build_standalone.js 自动生成，包含所有算法逻辑。
 *
 * 用法（与 mtgsig_fresh.js 相同）：
 *   const { sign, buildCurl, sendRequest } = require('./mtgsig_standalone');
 *
 *   // 每次新建会话（默认，防风控）
 *   const { signedUrl, mtgsig } = sign({ method, url, body, cookies });
 *
 *   // 复用实例（速度更快）
 *   const { signedUrl, mtgsig } = sign({ method, url, body, cookies, fresh: false, maxReuse: 50 });
 */

'use strict';

const { sign: _sign, reinit } = require('./mtgsig_core.cjs');

function serializeCookies(cookies) {
  if (!cookies) return '';
  if (typeof cookies === 'string') return cookies;
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
}

/**
 * 签名请求（与 mtgsig_fresh.js 的 sign() 完全兼容）
 */
function sign(opts) {
  return _sign(opts);
}

/**
 * 生成 curl 命令字符串
 */
function buildCurl({ method = 'POST', url, body, cookies, headers = {}, fresh = true, maxReuse = 100 } = {}) {
  const { signedUrl, bodyString } = sign({ method, url, body, cookies, fresh, maxReuse });
  const cookieStr = serializeCookies(cookies);
  const defaultHeaders = {
    'Host':            new URL(url).hostname,
    'Connection':      'keep-alive',
    'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Windows WindowsWechat/WMPF WindowsWechat(0x63090a13) UnifiedPCWindowsWechat(0xf254181d) XWEB/19201 miniProgram/wxde8ac0a21135c07d',
    'Accept':          'application/json, text/plain, */*',
    'Origin':          'https://awp.meituan.com',
    'Sec-Fetch-Site':  'same-site',
    'Sec-Fetch-Mode':  'cors',
    'Sec-Fetch-Dest':  'empty',
    'Referer':         'https://awp.meituan.com/',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Cookie':          cookieStr,
    'Content-Type':    'application/json',
  };
  const allHeaders = Object.assign({}, defaultHeaders, headers);
  const headerLines = Object.entries(allHeaders)
    .map(([k, v]) => `  --header '${k}: ${v}'`)
    .join(' \\\n');
  const dataLine = bodyString ? `  --data-raw '${bodyString}'` : '';
  return [
    `curl --location --request ${method.toUpperCase()} '${signedUrl}' \\`,
    headerLines,
    ...(dataLine ? [' \\', dataLine] : []),
  ].join('\n');
}

/**
 * 发送签名请求
 * @returns {Promise<{ status, headers, body, json }>}
 */
function sendRequest({ method = 'POST', url, body, cookies, headers = {}, fresh = true, maxReuse = 100 } = {}) {
  const { signedUrl, bodyString } = sign({ method, url, body, cookies, fresh, maxReuse });
  const https = require(signedUrl.startsWith('https') ? 'https' : 'http');
  const cookieStr = serializeCookies(cookies);
  const parsedUrl = new URL(signedUrl);
  const reqHeaders = Object.assign({
    'Host':            parsedUrl.hostname,
    'Connection':      'keep-alive',
    'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Windows WindowsWechat/WMPF WindowsWechat(0x63090a13) UnifiedPCWindowsWechat(0xf254181d) XWEB/19201 miniProgram/wxde8ac0a21135c07d',
    'Accept':          'application/json, text/plain, */*',
    'Origin':          'https://awp.meituan.com',
    'Sec-Fetch-Site':  'same-site',
    'Sec-Fetch-Mode':  'cors',
    'Sec-Fetch-Dest':  'empty',
    'Referer':         'https://awp.meituan.com/',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Cookie':          cookieStr,
    'Content-Type':    'application/json',
    'Content-Length':  Buffer.byteLength(bodyString),
  }, headers);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: parsedUrl.hostname,
      path:     parsedUrl.pathname + parsedUrl.search,
      method:   method.toUpperCase(),
      headers:  reqHeaders,
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (_) {}
        resolve({ status: res.statusCode, headers: res.headers, body: data, json });
      });
    });
    req.on('error', reject);
    if (bodyString) req.write(bodyString);
    req.end();
  });
}

module.exports = { sign, buildCurl, sendRequest, reinit };
