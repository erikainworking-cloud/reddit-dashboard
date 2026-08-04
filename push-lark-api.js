/**
 * push-lark-api.js  —  Feishu Bot API helper (no lark-cli / no Keychain)
 *
 * Uses env vars LARK_APP_ID + LARK_APP_SECRET when available.
 * Falls back to lark-cli (interactive/local only) when they are absent.
 */

'use strict';

const https = require('https');
const fs    = require('fs');
const path  = require('path');
const { spawnSync } = require('child_process');

const LARK_CLI = '/Users/erikaleen/.npm-global/lib/node_modules/@larksuite/cli/bin/lark-cli';

// ── Low-level HTTPS ───────────────────────────────────────────

function httpsPost(host, urlPath, headers, bodyBuf) {
  return new Promise((resolve, reject) => {
    const opts = { hostname: host, path: urlPath, method: 'POST', headers };
    const req  = https.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { reject(new Error('Non-JSON: ' + chunks.join(''))); }
      });
    });
    req.on('error', reject);
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

// ── Token cache (valid ~115 min) ──────────────────────────────

let _tokenCache = null;

async function getTenantAccessToken() {
  const appId     = process.env.LARK_APP_ID;
  const appSecret = process.env.LARK_APP_SECRET;
  if (!appId || !appSecret) throw new Error('LARK_APP_ID / LARK_APP_SECRET not set');

  if (_tokenCache && Date.now() < _tokenCache.expires) return _tokenCache.token;

  const body = Buffer.from(JSON.stringify({ app_id: appId, app_secret: appSecret }));
  const res  = await httpsPost('open.feishu.cn', '/open-apis/auth/v3/tenant_access_token/internal',
    { 'Content-Type': 'application/json', 'Content-Length': body.length }, body);

  if (res.code !== 0) throw new Error('token error: ' + JSON.stringify(res));
  _tokenCache = { token: res.tenant_access_token, expires: Date.now() + 6900_000 };
  return _tokenCache.token;
}

// ── Image upload ──────────────────────────────────────────────

async function uploadImageApi(token, imagePath) {
  const imageData = fs.readFileSync(imagePath);
  const boundary  = 'FeishuBoundary' + Math.random().toString(36).slice(2);

  const metaPart  = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="image_type"\r\n\r\nmessage\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="img.png"\r\nContent-Type: image/png\r\n\r\n`
  );
  const footer    = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body      = Buffer.concat([metaPart, imageData, footer]);

  const res = await httpsPost('open.feishu.cn', '/open-apis/im/v1/images',
    {
      'Authorization'  : `Bearer ${token}`,
      'Content-Type'   : `multipart/form-data; boundary=${boundary}`,
      'Content-Length' : body.length,
    }, body);

  if (res.code !== 0 || !res.data?.image_key) {
    throw new Error('image upload failed: ' + JSON.stringify(res));
  }
  return res.data.image_key;
}

function uploadImageCli(imagePath) {
  const relPath = path.relative(process.cwd(), imagePath);
  const r = spawnSync(LARK_CLI, [
    'api', 'POST', '/open-apis/im/v1/images',
    '--file', `image=${relPath}`,
    '--data', '{"image_type":"message"}',
    '--as', 'bot',
  ], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  const raw = (r.stdout || '') + (r.stderr || '');
  const d   = JSON.parse(raw.slice(raw.indexOf('{')));
  if (!d.data?.image_key) throw new Error('cli upload: ' + JSON.stringify(d));
  return d.data.image_key;
}

/**
 * Upload an image. Uses API when credentials are available, CLI otherwise.
 * @returns {Promise<string>} image_key
 */
async function uploadImage(imagePath) {
  if (process.env.LARK_APP_ID && process.env.LARK_APP_SECRET) {
    const token = await getTenantAccessToken();
    return uploadImageApi(token, imagePath);
  }
  return uploadImageCli(imagePath);
}

// ── Send card ─────────────────────────────────────────────────

async function sendCardApi(token, target, content) {
  const recvType = target.type === 'chat' ? 'chat_id' : 'user_id';
  const body     = Buffer.from(JSON.stringify({
    receive_id : target.id,
    msg_type   : 'interactive',
    content,
  }));
  const res = await httpsPost('open.feishu.cn',
    `/open-apis/im/v1/messages?receive_id_type=${recvType}`,
    {
      'Authorization'  : `Bearer ${token}`,
      'Content-Type'   : 'application/json',
      'Content-Length' : body.length,
    }, body);
  if (res.code !== 0) throw new Error('send failed: ' + JSON.stringify(res));
  return res.data?.message_id || 'ok';
}

function sendCardCli(target, content) {
  const flag = target.type === 'chat' ? '--chat-id' : '--user-id';
  const r = spawnSync(LARK_CLI, [
    'im', '+messages-send', flag, target.id,
    '--msg-type', 'interactive', '--content', content, '--as', 'bot',
  ], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  const raw = (r.stdout || '') + (r.stderr || '');
  const d   = JSON.parse(raw.slice(raw.indexOf('{')));
  if (d.ok || d.code === 0) return d.data?.message_id || 'ok';
  throw new Error((d.error?.message || d.msg || 'unknown') + ' | ' + raw.slice(0, 200));
}

/**
 * Send an interactive card to a target.
 * @param {{ type: 'chat'|'user', id: string, name: string }} target
 * @param {string} content  JSON string of the card
 * @returns {Promise<boolean>}
 */
async function sendCard(target, content) {
  try {
    let msgId;
    if (process.env.LARK_APP_ID && process.env.LARK_APP_SECRET) {
      const token = await getTenantAccessToken();
      msgId = await sendCardApi(token, target, content);
    } else {
      msgId = sendCardCli(target, content);
    }
    console.log(`  ✅ [${target.name}] 发送成功 · ${msgId}`);
    return true;
  } catch (e) {
    console.error(`  ❌ [${target.name}] ${e.message}`);
    return false;
  }
}

module.exports = { uploadImage, sendCard };
