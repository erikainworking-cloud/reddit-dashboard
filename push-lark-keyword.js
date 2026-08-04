#!/usr/bin/env node
/**
 * push-lark-keyword.js
 * 精准词监控日报 + 执行动作提醒
 *
 * 用法：
 *   node push-lark-keyword.js              # 测试模式
 *   node push-lark-keyword.js --prod       # 生产模式
 *   node push-lark-keyword.js --chat-id oc_xxx
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { createCanvas, GlobalFonts } = require(path.join(__dirname, 'node_modules/@napi-rs/canvas'));
const larkApi = require('./push-lark-api');
const STATS_FILE  = path.join(__dirname, 'stats.json');
const DASHBOARD_URL = 'https://erikainworking-cloud.github.io/reddit-dashboard/';

const TARGETS = {
  test: [{ type: 'chat', id: 'oc_25770fbdf3c7f0736f128e10fb0a83ed', name: 'erika消息推送接收群' }],
  prod: [],
};

const C = {
  ink: '#172033', muted: '#6B778C', faint: '#98A2B3',
  border: '#E5EAF0', grid: '#EEF2F6', panel: '#F8FAFC', white: '#FFFFFF',
  sf: '#FF5A1F', sfSoft: '#FFE9E1',
  df: '#2F6BEE', dfSoft: '#E8F0FF',
  risk: '#D64545', riskSoft: '#FDEBEC',
  warn: '#D97706', warnSoft: '#FFF3D6',
  good: '#16A36A', goodSoft: '#E7F7F0',
  blue: '#2F6BEE', blueSoft: '#E8F0FF',
  pending: '#667085', pendingSoft: '#F2F4F7',
};

// ── CLI args ──────────────────────────────────────────────────

const args = process.argv.slice(2);
const isProd = args.includes('--prod');
const customTargets = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--chat-id' && args[i+1]) { customTargets.push({ type: 'chat', id: args[i+1], name: args[i+1] }); i++; }
  if (args[i] === '--user-id' && args[i+1]) { customTargets.push({ type: 'user', id: args[i+1], name: args[i+1] }); i++; }
}
let targets;
if (customTargets.length) targets = customTargets;
else if (isProd && TARGETS.prod.length) targets = TARGETS.prod;
else targets = TARGETS.test;

// ── 数据 ──────────────────────────────────────────────────────

if (!fs.existsSync(STATS_FILE)) throw new Error('stats.json 不存在');
const stats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
const sf = stats.streamfab || {};
const df = stats.dvdfab   || {};

// ── Canvas 工具 ───────────────────────────────────────────────

function registerFonts() {
  for (const [file, family] of [
    ['/System/Library/Fonts/PingFang.ttc', 'PingFang SC'],
    ['/System/Library/Fonts/Hiragino Sans GB.ttc', 'Hiragino Sans GB'],
  ]) {
    try { if (fs.existsSync(file)) GlobalFonts.registerFromPath(file, family); } catch (_) {}
  }
}
registerFonts();
const FONT = 'PingFang SC, Hiragino Sans GB, sans-serif';

function rr(ctx, x, y, w, h, r, color) {
  const rv = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rv, y); ctx.arcTo(x + w, y, x + w, y + h, rv);
  ctx.arcTo(x + w, y + h, x, y + h, rv); ctx.arcTo(x, y + h, x, y, rv);
  ctx.arcTo(x, y, x + w, y, rv); ctx.closePath();
  if (color) { ctx.fillStyle = color; ctx.fill(); }
}

function txt(ctx, size, weight, color, align = 'left') {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
}

// ── 精准词 KPI 图（双列卡片）─────────────────────────────────

function drawKeywordCard(ctx, data, x, y, w, h, accent, accentSoft) {
  // 卡片底板
  ctx.save();
  ctx.shadowColor = 'rgba(16,24,40,0.07)'; ctx.shadowBlur = 16; ctx.shadowOffsetY = 4;
  rr(ctx, x, y, w, h, 16, C.white);
  ctx.restore();
  ctx.strokeStyle = C.border; ctx.lineWidth = 1;
  rr(ctx, x, y, w, h, 16); ctx.stroke();

  // 品牌标题
  rr(ctx, x + 20, y + 20, 8, 26, 4, accent);
  txt(ctx, 20, 700, C.ink); ctx.fillText(data.label || '', x + 40, y + 39);

  // 总量大数
  txt(ctx, 42, 700, C.ink); ctx.fillText(data.total ?? '—', x + 20, y + 100);
  txt(ctx, 14, 500, C.muted); ctx.fillText('条帖子/评论', x + 20, y + 120);

  // 帖子 vs 评论
  txt(ctx, 13, 500, C.faint);
  ctx.fillText(`帖子 ${data.posts ?? 0}`, x + 20, y + 148);
  ctx.fillText(`评论 ${data.comments ?? 0}`, x + 130, y + 148);

  // 品牌提及率
  const yes = data.brandMention?.YES ?? 0;
  const no  = data.brandMention?.NO  ?? 0;
  const mentionRate = yes + no > 0 ? (yes / (yes + no) * 100).toFixed(1) : '—';
  txt(ctx, 13, 500, C.faint); ctx.fillText('品牌提及率', x + w - 160, y + 30);
  txt(ctx, 28, 700, accent, 'right'); ctx.fillText(`${mentionRate}%`, x + w - 20, y + 60);
  txt(ctx, 12, 500, C.faint, 'right'); ctx.fillText(`${yes} / ${yes + no} 条`, x + w - 20, y + 78);

  // 分隔线
  ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x + 20, y + 163); ctx.lineTo(x + w - 20, y + 163); ctx.stroke();

  // 执行动作 4格
  const actions = [
    { label: '待处理',   val: (data.statusCount?.['待处理'] ?? 0), urgent: true  },
    { label: '待审核',   val: (data.statusCount?.['待审核'] ?? 0) + (data.statusCount?.['需要复核'] ?? 0), warn: true },
    { label: '高意向用户', val: data.intentCount?.['高意向用户'] ?? 0, highlight: true },
    { label: '已发布',   val: data.statusCount?.['已发布'] ?? 0, positive: true },
  ];
  const cellW = (w - 40) / 4;
  actions.forEach((a, i) => {
    const cx = x + 20 + i * cellW;
    const cy = y + 176;
    const bg  = a.urgent && a.val > 0  ? C.riskSoft
              : a.warn   && a.val > 0  ? C.warnSoft
              : a.highlight             ? C.blueSoft
              : a.positive && a.val > 0 ? C.goodSoft
              : C.pendingSoft;
    const fg  = a.urgent && a.val > 0  ? C.risk
              : a.warn   && a.val > 0  ? C.warn
              : a.highlight             ? C.blue
              : a.positive && a.val > 0 ? C.good
              : C.faint;
    rr(ctx, cx + 2, cy, cellW - 4, 60, 10, bg);
    txt(ctx, 11, 500, fg, 'center'); ctx.fillText(a.label, cx + cellW / 2, cy + 18);
    txt(ctx, 26, 700, fg, 'center'); ctx.fillText(String(a.val), cx + cellW / 2, cy + 50);
  });

  // Top 3 关键词
  txt(ctx, 12, 600, C.muted); ctx.fillText('Top 关键词', x + 20, y + 258);
  const kws = (data.topKeywords || []).slice(0, 3);
  kws.forEach(([kw, cnt], i) => {
    const barW = w - 40;
    const maxCnt = kws[0]?.[1] || 1;
    const fill = Math.round(barW * Math.min(cnt / maxCnt, 1));
    rr(ctx, x + 20, y + 268 + i * 22, barW, 14, 7, C.grid);
    rr(ctx, x + 20, y + 268 + i * 22, Math.max(fill, 14), 14, 7, accentSoft);
    txt(ctx, 11, 500, C.ink); ctx.fillText(kw || '', x + 26, y + 280 + i * 22);
    txt(ctx, 11, 600, accent, 'right'); ctx.fillText(String(cnt), x + w - 20, y + 280 + i * 22);
  });
}

async function generateKeywordPng(sfData, dfData, outPath) {
  const W = 1200, H = 380;
  const canvas = createCanvas(W * 2, H * 2);
  const ctx = canvas.getContext('2d');
  ctx.scale(2, 2);
  ctx.fillStyle = C.panel; ctx.fillRect(0, 0, W, H);

  drawKeywordCard(ctx, sfData, 32, 20, 556, 340, C.sf, C.sfSoft);
  drawKeywordCard(ctx, dfData, 612, 20, 556, 340, C.df, C.dfSoft);

  fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
  return outPath;
}

// ── 飞书图片上传 ──────────────────────────────────────────────

async function uploadImage(pngPath) {
  return larkApi.uploadImage(pngPath);
}

// ── 卡片构建 ──────────────────────────────────────────────────

function buildCard(imgKey) {
  const today = new Date().toISOString().slice(0, 10);
  const envTag = isProd ? '' : ' [TEST]';

  // 执行动作摘要（文字结论区）
  const sfPending  = (sf.statusCount?.['待处理'] ?? 0);
  const dfPending  = (df.statusCount?.['待处理'] ?? 0);
  const sfReview   = (sf.statusCount?.['待审核'] ?? 0) + (sf.statusCount?.['需要复核'] ?? 0);
  const dfReview   = (df.statusCount?.['待审核'] ?? 0) + (df.statusCount?.['需要复核'] ?? 0);
  const sfHigh     = sf.intentCount?.['高意向用户'] ?? 0;
  const dfHigh     = df.intentCount?.['高意向用户'] ?? 0;
  const sfPub      = sf.statusCount?.['已发布'] ?? 0;
  const dfPub      = df.statusCount?.['已发布'] ?? 0;
  const totalPending = sfPending + dfPending;
  const totalReview  = sfReview + dfReview;
  const totalHigh    = sfHigh + dfHigh;

  const urgentLine = totalPending > 0
    ? `🔴 **待处理 ${totalPending} 条**（SF ${sfPending} / DF ${dfPending}）· 需今日跟进`
    : `✅ 待处理清零`;
  const reviewLine = totalReview > 0
    ? `🟡 **待审核 ${totalReview} 条**（SF ${sfReview} / DF ${dfReview}）· 回复等待复核`
    : `✅ 无待审核`;
  const highLine  = totalHigh > 0
    ? `🟢 **高意向用户 ${totalHigh} 条**（SF ${sfHigh} / DF ${dfHigh}）· 优先跟进`
    : `⬜ 无高意向用户`;
  const pubLine   = `📤 **本期已发布 ${sfPub + dfPub} 条**（SF ${sfPub} / DF ${dfPub}）`;

  // Top 5 关键词（两品牌合并去重）
  const kwMap = new Map();
  for (const [kw, cnt] of [...(sf.topKeywords || []), ...(df.topKeywords || [])]) {
    kwMap.set(kw, (kwMap.get(kw) || 0) + cnt);
  }
  const top5 = [...kwMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const kwTable = top5.map(([kw, n], i) => `${i + 1}. **${kw}** — ${n} 条`).join('\n');

  const elements = [
    {
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**执行动作速览 · ${today}**\n${urgentLine}\n${reviewLine}\n${highLine}\n${pubLine}`,
      },
    },
    { tag: 'hr' },
  ];

  if (imgKey) {
    elements.push({
      tag: 'img', img_key: imgKey,
      alt: { tag: 'plain_text', content: '精准词监控 KPI' },
      mode: 'fit_horizontal', preview: false,
    });
  }

  elements.push({ tag: 'hr' });
  elements.push({
    tag: 'div',
    text: { tag: 'lark_md', content: `**热门关键词 Top 5**（SF + DF 合并）\n${kwTable}` },
  });

  elements.push({ tag: 'hr' });
  elements.push({
    tag: 'action',
    actions: [{
      tag: 'button',
      text: { tag: 'plain_text', content: '查看精准词监控看板 →' },
      type: 'primary', url: DASHBOARD_URL,
    }],
  });

  return JSON.stringify({
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `📡 精准词监控日报 · ${today}${envTag}` },
      template: isProd ? 'orange' : 'blue',
    },
    elements,
  });
}

// ── 发送 ──────────────────────────────────────────────────────

async function sendCard(target, content) {
  return larkApi.sendCard(target, content);
}

// ── 主流程 ────────────────────────────────────────────────────

(async () => {
  console.log(`\n${isProd ? '🚀 生产' : '🧪 测试'} 模式 · 精准词监控日报`);
  console.log(`数据：SF ${sf.total ?? '—'} 条 | DF ${df.total ?? '—'} 条`);

  const pngPath = path.join(__dirname, '_kw_summary.png');
  let imgKey = null;

  try {
    process.stdout.write('  ⏳ 生成 KPI 图...');
    await generateKeywordPng(sf, df, pngPath);
    console.log(' ✓');
    process.stdout.write('  ⏳ 上传图片...');
    imgKey = await uploadImage(pngPath);
    console.log(` ✓ ${imgKey}`);
  } catch (e) {
    console.log(` ⚠️  图片跳过（${e.message}）`);
  } finally {
    try { if (fs.existsSync(pngPath)) fs.unlinkSync(pngPath); } catch (_) {}
  }

  const content = buildCard(imgKey);
  let ok = 0;
  for (const t of targets) { if (await sendCard(t, content)) ok++; }
  console.log(`\n${ok}/${targets.length} 发送成功`);
  if (ok < targets.length) process.exitCode = 1;
})().catch(e => {
  console.error('\n❌', e.stack || e.message);
  process.exit(1);
});
