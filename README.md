# Ascend-Reddit 运营看板

StreamFab & DVDFab 的 Reddit 舆情监控与 AIO-BO 追踪看板，基于 GitHub Pages 静态托管，数据源自飞书多维表格（通过 lark-cli 抓取）。

---

## 环境要求

- **Node.js ≥ 18**
- **lark-cli**（飞书命令行工具）：需已登录飞书账号
  ```bash
  npm install -g @larksuite/cli
  lark-cli auth login
  ```

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
| `GITHUB_TOKEN` | 推送 stats.json 到 GitHub（仅本地手动同步时需要） | 本地推送必需 |
| `LARK_CLI` | 覆盖 lark-cli 路径（默认自动探测） | 可选 |
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
node export-stats.js
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

`.github/workflows/update-stats.yml` 在每天 UTC 02:00 / 10:00 / 18:00（北京时间 10:00 / 18:00 / 02:00）自动运行，无需手动干预。

**首次配置**：在仓库 Settings → Secrets → Actions 中添加：

| Secret | 说明 |
|--------|------|
| `LARK_TOKEN` | 飞书用户 token（通过 `lark-cli auth status` 获取） |

也可手动触发：GitHub Actions 页面 → Update Stats → Run workflow。

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

## 数据源说明

详见 [DATA_SOURCES.md](DATA_SOURCES.md)。

---

## 故障排查

### 飞书数据为空 / 抓取失败

1. 检查 lark-cli 是否登录：`lark-cli auth status`
2. 检查飞书账号是否有对应多维表格的查看权限
3. 检查 `stats.json` 是否存在并格式正确：`node -e "require('./stats.json')" && echo OK`

### GitHub Actions 失败

1. 检查 `LARK_TOKEN` Secret 是否设置，token 是否过期（飞书用户 token 有效期约 2 小时，每次 `lark-cli auth login` 刷新）
2. 查看 Actions 日志中 `Export stats from Feishu` 步骤的错误输出
3. 如果是权限问题，确认 workflow 中 `permissions: contents: write` 已配置

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
| `stats.json` | 看板数据（不提交到仓库，由 Actions 自动更新） |
| `.env.example` | 环境变量模板 |
| `.github/workflows/update-stats.yml` | 定时自动更新 GitHub Actions |
