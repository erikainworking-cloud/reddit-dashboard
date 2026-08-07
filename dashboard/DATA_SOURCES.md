# 看板数据来源与计算口径说明

> 本文档用于交接说明。看板地址：https://erikainworking-cloud.github.io/reddit-dashboard/
>
> 最后更新：2026-08-05

---

## 一、系统架构概览

```
飞书多维表格（原始业务数据）
         ↓
GitHub Actions（GitHub-hosted runner）
  1. export-stats.js   ← 通过飞书 Open API 拉取数据，计算按日聚合、运营漏斗、数据质量
  2. export-aiobo.js   ← 半自动计算 AIO-BO（每周触发一次）
  3. 原子写入 stats.json（先写 .next，再 renameSync）
         ↓
GitHub Pages（静态部署）
  → 浏览器看板（index.html 通过 fetch 读取 stats.json）
  → 飞书日报 / 周报卡片
```

**自动更新**（GitHub Actions）：在 GitHub-hosted runner 上每天 UTC 02:00 / 10:00 / 18:00（北京时间 10:00 / 18:00 / 次日 02:00）自动运行 `export-stats.js` 并提交 `stats.json`，不含 AIO-BO。使用飞书企业自建应用的短期 tenant access token，不依赖本机或 lark-cli。

**半自动更新**（AIO-BO）：每周手动运行 `node export-aiobo.js --update`，结果写入 `stats.json`。

**失败保护**：Actions 失败时不覆盖旧数据，`stats.json` 保留上一次成功结果。

---

## 二、精准词监控（`streamfab` / `dvdfab`）

### 数据来源

| 品牌 | 飞书多维表格 base_token | 表格 table_id |
|------|----------------------|--------------|
| StreamFab | `V2O8bxWe4aX0KGsafuAcrLDGnab` | `tblz9rJi6Pt88bPV` |
| DVDFab | `L9w8bTVofa7d9fsraqJc8e0Cn1b` | `tblz5MSaNKFyEW4D` |

由 **reddit-exact-term-monitoring-streamfab** Skill 每日自动将 Reddit 帖子/评论写入。

### 字段说明

| stats.json 字段 | 来源字段 | 计算方式 |
|----------------|---------|---------|
| `total` | `处理状态` | COUNT 所有记录 |
| `published` | `处理状态` | COUNT 值为「已发布」的记录 |
| `posts` | `贴子/评论` | COUNT 值为「帖子」的记录 |
| `comments` | `贴子/评论` | COUNT 值为「评论」的记录 |
| `statusCount` | `处理状态` | GROUP BY COUNT |
| `intentCount` | `意图分类` | GROUP BY COUNT |
| `brandMention.YES/NO` | `产品提及` | GROUP BY COUNT |
| `topKeywords` | `关键词` | GROUP BY COUNT，取 TOP 15 |
| `dailyTrend` | `抓取时间` | 按日期 GROUP BY COUNT，近 60 天 |
| `statusByDate` | `处理状态` × `抓取时间` | `{date: {status: count}}`，近 60 天 |
| `intentByDate` | `意图分类` × `抓取时间` | `{date: {intent: count}}`，近 60 天 |
| `mentionByDate` | `产品提及` × `抓取时间` | `{date: {YES/NO: count}}`，近 60 天 |
| `typeByDate` | `贴子/评论` × `抓取时间` | `{date: {帖子/评论: count}}`，近 60 天 |

> `*ByDate` 字段由新版 `export-stats.js`（v2）生成，用于前端按日聚合，支持真实的近7天/近30天数据统计，避免比例估算。

### 精准词合法处理状态

以下状态视为已知正常状态（不触发数据质量告警）：

`已发布` / `待处理` / `已生成` / `已忽略` / `忽略` / `处理中` / `无需处理` / `需要复核` / `待审核` / `暂不回复`

---

## 三、品牌舆情监控（`brandMonitoring.streamfab` / `brandMonitoring.dvdfab`）

### 数据来源

| 品牌 | 飞书多维表格 base_token | 表格 table_id |
|------|----------------------|--------------|
| StreamFab | `XrfObyYreaRR48sHAO1cTWDYnne` | `tblSVymHhFLAmo1g` |
| DVDFab | `WBRjbqWf8a8xTBsrabYcfdH7nUc` | `tblHTBcASPK2gNHm` |

记录提及品牌的 Reddit 帖子，由运营人员人工处理或 AI 辅助生成回复。

### 字段说明

| stats.json 字段 | 来源字段 | 计算方式 |
|----------------|---------|---------|
| `total` | `处理状态` | COUNT 所有记录 |
| `processed` | `处理状态` | COUNT 值为「已处理」|
| `generated` | `处理状态` | COUNT 值为「已生成」|
| `pending` | `处理状态` | COUNT 值为「待处理」|
| `noAction` | `处理状态` | COUNT 值为「无需处理」|
| `statusCount` | `处理状态` | GROUP BY COUNT |
| `problemType` | `问题分类` | GROUP BY COUNT |
| `avgQualityScore` | `回复质量评分` | AVG，保留 1 位小数 |
| `processingTrend` | `处理时间` | 按日期 GROUP BY COUNT（已处理记录）|
| `statusByDate` | `抓取时间` × `处理状态` | `{date: {status: count}}`，按抓取日期聚合当前处理状态 |
| `problemByDate` | `抓取时间` × `问题分类` | `{date: {problem: count}}`，按抓取日期聚合问题分类 |

> **品牌舆情的时间筛选口径**：默认展示近 7 天（可切换近 30 天或全部）抓取的记录，并按这些记录的当前处理状态统计“待处理 / 已生成 / 已处理”等数量；“全部”展示全量当前状态汇总。这样“待处理”不会把历史所有积压误作近期新增待处理。

---

## 四、竞品监控（`competitorMonitoring`）

### 数据来源

- **多维表格**：[竞品监控](https://i6a1sqw3p2.feishu.cn/base/Y1uAbFprUawDWKsSoOucyvhPnrc?table=tblJ98nNIyyxI1KL&view=vewSBgAnvb)
- **Base token**：`Y1uAbFprUawDWKsSoOucyvhPnrc`
- **日聚合表**：`日报表`（`tblRQe07VAZntyfq`）

周环比必须读取「日报表」，而不是明细表「输出数据」：日报表每个检查日期只有一条聚合记录，可避免将同一轮 SERP 中的多条明细误当作独立日提及。

### 字段与计算口径

| stats.json 字段 | 来源字段 | 计算方式 |
|----------------|---------|---------|
| `brands[].currentWeek` | `TunePat提及数`、`Movpilot提及数`、`Audials提及数`、`Playon提及数`、`Keeprix提及数`、`Tunefab提及数`、`其他品牌提及数` | 本周每日值求和 |
| `brands[].previousWeek` | 同上 | 上周每日值求和 |
| `brands[].change` | 同上 | 本周 − 上周 |
| `brands[].changePct` | 同上 | `(本周 − 上周) / 上周 × 100`；上周为 0 时为 `null` |
| `currentTotal` / `previousTotal` | 七个竞品字段 | 对应周期内所有品牌每日提及数求和 |
| `dailyTrend` | `检查日期` + 七个竞品字段 | 两个对比周内按日保留总量与品牌明细 |

**周定义**：始终比较最近一个已经完整结束的自然周（周一 00:00 至周日 23:59）与其前一个完整自然周，不使用尚在进行的本周。缺失日期按 0 计入，不会推断或补造未存在的日报记录。

**质量检查**：若最近完整周没有一条日报记录，写入 `dataQuality` 的 warning，提示检查竞品数据同步。

**推送**：`push-lark-competitor.js` 读取该数据生成卡片；GitHub workflow 计划每周一 01:00 UTC（北京时间 09:00）运行。卡片默认使用测试群，支持 `--chat-id` / `--user-id` 定向测试，并包含看板与该多维表格链接。

---

## 五、数据质量检查（`dataQuality`）

由 `export-stats.js` 自动生成，写入 `stats.json.dataQuality`。

```json
{
  "dataQuality": {
    "checkedAt": "2026-08-05T10:00:00.000Z",
    "checks": [
      { "source": "streamfab", "level": "error", "message": "dailyTrend 包含未来日期" },
      { "source": "dvdfab",    "level": "warning", "message": "最近 3 天无抓取记录" }
    ]
  }
}
```

**检查项说明**：

| level | 检查项 | 说明 |
|-------|--------|------|
| error | 未来日期 | dailyTrend 中存在晚于当前日期的记录 |
| error | 总量骤降 | 今日总量较前7天均值下降超过 80% |
| error | 品牌提及之和≠总量 | YES+NO 之和与 total 差异超过 10% |
| warning | 最近3天无记录 | dailyTrend 近3天全为0 |
| warning | 帖子+评论≠总量 | 两者之和与 total 差异超过 10% |
| warning | 总量骤增（精准词） | 总量突然超过前期 3 倍，疑似重复导入 |
| warning | 未识别处理状态 | 出现 KNOWN_PRECISE_STATUSES 以外的状态值 |
| warning | 问题分类之和与总量不一致 | 品牌舆情问题分类各值之和与 total 差异超过 15% |
| warning | 严重故障比例偏高 | 超过 15% |
| warning | 品牌舆情总量骤降 | 较前7天均值下降超过 60% |
| warning | 品牌舆情骤增 | 总量骤升超过 5 倍 |

---

## 六、第三方付费账号（`paidAccounts`）

| 飞书多维表格 base_token | 表格 table_id |
|----------------------|--------------|
| `KhAHbJRcNaCq03sxg8Bcw2Pfn1g` | `tblnoKwZHuCNuBCI` |

| stats.json 字段 | 来源字段 | 计算方式 |
|----------------|---------|---------|
| `total` | `产线` | COUNT 所有记录 |
| `byBrand` | `产线` | GROUP BY COUNT |
| `byType` | `帖子类型` | GROUP BY COUNT（新帖/旧帖）|
| `survive1day` | `存活1天` | GROUP BY COUNT（是/否）|
| `survive7day` | `存活7天` | GROUP BY COUNT（是/否）|

---

## 七、AIO-BO 进度追踪（`aioBo`）

> ⚠️ 此部分**不由 `export-stats.js` 自动拉取**，需手动运行 `export-aiobo.js`。

### 概念说明

**AIO-BO（AI Overview 品牌占位率）**= 完成「AIO → Reddit → 品牌提及」全链路的关键词数 ÷ AIO 触发词总数

```
AIO-BO% = 全链路关键词数 / aioTriggerWords（固定分母）
```

### 数据结构（v2 snapshots）

```json
{
  "aioBo": {
    "streamfab": {
      "current": 18.64,
      "currentWords": 33,
      "aioTriggerWords": 177,
      "q3Target": 25.0,
      "q3TargetWords": 44,
      "dataAsOf": "2026-07-31",
      "kwList": ["keyword1", "keyword2", "..."],
      "snapshots": [
        { "date": "2026-07-17", "week": "W1", "value": 18.08, "words": 32 },
        { "date": "2026-07-31", "week": "W3", "value": 18.64, "words": 33 }
      ]
    }
  }
}
```

> `snapshots` 结构（v2）按日期追加，同一天重复运行会更新当天快照而非追加。
> 旧版 `actual` / `weeks` 平行数组格式向前兼容，前端可同时读取。

### 差距单位说明

| 展示内容 | 单位 |
|---------|------|
| 当前 AIO-BO | `%`（如 `18.64%`） |
| Q3 目标 | `%`（如 `25.00%`） |
| 与目标差距 | `pp`（百分点，如 `-6.36pp`） |
| 周速度 | `pp/周`（如 `+0.56pp/周`） |

### 6.1 StreamFab AIO-BO

**飞书多维表格**：`EeTUbRHV3anTKTsvl2dcjaAenBf`

**全链路判定条件**（SERP 排名明细表）：
- `来源类别` = `来源引用`
- `细分来源` 不包含官方域名（`dvdfab.cn`、`streamfab.com`、`streamfab.dvdfab.cn`、`AIO正文`）
- `是否提及StreamFab` = `是`

**自动化运行**：
```bash
# 首次发现表格 ID
node --env-file=.env export-aiobo.js --list-tables-sf

# 预览计算结果（不写入）
node --env-file=.env export-aiobo.js

# 写入 stats.json
node --env-file=.env export-aiobo.js --update
```

**Q3 目标**：25.0%（44 个全链路关键词 / 177）

### 6.2 DVDFab AIO-BO

**飞书多维表格**：`NnG1bHoZsaYdCzs5Slfch1bQnJb`

读取预聚合统计表（`tblPIJosQPBHD9bj`），筛选 `来源` = `AIO` 行，取 `DVDFab 覆盖关键词数`。

**Q3 目标**：40.5%（82 个全链路关键词 / 203）

---

## 八、stats.json 数据结构速查

```
stats.json
├── updatedAt               ISO 时间戳，export-stats.js 自动生成
├── streamfab               精准词监控 - StreamFab
│   ├── total, published, posts, comments
│   ├── statusCount, intentCount, brandMention, topKeywords
│   ├── dailyTrend          [[date, count], ...]，近 60 天
│   ├── statusByDate        {date: {status: count}}，近 60 天 ← v2 新增
│   ├── intentByDate        {date: {intent: count}}，近 60 天 ← v2 新增
│   ├── mentionByDate       {date: {YES/NO: count}}，近 60 天 ← v2 新增
│   └── typeByDate          {date: {帖子/评论: count}}，近 60 天 ← v2 新增
├── dvdfab                  精准词监控 - DVDFab（同上）
├── brandMonitoring
│   ├── streamfab           品牌舆情 - StreamFab
│   └── dvdfab              品牌舆情 - DVDFab
├── competitorMonitoring    竞品提及完整自然周环比
│   ├── sourceUrl, currentWeek, previousWeek
│   ├── currentTotal, previousTotal, totalChange, totalChangePct
│   ├── brands              [{key, label, currentWeek, previousWeek, change, changePct}]
│   └── dailyTrend          [{date, total, brands}]
├── dataQuality             ← v2 新增
│   ├── checkedAt           检查时间戳
│   └── checks              [{source, level, message}]
├── aioBo
│   ├── streamfab           AIO-BO - StreamFab
│   │   ├── current, currentWords, dataAsOf
│   │   ├── snapshots       [{date, week, value, words}] ← v2 新结构
│   │   └── kwList          全链路关键词列表
│   └── dvdfab              AIO-BO - DVDFab（同上）
└── paidAccounts            第三方付费账号
```

---

## 九、运行方式汇总

```bash
cd dashboard

# 拉取飞书数据，生成 stats.json（精准词 + 品牌舆情 + 竞品周环比 + 付费账号 + 数据质量）
node --env-file=.env export-stats.js
# 或：node export-stats.js  （如已通过其他方式设置环境变量）

# 计算 AIO-BO 并写入 stats.json（每周一次）
node --env-file=.env export-aiobo.js --update

# 推送 stats.json 到 GitHub Pages
bash push-stats.sh

# 推送代码文件到 GitHub（修改 index.html 等后运行）
export GITHUB_TOKEN=ghp_xxx
bash push-code.sh
```

> `export-stats.js` 不覆盖 `aioBo` 字段；`export-aiobo.js --update` 不覆盖其他字段。两者可独立运行。
