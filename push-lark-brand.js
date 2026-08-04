#!/usr/bin/env node
/**
 * push-lark-brand.js
 * 品牌舆情监控周报：处理管道进度 + 问题分类 + 执行重点
 *
 * 用法：
 *   node push-lark-brand.js              # 测试模式
 *   node push-lark-brand.js --prod       # 生产模式
 *   node push-lark-brand.js --chat-id oc_xxx
 */

'use strict';

const { spawnSync } = require('child_process');
const fs   = require('fs');
const path = require('path');
const { createCanvas, GlobalFonts } = require(path.join(__dirname, 'node_modules/@napi-rs/canvas'));

const LARK        = '/Users/erikaleen/.npm-global/lib/node_modules/@larksuite/cli/bin/lark-cli';
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
  purple: '#7C3AED', purpleSoft: '#F5F3FF',
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
const bm = stats.brandMonitoring || {};
const sfBm = bm.streamfab || {};
const dfBm = bm.dvdfab   || {};

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
  if (w <= 0) return;
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

// ── 品牌舆情 KPI 卡片 ─────────────────────────────────────────

function drawBrandCard(ctx, data, x, y, w, h, accent, accentSoft) {
  // 卡片底板
  ctx.save();
  ctx.shadowColor = 'rgba(16,24,40,0.07)'; ctx.shadowBlur = 16; ctx.shadowOffsetY = 4;
  rr(ctx, x, y, w, h, 16, C.white);
  ctx.restore();
  ctx.strokeStyle = C.border; ctx.lineWidth = 1;
  rr(ctx, x, y, w, h, 16); ctx.stroke();

  // 品牌标题 + 质量评分
  rr(ctx, x + 20, y + 20, 8, 26, 4, accent);
  txt(ctx, 20, 700, C.ink); ctx.fillText(data.label || '', x + 40, y + 39);
  const score = data.avgQualityScore != null ? `${data.avgQualityScore}/10` : '—';
  txt(ctx, 12, 500, C.faint, 'right'); ctx.fillText('回复质量', x + w - 20, y + 30);
  txt(ctx, 24, 700, score !== '—' && parseFloat(score) >= 7 ? C.good : C.warn, 'right');
  ctx.fillText(score, x + w - 20, y + 56);

  // 总量
  txt(ctx, 38, 700, C.ink); ctx.fillText(data.total ?? '—', x + 20, y + 96);
  txt(ctx, 13, 500, C.muted); ctx.fillText('条品牌提及', x + 20, y + 116);

  // 分隔线
  ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x + 20, y + 132); ctx.lineTo(x + w - 20, y + 132); ctx.stroke();

  // 处理管道（Pipeline）：待处理 → 已生成 → 已处理 → 无需处理
  const stages = [
    { label: '待处理', val: data.pending  ?? 0, color: C.risk,    bg: C.riskSoft    },
    { label: '已生成', val: data.generated?? 0, color: C.warn,    bg: C.warnSoft    },
    { label: '已处理', val: data.processed?? 0, color: C.good,    bg: C.goodSoft    },
    { label: '无需处理',val: data.noAction?? 0, color: C.pending, bg: C.pendingSoft },
  ];
  txt(ctx, 12, 600, C.muted); ctx.fillText('处理管道', x + 20, y + 152);
  const stageW = (w - 44) / 4;
  stages.forEach((s, i) => {
    const sx = x + 20 + i * (stageW + 4);
    const sy = y + 160;
    rr(ctx, sx, sy, stageW, 62, 10, s.bg);
    // 箭头（非最后）
    if (i < 3) {
      txt(ctx, 16, 400, C.faint, 'center');
      ctx.fillText('›', sx + stageW + 2, sy + 36);
    }
    txt(ctx, 10, 500, s.color, 'center'); ctx.fillText(s.label, sx + stageW / 2, sy + 18);
    txt(ctx, 26, 700, s.color, 'center'); ctx.fillText(String(s.val), sx + stageW / 2, sy + 52);
  });

  // 分隔线
  ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x + 20, y + 236); ctx.lineTo(x + w - 20, y + 236); ctx.stroke();

  // 问题分类（横向比例条）
  txt(ctx, 12, 600, C.muted); ctx.fillText('问题分类', x + 20, y + 256);
  const problems = Object.entries(data.problemType || {}).sort((a, b) => b[1] - a[1]);
  const totalP   = problems.reduce((s, [, v]) => s + v, 0) || 1;
  const probColors = [C.risk, C.warn, C.good, C.purple];
  const barY  = y + 264;
  const barW  = w - 40;
  const barH  = 14;
  let offsetX = 0;
  problems.forEach(([label, val], i) => {
    const segW = Math.round(barW * val / totalP);
    rr(ctx, x + 20 + offsetX, barY, segW, barH, 0, probColors[i % probColors.length]);
    offsetX += segW;
  });
  // 圆角覆盖
  ctx.save(); ctx.globalCompositeOperation = 'destination-in';
  rr(ctx, x + 20, barY, barW, barH, 7); ctx.fill();
  ctx.restore();

  // 图例
  let legendX = x + 20;
  problems.slice(0, 4).forEach(([label, val], i) => {
    const pct = Math.round(val / totalP * 100);
    rr(ctx, legendX, barY + barH + 8, 8, 8, 2, probColors[i % probColors.length]);
    txt(ctx, 10.5, 500, C.muted); ctx.fillText(`${label} ${pct}%`, legendX + 12, barY + barH + 17);
    legendX += ctx.measureText(`${label} ${pct}%`).width + 22;
  });
}

async function generateBrandPng(sfData, dfData, outPath) {
  const W = 1200, H = 400;
  const canvas = createCanvas(W * 2, H * 2);
  const ctx = canvas.getContext('2d');
  ctx.scale(2, 2);
  ctx.fillStyle = C.panel; ctx.fillRect(0, 0, W, H);

  drawBrandCard(ctx, sfData, 32, 20, 556, 360, C.sf, C.sfSoft);
  drawBrandCard(ctx, dfData, 612, 20, 556, 360, C.df, C.dfSoft);

  fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
  return outPath;
}

// ── 飞书图片上传 ──────────────────────────────────────────────

function uploadImage(pngPath) {
  const rel = path.relative(process.cwd(), pngPath);
  const r = spawnSync(LARK, [
    'api', 'POST', '/open-apis/im/v1/images',
    '--file', `image=${rel}`,
    '--data', '{"image_type":"message"}',
    '--as', 'bot',
  ], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, cwd: process.cwd() });
  const raw = (r.stdout || '') + (r.stderr || '');
  const d = JSON.parse(raw.slice(raw.indexOf('{')));
  if (!d.data?.image_key) throw new Error('upload no key');
  return d.data.image_key;
}

// ── 卡片构建 ──────────────────────────────────────────────────

function buildCard(imgKey) {
  const today  = new Date().toISOString().slice(0, 10);
  const envTag = isProd ? '' : ' [TEST]';

  const sfPending  = sfBm.pending   ?? 0;
  const dfPending  = dfBm.pending   ?? 0;
  const sfCritical = sfBm.problemType?.['严重故障'] ?? 0;
  const dfCritical = dfBm.problemType?.['严重故障'] ?? 0;
  const sfGenerated = sfBm.generated ?? 0;
  const dfGenerated = dfBm.generated ?? 0;

  // 执行重点
  const criticalLine = (sfCritical + dfCritical) > 0
    ? `🔴 **严重故障帖 ${sfCritical + dfCritical} 条**（SF ${sfCritical} / DF ${dfCritical}）· 优先响应`
    : `✅ 无严重故障帖`;
  const pendingLine = (sfPending + dfPending) > 0
    ? `🟡 **待处理 ${sfPending + dfPending} 条**（SF ${sfPending} / DF ${dfPending}）· 需跟进回复`
    : `✅ 舆情待处理清零`;
  const genLine = (sfGenerated + dfGenerated) > 0
    ? `📝 **已生成待发布 ${sfGenerated + dfGenerated} 条**（SF ${sfGenerated} / DF ${dfGenerated}）· 可审核发布`
    : `⬜ 无待发布回复`;
  const qualLine = `📊 SF 回复质量 **${sfBm.avgQualityScore ?? '—'}/10** · DF 回复质量 **${dfBm.avgQualityScore ?? '—'}/10**`;

  const elements = [
    {
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**品牌舆情执行重点 · ${today}**\n${criticalLine}\n${pendingLine}\n${genLine}\n${qualLine}`,
      },
    },
    { tag: 'hr' },
  ];

  if (imgKey) {
    elements.push({
      tag: 'img', img_key: imgKey,
      alt: { tag: 'plain_text', content: '品牌舆情监控 KPI' },
      mode: 'fit_horizontal', preview: false,
    });
  } else {
    // 降级文字
    const sfText = [
      `🟠 **StreamFab** · 共 ${sfBm.total ?? '—'} 条`,
      `待处理 ${sfBm.pending ?? '—'} · 已生成 ${sfBm.generated ?? '—'} · 已处理 ${sfBm.processed ?? '—'}`,
    ].join('\n');
    const dfText = [
      `🔵 **DVDFab** · 共 ${dfBm.total ?? '—'} 条`,
      `待处理 ${dfBm.pending ?? '—'} · 已生成 ${dfBm.generated ?? '—'} · 已处理 ${dfBm.processed ?? '—'}`,
    ].join('\n');
    elements.push({
      tag: 'column_set', flex_mode: 'bisect', background_style: 'default',
      columns: [
        { tag: 'column', width: 'weighted', weight: 1, elements: [{ tag: 'div', text: { tag: 'lark_md', content: sfText } }] },
        { tag: 'column', width: 'weighted', weight: 1, elements: [{ tag: 'div', text: { tag: 'lark_md', content: dfText } }] },
      ],
    });
  }

  elements.push({ tag: 'hr' });
  elements.push({
    tag: 'action',
    actions: [{
      tag: 'button',
      text: { tag: 'plain_text', content: '查看品牌舆情看板 →' },
      type: 'primary', url: DASHBOARD_URL,
    }],
  });

  return JSON.stringify({
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `🔔 品牌舆情监控 · ${today}${envTag}` },
      template: isProd ? 'red' : 'blue',
    },
    elements,
  });
}

// ── 发送 ──────────────────────────────────────────────────────

function sendCard(target, content) {
  const flag = target.type === 'chat' ? '--chat-id' : '--user-id';
  const r = spawnSync(LARK, [
    'im', '+messages-send', flag, target.id,
    '--msg-type', 'interactive', '--content', content, '--as', 'bot',
  ], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  const raw = (r.stdout || '') + (r.stderr || '');
  const d = JSON.parse(raw.slice(raw.indexOf('{')));
  if (d.ok || d.code === 0) {
    console.log(`  ✅ [${target.name}] 发送成功 · ${d.data?.message_id || '—'}`);
    return true;
  }
  console.error(`  ❌ [${target.name}] ${d.error?.message || d.msg || '未知'}`);
  return false;
}

// ── 主流程 ────────────────────────────────────────────────────

(async () => {
  console.log(`\n${isProd ? '🚀 生产' : '🧪 测试'} 模式 · 品牌舆情监控`);
  console.log(`数据：SF 共 ${sfBm.total ?? '—'} 条 | DF 共 ${dfBm.total ?? '—'} 条`);

  const pngPath = path.join(__dirname, '_brand_summary.png');
  let imgKey = null;

  try {
    process.stdout.write('  ⏳ 生成 KPI 图...');
    await generateBrandPng(sfBm, dfBm, pngPath);
    console.log(' ✓');
    process.stdout.write('  ⏳ 上传图片...');
    imgKey = uploadImage(pngPath);
    console.log(` ✓ ${imgKey}`);
  } catch (e) {
    console.log(` ⚠️  图片跳过（${e.message}）`);
  } finally {
    try { if (fs.existsSync(pngPath)) fs.unlinkSync(pngPath); } catch (_) {}
  }

  const content = buildCard(imgKey);
  let ok = 0;
  for (const t of targets) { if (sendCard(t, content)) ok++; }
  console.log(`\n${ok}/${targets.length} 发送成功`);
  if (ok < targets.length) process.exitCode = 1;
})().catch(e => {
  console.error('\n❌', e.stack || e.message);
  process.exit(1);
});
