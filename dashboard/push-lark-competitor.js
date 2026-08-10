#!/usr/bin/env node
/**
 * push-lark-competitor.js
 * 竞品提及周环比 Feishu 卡片
 *
 * 用法：
 *   node push-lark-competitor.js              # 测试模式
 *   node push-lark-competitor.js --prod       # 生产模式
 *   node push-lark-competitor.js --chat-id oc_xxx
 *   node push-lark-competitor.js --user-id ou_xxx
 */

'use strict';

const fs = require('fs');
const path = require('path');
const larkApi = require('./push-lark-api');

const STATS_FILE = path.join(__dirname, 'stats.json');
const DASHBOARD_URL = 'https://erikainworking-cloud.github.io/reddit-dashboard/';

const TARGETS = {
  test: [{ type: 'chat', id: 'oc_25770fbdf3c7f0736f128e10fb0a83ed', name: 'erika消息推送接收群' }],
  prod: [],
};

const args = process.argv.slice(2);
const isProd = args.includes('--prod');
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
const targets = customTargets.length
  ? customTargets
  : isProd && TARGETS.prod.length
    ? TARGETS.prod
    : TARGETS.test;

if (!fs.existsSync(STATS_FILE)) throw new Error('stats.json 不存在');
const stats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
const monitor = stats.competitorMonitoring;
if (!monitor) throw new Error('stats.json 不含 competitorMonitoring；请先运行 export-stats.js');

function signed(value) {
  return `${value > 0 ? '+' : ''}${value}`;
}

function changeDescription(brand) {
  const change = brand.change || 0;
  if (change > 0) {
    const rate = brand.changePct == null ? '（上周为 0，新增）' : `（+${brand.changePct}%）`;
    return `🔴 **${brand.label}** +${change} 条 ${rate}`;
  }
  if (change < 0) {
    const rate = brand.changePct == null ? '' : `（${brand.changePct}%）`;
    return `🟢 **${brand.label}** ${change} 条 ${rate}`;
  }
  return `⚪ **${brand.label}** 持平（${brand.currentWeek || 0} 条）`;
}

function buildCard() {
  const envTag = isProd ? '' : ' [TEST]';
  const currentRange = `${monitor.currentWeek?.start || '—'} 至 ${monitor.currentWeek?.end || '—'}`;
  const previousRange = `${monitor.previousWeek?.start || '—'} 至 ${monitor.previousWeek?.end || '—'}`;
  const metric = monitor.metrics?.rawRecords ?? monitor.currentTotal ?? 0;
  const previousMetric = monitor.previousMetrics?.rawRecords ?? monitor.previousTotal ?? 0;
  const totalChange = metric - previousMetric;
  const totalPct = previousMetric ? `${totalChange > 0 ? '+' : ''}${(totalChange / previousMetric * 100).toFixed(1)}%` : '—';
  const brands = [...(monitor.brands || [])].map(brand => ({
    ...brand,
    currentWeek: brand.current?.rawRecords ?? brand.currentWeek ?? 0,
    previousWeek: brand.previous?.rawRecords ?? brand.previousWeek ?? 0,
    change: brand.change?.rawRecords ?? brand.change ?? 0,
    changePct: brand.changePct?.rawRecords ?? brand.changePct ?? null,
  })).sort((a, b) => Math.abs(b.change || 0) - Math.abs(a.change || 0));
  const increased = brands.filter(brand => (brand.change || 0) > 0);
  const decreased = brands.filter(brand => (brand.change || 0) < 0);
  const keyMovements = brands.slice(0, 5).map(changeDescription).join('\n') || '暂无竞品监控数据';
  const completeness = monitor.dataStatus?.periodComplete === false ? `\n⚠ 数据截至 ${monitor.dataStatus.dataThrough || '—'}，当前周期不完整，环比仅供参考。` : '';
  const attention = monitor.metrics?.attentionItems ?? 0;

  return JSON.stringify({
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `竞品提及周报 · ${currentRange}${envTag}` },
      template: totalChange > 0 ? 'red' : totalChange < 0 ? 'green' : 'blue',
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**本周竞品记录 ${metric} 条** · 上周 ${previousMetric} 条 · 环比 **${signed(totalChange)}**（${totalPct}）\n独立竞品帖子 ${monitor.metrics?.uniqueUrls ?? '—'} 个 · 需关注机会 ${attention} 个\n本周：${currentRange}\n上周：${previousRange}${completeness}`,
        },
      },
      { tag: 'hr' },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**重点变化**\n${keyMovements}`,
        },
      },
      {
        tag: 'note',
        elements: [{
          tag: 'plain_text',
          content: `增长 ${increased.length} 个 · 下降 ${decreased.length} 个 · 数据源：竞品监控日报表`,
        }],
      },
      { tag: 'hr' },
      {
        tag: 'action',
        actions: [
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '查看竞品监控看板 →' },
            type: 'primary',
            url: DASHBOARD_URL,
          },
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '打开竞品多维表格 ↗' },
            type: 'default',
            url: monitor.sourceUrl,
          },
        ],
      },
    ],
  });
}

(async () => {
  console.log(`\n${isProd ? '🚀 生产' : '🧪 测试'} 模式 · 竞品提及周报`);
  console.log(`数据：${monitor.currentWeek?.start || '—'} 至 ${monitor.currentWeek?.end || '—'}，竞品记录 ${monitor.metrics?.rawRecords ?? monitor.currentTotal ?? 0} 条`);

  const content = buildCard();
  let ok = 0;
  for (const target of targets) {
    if (await larkApi.sendCard(target, content)) ok++;
  }
  console.log(`\n${ok}/${targets.length} 发送成功`);
  if (ok < targets.length) process.exitCode = 1;
})().catch(error => {
  console.error('\n❌', error.stack || error.message);
  process.exit(1);
});
