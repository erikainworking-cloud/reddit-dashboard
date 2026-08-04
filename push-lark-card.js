#!/usr/bin/env node
/**
 * push-lark-card.js
 * 读取 stats.json，构建 AIO-BO 北极星进展飞书卡片并推送
 *
 * 运行方式：
 *   node push-lark-card.js
 *
 * 环境变量（或直接修改下方 WEBHOOK_URL）：
 *   LARK_WEBHOOK=https://open.feishu.cn/open-apis/bot/v2/hook/xxx node push-lark-card.js
 */

const fs   = require('fs');
const path = require('path');
const https = require('https');
const url  = require('url');

// ── 配置 ──────────────────────────────────────────────────────
const WEBHOOK_URL = process.env.LARK_WEBHOOK || 'https://open.feishu.cn/open-apis/bot/v2/hook/FILL_IN_YOUR_WEBHOOK_HERE';
const STATS_FILE  = path.join(__dirname, 'stats.json');
const DASHBOARD_URL = 'https://erikainworking-cloud.github.io/reddit-dashboard/';

// ── 读取数据 ──────────────────────────────────────────────────
const stats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf-8'));
const ab = stats.aioBo || {};
const sf = ab.streamfab || {};
const df = ab.dvdfab    || {};
const milestones = stats.milestones || [];

// ── 工具函数 ──────────────────────────────────────────────────
function progressBar(current, target, len = 12) {
  const n = Math.round(Math.min(current / target, 1) * len);
  return '█'.repeat(n) + '░'.repeat(len - n);
}

function trendText(weeks, actual) {
  const pts = [];
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] !== null && actual[i] !== undefined) {
      pts.push({ w: (weeks[i] || '').replace('\n', ' '), v: actual[i] });
    }
  }
  const last4 = pts.slice(-4);
  return last4.map((p, idx) => {
    const prev = idx > 0 ? last4[idx - 1].v : null;
    const diff = prev !== null
      ? ` (${p.v >= prev ? '+' : ''}${(p.v - prev).toFixed(2)}%)`
      : '';
    const isLatest = idx === last4.length - 1;
    return `${p.w}: **${p.v}%**${diff}${isLatest ? ' 🆕' : ''}`;
  }).join('\n');
}

// ── 构建卡片 ──────────────────────────────────────────────────
const today = new Date().toISOString().slice(0, 10);

const sfPct  = sf.current || 0;
const dfPct  = df.current || 0;
const sfGap  = ((sf.q3Target || 25) - sfPct).toFixed(2);
const dfGap  = ((df.q3Target || 40.5) - dfPct).toFixed(2);
const sfBar  = progressBar(sfPct, sf.q3Target || 25);
const dfBar  = progressBar(dfPct, df.q3Target || 40.5);
const sfFill = (sfPct / (sf.q3Target || 25) * 100).toFixed(1);
const dfFill = (dfPct / (df.q3Target || 40.5) * 100).toFixed(1);

const latestMs = milestones.filter(m => today >= m.date).pop();
let msNote = '';
if (latestMs) {
  const sfA = latestMs.sf.actual;
  const dfA = latestMs.df.actual;
  const sfStatus = sfA !== null && sfA !== undefined
    ? (sfA >= latestMs.sf.target ? '✅ 达标' : `⚠️ 落后 ${(latestMs.sf.target - sfA).toFixed(2)}%`)
    : '⏳ 数据待更新';
  const dfStatus = dfA !== null && dfA !== undefined
    ? (dfA >= latestMs.df.target ? '✅ 达标' : `⚠️ 落后 ${(latestMs.df.target - dfA).toFixed(2)}%`)
    : '⏳ 数据待更新';
  msNote = `\n**${latestMs.date} 检查点**：SF ${sfStatus} · DVDFab ${dfStatus}`;
}

const card = {
  msg_type: 'interactive',
  card: {
    header: {
      title: { content: `🎯 AIO-BO 北极星进展 · ${today}`, tag: 'plain_text' },
      template: 'green',
    },
    elements: [
      {
        tag: 'div',
        text: {
          content: `**Reddit AIO-BO** — 关键词在 Google AIO 引用的 Reddit 帖子中的品牌占位率。${msNote}`,
          tag: 'lark_md',
        },
      },
      { tag: 'hr' },
      {
        tag: 'column_set',
        flex_mode: 'bisect',
        background_style: 'default',
        columns: [
          {
            tag: 'column', width: 'weighted', weight: 1,
            elements: [{
              tag: 'div',
              text: {
                content: `🟠 **StreamFab**\n当前 **${sfPct}%** (${sf.currentWords || 0}/${sf.aioTriggerWords || 0}词)\n目标 ${sf.q3Target || 25}% | 缺口 **${sfGap}%** | 还需 **${(sf.q3TargetWords || 44) - (sf.currentWords || 0)}** 词\n\`${sfBar}\` ${sfFill}%`,
                tag: 'lark_md',
              },
            }],
          },
          {
            tag: 'column', width: 'weighted', weight: 1,
            elements: [{
              tag: 'div',
              text: {
                content: `🔵 **DVDFab**\n当前 **${dfPct}%** (${df.currentWords || 0}/${df.aioTriggerWords || 0}词)\n目标 ${df.q3Target || 40.5}% | 缺口 **${dfGap}%** | 还需 **${(df.q3TargetWords || 82) - (df.currentWords || 0)}** 词\n\`${dfBar}\` ${dfFill}%`,
                tag: 'lark_md',
              },
            }],
          },
        ],
      },
      { tag: 'hr' },
      {
        tag: 'column_set',
        flex_mode: 'bisect',
        columns: [
          {
            tag: 'column', width: 'weighted', weight: 1,
            elements: [{
              tag: 'div',
              text: { content: `📈 **SF 近期趋势**\n${trendText(sf.weeks || [], sf.actual || [])}`, tag: 'lark_md' },
            }],
          },
          {
            tag: 'column', width: 'weighted', weight: 1,
            elements: [{
              tag: 'div',
              text: { content: `📈 **DF 近期趋势**\n${trendText(df.weeks || [], df.actual || [])}`, tag: 'lark_md' },
            }],
          },
        ],
      },
      { tag: 'hr' },
      {
        tag: 'action',
        actions: [{
          tag: 'button',
          text: { content: '查看完整看板 →', tag: 'plain_text' },
          type: 'primary',
          url: DASHBOARD_URL,
        }],
      },
    ],
  },
};

// ── 推送 ──────────────────────────────────────────────────────
if (!WEBHOOK_URL.includes('FILL_IN')) {
  const parsed = new url.URL(WEBHOOK_URL);
  const bodyStr = JSON.stringify(card);
  const req = https.request({
    hostname: parsed.hostname,
    path: parsed.pathname + parsed.search,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) },
  }, res => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        if (json.code === 0 || json.StatusCode === 0) {
          console.log('✅ 飞书卡片推送成功');
        } else {
          console.error('❌ 推送失败:', data);
          process.exit(1);
        }
      } catch(e) {
        console.error('❌ 响应解析失败:', data);
        process.exit(1);
      }
    });
  });
  req.on('error', e => { console.error('❌ 网络错误:', e.message); process.exit(1); });
  req.write(bodyStr);
  req.end();
} else {
  console.warn('⚠️  WEBHOOK_URL 未配置，跳过推送。请设置环境变量 LARK_WEBHOOK 或修改脚本中的 WEBHOOK_URL。');
  console.log('   预览卡片 JSON：');
  console.log(JSON.stringify(card, null, 2));
}
