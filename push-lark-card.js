#!/usr/bin/env node
/**
 * push-lark-card.js
 * 使用飞书 CLI（lark-cli）推送 AIO-BO 北极星进展卡片
 *
 * 用法：
 *   node push-lark-card.js                         # 发到默认目标（测试群）
 *   node push-lark-card.js --prod                  # 发到生产目标
 *   node push-lark-card.js --chat-id oc_xxx        # 发到指定群
 *   node push-lark-card.js --user-id ou_xxx        # 发到指定用户（DM）
 *   node push-lark-card.js --chat-id oc_A --chat-id oc_B  # 多个群
 *
 * 依赖：lark-cli 已安装并已登录（lark-cli auth status）
 */

const { spawnSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

// ── 配置 ──────────────────────────────────────────────────────

const LARK = '/Users/erikaleen/.npm-global/lib/node_modules/@larksuite/cli/bin/lark-cli';
const STATS_FILE  = path.join(__dirname, 'stats.json');
const DASHBOARD_URL = 'https://erikainworking-cloud.github.io/reddit-dashboard/';

/**
 * 推送目标配置
 * test  - 测试环境默认目标（由 erika消息推送接收群 接收）
 * prod  - 生产环境默认目标（上线后自定义，支持多个群/用户）
 *
 * 格式：{ type: 'chat'|'user', id: 'oc_xxx'|'ou_xxx', name: '备注名' }
 */
const TARGETS = {
  test: [
    { type: 'chat', id: 'oc_25770fbdf3c7f0736f128e10fb0a83ed', name: 'erika消息推送接收群' },
  ],
  prod: [
    // 上线后在此添加正式推送群组，例如：
    // { type: 'chat', id: 'oc_xxx', name: '运营周报群' },
    // { type: 'user', id: 'ou_xxx', name: '邓艾林（个人）' },
  ],
};

// ── 解析命令行参数 ────────────────────────────────────────────

const args = process.argv.slice(2);
const isProd = args.includes('--prod');
const isTest = args.includes('--test') || !isProd;

// 动态目标（--chat-id 和 --user-id 参数）
const customTargets = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--chat-id' && args[i+1]) {
    customTargets.push({ type: 'chat', id: args[i+1], name: args[i+1] }); i++;
  }
  if (args[i] === '--user-id' && args[i+1]) {
    customTargets.push({ type: 'user', id: args[i+1], name: args[i+1] }); i++;
  }
}

// 决定最终推送目标
let targets;
if (customTargets.length > 0) {
  targets = customTargets;
} else if (isProd && TARGETS.prod.length > 0) {
  targets = TARGETS.prod;
} else {
  targets = TARGETS.test;
}

// ── 读取数据 ──────────────────────────────────────────────────

const stats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf-8'));
const ab = stats.aioBo || {};
const sf = ab.streamfab || {};
const df = ab.dvdfab    || {};
const milestones = stats.milestones || [];

// ── 构建卡片内容 ──────────────────────────────────────────────

function progressBar(current, target, len = 12) {
  const n = Math.round(Math.min(current / target, 1) * len);
  return '█'.repeat(n) + '░'.repeat(len - n);
}

function trendText(weeks, actual) {
  const pts = [];
  for (let i = 0; i < (actual || []).length; i++) {
    if (actual[i] !== null && actual[i] !== undefined) {
      pts.push({ w: (weeks[i] || '').replace('\n', ' '), v: actual[i] });
    }
  }
  const last4 = pts.slice(-4);
  if (!last4.length) return '暂无数据';
  return last4.map((p, idx) => {
    const prev = idx > 0 ? last4[idx - 1].v : null;
    const diff = prev !== null
      ? ` (${p.v >= prev ? '+' : ''}${(p.v - prev).toFixed(2)}%)`
      : '';
    return `${p.w}: **${p.v}%**${diff}${idx === last4.length - 1 ? ' 🆕' : ''}`;
  }).join('\n');
}

const today    = new Date().toISOString().slice(0, 10);
const sfPct    = sf.current || 0;
const dfPct    = df.current || 0;
const sfTarget = sf.q3Target || 25;
const dfTarget = df.q3Target || 40.5;
const sfGap    = (sfTarget - sfPct).toFixed(2);
const dfGap    = (dfTarget - dfPct).toFixed(2);
const sfBar    = progressBar(sfPct, sfTarget);
const dfBar    = progressBar(dfPct, dfTarget);
const sfFill   = (sfPct / sfTarget * 100).toFixed(1);
const dfFill   = (dfPct / dfTarget * 100).toFixed(1);

// 最近通过的里程碑状态
const latestMs = milestones.filter(m => today >= m.date).pop();
let msNote = '';
if (latestMs) {
  const sfA = latestMs.sf.actual;
  const dfA = latestMs.df.actual;
  const sfStatus = sfA != null
    ? (sfA >= latestMs.sf.target ? '✅ 达标' : `⚠️ 落后 ${(latestMs.sf.target - sfA).toFixed(2)}%`)
    : '⏳ 数据待更新';
  const dfStatus = dfA != null
    ? (dfA >= latestMs.df.target ? '✅ 达标' : `⚠️ 落后 ${(latestMs.df.target - dfA).toFixed(2)}%`)
    : '⏳ 数据待更新';
  msNote = `\n**${latestMs.date} 检查点**：SF ${sfStatus} · DVDFab ${dfStatus}`;
}

const envTag = isProd ? '' : ' [TEST]';
const cardContent = JSON.stringify({
  config: { wide_screen_mode: true },
  header: {
    title: { content: `🎯 AIO-BO 北极星进展 · ${today}${envTag}`, tag: 'plain_text' },
    template: isProd ? 'green' : 'blue',
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
              content: `🟠 **StreamFab**\n当前 **${sfPct}%** (${sf.currentWords || 0}/${sf.aioTriggerWords || 0}词)\n目标 ${sfTarget}% | 缺口 **${sfGap}%** | 还需 **${(sf.q3TargetWords || 44) - (sf.currentWords || 0)}** 词\n\`${sfBar}\` ${sfFill}%`,
              tag: 'lark_md',
            },
          }],
        },
        {
          tag: 'column', width: 'weighted', weight: 1,
          elements: [{
            tag: 'div',
            text: {
              content: `🔵 **DVDFab**\n当前 **${dfPct}%** (${df.currentWords || 0}/${df.aioTriggerWords || 0}词)\n目标 ${dfTarget}% | 缺口 **${dfGap}%** | 还需 **${(df.q3TargetWords || 82) - (df.currentWords || 0)}** 词\n\`${dfBar}\` ${dfFill}%`,
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
            text: { content: `📈 **SF 近期趋势**\n${trendText(sf.weeks, sf.actual)}`, tag: 'lark_md' },
          }],
        },
        {
          tag: 'column', width: 'weighted', weight: 1,
          elements: [{
            tag: 'div',
            text: { content: `📈 **DF 近期趋势**\n${trendText(df.weeks, df.actual)}`, tag: 'lark_md' },
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
});

// ── 发送函数 ──────────────────────────────────────────────────

function sendCard(target) {
  const flag = target.type === 'chat' ? '--chat-id' : '--user-id';
  const result = spawnSync(LARK, [
    'im', '+messages-send',
    flag, target.id,
    '--msg-type', 'interactive',
    '--content', cardContent,
    '--as', 'bot',
  ], { encoding: 'utf-8', maxBuffer: 2 * 1024 * 1024 });

  const raw = result.stdout + result.stderr;
  const start = raw.indexOf('{');
  if (start === -1) {
    console.error(`  ❌ [${target.name}] 无 JSON 输出:`, raw.slice(0, 200));
    return false;
  }
  try {
    const d = JSON.parse(raw.slice(start));
    if (d.ok) {
      console.log(`  ✅ [${target.name}] 发送成功 · message_id: ${d.data?.message_id}`);
      return true;
    } else {
      console.error(`  ❌ [${target.name}] 发送失败: code=${d.error?.code} ${d.error?.message}`);
      return false;
    }
  } catch(e) {
    console.error(`  ❌ [${target.name}] JSON 解析失败:`, raw.slice(0, 200));
    return false;
  }
}

// ── 主流程 ────────────────────────────────────────────────────

const mode = isProd ? '🚀 生产' : '🧪 测试';
console.log(`\n${mode} 模式 · 推送 AIO-BO 飞书卡片`);
console.log(`数据截至：SF ${sf.dataAsOf || '—'} | DF ${df.dataAsOf || '—'}`);
console.log(`目标：${targets.map(t => t.name).join(', ')}\n`);

let ok = 0;
for (const t of targets) {
  if (sendCard(t)) ok++;
}
console.log(`\n推送完成：${ok}/${targets.length} 成功`);
if (ok < targets.length) process.exit(1);
