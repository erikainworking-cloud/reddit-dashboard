#!/usr/bin/env node
/**
 * export-stats.js
 * 从飞书拉取所有运营数据，生成 stats.json
 * 运行方式：node export-stats.js
 */

const { spawnSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const FEISHU_API = 'https://open.feishu.cn/open-apis';
const recordCache = new Map();
let tenantAccessToken = null;

async function getTenantAccessToken() {
  const appId = process.env.LARK_APP_ID;
  const appSecret = process.env.LARK_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error('缺少 LARK_APP_ID 或 LARK_APP_SECRET 环境变量');
  }

  const response = await fetch(`${FEISHU_API}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const payload = await response.json();
  if (!response.ok || payload.code !== 0 || !payload.tenant_access_token) {
    throw new Error(`获取飞书 tenant_access_token 失败（code: ${payload.code ?? response.status}）`);
  }
  return payload.tenant_access_token;
}

async function feishuRequest(url) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${tenantAccessToken}` },
  });
  const payload = await response.json();
  if (!response.ok || payload.code !== 0) {
    throw new Error(`飞书 Bitable API 请求失败（code: ${payload.code ?? response.status}）`);
  }
  return payload.data;
}

function normalizeFieldValue(value, fieldName) {
  if (value == null || value === '') return null;
  if (Array.isArray(value)) {
    const values = value
      .map(item => typeof item === 'object' && item !== null ? (item.text ?? item.name ?? item.id) : item)
      .filter(item => item != null && item !== '');
    return values.length ? values.join('、') : null;
  }
  if (typeof value === 'object') return value.text ?? value.name ?? value.id ?? null;
  if ((fieldName.includes('时间') || fieldName.includes('日期')) && /^\d{12,}$/.test(String(value))) {
    return new Date(Number(value)).toISOString().slice(0, 10);
  }
  return String(value);
}

async function loadTableRecords(baseToken, tableId) {
  const cacheKey = `${baseToken}:${tableId}`;
  if (recordCache.has(cacheKey)) return recordCache.get(cacheKey);

  const records = [];
  let pageToken = null;
  do {
    const params = new URLSearchParams({ page_size: '500' });
    if (pageToken) params.set('page_token', pageToken);
    const data = await feishuRequest(
      `${FEISHU_API}/bitable/v1/apps/${encodeURIComponent(baseToken)}/tables/${encodeURIComponent(tableId)}/records?${params}`
    );
    records.push(...(data.items || []));
    pageToken = data.has_more ? data.page_token : null;
  } while (pageToken);

  recordCache.set(cacheKey, records);
  return records;
}

async function loadAllSourceRecords() {
  tenantAccessToken = await getTenantAccessToken();
  const sources = [
    ...PRECISE_SOURCES.flatMap(({ baseToken, tableId, keywordTableId }) => [
      [baseToken, tableId],
      ...(keywordTableId ? [[baseToken, keywordTableId]] : []),
    ]),
    ...BRAND_MON_SOURCES.map(({ baseToken, tableId }) => [baseToken, tableId]),
    [PAID_SOURCE.baseToken, PAID_SOURCE.tableId],
    [COMPETITOR_SOURCE.baseToken, COMPETITOR_SOURCE.tableId],
  ];
  await Promise.all(sources.map(([baseToken, tableId]) => loadTableRecords(baseToken, tableId)));
}

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

// 竞品监控（日聚合表，按最近两个完整自然周比较）
const COMPETITOR_SOURCE = {
  baseToken: 'Y1uAbFprUawDWKsSoOucyvhPnrc',
  tableId: 'tblRQe07VAZntyfq',
  url: 'https://i6a1sqw3p2.feishu.cn/base/Y1uAbFprUawDWKsSoOucyvhPnrc?table=tblJ98nNIyyxI1KL&view=vewSBgAnvb',
  brands: [
    { key: 'tunepat', label: 'TunePat', field: 'TunePat提及数' },
    { key: 'movpilot', label: 'Movpilot', field: 'Movpilot提及数' },
    { key: 'audials', label: 'Audials', field: 'Audials提及数' },
    { key: 'playon', label: 'Playon', field: 'Playon提及数' },
    { key: 'keeprix', label: 'Keeprix', field: 'Keeprix提及数' },
    { key: 'tunefab', label: 'Tunefab', field: 'Tunefab提及数' },
    { key: 'other', label: '其他品牌', field: '其他品牌提及数' },
  ],
};

// ── 工具函数 ──────────────────────────────────────────────────

async function tableRecords(baseToken, tableId) {
  return loadTableRecords(baseToken, tableId);
}

function fieldValue(record, fieldName) {
  return normalizeFieldValue(record.fields?.[fieldName], fieldName);
}

function countBy(records, fieldName) {
  const map = {};
  for (const record of records) {
    const value = fieldValue(record, fieldName);
    if (value != null) map[value] = (map[value] || 0) + 1;
  }
  return map;
}

function countByDate(records, dateField, valueField) {
  const map = {};
  for (const record of records) {
    const date = normDate(fieldValue(record, dateField));
    const value = fieldValue(record, valueField);
    if (date && value != null) {
      (map[date] = map[date] || {})[value] = (map[date][value] || 0) + 1;
    }
  }
  return map;
}

function countDates(records, dateField, limit = 60) {
  const map = {};
  for (const record of records) {
    const date = normDate(fieldValue(record, dateField));
    if (date) map[date] = (map[date] || 0) + 1;
  }
  return Object.entries(map)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-limit)
    .map(([date, count]) => [date, count]);
}

function averageBy(records, fieldName) {
  const values = records
    .map(record => Number(fieldValue(record, fieldName)))
    .filter(Number.isFinite);
  if (!values.length) return null;
  return (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1);
}

function sortedCounts(map, limit) {
  return Object.entries(map)
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit);
}

function normDate(raw) {
  if (!raw) return null;
  const match = String(raw).match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!match) return null;
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function beijingToday() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const value = type => parts.find(part => part.type === type)?.value;
  return new Date(Date.UTC(Number(value('year')), Number(value('month')) - 1, Number(value('day'))));
}

function addUtcDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function weekRange(start) {
  return { start: isoDate(start), end: isoDate(addUtcDays(start, 6)) };
}

function isInRange(date, range) {
  return date >= range.start && date <= range.end;
}

// ── 精准词监控 ────────────────────────────────────────────────

async function fetchPreciseStats(src) {
  const { baseToken, tableId, label, keywordTableId } = src;
  const records = await tableRecords(baseToken, tableId);
  const statusCount = countBy(records, '处理状态');
  const intentCount = countBy(records, '意图分类');
  const mentionCount = countBy(records, '产品提及');
  const typeCount = countBy(records, '贴子/评论');

  let allowSet = null;
  if (keywordTableId) {
    const keywordRecords = await tableRecords(baseToken, keywordTableId);
    allowSet = new Set(keywordRecords
      .map(record => fieldValue(record, '关键词')?.toLowerCase())
      .filter(Boolean));
  }
  const topKeywords = sortedCounts(countBy(records, '关键词'))
    .filter(([keyword]) => !allowSet || allowSet.has(keyword.toLowerCase()))
    .slice(0, 15);

  return {
    label, total: records.length,
    published: statusCount['已发布'] || 0,
    posts:    typeCount['帖子']  || 0,
    comments: typeCount['评论']  || 0,
    statusCount, intentCount,
    brandMention: { YES: mentionCount.YES || 0, NO: mentionCount.NO || 0 },
    topKeywords,
    dailyTrend: countDates(records, '抓取时间'),
    statusByDate: countByDate(records, '抓取时间', '处理状态'),
    intentByDate: countByDate(records, '抓取时间', '意图分类'),
    mentionByDate: countByDate(records, '抓取时间', '产品提及'),
    typeByDate: countByDate(records, '抓取时间', '贴子/评论'),
  };
}

// ── 品牌舆情监控 ──────────────────────────────────────────────

async function fetchBrandMonStats(src) {
  const { baseToken, tableId, label } = src;
  const records = await tableRecords(baseToken, tableId);
  const statusCount = countBy(records, '处理状态');
  const problemType = countBy(records, '问题分类');
  const problemStatusCross = {};
  for (const record of records) {
    const problem = fieldValue(record, '问题分类');
    const status = fieldValue(record, '处理状态');
    if (problem && status) {
      (problemStatusCross[problem] = problemStatusCross[problem] || {})[status] =
        (problemStatusCross[problem][status] || 0) + 1;
    }
  }

  return {
    label, total: records.length,
    processed: statusCount['已处理'] || 0,
    generated: statusCount['已生成'] || 0,
    pending:   statusCount['待处理'] || 0,
    noAction:  statusCount['无需处理'] || 0,
    statusCount,
    problemType,
    avgQualityScore: averageBy(records, '回复质量评分'),
    scrapingTrend: countDates(records, '抓取时间'),
    processingTrend: countDates(records, '处理时间'),
    statusByDate: countByDate(records, '抓取时间', '处理状态'),
    problemByDate: countByDate(records, '抓取时间', '问题分类'),
    problemStatusCross,
  };
}

// ── 竞品监控 ──────────────────────────────────────────────────

async function fetchCompetitorStats() {
  const records = await tableRecords(COMPETITOR_SOURCE.baseToken, COMPETITOR_SOURCE.tableId);
  const today = beijingToday();
  const dayOfWeek = today.getUTCDay();
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  const currentWeek = weekRange(addUtcDays(today, -(daysSinceMonday + 7)));
  const previousWeek = weekRange(addUtcDays(today, -(daysSinceMonday + 14)));

  const byDate = new Map();
  for (const record of records) {
    const date = normDate(fieldValue(record, '检查日期'));
    if (!date) continue;

    const values = Object.fromEntries(COMPETITOR_SOURCE.brands.map(({ key, field }) => {
      const value = Number(fieldValue(record, field));
      return [key, Number.isFinite(value) ? value : 0];
    }));
    const total = COMPETITOR_SOURCE.brands.reduce((sum, { key }) => sum + values[key], 0);
    byDate.set(date, { date, total, brands: values });
  }

  const totalForRange = range => [...byDate.values()]
    .filter(day => isInRange(day.date, range))
    .reduce((sum, day) => sum + day.total, 0);
  const brandTotalForRange = (key, range) => [...byDate.values()]
    .filter(day => isInRange(day.date, range))
    .reduce((sum, day) => sum + day.brands[key], 0);

  const brands = COMPETITOR_SOURCE.brands.map(({ key, label }) => {
    const currentWeekTotal = brandTotalForRange(key, currentWeek);
    const previousWeekTotal = brandTotalForRange(key, previousWeek);
    const change = currentWeekTotal - previousWeekTotal;
    return {
      key,
      label,
      currentWeek: currentWeekTotal,
      previousWeek: previousWeekTotal,
      change,
      changePct: previousWeekTotal ? Number((change / previousWeekTotal * 100).toFixed(1)) : null,
    };
  });

  const dailyTrend = [...byDate.values()]
    .filter(day => isInRange(day.date, previousWeek) || isInRange(day.date, currentWeek))
    .sort((a, b) => a.date.localeCompare(b.date));
  const currentTotal = totalForRange(currentWeek);
  const previousTotal = totalForRange(previousWeek);

  return {
    sourceUrl: COMPETITOR_SOURCE.url,
    currentWeek,
    previousWeek,
    currentTotal,
    previousTotal,
    totalChange: currentTotal - previousTotal,
    totalChangePct: previousTotal ? Number(((currentTotal - previousTotal) / previousTotal * 100).toFixed(1)) : null,
    currentWeekRecordCount: dailyTrend.filter(day => isInRange(day.date, currentWeek)).length,
    brands,
    dailyTrend,
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

  // ── 竞品监控模块 ──
  const competitor = result.competitorMonitoring;
  if (competitor && competitor.currentWeekRecordCount === 0) {
    checks.push({
      source: 'competitorMonitoring',
      level: 'warning',
      message: `最近完整自然周（${competitor.currentWeek.start} 至 ${competitor.currentWeek.end}）没有日报记录，请检查竞品监控数据是否按日同步`,
    });
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
  const records = await tableRecords(baseToken, tableId);

  return {
    total: records.length,
    byBrand: countBy(records, '产线'),
    byType: countBy(records, '帖子类型'),
    survive1day: countBy(records, '存活1天'),
    survive7day: countBy(records, '存活7天'),
  };
}

// ── 主流程 ────────────────────────────────────────────────────

const exportArgs = process.argv.slice(2);
const autoPush   = exportArgs.includes('--push');

(async () => {
  console.log('📊 开始从飞书拉取聚合数据...');
  await loadAllSourceRecords();
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

  console.log(`  ⏳ 竞品监控周环比...`);
  result.competitorMonitoring = await fetchCompetitorStats();
  const cm = result.competitorMonitoring;
  console.log(`  ✅ 竞品监控: ${cm.currentWeek.start} 至 ${cm.currentWeek.end} 共 ${cm.currentTotal} 条（环比 ${cm.totalChange >= 0 ? '+' : ''}${cm.totalChange}）`);

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
  const required = ['updatedAt', 'streamfab', 'dvdfab', 'brandMonitoring', 'paidAccounts', 'competitorMonitoring'];
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
