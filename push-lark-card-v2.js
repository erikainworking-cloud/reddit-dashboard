#!/usr/bin/env node
/**
 * push-lark-card-v2.js
 * AIO-BO 飞书卡片 2.0：所有图表均由 @napi-rs/canvas 本地绘制。
 *
 * 改进：
 * - 第一屏先给本周结论
 * - 目标差距统一使用百分点 pp
 * - KPI 摘要图同时显示当前值、WoW、路径差距、Q3 完成度、词覆盖
 * - 趋势图仅标注最新实际值和当前目标值
 * - 实际点不足 3 个时，自动改为数据采集状态卡
 * - 不依赖 QuickChart.io
 *
 * 用法：
 *   node push-lark-card-v2.js
 *   node push-lark-card-v2.js --prod
 *   node push-lark-card-v2.js --chat-id oc_xxx
 *   node push-lark-card-v2.js --user-id ou_xxx
 *   node push-lark-card-v2.js --no-chart
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { createCanvas, GlobalFonts } = require(path.join(__dirname, 'node_modules/@napi-rs/canvas'));
const larkApi = require('./push-lark-api');

// ── 配置 ──────────────────────────────────────────────────────
const STATS_FILE = path.join(__dirname, 'stats.json');
const DASHBOARD_URL = 'https://erikainworking-cloud.github.io/reddit-dashboard/';

const TARGETS = {
  test: [
    { type: 'chat', id: 'oc_25770fbdf3c7f0736f128e10fb0a83ed', name: 'erika消息推送接收群' },
  ],
  prod: [
    // { type: 'chat', id: 'oc_xxx', name: '运营团队周报群' },
  ],
};

const COLORS = {
  ink: '#172033',
  muted: '#6B778C',
  faint: '#98A2B3',
  border: '#E5EAF0',
  grid: '#EEF2F6',
  panel: '#F8FAFC',
  white: '#FFFFFF',
  sf: '#FF5A1F',
  sfSoft: '#FFE9E1',
  df: '#2F6BEE',
  dfSoft: '#E8F0FF',
  good: '#16A36A',
  goodSoft: '#E7F7F0',
  warn: '#D97706',
  warnSoft: '#FFF3D6',
  risk: '#D64545',
  riskSoft: '#FDEBEC',
  pending: '#667085',
  pendingSoft: '#F2F4F7',
};

// ── 命令行参数 ────────────────────────────────────────────────

const args = process.argv.slice(2);
const isProd = args.includes('--prod');
const noChart = args.includes('--no-chart');
const customTargets = [];

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--chat-id' && args[i + 1]) {
    customTargets.push({ type: 'chat', id: args[i + 1], name: args[i + 1] });
    i++;
  }
  if (args[i] === '--user-id' && args[i + 1]) {
    customTargets.push({ type: 'user', id: args[i + 1], name: args[i + 1] });
    i++;
  }
}

let targets;
if (customTargets.length) targets = customTargets;
else if (isProd && TARGETS.prod.length) targets = TARGETS.prod;
else targets = TARGETS.test;

// ── 数据读取 ──────────────────────────────────────────────────

if (!fs.existsSync(STATS_FILE)) {
  throw new Error(`stats.json 不存在：${STATS_FILE}`);
}

const stats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
const ab = stats.aioBo || {};
const sf = ab.streamfab || {};
const df = ab.dvdfab || {};
const milestones = Array.isArray(stats.milestones) ? stats.milestones : [];

// ── 字体 ──────────────────────────────────────────────────────

function registerFonts() {
  const candidates = [
    ['/System/Library/Fonts/PingFang.ttc', 'PingFang SC'],
    ['/System/Library/Fonts/Hiragino Sans GB.ttc', 'Hiragino Sans GB'],
    ['/System/Library/Fonts/Supplemental/Arial Unicode.ttf', 'Arial Unicode MS'],
  ];
  for (const [file, family] of candidates) {
    try {
      if (fs.existsSync(file)) GlobalFonts.registerFromPath(file, family);
    } catch (_) {
      // 字体注册失败时继续使用系统 sans-serif。
    }
  }
}
registerFonts();
const FONT = 'PingFang SC, Hiragino Sans GB, Arial Unicode MS, sans-serif';

// ── 数据工具 ──────────────────────────────────────────────────

const isNum = value => typeof value === 'number' && Number.isFinite(value);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function fmtPct(value, digits = 2) {
  return isNum(value) ? `${value.toFixed(digits)}%` : '—';
}

function fmtPp(value, digits = 2, withPlus = true) {
  if (!isNum(value)) return '—';
  const sign = value > 0 && withPlus ? '+' : '';
  return `${sign}${value.toFixed(digits)}pp`;
}

function getActualPoints(item) {
  const weeks = Array.isArray(item.weeks) ? item.weeks : [];
  const actual = Array.isArray(item.actual) ? item.actual : [];
  const target = Array.isArray(item.target) ? item.target : [];
  return actual
    .map((value, index) => ({
      index,
      value,
      target: target[index],
      label: String(weeks[index] || '').replace(/\n/g, ' '),
    }))
    .filter(point => isNum(point.value));
}

function getMetrics(item) {
  const points = getActualPoints(item);
  const latest = points.at(-1) || null;
  const previous = points.at(-2) || null;
  const current = isNum(latest?.value) ? latest.value : (isNum(item.current) ? item.current : null);
  const currentTarget = isNum(latest?.target) ? latest.target : null;
  const wow = latest && previous ? latest.value - previous.value : null;
  const gap = isNum(current) && isNum(currentTarget) ? current - currentTarget : null;
  const q3Target = isNum(item.q3Target) ? item.q3Target : null;
  const completion = isNum(current) && isNum(q3Target) && q3Target !== 0 ? current / q3Target * 100 : null;
  const currentWords = isNum(item.currentWords) ? item.currentWords : 0;
  const totalWords = isNum(item.aioTriggerWords) ? item.aioTriggerWords : 0;

  return {
    points,
    latest,
    current,
    currentTarget,
    wow,
    gap,
    q3Target,
    completion,
    currentWords,
    totalWords,
    dataAsOf: item.dataAsOf || null,
  };
}

function getStatus(metrics) {
  if (!isNum(metrics.currentTarget) || !isNum(metrics.gap)) {
    return { icon: '⏳', label: '数据待更新', tone: 'pending' };
  }
  if (metrics.gap >= 0) return { icon: '✅', label: `领先 ${fmtPp(metrics.gap)}`, tone: 'good' };
  if (metrics.gap >= -0.5) return { icon: '🟡', label: `轻微落后 ${fmtPp(Math.abs(metrics.gap), 2, false)}`, tone: 'warn' };
  return { icon: '⚠️', label: `落后 ${fmtPp(Math.abs(metrics.gap), 2, false)}`, tone: 'risk' };
}

function getLatestMilestone(today) {
  return milestones.filter(item => item?.date && item.date <= today).at(-1) || null;
}

function milestoneStatus(milestoneItem) {
  if (!milestoneItem || !isNum(milestoneItem.actual) || !isNum(milestoneItem.target)) {
    return { icon: '⏳', text: '数据待更新' };
  }
  const gap = milestoneItem.actual - milestoneItem.target;
  return gap >= 0
    ? { icon: '✅', text: `领先 ${fmtPp(gap)}` }
    : { icon: '⚠️', text: `落后 ${fmtPp(Math.abs(gap), 2, false)}` };
}

// ── Canvas 绘图工具 ───────────────────────────────────────────

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function fillRoundedRect(ctx, x, y, width, height, radius, color) {
  roundedRect(ctx, x, y, width, height, radius);
  ctx.fillStyle = color;
  ctx.fill();
}

function strokeRoundedRect(ctx, x, y, width, height, radius, color, lineWidth = 1) {
  roundedRect(ctx, x, y, width, height, radius);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

function setText(ctx, size, weight = 400, color = COLORS.ink, align = 'left') {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
}

function drawPill(ctx, text, x, y, tone = 'pending') {
  const themes = {
    good: [COLORS.goodSoft, COLORS.good],
    warn: [COLORS.warnSoft, COLORS.warn],
    risk: [COLORS.riskSoft, COLORS.risk],
    pending: [COLORS.pendingSoft, COLORS.pending],
  };
  const [bg, fg] = themes[tone] || themes.pending;
  setText(ctx, 20, 600, fg);
  const width = ctx.measureText(text).width + 28;
  fillRoundedRect(ctx, x, y, width, 38, 19, bg);
  ctx.fillText(text, x + 14, y + 26);
  return width;
}

function drawProgress(ctx, x, y, width, ratio, color) {
  fillRoundedRect(ctx, x, y, width, 12, 6, COLORS.grid);
  const fillWidth = clamp(width * ratio, 0, width);
  if (fillWidth > 0) fillRoundedRect(ctx, x, y, Math.max(fillWidth, 12), 12, 6, color);
}

function createHiDPICanvas(width, height, ratio = 2) {
  const canvas = createCanvas(width * ratio, height * ratio);
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);
  ctx.imageSmoothingEnabled = true;
  return { canvas, ctx };
}

function saveCanvas(canvas, outPath) {
  fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
  return outPath;
}

// ── KPI 摘要图 ────────────────────────────────────────────────

function drawKpiCard(ctx, item, x, y, width, height, brandName, accent, accentSoft) {
  const metrics = getMetrics(item);
  const status = getStatus(metrics);

  ctx.save();
  ctx.shadowColor = 'rgba(16, 24, 40, 0.08)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 6;
  fillRoundedRect(ctx, x, y, width, height, 18, COLORS.white);
  ctx.restore();
  strokeRoundedRect(ctx, x, y, width, height, 18, COLORS.border);

  fillRoundedRect(ctx, x + 22, y + 22, 10, 28, 5, accent);
  setText(ctx, 22, 700, COLORS.ink);
  ctx.fillText(brandName, x + 44, y + 44);

  const pillText = `${status.icon} ${status.label}`;
  setText(ctx, 20, 600, COLORS.pending);
  const pillWidth = ctx.measureText(pillText).width + 28;
  drawPill(ctx, pillText, x + width - pillWidth - 22, y + 18, status.tone);

  setText(ctx, 46, 700, COLORS.ink);
  ctx.fillText(fmtPct(metrics.current), x + 22, y + 108);

  setText(ctx, 18, 500, COLORS.muted);
  ctx.fillText('当前 AIO-BO', x + 22, y + 136);

  const colX = [x + 22, x + 188, x + 354];
  const labels = ['WoW', '路径差距', 'Q3 目标'];
  const values = [
    fmtPp(metrics.wow),
    fmtPp(metrics.gap),
    fmtPct(metrics.q3Target),
  ];
  labels.forEach((label, index) => {
    setText(ctx, 16, 500, COLORS.faint);
    ctx.fillText(label, colX[index], y + 177);
    const valueColor = index === 1 && isNum(metrics.gap)
      ? (metrics.gap >= 0 ? COLORS.good : COLORS.risk)
      : COLORS.ink;
    setText(ctx, 22, 700, valueColor);
    ctx.fillText(values[index], colX[index], y + 207);
  });

  const ratio = isNum(metrics.completion) ? clamp(metrics.completion / 100, 0, 1) : 0;
  setText(ctx, 17, 600, COLORS.muted);
  ctx.fillText('Q3 最终目标完成度', x + 22, y + 252);
  setText(ctx, 18, 700, accent, 'right');
  ctx.fillText(isNum(metrics.completion) ? `${metrics.completion.toFixed(1)}%` : '—', x + width - 22, y + 252);
  drawProgress(ctx, x + 22, y + 266, width - 44, ratio, accent);

  fillRoundedRect(ctx, x + 22, y + 298, width - 44, 52, 12, accentSoft);
  setText(ctx, 17, 600, COLORS.muted);
  ctx.fillText('AIO 触发词覆盖', x + 38, y + 331);
  setText(ctx, 20, 700, accent, 'right');
  ctx.fillText(`${metrics.currentWords} / ${metrics.totalWords || '—'}`, x + width - 38, y + 331);
}

async function generateSummaryPng(sfItem, dfItem, outPath) {
  const W = 1200;
  const H = 430;
  const { canvas, ctx } = createHiDPICanvas(W, H);
  ctx.fillStyle = COLORS.panel;
  ctx.fillRect(0, 0, W, H);

  drawKpiCard(ctx, sfItem, 32, 32, 552, 366, 'StreamFab', COLORS.sf, COLORS.sfSoft);
  drawKpiCard(ctx, dfItem, 616, 32, 552, 366, 'DVDFab', COLORS.df, COLORS.dfSoft);
  return saveCanvas(canvas, outPath);
}

// ── 趋势图 ────────────────────────────────────────────────────

function niceRange(values, targetValues) {
  const nums = [...values, ...targetValues].filter(isNum);
  if (!nums.length) return { min: 0, max: 1 };
  const rawMin = Math.min(...nums);
  const rawMax = Math.max(...nums);
  const spread = Math.max(rawMax - rawMin, 1);
  const pad = Math.max(spread * 0.22, 1);
  return {
    min: Math.floor((rawMin - pad) * 2) / 2,
    max: Math.ceil((rawMax + pad) * 2) / 2,
  };
}

function linePath(ctx, points) {
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
}

function drawTrendChart(ctx, item, x, y, width, height, accent, accentSoft) {
  const weeks = Array.isArray(item.weeks) ? item.weeks.map(v => String(v).replace(/\n/g, ' ')) : [];
  const actual = Array.isArray(item.actual) ? item.actual : [];
  const target = Array.isArray(item.target) ? item.target : [];
  const metrics = getMetrics(item);

  const plot = { x: x + 72, y: y + 36, width: width - 102, height: height - 98 };
  const range = niceRange(actual, target);
  const count = Math.max(weeks.length, actual.length, target.length, 2);
  const px = index => plot.x + index / (count - 1) * plot.width;
  const py = value => plot.y + (range.max - value) / (range.max - range.min) * plot.height;

  for (let i = 0; i <= 4; i++) {
    const value = range.max - (range.max - range.min) * i / 4;
    const gy = plot.y + plot.height * i / 4;
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(plot.x, gy);
    ctx.lineTo(plot.x + plot.width, gy);
    ctx.stroke();
    setText(ctx, 15, 500, COLORS.faint, 'right');
    ctx.fillText(`${value.toFixed(1)}%`, plot.x - 14, gy + 5);
  }

  const targetPoints = target
    .map((value, index) => isNum(value) ? { x: px(index), y: py(value), value, index } : null)
    .filter(Boolean);
  if (targetPoints.length > 1) {
    ctx.save();
    ctx.setLineDash([10, 8]);
    ctx.strokeStyle = accentSoft;
    ctx.lineWidth = 3;
    linePath(ctx, targetPoints);
    ctx.stroke();
    ctx.restore();
  }

  const actualSegments = [];
  let current = [];
  actual.forEach((value, index) => {
    if (isNum(value)) current.push({ x: px(index), y: py(value), value, index });
    else if (current.length) {
      actualSegments.push(current);
      current = [];
    }
  });
  if (current.length) actualSegments.push(current);

  actualSegments.forEach(segment => {
    if (segment.length > 1) {
      ctx.strokeStyle = accent;
      ctx.lineWidth = 4;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      linePath(ctx, segment);
      ctx.stroke();
    }
    segment.forEach(point => {
      ctx.fillStyle = COLORS.white;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
      ctx.fill();
    });
  });

  const last = metrics.latest;
  if (last) {
    const lx = px(last.index);
    const ly = py(last.value);
    const actualLabel = `实际 ${last.value.toFixed(2)}%`;
    setText(ctx, 17, 700, COLORS.white);
    const actualWidth = ctx.measureText(actualLabel).width + 24;
    const ax = clamp(lx - actualWidth / 2, plot.x, plot.x + plot.width - actualWidth);
    fillRoundedRect(ctx, ax, ly - 48, actualWidth, 32, 16, accent);
    ctx.fillText(actualLabel, ax + 12, ly - 26);

    if (isNum(last.target)) {
      const ty = py(last.target);
      ctx.fillStyle = accentSoft;
      ctx.beginPath();
      ctx.arc(lx, ty, 6, 0, Math.PI * 2);
      ctx.fill();
      const targetLabel = `目标 ${last.target.toFixed(2)}%`;
      setText(ctx, 16, 700, accent);
      const targetWidth = ctx.measureText(targetLabel).width + 20;
      const tx = clamp(lx - targetWidth / 2, plot.x, plot.x + plot.width - targetWidth);
      fillRoundedRect(ctx, tx, ty + 12, targetWidth, 30, 15, accentSoft);
      ctx.fillText(targetLabel, tx + 10, ty + 33);
    }
  }

  const labelStep = Math.max(1, Math.ceil(count / 6));
  weeks.forEach((label, index) => {
    if (index % labelStep !== 0 && index !== weeks.length - 1) return;
    setText(ctx, 14, 500, COLORS.faint, 'center');
    ctx.fillText(label, px(index), plot.y + plot.height + 32);
  });
}

function drawCollectingCard(ctx, item, x, y, width, height, accent, accentSoft) {
  const metrics = getMetrics(item);
  fillRoundedRect(ctx, x, y, width, height, 18, COLORS.white);
  strokeRoundedRect(ctx, x, y, width, height, 18, COLORS.border);

  fillRoundedRect(ctx, x + 28, y + 32, 52, 52, 16, accentSoft);
  setText(ctx, 28, 700, accent, 'center');
  ctx.fillText('···', x + 54, y + 69);

  setText(ctx, 25, 700, COLORS.ink);
  ctx.fillText('数据持续采集中', x + 98, y + 59);
  setText(ctx, 17, 500, COLORS.muted);
  ctx.fillText('累计至少 3 个实际数据点后自动切换为趋势图', x + 98, y + 86);

  const cells = [
    ['当前', fmtPct(metrics.current)],
    ['Q3 目标', fmtPct(metrics.q3Target)],
    ['实际数据点', `${metrics.points.length} 个`],
  ];
  cells.forEach((cell, index) => {
    const cellX = x + 28 + index * ((width - 56) / 3);
    if (index > 0) {
      ctx.strokeStyle = COLORS.border;
      ctx.beginPath();
      ctx.moveTo(cellX, y + 126);
      ctx.lineTo(cellX, y + height - 28);
      ctx.stroke();
    }
    setText(ctx, 16, 500, COLORS.faint);
    ctx.fillText(cell[0], cellX + 20, y + 160);
    setText(ctx, 30, 700, index === 0 ? accent : COLORS.ink);
    ctx.fillText(cell[1], cellX + 20, y + 203);
  });
}

async function generateTrendPng(item, brandName, accent, accentSoft, outPath) {
  const W = 1200;
  const H = 500;
  const { canvas, ctx } = createHiDPICanvas(W, H);
  ctx.fillStyle = COLORS.panel;
  ctx.fillRect(0, 0, W, H);

  setText(ctx, 25, 700, COLORS.ink);
  ctx.fillText(`${brandName} 最近趋势`, 32, 46);
  setText(ctx, 17, 500, COLORS.muted);
  ctx.fillText('实线为实际值，虚线为目标路径；仅标注最新检查点', 32, 74);

  if (getMetrics(item).points.length < 3) {
    drawCollectingCard(ctx, item, 32, 100, 1136, 360, accent, accentSoft);
  } else {
    fillRoundedRect(ctx, 32, 100, 1136, 360, 18, COLORS.white);
    strokeRoundedRect(ctx, 32, 100, 1136, 360, 18, COLORS.border);
    drawTrendChart(ctx, item, 48, 112, 1104, 332, accent, accentSoft);
  }
  return saveCanvas(canvas, outPath);
}

// ── 飞书图片上传 ──────────────────────────────────────────────

async function uploadImageToFeishu(pngPath) {
  return larkApi.uploadImage(pngPath);
}

// ── 卡片构建 ──────────────────────────────────────────────────

function fallbackSummary(item, brandName, emoji) {
  const metrics = getMetrics(item);
  const status = getStatus(metrics);
  return [
    `${emoji} **${brandName}**  ${status.icon} ${status.label}`,
    `当前：**${fmtPct(metrics.current)}**`,
    `WoW：**${fmtPp(metrics.wow)}**`,
    `Q3 目标：**${fmtPct(metrics.q3Target)}**`,
    `完成度：**${isNum(metrics.completion) ? `${metrics.completion.toFixed(1)}%` : '—'}**`,
  ].join('\n');
}

function buildCard(summaryImgKey, sfImgKey, dfImgKey) {
  const today = new Date().toISOString().slice(0, 10);
  const sfMetrics = getMetrics(sf);
  const dfMetrics = getMetrics(df);
  const sfStatus = getStatus(sfMetrics);
  const dfStatus = getStatus(dfMetrics);
  const milestone = getLatestMilestone(today);
  const sfMilestone = milestoneStatus(milestone?.sf);
  const dfMilestone = milestoneStatus(milestone?.df);

  const checkDate = milestone?.date || sf.dataAsOf || df.dataAsOf || today;
  const conclusion = [
    `**${sfStatus.icon} StreamFab：${sfStatus.label}**`,
    `**${dfStatus.icon} DVDFab：${dfStatus.label}**`,
  ].join('　　');

  const elements = [
    {
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**本周结论 · ${checkDate}**\n${conclusion}\n\n<font color='grey'>AIO-BO：品牌在 Google AIO 引用的 Reddit 帖子中的占位率</font>`,
      },
    },
    { tag: 'hr' },
  ];

  if (summaryImgKey) {
    elements.push({
      tag: 'img',
      img_key: summaryImgKey,
      alt: { tag: 'plain_text', content: 'AIO-BO KPI 摘要' },
      mode: 'fit_horizontal',
      preview: false,
    });
  } else {
    elements.push({
      tag: 'column_set',
      flex_mode: 'bisect',
      background_style: 'default',
      columns: [
        { tag: 'column', width: 'weighted', weight: 1, elements: [{ tag: 'div', text: { tag: 'lark_md', content: fallbackSummary(sf, 'StreamFab', '🟠') } }] },
        { tag: 'column', width: 'weighted', weight: 1, elements: [{ tag: 'div', text: { tag: 'lark_md', content: fallbackSummary(df, 'DVDFab', '🔵') } }] },
      ],
    });
  }

  elements.push({ tag: 'hr' });
  elements.push({ tag: 'div', text: { tag: 'lark_md', content: `**StreamFab 趋势**　${sfStatus.icon} ${sfStatus.label}` } });
  if (sfImgKey) {
    elements.push({ tag: 'img', img_key: sfImgKey, alt: { tag: 'plain_text', content: 'StreamFab AIO-BO 趋势' }, mode: 'fit_horizontal', preview: false });
  }

  elements.push({ tag: 'hr' });
  elements.push({ tag: 'div', text: { tag: 'lark_md', content: `**DVDFab 趋势**　${dfStatus.icon} ${dfStatus.label}` } });
  if (dfImgKey) {
    elements.push({ tag: 'img', img_key: dfImgKey, alt: { tag: 'plain_text', content: 'DVDFab AIO-BO 趋势' }, mode: 'fit_horizontal', preview: false });
  }

  if (milestone) {
    elements.push({
      tag: 'note',
      elements: [{
        tag: 'plain_text',
        content: `${milestone.date} 检查点：SF ${sfMilestone.icon} ${sfMilestone.text} · DVDFab ${dfMilestone.icon} ${dfMilestone.text}`,
      }],
    });
  }

  elements.push({ tag: 'hr' });
  elements.push({
    tag: 'action',
    actions: [{
      tag: 'button',
      text: { tag: 'plain_text', content: '查看关键词与 Reddit 帖子明细 →' },
      type: 'primary',
      url: DASHBOARD_URL,
    }],
  });

  return JSON.stringify({
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `🎯 AIO-BO 北极星进展 · ${today}${isProd ? '' : ' [TEST]'}` },
      template: isProd ? 'green' : 'blue',
    },
    elements,
  });
}

// ── 发送 ──────────────────────────────────────────────────────

async function sendCard(target, cardContent) {
  return larkApi.sendCard(target, cardContent);
}

// ── 主流程 ────────────────────────────────────────────────────

(async () => {
  const mode = isProd ? '🚀 生产' : '🧪 测试';
  console.log(`\n${mode} 模式 · AIO-BO 飞书卡片 2.0`);
  console.log(`数据：SF ${sf.dataAsOf || '—'} ${sf.current ?? '—'}% | DF ${df.dataAsOf || '—'} ${df.current ?? '—'}%`);
  console.log(`目标：${targets.map(target => target.name).join(', ')}\n`);

  const summaryPath = path.join(__dirname, '_aio_bo_summary_v2.png');
  const sfPath = path.join(__dirname, '_aio_bo_sf_v2.png');
  const dfPath = path.join(__dirname, '_aio_bo_df_v2.png');
  let summaryImgKey = null;
  let sfImgKey = null;
  let dfImgKey = null;

  try {
    if (!noChart) {
      process.stdout.write('  ⏳ 生成 KPI 摘要图...');
      await generateSummaryPng(sf, df, summaryPath);
      console.log(' ✓');
      process.stdout.write('  ⏳ 上传 KPI 摘要图...');
      summaryImgKey = await uploadImageToFeishu(summaryPath);
      console.log(` ✓ ${summaryImgKey}`);

      process.stdout.write('  ⏳ 生成 StreamFab 趋势图...');
      await generateTrendPng(sf, 'StreamFab', COLORS.sf, '#FFB39A', sfPath);
      console.log(' ✓');
      process.stdout.write('  ⏳ 上传 StreamFab 趋势图...');
      sfImgKey = await uploadImageToFeishu(sfPath);
      console.log(` ✓ ${sfImgKey}`);

      process.stdout.write('  ⏳ 生成 DVDFab 趋势图...');
      await generateTrendPng(df, 'DVDFab', COLORS.df, '#AFC8FF', dfPath);
      console.log(' ✓');
      process.stdout.write('  ⏳ 上传 DVDFab 趋势图...');
      dfImgKey = await uploadImageToFeishu(dfPath);
      console.log(` ✓ ${dfImgKey}`);
    } else {
      console.log('  ℹ️ --no-chart 模式：跳过图片生成和上传');
    }

    console.log('\n  ⏳ 发送卡片...');
    const content = buildCard(summaryImgKey, sfImgKey, dfImgKey);
    let success = 0;
    for (const target of targets) {
      if (await sendCard(target, content)) success++;
    }
    console.log(`\n${success}/${targets.length} 发送成功`);
    if (success < targets.length) process.exitCode = 1;
  } finally {
    [summaryPath, sfPath, dfPath].forEach(file => {
      try {
        if (fs.existsSync(file)) fs.unlinkSync(file);
      } catch (_) {}
    });
  }
})().catch(error => {
  console.error('\n❌ 执行失败：', error.stack || error.message || error);
  process.exit(1);
});
