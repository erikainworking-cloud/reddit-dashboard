# Ascend-Reddit 运营看板

StreamFab & DVDFab 的 Reddit 舆情监控与 AIO-BO 追踪看板，基于 GitHub Pages 静态托管，数据源自飞书多维表格（通过飞书 Open API 抓取）。

---

## 环境要求

- **Node.js ≥ 18**
- **飞书企业自建应用凭证**：`LARK_APP_ID`、`LARK_APP_SECRET`（应用需具备多维表格读取权限，且已加入所有源数据表）

---

## 本地运行

### 1. 安装依赖

```bash
cd dashboard
npm ci
```

### 2. 配置环境变量

复制 `.env.example` 并填写缺省值：

```bash
cp .env.example .env
# 手动编辑 .env，填写 GITHUB_TOKEN 等
```

| 变量 | 用途 | 必需 |
|------|------|------|
| `LARK_APP_ID` | 飞书企业自建应用 App ID，用于读取多维表格 | export-stats.js 必需 |
| `LARK_APP_SECRET` | 飞书企业自建应用 App Secret，用于换取短期访问令牌 | export-stats.js 必需 |
| `GITHUB_TOKEN` | 推送 stats.json 到 GitHub（仅本地手动同步时需要） | 本地推送必需 |
| `SF_SERP_TABLE_ID` | StreamFab SERP 排名明细表 table_id（首次配置时使用） | export-aiobo.js 必需 |

> **注意**：`.env` 已在 `.gitignore` 中，不会提交到仓库。

> ⚠️ **Node.js 不会自动读取 `.env` 文件。** 运行脚本时需要用以下任一方式加载环境变量：
>
> **方式一（推荐，Node ≥ 20.6.0）**：
> ```bash
> node --env-file=.env export-aiobo.js --update
> node --env-file=.env export-stats.js
> ```
>
> **方式二（Shell 加载，兼容所有 Node 版本）**：
> ```bash
> set -a; source .env; set +a
> node export-aiobo.js --update
> ```
>
> **方式三（单次临时注入）**：
> ```bash
> GITHUB_TOKEN=ghp_xxx SF_SERP_TABLE_ID=tblYYY node export-aiobo.js --update
> ```

### 3. 抓取飞书数据

```bash
node --env-file=.env export-stats.js
```

运行完成后生成 `stats.json`（原子写入，先写 `stats.json.next` 再重命名，防止中途读取到残缺文件）。

### 4. 本地预览看板

```bash
python3 -m http.server 8000
# 访问 http://localhost:8000
```

---

## 更新工作流

### 方式一：GitHub Actions 自动更新（推荐）

`.github/workflows/update-stats.yml` 在 GitHub-hosted runner（`ubuntu-latest`）上每天 UTC 02:00 / 10:00 / 18:00 自动运行，对应北京时间 10:00 / 18:00 / 次日 02:00；无需本机在线或 lark-cli 登录。

**首次配置**：在仓库 **Settings → Secrets and variables → Actions** 中添加：

| Secret | 说明 |
|--------|------|
| `LARK_APP_ID` | 飞书企业自建应用的 App ID |
| `LARK_APP_SECRET` | 飞书企业自建应用的 App Secret |

应用必须已发布/启用、具备多维表格读取权限，且已被添加为所有源多维表格的协作者。工作流只在运行中换取短期 tenant access token，不会将凭证写入仓库或页面。

也可手动触发：GitHub Actions 页面 → Update Stats → Run workflow。成功运行会仅在 `stats.json` 有变化时提交并推送，随后触发 GitHub Pages 部署。

### 方式二：本地手动同步

```bash
export GITHUB_TOKEN=<your_token>
bash push-stats.sh
```

脚本会自动调用 `export-stats.js` 抓取数据，然后通过 GitHub API 推送 `stats.json`。

### AIO-BO 半自动化更新

AIO-BO 指标需要从 SERP 数据手动触发计算（每周一次）：

```bash
# 预览模式（不写入）
node export-aiobo.js

# 写入 stats.json
node export-aiobo.js --update

# 发现 StreamFab SERP 数据表 ID（首次配置时使用）
node export-aiobo.js --list-tables-sf
```

发现表 ID 后，将 `SF_SERP_TABLE_ID` 写入 `.env`，然后通过以下方式运行：

```bash
# 推荐（Node >= 20.6.0）
node --env-file=.env export-aiobo.js --update

# 或临时注入
SF_SERP_TABLE_ID=tblXXX node export-aiobo.js --update
```

---

## 竞品监控周报

看板的「竞品监控」页面读取 [竞品监控多维表格](https://i6a1sqw3p2.feishu.cn/base/Y1uAbFprUawDWKsSoOucyvhPnrc?table=tblJ98nNIyyxI1KL&view=vewSBgAnvb) 中的「日报表」日聚合数据，监控 TunePat、Movpilot、Audials、Playon、Keeprix、Tunefab 与其他品牌的每日提及数。

- **比较口径**：最近一个已完整结束的自然周（周一至周日）对比前一个完整自然周；不把进行中的本周计入周报。
- **数据质量提醒**：若最近完整自然周没有任何日报记录，`export-stats.js` 会写入 warning，前端顶部会展示提示。
- **每周推送**：`.github/workflows/push-competitor-card.yml` 在每周一 09:00（北京时间，UTC 01:00）发送卡片。默认发往现有测试群；正式接收人尚未配置前，不会猜测或使用生产群。

本地测试（会真正发送卡片，建议指定测试群或用户）：

```bash
node --env-file=.env push-lark-competitor.js --chat-id oc_xxx
# 或使用默认测试群
node --env-file=.env push-lark-competitor.js
```

卡片包含本周/上周总提及、增长与下降最明显的竞品，以及看板和多维表格的直达链接。应用需同时拥有该竞品 Base 的读取权限与向目标群发消息的权限。

## 数据源说明

详见 [DATA_SOURCES.md](DATA_SOURCES.md)。

---

## 故障排查

### 飞书数据为空 / 抓取失败

1. 检查 `LARK_APP_ID` / `LARK_APP_SECRET` 是否正确，且 App Secret 未过期或被轮换
2. 检查飞书应用已启用、具备多维表格读取权限，并已加入所有源数据表的协作者
3. 检查 `stats.json` 是否存在并格式正确：`node -e "require('./stats.json')" && echo OK`

### GitHub Actions 失败

1. 检查 `LARK_APP_ID`、`LARK_APP_SECRET` 两个 Actions Secret 是否设置且与当前飞书应用匹配
2. 查看 Actions 日志中 `Export stats from Feishu` 步骤的错误输出
3. 如果是推送问题，确认 workflow 中 `permissions: contents: write` 已配置

### 看板图表空白

- 打开浏览器开发者工具 Console，查看 JS 报错
- 确认 `stats.json` 可以正常访问（GitHub Pages 需等待部署完成，约 1-2 分钟）
- 本地预览时需通过 HTTP server 访问，不能直接打开 `index.html` 文件（fetch 受 CORS 限制）

### 数据质量告警（看板顶部红色/黄色横幅）

- **error（红色）**：数据存在明显异常，建议立即排查
  - `dailyTrend 包含未来日期`：检查飞书表格中的日期字段是否填写有误
  - `总量骤降`：可能是飞书数据同步中断，或查询条件变更
- **warning（黄色）**：轻微不一致，不影响使用但建议关注
  - `最近3天无抓取记录`：检查监控任务是否正常运行
  - `帖子+评论总和与总量差异超10%`：正常情况下两者应相近

### stats.json 格式错误

如遇文件损坏（上次写入中断），直接删除 `stats.json` 并重新运行 `node export-stats.js`。写入采用原子操作（`.next` 临时文件），正常运行不会产生损坏文件。

---

## 主要文件

| 文件 | 说明 |
|------|------|
| `index.html` | 看板前端，单文件，通过 fetch 读取 stats.json |
| `export-stats.js` | 从飞书抓取核心指标，生成 stats.json |
| `export-aiobo.js` | AIO-BO 半自动化计算，结果写入 stats.json |
| `push-stats.sh` | 本地手动推送脚本 |
| `stats.json` | 看板数据（由 Actions 自动更新并提交，以触发 Pages 部署） |
| `.env.example` | 环境变量模板 |
| `.github/workflows/update-stats.yml` | 定时自动更新 GitHub Actions |
