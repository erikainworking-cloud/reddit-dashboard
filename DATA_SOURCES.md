# 看板数据来源与计算口径说明

> 本文档用于交接说明。看板地址：https://erikainworking-cloud.github.io/reddit-dashboard/
>
> 最后更新：2026-08-03

---

## 一、系统架构概览

```
飞书多维表格（数据存储）
        ↓
export-stats.js（数据拉取脚本，本地运行）
        ↓
stats.json（静态数据文件）
        ↓
GitHub Pages（前端展示，index.html 读取 stats.json）
```

**更新流程**：
1. 运行 `node dashboard/export-stats.js` → 拉取飞书数据，覆盖本地 `stats.json`
2. AIO-BO 部分手动更新 `stats.json`（见第五节）
3. 将 `stats.json` 推送到 GitHub：运行 `bash dashboard/push-stats.sh`

---

## 二、精准词监控（`streamfab` / `dvdfab`）

### 数据来源

| 品牌 | 飞书多维表格 base_token | 表格 table_id |
|------|----------------------|--------------|
| StreamFab | `V2O8bxWe4aX0KGsafuAcrLDGnab` | `tblz9rJi6Pt88bPV` |
| DVDFab | `L9w8bTVofa7d9fsraqJc8e0Cn1b` | `tblz5MSaNKFyEW4D` |

飞书表格链接（需权限）：
- StreamFab：`https://i6a1sqw3p2.feishu.cn/base/V2O8bxWe4aX0KGsafuAcrLDGnab`
- DVDFab：`https://i6a1sqw3p2.feishu.cn/base/L9w8bTVofa7d9fsraqJc8e0Cn1b`

这两张表由 **reddit-exact-term-monitoring-streamfab** Skill 每日自动运行，将 Reddit 帖子/评论抓取并写入。

### 字段说明与计算方式

| stats.json 字段 | 来源字段 | 计算方式 |
|----------------|---------|---------|
| `total` | `处理状态` | COUNT 所有记录 |
| `published` | `处理状态` | COUNT 值为「已发布」的记录 |
| `posts` | `贴子/评论` | COUNT 值为「帖子」的记录 |
| `comments` | `贴子/评论` | COUNT 值为「评论」的记录 |
| `statusCount` | `处理状态` | 按状态值 GROUP BY COUNT |
| `intentCount` | `意图分类` | 按意图值 GROUP BY COUNT |
| `brandMention.YES/NO` | `产品提及` | GROUP BY COUNT，取 YES / NO |
| `topKeywords` | `关键词` | GROUP BY COUNT，取 TOP 15 |
| `dailyTrend` | `抓取时间` | 按日期 GROUP BY COUNT，取最近 60 天 |

---

## 三、品牌舆情监控（`brandMonitoring.streamfab` / `brandMonitoring.dvdfab`）

### 数据来源

| 品牌 | 飞书多维表格 base_token | 表格 table_id |
|------|----------------------|--------------|
| StreamFab | `XrfObyYreaRR48sHAO1cTWDYnne` | `tblSVymHhFLAmo1g` |
| DVDFab | `WBRjbqWf8a8xTBsrabYcfdH7nUc` | `tblHTBcASPK2gNHm` |

这两张表记录的是**提及品牌的 Reddit 帖子**，由运营人员人工处理或 AI 辅助生成回复。

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

---

## 四、第三方付费账号（`paidAccounts`）

### 数据来源

| 飞书多维表格 base_token | 表格 table_id |
|----------------------|--------------|
| `KhAHbJRcNaCq03sxg8Bcw2Pfn1g` | `tblnoKwZHuCNuBCI` |

记录运营团队购买/管理的第三方 Reddit 账号，用于评估账号存活情况。

### 字段说明

| stats.json 字段 | 来源字段 | 计算方式 |
|----------------|---------|---------|
| `total` | `产线` | COUNT 所有记录 |
| `byBrand` | `产线` | GROUP BY COUNT |
| `byType` | `帖子类型` | GROUP BY COUNT（新帖/旧帖）|
| `survive1day` | `存活1天` | GROUP BY COUNT（是/否）|
| `survive7day` | `存活7天` | GROUP BY COUNT（是/否）|

---

## 五、AIO-BO 进度追踪（`aioBo`）

> ⚠️ 此部分**不由 export-stats.js 自动拉取**，需要手动计算后更新 `stats.json`。

### 概念说明

**AIO-BO（AI Overview 反向占位率）**= 在 Google AI Overview（搜索结果顶部 AI 摘要）中，被引用的 Reddit 帖子里提及了我方产品的关键词比例。

```
AIO-BO% = 全链路关键词数 / AIO 触发词总数
```

- **全链路关键词**：监控关键词中，存在一个 Reddit 帖子同时满足：被 AIO 引用 + 提及我方产品
- **AIO 触发词总数（aioTriggerWords）**：监控关键词列表中，曾触发过 AIO 结果的关键词总数（固定分母，不随周次变化）

---

### 5.1 StreamFab AIO-BO

**飞书多维表格**：`https://i6a1sqw3p2.feishu.cn/base/EeTUbRHV3anTKTsvl2dcjaAenBf`

| 表格名 | table_id | 用途 |
|--------|---------|------|
| SERP 排名明细表 | 查询 base 获取 | 每周关键词监控结果，每条记录 = 一个关键词 × 一周 |

**全链路判定条件**（在 SERP 排名明细表中筛选）：
- `来源类别` = `来源引用`（AIO 中被引用）
- `细分来源` ≠ `dvdfab.cn`、`streamfab.com`、`streamfab.dvdfab.cn`、`AIO正文`（排除官方来源）
- `是否提及StreamFab` = `是`

**计算方式**：

```
全链路关键词 = 满足上述条件的记录中，去重后的「关键词」字段值集合

AIO-BO% = |全链路关键词| / aioTriggerWords (177)
```

**周次快照逻辑**（首次进入日期）：

以每周截止日为节点，统计**截至该日期已首次满足全链路的关键词累计数量**。
- 某关键词最早满足全链路的那条记录的日期 = 该关键词的「入链日期」
- 每个周次的全链路数 = 入链日期 ≤ 该周截止日的关键词总数

**已记录的实际值**：

| 周次 | 截止日期 | 全链路KWs | AIO-BO% | 备注 |
|------|---------|-----------|--------|------|
| 基准 | 2026-07-10 | 31 / 176 | 17.61% | Q3 起点 |
| W1 | 2026-07-17 | 32 / 177 | 18.08% | 07/13 新增 `bypass zdf drm` |
| W2 | 2026-07-24 | 32 / 177 | 18.08% | 无新增 |
| W3 | 2026-07-31 | 33 / 177 | 18.64% | 07/28 新增 `bypass vix drm` |

**Q3 目标**：25.0%（44 个全链路关键词 / 177）

---

### 5.2 DVDFab AIO-BO

**飞书多维表格**：`https://i6a1sqw3p2.feishu.cn/base/NnG1bHoZsaYdCzs5Slfch1bQnJb`

| 表格名 | table_id | 用途 |
|--------|---------|------|
| SERP 监控关键词表 | `tblqauW55Cu9NpKp` | 227 个监控关键词列表 |
| SERP Reddit 原始池 | `tblooqdTdeJPnYkY` | 在 SERP/AIO 中出现的 Reddit 帖子池（`来源` 字段区分 SERP / AIO / SERP+AIO）|
| DVDFab 帖子数据源 | `tbluDe1LshaBV3T9` | 在原始池中提及 DVDFab 产品的帖子 |
| SERP 排名明细表 | `tblKnWcmaWAspsVe` | SERP 排名详情，`关联主帖` 字段关联 DVDFab 帖子 |
| DVDFab Reddit 占位率统计 | `tblPIJosQPBHD9bj` | **预聚合统计表，每周 AIO/SERP 覆盖率汇总** |

**全链路判定条件**：

DVDFab 帖子数据源（`tbluDe1LshaBV3T9`）中，`SERP 排名明细表` 关联字段不为空的帖子，即为「DVDFab 全链路帖子」。
这些帖子同时满足：
1. 提及 DVDFab 产品（在 DVDFab 帖子数据源中）
2. 出现在 SERP 排名中（SERP 排名明细表有关联记录）

**计算方式**：

**推荐读法**：直接读取 `DVDFab Reddit 占位率统计`（tblPIJosQPBHD9bj）表：
- 筛选 `来源` = `["AIO"]` 的行
- 取当周 `DVDFab 覆盖关键词数` 字段值 = 分子
- 固定分母 = `aioTriggerWords` = **203**（监控期内曾触发 AIO 的关键词总数）

```
DVDFab AIO-BO% = DVDFab 覆盖关键词数（AIO 行）/ 203
```

> 注意：飞书表内的「DVDFab 占位率」字段使用的是当周 AIO 总池作分母（浮动），与看板使用固定分母 203 不同，两者数值会有差异。

**已记录的实际值**：

| 周次 | 日期 | DVDFab AIO KWs | AIO-BO% (/203) | 备注 |
|------|------|----------------|----------------|------|
| 基准 | 2026-07-15 | 68 | 33.50% | Q3 起点 |
| W1 | 2026-07-24 | — | — | 飞书监控未更新，暂无数据 |
| W2 | 2026-07-31 | — | — | 飞书监控未更新，暂无数据 |

> ⚠️ DVDFab 监控数据最后更新于 2026-07-15（W29），飞书抓取流程需手动/定时触发后数据才会更新。

**Q3 目标**：40.5%（82 个全链路关键词 / 203）

---

## 六、手动更新 AIO-BO 步骤

每次需要更新 AIO-BO 进度时：

### StreamFab

1. 打开飞书多维表格：`EeTUbRHV3anTKTsvl2dcjaAenBf`
2. 在 SERP 排名明细表中，筛选条件：
   - `来源类别` = `来源引用`
   - `细分来源` 排除官方域名
   - `是否提及StreamFab` = `是`
3. 对满足条件的记录，按「关键词」去重，统计每个关键词**最早满足条件的日期**
4. 按周次截止日累计，更新 `stats.json` 中 `aioBo.streamfab.actual` 数组

### DVDFab

1. 打开飞书多维表格：`NnG1bHoZsaYdCzs5Slfch1bQnJb`
2. 查看 `DVDFab Reddit 占位率统计`（tblPIJosQPBHD9bj）表
3. 找到最新周次中 `来源` = `["AIO"]` 的行
4. 读取 `DVDFab 覆盖关键词数`，除以 203，得到 AIO-BO%
5. 更新 `stats.json` 中 `aioBo.dvdfab.actual` 数组

---

## 七、全量刷新 stats.json

```bash
cd dashboard
node export-stats.js        # 拉取飞书数据（精准词+品牌舆情+付费账号）
# 然后手动补充 aioBo 部分（如有更新）
bash push-stats.sh           # 推送到 GitHub Pages
```

> `export-stats.js` 不会覆盖 `aioBo` 字段，因为该字段需手动维护。
>
> ⚠️ 运行 `export-stats.js` 需要本地安装 `lark-cli` 并已登录飞书账号（`lark-cli auth login`）。

---

## 八、数据结构速查

```
stats.json
├── updatedAt               ISO 时间戳，export-stats.js 自动生成
├── streamfab               精准词监控 - StreamFab
├── dvdfab                  精准词监控 - DVDFab
├── brandMonitoring
│   ├── streamfab           品牌舆情 - StreamFab
│   └── dvdfab              品牌舆情 - DVDFab
├── aioBo
│   ├── streamfab           AIO-BO 进度 - StreamFab（手动更新）
│   └── dvdfab              AIO-BO 进度 - DVDFab（手动更新）
└── paidAccounts            第三方付费账号
```
