#!/usr/bin/env node
/**
 * export-aiobo.js
 * AIO-BO 半自动化计算脚本（StreamFab + DVDFab）
 *
 * 运行方式：
 *   node export-aiobo.js              # 预览计算结果，不写入
 *   node export-aiobo.js --update     # 预览 + 写入 stats.json aioBo 字段
 *
 * 依赖：lark-cli 已登录（lark-cli auth login）
 *
 * 说明：
 *   StreamFab：查询 SERP 排名明细表，按（来源类别, 是否提及StreamFab, 关键词）
 *              聚合，JS 侧过滤 来源类别=来源引用 & 是否提及StreamFab=是，
 *              统计满足全链路的唯一关键词数量。
 *              注：细分来源排除（官方域名）由 JS 侧过滤，需确保 SF_EXCLUDE_SOURCES 准确。
 *   DVDFab：读取预聚合表 DVDFab Reddit 占位率统计，过滤 来源=AIO，
 *           取 DVDFab覆盖关键词数 最新值。
 */

const { spawnSync, execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');
const readline = require('readline');

// ── 配置 ──────────────────────────────────────────────────────

const CONFIG = {
  streamfab: {
    label:          'StreamFab',
    baseToken:      'EeTUbRHV3anTKTsvl2dcjaAenBf',
    // SERP 排名明细表 table_id（若未知，运行 node export-aiobo.js --list-tables-sf 自动发现）
    serpTableId:    process.env.SF_SERP_TABLE_ID || '',
    aioTriggerWords: 177,
    q3Target:       25.0,
    q3TargetWords:  44,
    // 需要从全链路中排除的细分来源
    excludeSources: ['dvdfab.cn', 'streamfab.com', 'streamfab.dvdfab.cn', 'AIO正文'],
    // 飞书字段名
    fields: {
      sourceType:    '来源类别',
      subSource:     '细分来源',
      mentionBrand:  '是否提及StreamFab',
      keyword:       '关键词',
    },
    // 全链路筛选值
    filterValues: {
      sourceType:   '来源引用',
      mentionBrand: '是',
    },
  },
  dvdfab: {
    label:          'DVDFab',
    baseToken:      'NnG1bHoZsaYdCzs5Slfch1bQnJb',
    // 预聚合统计表（直接读取）
    statsTableId:   'tblPIJosQPBHD9bj',
    aioTriggerWords: 203,
    q3Target:       40.5,
    q3TargetWords:  82,
    fields: {
      source:       '来源',
      kwCount:      'DVDFab覆盖关键词数',
    },
    filterValues: {
      source:       'AIO',
    },
  },
};

// ── 工具 ──────────────────────────────────────────────────────

function resolveLark() {
  if (process.env.LARK_CLI) return process.env.LARK_CLI;
  try {
    const p = execSync('which lark-cli', { encoding: 'utf-8', stdio: ['pipe','pipe','pipe'] }).trim();
    if (p) return p;
  } catch {}
  const candidates = [
    path.join(process.env.HOME || '', '.npm-global/lib/node_modules/@larksuite/cli/bin/lark-cli'),
    '/usr/local/lib/node_modules/@larksuite/cli/bin/lark-cli',
    '/usr/local/bin/lark-cli',
  ];
  for (const c of candidates) { if (fs.existsSync(c)) return c; }
  throw new Error('找不到 lark-cli，请安装或设置 LARK_CLI 环境变量');
}
const LARK = resolveLark();

function dataQuery(baseToken, dsl) {
  const result = spawnSync(LARK, [
    'base', '+data-query',
    '--base-token', baseToken,
    '--dsl', JSON.stringify(dsl),
    '--as', 'user',
  ], { encoding: 'utf-8', maxBuffer: 20 * 1024 * 1024 });

  const raw = result.stdout + result.stderr;
  const start = raw.indexOf('{');
  if (start === -1) throw new Error('lark-cli 无 JSON 输出:\n' + raw.slice(0, 500));
  const d = JSON.parse(raw.slice(start));
  if (!d.ok) throw new Error('data-query 失败: ' + JSON.stringify(d.error));
  return d.data?.main_data || [];
}

function listTables(baseToken) {
  const result = spawnSync(LARK, [
    'base', '+list-tables',
    '--base-token', baseToken,
    '--as', 'user',
  ], { encoding: 'utf-8', maxBuffer: 5 * 1024 * 1024 });
  const raw = result.stdout + result.stderr;
  const start = raw.indexOf('{');
  if (start === -1) throw new Error('list-tables 无 JSON 输出:\n' + raw.slice(0, 500));
  const d = JSON.parse(raw.slice(start));
  return d.data?.items || d.data || [];
}

// ── StreamFab AIO-BO 计算 ─────────────────────────────────────

async function calcStreamfabAiobo() {
  const cfg = CONFIG.streamfab;

  // 自动发现 SERP 排名明细表 table_id
  let serpTableId = cfg.serpTableId;
  if (!serpTableId) {
    console.log('  📋 自动发现 SERP 排名明细表...');
    try {
      const tables = listTables(cfg.baseToken);
      const target = tables.find(t => t.name?.includes('SERP 排名明细') || t.name?.includes('SERP排名明细'));
      if (target) {
        serpTableId = target.table_id || target.tableId;
        console.log(`  ✅ 找到表格：${target.name} (${serpTableId})`);
      } else {
        console.log('  ⚠️  未找到 SERP 排名明细表，可用表格：');
        tables.forEach(t => console.log(`     ${t.name} → ${t.table_id || t.tableId}`));
        console.log('  请设置环境变量 SF_SERP_TABLE_ID=<table_id> 后重试');
        return null;
      }
    } catch (e) {
      console.log(`  ⚠️  自动发现失败（${e.message}），请手动设置 SF_SERP_TABLE_ID`);
      return null;
    }
  }

  console.log(`  📊 查询 StreamFab SERP 排名明细表（${serpTableId}）...`);

  // GROUP BY 来源类别 × 细分来源 × 是否提及StreamFab × 关键词，JS 侧过滤
  const rows = dataQuery(cfg.baseToken, {
    datasource: { type: 'table', table: { tableId: serpTableId } },
    dimensions: [
      { field_name: cfg.fields.sourceType,   alias: 'sourceType' },
      { field_name: cfg.fields.subSource,    alias: 'subSource' },
      { field_name: cfg.fields.mentionBrand, alias: 'mention' },
      { field_name: cfg.fields.keyword,      alias: 'keyword' },
    ],
    measures: [{ field_name: cfg.fields.keyword, aggregation: 'count', alias: 'count' }],
    sort:     [{ field_name: 'count', order: 'desc' }],
    pagination: { limit: 5000 },
    shaper: { format: 'flat' },
  });

  // 收集满足全链路的关键词（去重），排除官方来源
  const qualifiedKws = new Set();
  for (const r of rows) {
    const sourceType = r.sourceType?.value;
    const mention    = r.mention?.value;
    const keyword    = r.keyword?.value;
    if (!keyword) continue;
    const subSource = String(r.subSource?.value || '').toLowerCase();
    const excluded  = cfg.excludeSources.some(s => subSource.includes(s.toLowerCase()));
    if (sourceType === cfg.filterValues.sourceType && mention === cfg.filterValues.mentionBrand && !excluded) {
      qualifiedKws.add(keyword);
    }
  }

  // 从上一次结果对比新增关键词
  const statsPath = path.join(__dirname, 'stats.json');
  let prevKws = new Set();
  if (fs.existsSync(statsPath)) {
    const prevStats = JSON.parse(fs.readFileSync(statsPath, 'utf-8'));
    // 尝试从 aioBo.streamfab.kwList 读取（如果存在）
    const kwList = prevStats.aioBo?.streamfab?.kwList;
    if (Array.isArray(kwList)) prevKws = new Set(kwList);
  }

  const newKws  = [...qualifiedKws].filter(k => !prevKws.has(k));
  const lostKws = [...prevKws].filter(k => !qualifiedKws.has(k));
  const kwCount = qualifiedKws.size;
  const aioBoPercent = (kwCount / cfg.aioTriggerWords * 100).toFixed(2);

  return {
    brand:          'StreamFab',
    kwCount,
    aioBoPercent:   Number(aioBoPercent),
    aioTriggerWords: cfg.aioTriggerWords,
    q3Target:       cfg.q3Target,
    q3TargetWords:  cfg.q3TargetWords,
    gap:            cfg.q3TargetWords - kwCount,
    newKws,
    lostKws,
    kwList:         [...qualifiedKws].sort(),
  };
}

// ── DVDFab AIO-BO 计算 ────────────────────────────────────────

async function calcDvdfabAiobo() {
  const cfg = CONFIG.dvdfab;

  console.log(`  📊 查询 DVDFab 占位率统计表（${cfg.statsTableId}）...`);

  // 读取预聚合表，取来源=AIO 的最新行
  const rows = dataQuery(cfg.baseToken, {
    datasource: { type: 'table', table: { tableId: cfg.statsTableId } },
    dimensions: [{ field_name: cfg.fields.source, alias: 'source' }],
    measures: [
      { field_name: cfg.fields.kwCount, aggregation: 'max', alias: 'kwCount' },
    ],
    sort: [{ field_name: 'kwCount', order: 'desc' }],
    pagination: { limit: 50 },
    shaper: { format: 'flat' },
  });

  // 找到 来源 包含 AIO 的行，取 kwCount
  const aioRow = rows.find(r => {
    const src = r.source?.value;
    if (!src) return false;
    if (Array.isArray(src)) return src.includes(cfg.filterValues.source);
    return String(src).includes(cfg.filterValues.source);
  });

  if (!aioRow) {
    console.log('  ⚠️  未找到 来源=AIO 的行，请确认表结构');
    return null;
  }

  const kwCount      = Number(aioRow.kwCount?.value) || 0;
  const aioBoPercent = (kwCount / cfg.aioTriggerWords * 100).toFixed(2);

  // DVDFab 预聚合表只有汇总数字，无逐词列表，故 newKws/lostKws 留空
  return {
    brand:           'DVDFab',
    kwCount,
    aioBoPercent:    Number(aioBoPercent),
    aioTriggerWords: cfg.aioTriggerWords,
    q3Target:        cfg.q3Target,
    q3TargetWords:   cfg.q3TargetWords,
    gap:             cfg.q3TargetWords - kwCount,
    newKws:          [],
    lostKws:         [],
  };
}

// ── 格式化输出 ────────────────────────────────────────────────

function printResult(r) {
  if (!r) return;
  const bar = (pct, target) => {
    const fill = Math.round(pct / target * 20);
    return '[' + '█'.repeat(Math.min(fill, 20)) + '░'.repeat(Math.max(0, 20 - fill)) + ']';
  };
  console.log(`\n  品牌：${r.brand}`);
  console.log(`  固定分母：${r.aioTriggerWords}`);
  console.log(`  全链路关键词：${r.kwCount}`);
  console.log(`  当前 AIO-BO：${r.aioBoPercent}%  ${bar(r.aioBoPercent, r.q3Target)} Q3目标 ${r.q3Target}%`);
  console.log(`  距 Q3 目标差距：${r.gap > 0 ? '+'+r.gap : r.gap} 个关键词`);
  if (r.newKws?.length)  console.log(`  本次新增 (${r.newKws.length})：${r.newKws.join('、')}`);
  if (r.lostKws?.length) console.log(`  本次流失 (${r.lostKws.length})：${r.lostKws.join('、')}`);
  console.log(`  净增长：${(r.newKws?.length||0) - (r.lostKws?.length||0) >= 0 ? '+' : ''}${(r.newKws?.length||0) - (r.lostKws?.length||0)}`);
}

// ── 写入 stats.json ───────────────────────────────────────────

function updateStatsJson(sfResult, dfResult) {
  const statsPath = path.join(__dirname, 'stats.json');
  if (!fs.existsSync(statsPath)) {
    console.error('❌ stats.json 不存在，请先运行 node export-stats.js');
    process.exit(1);
  }
  const stats = JSON.parse(fs.readFileSync(statsPath, 'utf-8'));
  const today = new Date().toISOString().slice(0, 10);

  // 辅助：向 snapshots 数组追加或更新当日快照
  function upsertSnapshot(brand, result, weekLabel) {
    stats.aioBo = stats.aioBo || {};
    stats.aioBo[brand] = stats.aioBo[brand] || {};
    const entry = stats.aioBo[brand];
    entry.current      = result.aioBoPercent;
    entry.currentWords = result.kwCount;
    entry.dataAsOf     = today;
    if (result.kwList)   entry.kwList      = result.kwList;
    if (result.newKws)   entry.weeklyAdded = result.newKws;
    if (result.lostKws)  entry.weeklyLost  = result.lostKws;

    const snapshots = entry.snapshots || [];
    const existIdx  = snapshots.findIndex(s => s.date === today);
    const snap = {
      date:  today,
      week:  weekLabel || `W${snapshots.length + 1}`,
      value: result.aioBoPercent,
      words: result.kwCount,
    };
    if (existIdx !== -1) {
      snapshots[existIdx] = snap;
      console.log(`  ✅ ${brand} snapshot[${today}] 已更新 = ${result.aioBoPercent}%`);
    } else {
      snapshots.push(snap);
      snapshots.sort((a, b) => a.date.localeCompare(b.date));
      console.log(`  ✅ ${brand} snapshot[${today}] 已追加 = ${result.aioBoPercent}%`);
    }
    entry.snapshots = snapshots;
  }

  if (sfResult) upsertSnapshot('streamfab', sfResult);
  if (dfResult) upsertSnapshot('dvdfab', dfResult);

  const nextPath = statsPath + '.next';
  fs.writeFileSync(nextPath, JSON.stringify(stats, null, 2), 'utf-8');
  fs.renameSync(nextPath, statsPath);
  console.log(`\n✅ stats.json 已更新 → ${statsPath}`);
}

// ── 推送到 GitHub ─────────────────────────────────────────────

function pushToGitHub(statsPath) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('❌ 请先设置 GITHUB_TOKEN 环境变量后再使用 --push');
    process.exit(1);
  }
  const repo = 'erikainworking-cloud/reddit-dashboard';
  const apiUrl = `https://api.github.com/repos/${repo}/contents/stats.json`;

  console.log('\n🚀 推送到 GitHub...');

  // 获取当前 SHA
  const shaResult = spawnSync('curl', [
    '-s', '-H', `Authorization: token ${token}`,
    apiUrl,
  ], { encoding: 'utf-8' });
  const shaData = JSON.parse(shaResult.stdout || '{}');
  const sha = shaData.sha || '';

  // Base64 编码
  const content = fs.readFileSync(statsPath).toString('base64');
  const body = JSON.stringify({
    message: `update aio-bo stats ${new Date().toISOString().slice(0, 10)}`,
    content,
    sha,
  });

  const pushResult = spawnSync('curl', [
    '-s', '-X', 'PUT',
    '-H', `Authorization: token ${token}`,
    '-H', 'Accept: application/vnd.github+json',
    '-H', 'Content-Type: application/json',
    '-d', body,
    apiUrl,
  ], { encoding: 'utf-8' });

  const pushData = JSON.parse(pushResult.stdout || '{}');
  if (pushData.content) {
    console.log('✅ 已推送到 GitHub，看板将自动刷新');
    console.log('🌐 https://erikainworking-cloud.github.io/reddit-dashboard/');
  } else {
    console.error('❌ 推送失败：', pushData.message || pushResult.stdout.slice(0, 200));
  }
}

// ── 主流程 ────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes('--list-tables-sf')) {
  console.log('📋 列出 StreamFab base 中所有表格：');
  try {
    const tables = listTables(CONFIG.streamfab.baseToken);
    tables.forEach(t => console.log(`  ${t.name || t.table_name} → ${t.table_id || t.tableId}`));
  } catch (e) {
    console.error('❌', e.message);
  }
  process.exit(0);
}

(async () => {
  console.log('🔍 AIO-BO 半自动化计算...\n');
  console.log('── StreamFab ─────────────────────────────────────');
  const sfResult = await calcStreamfabAiobo().catch(e => { console.error('  ❌ StreamFab 计算失败:', e.message); return null; });
  printResult(sfResult);

  console.log('\n── DVDFab ────────────────────────────────────────');
  const dfResult = await calcDvdfabAiobo().catch(e => { console.error('  ❌ DVDFab 计算失败:', e.message); return null; });
  printResult(dfResult);

  const shouldUpdate = args.includes('--update') || args.includes('--push');
  if (shouldUpdate) {
    console.log('\n📝 写入 stats.json...');
    updateStatsJson(sfResult, dfResult);
  } else {
    console.log('\n💡 预览模式（不写入）。添加 --update 写入本地，--push 写入并推送到线上。');
  }

  if (args.includes('--push')) {
    pushToGitHub(path.join(__dirname, 'stats.json'));
  }
})();
