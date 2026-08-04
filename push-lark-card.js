#!/usr/bin/env node
/**
 * push-lark-card.js
 * 生成 AIO-BO 折线图（QuickChart）→ 上传飞书 → 嵌入交互卡片推送
 *
 * 用法：
 *   node push-lark-card.js                         # 测试模式 → erika消息推送接收群
 *   node push-lark-card.js --prod                  # 生产模式
 *   node push-lark-card.js --chat-id oc_xxx        # 指定群
 *   node push-lark-card.js --user-id ou_xxx        # 指定用户 DM
 *   node push-lark-card.js --no-chart              # 跳过图表（纯文字快速推送）
 */

const { spawnSync } = require('child_process');
const fs    = require('fs');
const path  = require('path');
const https = require('https');

// ── 配置 ──────────────────────────────────────────────────────

const LARK         = '/Users/erikaleen/.npm-global/lib/node_modules/@larksuite/cli/bin/lark-cli';
const STATS_FILE   = path.join(__dirname, 'stats.json');
const DASHBOARD_URL = 'https://erikainworking-cloud.github.io/reddit-dashboard/';

const TARGETS = {
  test: [
    { type: 'chat', id: 'oc_25770fbdf3c7f0736f128e10fb0a83ed', name: 'erika消息推送接收群' },
  ],
  prod: [
    // 上线后在此添加正式群组
    // { type: 'chat', id: 'oc_xxx', name: '运营团队周报群' },
  ],
};

// ── 命令行参数 ────────────────────────────────────────────────

const args      = process.argv.slice(2);
const isProd    = args.includes('--prod');
const noChart   = args.includes('--no-chart');
const customTargets = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--chat-id' && args[i+1]) {
    customTargets.push({ type: 'chat', id: args[i+1], name: args[i+1] }); i++;
  }
  if (args[i] === '--user-id' && args[i+1]) {
    customTargets.push({ type: 'user', id: args[i+1], name: args[i+1] }); i++;
  }
}

let targets;
if (customTargets.length > 0)        targets = customTargets;
else if (isProd && TARGETS.prod.length) targets = TARGETS.prod;
else                                   targets = TARGETS.test;

// ── 读取数据 ──────────────────────────────────────────────────

const stats     = JSON.parse(fs.readFileSync(STATS_FILE, 'utf-8'));
const ab        = stats.aioBo || {};
const sf        = ab.streamfab || {};
const df        = ab.dvdfab    || {};
const milestones = stats.milestones || [];

// ── 工具函数 ──────────────────────────────────────────────────

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
    const prev = idx > 0 ? last4[idx-1].v : null;
    const diff = prev !== null ? ` (${p.v >= prev ? '+':''}${(p.v - prev).toFixed(2)}%)` : '';
    return `${p.w}: **${p.v}%**${diff}${idx === last4.length-1 ? ' 🆕' : ''}`;
  }).join('\n');
}

// ── QuickChart 折线图生成 ─────────────────────────────────────

/**
 * 用 QuickChart.io 生成折线图 PNG
 * weeks: string[]  actual: (number|null)[]  target: number[]
 */
async function generateChartPng(title, weeks, actual, target, accentColor, targetColor, minY, maxY, outPath) {
  const labels = weeks.map(w => w.replace('\n', ' '));

  // pointRadius 数组：有数据的点显示 6px，null 点隐藏
  const actualRadius = actual.map(v => (v !== null && v !== undefined) ? 6 : 0);

  const chartCfg = {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: '实际 AIO-BO',
          data: actual,
          borderColor: accentColor,
          backgroundColor: accentColor,
          fill: false,
          tension: 0,
          pointRadius: actualRadius,
          pointBackgroundColor: accentColor,
          pointBorderColor: '#ffffff',
          pointBorderWidth: 2,
          borderWidth: 2.5,
          spanGaps: false,
        },
        {
          label: '目标路径',
          data: target,
          borderColor: targetColor,
          backgroundColor: 'transparent',
          fill: false,
          tension: 0,
          pointRadius: 3,
          pointBackgroundColor: targetColor,
          borderDash: [6, 3],
          borderWidth: 1.5,
        },
      ],
    },
    options: {
      plugins: {
        title: {
          display: true,
          text: title,
          font: { size: 13, weight: 'bold' },
          color: '#1a2332',
          padding: { bottom: 8 },
        },
        legend: {
          position: 'bottom',
          labels: {
            usePointStyle: true,
            padding: 14,
            font: { size: 11 },
            color: '#475569',
          },
        },
        datalabels: {
          display: 'auto',
          align: 'top',
          anchor: 'end',
          color: accentColor,
          font: { size: 10, weight: 'bold' },
          // Only label the actual line (dataset index 0)
          formatter: 'function(v, ctx) { if (ctx.datasetIndex !== 0) return null; return v !== null ? v + "%" : null; }',
        },
      },
      scales: {
        y: {
          min: minY,
          max: maxY,
          ticks: {
            callback: 'function(v) { return v + "%"; }',
            font: { size: 10 },
            color: '#94a3b8',
          },
          grid: { color: '#f1f5f9' },
          border: { color: '#e2e8f0' },
        },
        x: {
          ticks: { font: { size: 9 }, color: '#94a3b8', maxRotation: 30 },
          grid: { display: false },
          border: { color: '#e2e8f0' },
        },
      },
    },
  };

  const body = JSON.stringify({
    chart: chartCfg,
    width: 600,
    height: 280,
    backgroundColor: 'white',
    devicePixelRatio: 2,
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'quickchart.io',
      path: '/chart',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode !== 200) {
          reject(new Error(`QuickChart HTTP ${res.statusCode}: ${buf.toString().slice(0, 200)}`));
          return;
        }
        fs.writeFileSync(outPath, buf);
        resolve(outPath);
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── QuickChart 进度摘要图 ──────────────────────────────────────

async function generateProgressPng(sf, df, outPath) {
  const sfPct    = sf.current    || 0;
  const dfPct    = df.current    || 0;
  const sfTarget = sf.q3Target   || 25;
  const dfTarget = df.q3Target   || 40.5;
  const sfGap    = Math.max(0, sfTarget - sfPct);
  const dfGap    = Math.max(0, dfTarget - dfPct);
  const sfWords  = sf.currentWords    || 0;
  const sfTotal  = sf.aioTriggerWords || 177;
  const dfWords  = df.currentWords    || 0;
  const dfTotal  = df.aioTriggerWords || 203;
  const sfNeeded = Math.max(0, (sf.q3TargetWords  || 44) - sfWords);
  const dfNeeded = Math.max(0, (df.q3TargetWords  || 82) - dfWords);
  const sfFill   = (sfPct / sfTarget * 100).toFixed(1);
  const dfFill   = (dfPct / dfTarget * 100).toFixed(1);
  const maxX     = Math.ceil(Math.max(sfTarget, dfTarget) + 6);

  const chartCfg = {
    type: 'bar',
    data: {
      labels: [
        `StreamFab — ${sfFill}% 达成`,
        `DVDFab — ${dfFill}% 达成`,
      ],
      datasets: [
        {
          label: '当前 AIO-BO',
          data: [sfPct, dfPct],
          backgroundColor: ['#ff4500', '#2563eb'],
          borderRadius: 6,
          borderSkipped: false,
        },
        {
          label: '距 Q3 目标',
          data: [sfGap, dfGap],
          backgroundColor: ['rgba(255,69,0,0.18)', 'rgba(37,99,235,0.18)'],
          borderRadius: 6,
          borderSkipped: false,
        },
      ],
    },
    options: {
      indexAxis: 'y',
      plugins: {
        title: {
          display: true,
          text: 'Q3 目标进度一览',
          font: { size: 13, weight: 'bold' },
          color: '#1a2332',
          padding: { bottom: 10 },
        },
        legend: {
          position: 'bottom',
          labels: { usePointStyle: true, padding: 16, font: { size: 11 }, color: '#475569' },
        },
        datalabels: {
          display: true,
          align: 'center',
          anchor: 'center',
          font: { size: 10.5, weight: 'bold' },
          color: `function(ctx) { return ctx.datasetIndex === 0 ? '#ffffff' : '#64748b'; }`,
          formatter: `function(v, ctx) {
            if (v < 0.3) return null;
            var a = ['${sfPct}% (${sfWords}/${sfTotal}词)', '${dfPct}% (${dfWords}/${dfTotal}词)'];
            var g = ['还需 ${sfNeeded} 词', '还需 ${dfNeeded} 词'];
            return ctx.datasetIndex === 0 ? a[ctx.dataIndex] : g[ctx.dataIndex];
          }`,
        },
      },
      scales: {
        x: {
          stacked: true,
          max: maxX,
          ticks: {
            callback: 'function(v) { return v + "%"; }',
            font: { size: 10 },
            color: '#94a3b8',
          },
          grid: { color: '#f1f5f9' },
          border: { color: '#e2e8f0' },
        },
        y: {
          stacked: true,
          ticks: { font: { size: 11 }, color: '#334155' },
          grid: { display: false },
          border: { color: '#e2e8f0' },
        },
      },
    },
  };

  const body = JSON.stringify({
    chart: chartCfg,
    width: 600,
    height: 200,
    backgroundColor: 'white',
    devicePixelRatio: 2,
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'quickchart.io',
      path: '/chart',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode !== 200) {
          reject(new Error(`QuickChart HTTP ${res.statusCode}: ${buf.toString().slice(0, 200)}`));
          return;
        }
        fs.writeFileSync(outPath, buf);
        resolve(outPath);
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── 飞书图片上传 ──────────────────────────────────────────────

function uploadImageToFeishu(pngPath) {
  const relPath = path.relative(process.cwd(), pngPath);
  const result = spawnSync(LARK, [
    'api', 'POST', '/open-apis/im/v1/images',
    '--file', `image=${relPath}`,
    '--data', '{"image_type":"message"}',
    '--as', 'bot',
  ], { encoding: 'utf-8', maxBuffer: 2 * 1024 * 1024, cwd: process.cwd() });

  const raw = result.stdout + result.stderr;
  const start = raw.indexOf('{');
  if (start === -1) throw new Error('upload: no JSON: ' + raw.slice(0, 200));
  const d = JSON.parse(raw.slice(start));
  if (d.code !== 0 && !d.ok) throw new Error('upload failed: ' + JSON.stringify(d.error || d));
  const key = d.data?.image_key;
  if (!key) throw new Error('upload: no image_key in response: ' + JSON.stringify(d));
  return key;
}

// ── 构建卡片 ──────────────────────────────────────────────────

function buildCard(progressImgKey, sfImgKey, dfImgKey) {
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

  // Stats summary section (two columns)
  const sfStats = `🟠 **StreamFab**\n当前 **${sfPct}%** (${sf.currentWords||0}/${sf.aioTriggerWords||0}词)\n目标 ${sfTarget}% | 缺口 **${sfGap}%** | 还需 **${(sf.q3TargetWords||44)-(sf.currentWords||0)}** 词\n\`${sfBar}\` ${sfFill}% 进度`;
  const dfStats = `🔵 **DVDFab**\n当前 **${dfPct}%** (${df.currentWords||0}/${df.aioTriggerWords||0}词)\n目标 ${dfTarget}% | 缺口 **${dfGap}%** | 还需 **${(df.q3TargetWords||82)-(df.currentWords||0)}** 词\n\`${dfBar}\` ${dfFill}% 进度`;

  const elements = [
    // 概述
    {
      tag: 'div',
      text: {
        content: `**Reddit AIO-BO** — 关键词在 Google AIO 引用的 Reddit 帖子中的品牌占位率。${msNote}`,
        tag: 'lark_md',
      },
    },
    { tag: 'hr' },
  ];

  // 进度摘要：有图用图，没图退回文字双列
  if (progressImgKey) {
    elements.push({
      tag: 'img',
      img_key: progressImgKey,
      alt: { tag: 'plain_text', content: 'AIO-BO Q3 目标进度' },
      mode: 'fit_horizontal',
      preview: false,
    });
  } else {
    elements.push({
      tag: 'column_set',
      flex_mode: 'bisect',
      background_style: 'default',
      columns: [
        { tag: 'column', width: 'weighted', weight: 1, elements: [{ tag: 'div', text: { content: sfStats, tag: 'lark_md' } }] },
        { tag: 'column', width: 'weighted', weight: 1, elements: [{ tag: 'div', text: { content: dfStats, tag: 'lark_md' } }] },
      ],
    });
  }
  elements.push({ tag: 'hr' });

  // SF 折线图
  elements.push({
    tag: 'div',
    text: { content: '**StreamFab AIO-BO 周进展** — 实际值 vs 目标路径', tag: 'lark_md' },
  });
  if (sfImgKey) {
    elements.push({
      tag: 'img',
      img_key: sfImgKey,
      alt: { tag: 'plain_text', content: 'StreamFab AIO-BO 趋势图' },
      mode: 'fit_horizontal',
      preview: false,
    });
  } else {
    elements.push({ tag: 'div', text: { content: trendText(sf.weeks||[], sf.actual||[]), tag: 'lark_md' } });
  }

  // DF 折线图
  elements.push({ tag: 'hr' });
  elements.push({
    tag: 'div',
    text: { content: '**DVDFab AIO-BO 周进展** — 实际值 vs 目标路径（Q3 全程）', tag: 'lark_md' },
  });
  if (dfImgKey) {
    elements.push({
      tag: 'img',
      img_key: dfImgKey,
      alt: { tag: 'plain_text', content: 'DVDFab AIO-BO 趋势图' },
      mode: 'fit_horizontal',
      preview: false,
    });
  } else {
    elements.push({ tag: 'div', text: { content: trendText(df.weeks||[], df.actual||[]), tag: 'lark_md' } });
  }

  elements.push({ tag: 'hr' });
  elements.push({
    tag: 'action',
    actions: [{
      tag: 'button',
      text: { content: '查看完整看板（含交互图表）→', tag: 'plain_text' },
      type: 'primary',
      url: DASHBOARD_URL,
    }],
  });

  return JSON.stringify({
    config: { wide_screen_mode: true },
    header: {
      title: { content: `🎯 AIO-BO 北极星进展 · ${today}${envTag}`, tag: 'plain_text' },
      template: isProd ? 'green' : 'blue',
    },
    elements,
  });
}

// ── 发送卡片 ──────────────────────────────────────────────────

function sendCard(target, cardContent) {
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
  if (start === -1) { console.error(`  ❌ [${target.name}] 无 JSON 输出`); return false; }
  const d = JSON.parse(raw.slice(start));
  if (d.ok) { console.log(`  ✅ [${target.name}] 发送成功 · ${d.data?.message_id}`); return true; }
  console.error(`  ❌ [${target.name}] code=${d.error?.code} ${d.error?.message}`);
  return false;
}

// ── 主流程 ────────────────────────────────────────────────────

(async () => {
  const mode = isProd ? '🚀 生产' : '🧪 测试';
  console.log(`\n${mode} 模式 · AIO-BO 飞书卡片推送`);
  console.log(`数据：SF ${sf.dataAsOf||'—'} ${sf.current}% | DF ${df.dataAsOf||'—'} ${df.current}%`);
  console.log(`目标：${targets.map(t => t.name).join(', ')}\n`);

  const progressChartPath = path.join(__dirname, '_chart_progress.png');
  const sfChartPath = path.join(__dirname, '_chart_sf.png');
  const dfChartPath = path.join(__dirname, '_chart_df.png');

  let progressImgKey = null, sfImgKey = null, dfImgKey = null;

  if (!noChart) {
    // 生成进度摘要横向条形图
    process.stdout.write('  ⏳ 生成进度摘要图...');
    try {
      await generateProgressPng(sf, df, progressChartPath);
      console.log(' ✓');
      process.stdout.write('  ⏳ 上传进度图到飞书...');
      progressImgKey = uploadImageToFeishu(progressChartPath);
      console.log(' ✓', progressImgKey);
    } catch(e) {
      console.log(` ⚠️ 跳过（${e.message}）`);
    }

    // 计算 Y 轴范围（加一点 padding）
    const sfActualVals = (sf.actual||[]).filter(v => v !== null);
    const dfActualVals = (df.actual||[]).filter(v => v !== null);
    const sfMin = Math.floor(Math.min(...sfActualVals, ...(sf.target||[])) - 1);
    const sfMax = Math.ceil(Math.max(...sfActualVals, ...(sf.target||[])) + 1);
    const dfMin = Math.floor(Math.min(...dfActualVals, ...(df.target||[])) - 1);
    const dfMax = Math.ceil(Math.max(...dfActualVals, ...(df.target||[])) + 1);

    // 生成 SF 折线图
    process.stdout.write('  ⏳ 生成 StreamFab 折线图...');
    try {
      await generateChartPng(
        'StreamFab AIO-BO 周进展',
        sf.weeks || [],
        sf.actual || [],
        sf.target || [],
        '#ff4500', '#fca07a',
        sfMin, sfMax,
        sfChartPath
      );
      console.log(' ✓');

      process.stdout.write('  ⏳ 上传 SF 图片到飞书...');
      sfImgKey = uploadImageToFeishu(sfChartPath);
      console.log(' ✓', sfImgKey);
    } catch(e) {
      console.log(` ⚠️ 跳过（${e.message}）`);
    }

    // 生成 DF 折线图
    process.stdout.write('  ⏳ 生成 DVDFab 折线图...');
    try {
      await generateChartPng(
        'DVDFab AIO-BO 周进展（Q3 全程）',
        df.weeks || [],
        df.actual || [],
        df.target || [],
        '#2563eb', '#93c5fd',
        dfMin, dfMax,
        dfChartPath
      );
      console.log(' ✓');

      process.stdout.write('  ⏳ 上传 DF 图片到飞书...');
      dfImgKey = uploadImageToFeishu(dfChartPath);
      console.log(' ✓', dfImgKey);
    } catch(e) {
      console.log(` ⚠️ 跳过（${e.message}）`);
    }
  } else {
    console.log('  ℹ️  --no-chart 模式，跳过图表生成');
  }

  // 构建并发送卡片
  console.log('\n  ⏳ 发送卡片...');
  const cardContent = buildCard(progressImgKey, sfImgKey, dfImgKey);

  let ok = 0;
  for (const t of targets) {
    if (sendCard(t, cardContent)) ok++;
  }

  // 清理临时文件
  [progressChartPath, sfChartPath, dfChartPath].forEach(p => {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });

  console.log(`\n${ok}/${targets.length} 发送成功`);
  if (ok < targets.length) process.exit(1);
})();
