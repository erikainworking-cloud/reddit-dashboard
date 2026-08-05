#!/usr/bin/env node
/**
 * export-stats.js
 * 从飞书拉取所有运营数据，生成 stats.json
 * 运行方式：node export-stats.js
 */

const { spawnSync, execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

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

// ── 数据源配置 ────────────────────────────────────────────────

// 精准词监控（监控看板）
const PRECISE_SOURCES = [
  { brand: 'streamfab', label: 'StreamFab', baseToken: 'V2O8bxWe4aX0KGsafuAcrLDGnab', tableId: 'tblz9rJi6Pt88bPV', keywordTableId: 'tbl4sXUD5NHhep4B' },
  { brand: 'dvdfab',    label: 'DVDFab',    baseToken: 'L9w8bTVofa7d9fsraqJc8e0Cn1b', tableId: 'tblz5MSaNKFyEW4D', keywordTableId: 'tbl6o1UiQ7qPhC2O' },
];

// 品牌舆情监控（执行动作）
const BRAND_MON_SOURCES = [
  { brand: 'streamfab', label: 'StreamFab', baseToken: 'XrfObyYreaRR48sHAO1cTWDYnne', tableId: 'tblSVymHhFLAmo1g' },
  { brand: 'dvdfab',    label: 'DVDFab',    baseToken: 'WBRjbqWf8a8xTBsrabYcfdH7nUc', tableId: 'tblHTBcASPK2gNHm' },
];

// 第三方付费账号
const PAID_SOURCE = { baseToken: 'KhAHbJRcNaCq03sxg8Bcw2Pfn1g', tableId: 'tblnoKwZHuCNuBCI' };

// ── 工具函数 ──────────────────────────────────────────────────

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

function toCountMap(rows, keyAlias, countAlias = 'count') {
  const map = {};
  for (const row of rows) {
    const k = row[keyAlias]?.value;
    const v = row[countAlias]?.value;
    if (k !== null && k !== undefined) map[String(k)] = Number(v);
  }
  return map;
}

function buildDSL(tableId, dimensionField, alias) {
  return {
    datasource: { type: 'table', table: { tableId } },
    dimensions: [{ field_name: dimensionField, alias }],
    measures:   [{ field_name: dimensionField, aggregation: 'count', alias: 'count' }],
    sort:       [{ field_name: 'count', order: 'desc' }],
    pagination: { limit: 50 },
    shaper:     { format: 'flat' },
  };
}

function buildTotalDSL(tableId, field) {
  return {
    datasource: { type: 'table', table: { tableId } },
    measures:   [{ field_name: field, aggregation: 'count', alias: 'total' }],
    shaper:     { format: 'flat' },
  };
}

function normDate(raw) {
  return raw ? String(raw).replace(/\//g, '-') : null;
}

// ── 精准词监控 ────────────────────────────────────────────────

async function fetchPreciseStats(src) {
  const { baseToken, tableId, label, keywordTableId } = src;

  const totalRows  = dataQuery(baseToken, buildTotalDSL(tableId, '处理状态'));
  const total      = totalRows[0]?.total?.value || 0;

  const statusRows = dataQuery(baseToken, buildDSL(tableId, '处理状态', 'status'));
  const statusCount = toCountMap(statusRows, 'status');

  const intentRows  = dataQuery(baseToken, buildDSL(tableId, '意图分类', 'intent'));
  const intentCount = toCountMap(intentRows, 'intent');

  const mentionRows  = dataQuery(baseToken, buildDSL(tableId, '产品提及', 'mention'));
  const mentionCount = toCountMap(mentionRows, 'mention');

  const typeRows  = dataQuery(baseToken, buildDSL(tableId, '贴子/评论', 'type'));
  const typeCount = toCountMap(typeRows, 'type');

  // Build keyword allowlist from the brand's 关键词 table, then filter monitoring data
  let allowSet = null;
  if (keywordTableId) {
    const allowRows = dataQuery(baseToken, { ...buildDSL(keywordTableId, '关键词', 'keyword'), pagination: { limit: 2000 } });
    allowSet = new Set(allowRows.map(r => (r.keyword?.value || '').toLowerCase()).filter(Boolean));
  }
  const keywordRows = dataQuery(baseToken, { ...buildDSL(tableId, '关键词', 'keyword'), pagination: { limit: 500 } });
  const topKeywords = keywordRows
    .map(r => [r.keyword?.value, r.count?.value])
    .filter(([k]) => k && (!allowSet || allowSet.has(k.toLowerCase())))
    .slice(0, 15);

  const dailyRows = dataQuery(baseToken, {
    datasource: { type: 'table', table: { tableId } },
    dimensions: [{ field_name: '抓取时间', alias: 'date' }],
    measures:   [{ field_name: '抓取时间', aggregation: 'count', alias: 'count' }],
    sort:       [{ field_name: 'date', order: 'asc' }],
    pagination: { limit: 90 },
    shaper:     { format: 'flat' },
  });
  const dailyTrend = dailyRows
    .map(r => [normDate(r.date?.value), r.count?.value])
    .filter(([d]) => d)
    .slice(-60);

  // 按日 × 处理状态（供前端精确时间范围切片）
  const statusDayRows = dataQuery(baseToken, {
    datasource: { type: 'table', table: { tableId } },
    dimensions: [{ field_name: '抓取时间', alias: 'date' }, { field_name: '处理状态', alias: 'status' }],
    measures:   [{ field_name: '处理状态', aggregation: 'count', alias: 'count' }],
    sort:       [{ field_name: 'date', order: 'desc' }],
    pagination: { limit: 5000 },
    shaper:     { format: 'flat' },
  });
  const statusByDate = {};
  for (const r of statusDayRows) {
    const dt = normDate(r.date?.value), st = r.status?.value;
    if (dt && st) (statusByDate[dt] = statusByDate[dt] || {})[st] = Number(r.count?.value) || 0;
  }

  // 按日 × 意图分类
  const intentDayRows = dataQuery(baseToken, {
    datasource: { type: 'table', table: { tableId } },
    dimensions: [{ field_name: '抓取时间', alias: 'date' }, { field_name: '意图分类', alias: 'intent' }],
    measures:   [{ field_name: '意图分类', aggregation: 'count', alias: 'count' }],
    sort:       [{ field_name: 'date', order: 'desc' }],
    pagination: { limit: 5000 },
    shaper:     { format: 'flat' },
  });
  const intentByDate = {};
  for (const r of intentDayRows) {
    const dt = normDate(r.date?.value), it = r.intent?.value;
    if (dt && it) (intentByDate[dt] = intentByDate[dt] || {})[it] = Number(r.count?.value) || 0;
  }

  // 按日 × 产品提及
  const mentionDayRows = dataQuery(baseToken, {
    datasource: { type: 'table', table: { tableId } },
    dimensions: [{ field_name: '抓取时间', alias: 'date' }, { field_name: '产品提及', alias: 'mention' }],
    measures:   [{ field_name: '产品提及', aggregation: 'count', alias: 'count' }],
    sort:       [{ field_name: 'date', order: 'desc' }],
    pagination: { limit: 5000 },
    shaper:     { format: 'flat' },
  });
  const mentionByDate = {};
  for (const r of mentionDayRows) {
    const dt = normDate(r.date?.value), mn = r.mention?.value;
    if (dt && mn) (mentionByDate[dt] = mentionByDate[dt] || {})[mn] = Number(r.count?.value) || 0;
  }

  // 按日 × 帖子/评论
  const typeDayRows = dataQuery(baseToken, {
    datasource: { type: 'table', table: { tableId } },
    dimensions: [{ field_name: '抓取时间', alias: 'date' }, { field_name: '贴子/评论', alias: 'postType' }],
    measures:   [{ field_name: '贴子/评论', aggregation: 'count', alias: 'count' }],
    sort:       [{ field_name: 'date', order: 'desc' }],
    pagination: { limit: 5000 },
    shaper:     { format: 'flat' },
  });
  const typeByDate = {};
  for (const r of typeDayRows) {
    const dt = normDate(r.date?.value), tp = r.postType?.value;
    if (dt && tp) (typeByDate[dt] = typeByDate[dt] || {})[tp] = Number(r.count?.value) || 0;
  }

  return {
    label, total: Number(total),
    published: statusCount['已发布'] || 0,
    posts:    typeCount['帖子']  || 0,
    comments: typeCount['评论']  || 0,
    statusCount, intentCount,
    brandMention: { YES: mentionCount['YES'] || 0, NO: mentionCount['NO'] || 0 },
    topKeywords, dailyTrend,
    statusByDate, intentByDate, mentionByDate, typeByDate,
  };
}

// ── 品牌舆情监控 ──────────────────────────────────────────────

async function fetchBrandMonStats(src) {
  const { baseToken, tableId, label } = src;

  const totalRows = dataQuery(baseToken, buildTotalDSL(tableId, '处理状态'));
  const total     = totalRows[0]?.total?.value || 0;

  const statusRows  = dataQuery(baseToken, buildDSL(tableId, '处理状态', 'status'));
  const statusCount = toCountMap(statusRows, 'status');

  const problemRows = dataQuery(baseToken, buildDSL(tableId, '问题分类', 'problem'));
  const problemType = toCountMap(problemRows, 'problem');

  // 平均回复质量评分
  const avgRows = dataQuery(baseToken, {
    datasource: { type: 'table', table: { tableId } },
    measures:   [{ field_name: '回复质量评分', aggregation: 'avg', alias: 'avgScore' }],
    shaper:     { format: 'flat' },
  });
  const avgQualityScore = avgRows[0]?.avgScore?.value != null
    ? Number(avgRows[0].avgScore.value).toFixed(1)
    : null;

  // 抓取时间趋势（最近 60 天）
  const scrapingRows = dataQuery(baseToken, {
    datasource: { type: 'table', table: { tableId } },
    dimensions: [{ field_name: '抓取时间', alias: 'date' }],
    measures:   [{ field_name: '抓取时间', aggregation: 'count', alias: 'count' }],
    sort:       [{ field_name: 'date', order: 'desc' }],
    pagination: { limit: 60 },
    shaper:     { format: 'flat' },
  });
  const scrapingTrend = scrapingRows
    .map(r => [normDate(r.date?.value), r.count?.value])
    .filter(([d]) => d)
    .reverse();

  // 处理时间趋势（最近 60 天，已处理记录）
  const trendRows = dataQuery(baseToken, {
    datasource: { type: 'table', table: { tableId } },
    dimensions: [{ field_name: '处理时间', alias: 'date' }],
    measures:   [{ field_name: '处理时间', aggregation: 'count', alias: 'count' }],
    sort:       [{ field_name: 'date', order: 'desc' }],
    pagination: { limit: 60 },
    shaper:     { format: 'flat' },
  });
  const processingTrend = trendRows
    .map(r => [normDate(r.date?.value), r.count?.value])
    .filter(([d]) => d)
    .reverse();

  // 每日状态分布（供客户端时间范围筛选）
  const statusDayRows = dataQuery(baseToken, {
    datasource: { type: 'table', table: { tableId } },
    dimensions: [
      { field_name: '抓取时间', alias: 'date' },
      { field_name: '处理状态', alias: 'status' },
    ],
    measures: [{ field_name: '处理状态', aggregation: 'count', alias: 'count' }],
    sort: [{ field_name: 'date', order: 'desc' }],
    pagination: { limit: 2000 },
    shaper: { format: 'flat' },
  });
  const statusByDate = {};
  for (const r of statusDayRows) {
    const dt = normDate(r.date?.value);
    const st = r.status?.value;
    if (dt && st) {
      (statusByDate[dt] = statusByDate[dt] || {})[st] = Number(r.count?.value) || 0;
    }
  }

  // 每日问题分类（供客户端时间范围筛选）
  const probDayRows = dataQuery(baseToken, {
    datasource: { type: 'table', table: { tableId } },
    dimensions: [
      { field_name: '抓取时间', alias: 'date' },
      { field_name: '问题分类', alias: 'problem' },
    ],
    measures: [{ field_name: '问题分类', aggregation: 'count', alias: 'count' }],
    sort: [{ field_name: 'date', order: 'desc' }],
    pagination: { limit: 2000 },
    shaper: { format: 'flat' },
  });
  const problemByDate = {};
  for (const r of probDayRows) {
    const dt = normDate(r.date?.value);
    const pb = r.problem?.value;
    if (dt && pb) {
      (problemByDate[dt] = problemByDate[dt] || {})[pb] = Number(r.count?.value) || 0;
    }
  }

  return {
    label, total: Number(total),
    processed: statusCount['已处理'] || 0,
    generated: statusCount['已生成'] || 0,
    pending:   statusCount['待处理'] || 0,
    noAction:  statusCount['无需处理'] || 0,
    statusCount, problemType, avgQualityScore, scrapingTrend, processingTrend,
    statusByDate, problemByDate,
  };
}

// ── 数据质量检查 ──────────────────────────────────────────────

function buildDataQuality(result, prev) {
  const checks = [];
  const today  = new Date().toISOString().slice(0, 10);
  const d3     = new Date(); d3.setDate(d3.getDate() - 3);
  const d3Str  = d3.toISOString().slice(0, 10);

  // ── 精准词模块 ──
  for (const brand of ['streamfab', 'dvdfab']) {
    const d = result[brand];
    if (!d) continue;
    const src = `${brand}.precise`;

    // 帖子 + 评论之和与总量一致性（允许 10% 误差）
    const typeSum = (d.posts || 0) + (d.comments || 0);
    if (typeSum > 0 && Math.abs(typeSum - d.total) / d.total > 0.10) {
      checks.push({ source: src, level: 'warning',
        message: `帖子(${d.posts})+评论(${d.comments})=${typeSum}，与总量 ${d.total} 差异超过 10%` });
    }

    // 处理状态各值之和与总量一致性
    const statusSum = Object.values(d.statusCount || {}).reduce((s, v) => s + v, 0);
    if (statusSum > 0 && Math.abs(statusSum - d.total) / d.total > 0.15) {
      checks.push({ source: src, level: 'warning',
        message: `处理状态各值之和 ${statusSum} 与总量 ${d.total} 差异超过 15%` });
    }

    // dailyTrend 中有未来日期
    const futureDates = (d.dailyTrend || []).filter(([dt]) => dt > today);
    if (futureDates.length) {
      checks.push({ source: src, level: 'error',
        message: `dailyTrend 包含 ${futureDates.length} 条未来日期（首个：${futureDates[0][0]}）` });
    }

    // 最近 3 天无抓取记录
    const hasRecent3 = (d.dailyTrend || []).some(([dt]) => dt >= d3Str);
    if ((d.dailyTrend || []).length > 0 && !hasRecent3) {
      checks.push({ source: src, level: 'warning',
        message: '最近 3 天无抓取记录，请检查监控任务是否正常运行' });
    }

    // 与上次对比：总量骤降超过 50%（防止接口异常返回少量数据）
    const prevTotal = prev?.[brand]?.total || 0;
    if (prevTotal > 100 && d.total < prevTotal * 0.5) {
      checks.push({ source: src, level: 'error',
        message: `总量从 ${prevTotal} 骤降至 ${d.total}（-${(100 - d.total / prevTotal * 100).toFixed(0)}%），疑似数据异常` });
    }

    // 总量骤增超过 3 倍（可能是数据重复导入）
    if (prevTotal > 100 && d.total > prevTotal * 3) {
      checks.push({ source: src, level: 'warning',
        message: `总量从 ${prevTotal} 骤增至 ${d.total}（+${((d.total / prevTotal - 1) * 100).toFixed(0)}%），疑似数据重复导入` });
    }

    // 未识别的处理状态（飞书字段选项可能被改名）
    const KNOWN_PRECISE_STATUSES = new Set(['已发布', '待处理', '已生成', '已忽略', '忽略', '处理中', '无需处理', '需要复核', '待审核', '暂不回复']);
    const unknownStatuses = Object.keys(d.statusCount || {}).filter(s => !KNOWN_PRECISE_STATUSES.has(s));
    if (unknownStatuses.length) {
      checks.push({ source: src, level: 'warning',
        message: `发现未识别处理状态：${unknownStatuses.join('、')}，请检查飞书字段选项是否变更` });
    }
  }

  // ── 品牌舆情模块 ──
  for (const brand of ['streamfab', 'dvdfab']) {
    const d = result.brandMonitoring?.[brand];
    if (!d) continue;
    const src = `brandMonitoring.${brand}`;

    const statusSum = Object.values(d.statusCount || {}).reduce((s, v) => s + v, 0);
    if (statusSum > 0 && Math.abs(statusSum - d.total) / d.total > 0.15) {
      checks.push({ source: src, level: 'warning',
        message: `处理状态各值之和 ${statusSum} 与总量 ${d.total} 差异超过 15%` });
    }

    const hasRecent3 = (d.scrapingTrend || []).some(([dt]) => dt >= d3Str);
    if ((d.scrapingTrend || []).length > 0 && !hasRecent3) {
      checks.push({ source: src, level: 'warning', message: '最近 3 天无抓取记录' });
    }

    // 严重故障突然飙升（本次严重故障超上次 3 倍且绝对值 > 5）
    const prevSevere = prev?.brandMonitoring?.[brand]?.problemType?.['严重故障'] || 0;
    const currSevere = d.problemType?.['严重故障'] || 0;
    if (prevSevere > 0 && currSevere > prevSevere * 3 && currSevere > 5) {
      checks.push({ source: src, level: 'warning',
        message: `严重故障从 ${prevSevere} 飙升至 ${currSevere}，请排查是否有版本问题` });
    }

    // 问题分类之和与总量一致性（允许 15% 误差）
    const problemSum = Object.values(d.problemType || {}).reduce((s, v) => s + v, 0);
    if (problemSum > 0 && d.total > 0 && Math.abs(problemSum - d.total) / d.total > 0.15) {
      checks.push({ source: src, level: 'warning',
        message: `问题分类各值之和 ${problemSum} 与总量 ${d.total} 差异超过 15%，请检查是否存在未分类记录` });
    }
  }

  // ── AIO-BO 模块 ──
  for (const brand of ['streamfab', 'dvdfab']) {
    const ab = result.aioBo?.[brand];
    if (!ab) continue;
    const actual = ab.actual || [];
    const latestVal = actual.filter(v => v !== null).slice(-1)[0];
    const denominator = ab.aioTriggerWords || 0;

    // 分子 > 分母
    if (latestVal != null && denominator > 0) {
      const numerator = Math.round(latestVal / 100 * denominator);
      if (numerator > denominator) {
        checks.push({ source: `aioBo.${brand}`, level: 'error',
          message: `AIO-BO 百分比 ${latestVal}% 对应分子 ${numerator} 大于分母 ${denominator}` });
      }
    }

    // dataAsOf 超过 14 天未更新
    if (ab.dataAsOf) {
      const daysSince = (Date.now() - new Date(ab.dataAsOf).getTime()) / 86400000;
      if (daysSince > 14) {
        checks.push({ source: `aioBo.${brand}`, level: 'warning',
          message: `AIO-BO 数据已 ${Math.floor(daysSince)} 天未更新（最后：${ab.dataAsOf}）` });
      }
    }

    // 连续 2 周实际值为 null（停更）
    const recentActual = actual.slice(-2);
    if (recentActual.length === 2 && recentActual.every(v => v === null)) {
      checks.push({ source: `aioBo.${brand}`, level: 'warning',
        message: '最近 2 个周次实际值为空，AIO-BO 可能未按时更新' });
    }
  }

  const hasError   = checks.some(c => c.level === 'error');
  const hasWarning = checks.some(c => c.level === 'warning');
  const status     = hasError ? 'error' : hasWarning ? 'warning' : 'ok';
  return { status, checks, checkedAt: new Date().toISOString() };
}

// ── 第三方付费账号 ────────────────────────────────────────────

async function fetchPaidStats() {
  const { baseToken, tableId } = PAID_SOURCE;

  const totalRows = dataQuery(baseToken, buildTotalDSL(tableId, '产线'));
  const total     = totalRows[0]?.total?.value || 0;

  const brandRows = dataQuery(baseToken, buildDSL(tableId, '产线', 'brand'));
  const byBrand   = toCountMap(brandRows, 'brand');

  const typeRows = dataQuery(baseToken, buildDSL(tableId, '帖子类型', 'postType'));
  const byType   = toCountMap(typeRows, 'postType');

  const s1Rows    = dataQuery(baseToken, buildDSL(tableId, '存活1天', 's1'));
  const survive1day = toCountMap(s1Rows, 's1');

  const s7Rows    = dataQuery(baseToken, buildDSL(tableId, '存活7天', 's7'));
  const survive7day = toCountMap(s7Rows, 's7');

  return { total: Number(total), byBrand, byType, survive1day, survive7day };
}

// ── 主流程 ────────────────────────────────────────────────────

const exportArgs = process.argv.slice(2);
const autoPush   = exportArgs.includes('--push');

(async () => {
  console.log('📊 开始从飞书拉取聚合数据...');
  const result = { updatedAt: new Date().toISOString() };

  for (const src of PRECISE_SOURCES) {
    console.log(`  ⏳ 精准词监控 - ${src.label}...`);
    result[src.brand] = await fetchPreciseStats(src);
    const d = result[src.brand];
    console.log(`  ✅ ${src.label}: 共 ${d.total} 条 | 已发布 ${d.published}`);
  }

  result.brandMonitoring = {};
  for (const src of BRAND_MON_SOURCES) {
    console.log(`  ⏳ 品牌舆情 - ${src.label}...`);
    result.brandMonitoring[src.brand] = await fetchBrandMonStats(src);
    const d = result.brandMonitoring[src.brand];
    console.log(`  ✅ ${src.label} 品牌舆情: 共 ${d.total} 条 | 已处理 ${d.processed} | 待处理 ${d.pending}`);
  }

  console.log(`  ⏳ 第三方付费账号...`);
  result.paidAccounts = await fetchPaidStats();
  console.log(`  ✅ 第三方账号: 共 ${result.paidAccounts.total} 条`);

  // aioBo / milestones 手动维护，不覆盖
  const outPath  = path.join(__dirname, 'stats.json');
  const nextPath = outPath + '.next';
  let prevResult = null;
  if (fs.existsSync(outPath)) {
    const existing = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
    prevResult = existing;
    if (existing.aioBo)      result.aioBo      = existing.aioBo;
    if (existing.milestones) result.milestones  = existing.milestones;
  }

  // 数据质量检查（写入 stats.json，前端 banner 和告警均可读取）
  result.dataQuality = buildDataQuality(result, prevResult);
  if (result.dataQuality.checks.length) {
    console.log('\n📋 数据质量检查：');
    for (const c of result.dataQuality.checks) {
      console.log(`  ${c.level === 'error' ? '❌' : '⚠️ '} [${c.source}] ${c.message}`);
    }
  } else {
    console.log('\n✅ 数据质量检查通过，无异常');
  }

  // 基础校验（结构完整性）
  const required = ['updatedAt', 'streamfab', 'dvdfab', 'brandMonitoring', 'paidAccounts'];
  for (const k of required) {
    if (result[k] == null) throw new Error(`校验失败：缺少字段 "${k}"`);
  }
  for (const brand of ['streamfab', 'dvdfab']) {
    if (typeof result[brand].total !== 'number') {
      throw new Error(`校验失败：${brand}.total 应为数字，实际为 ${typeof result[brand].total}`);
    }
  }

  // 原子写入：先写 .next，校验通过后 rename
  fs.writeFileSync(nextPath, JSON.stringify(result, null, 2), 'utf-8');
  fs.renameSync(nextPath, outPath);
  console.log(`\n✅ stats.json 已更新 → ${outPath}`);

  // --push：数据更新后自动推送飞书卡片
  if (autoPush) {
    console.log('\n📤 --push 模式：自动推送飞书卡片...');
    for (const script of ['push-lark-keyword.js', 'push-lark-brand.js']) {
      const scriptPath = path.join(__dirname, script);
      if (!fs.existsSync(scriptPath)) { console.log(`  ⚠️  ${script} 不存在，跳过`); continue; }
      console.log(`\n  ▶ ${script}`);
      const r = spawnSync(process.execPath, [scriptPath], {
        encoding: 'utf-8',
        cwd: __dirname,
        stdio: 'inherit',
      });
      if (r.status !== 0) console.log(`  ⚠️  ${script} 退出码 ${r.status}`);
    }
  }
})();
