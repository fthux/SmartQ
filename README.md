# SmartQ MVP

SmartQ 是一个通用考试 / 测评平台 MVP。当前版本按正式考试流程实现核心闭环：命题配置、AI 出题、质量校验、人工审核、保存试卷、试卷发布、考生分配、在线考试、监考事件、提交即阅卷、主观题复核和分析报告。

## 功能范围

- AI 命题任务：出题方向、数量、难度、题型分布、知识点、总分和补充要求
- AI 输出稳定性：结构规范化、规格一致性检查、总分/题型/数量校验
- 题目质量控制：质量复检、自动修复、人工审核，非法题不能审核通过
- 保存试卷：只使用已校验题目，保存试卷题目 ID 和制卷依据
- 试卷发布：只允许已保存试卷发布给考生
- 考生分配：创建考生会话、准考证唯一校验、卷型与考试时段配置
- 考生端考试：一页展示整卷、保存草稿、提交后自动进入阅卷队列
- 监考状态：心跳、离开页面风险、手动风险记录、多考生状态展示
- 阅卷复核：客观题自动判分，主观题 AI 初评后进入人工复核
- 分析报告：只统计完成复核的成绩，按正式试卷、知识点和风险事件计算

## 项目结构

- `frontend/`：Vue 单页应用和前端交互脚本
- `backend/`：Node API 服务、AI 封装、运行时存储和初始数据
- `scripts/`：端到端验证脚本
- `Dockerfile` / `docker-compose.yml`：Docker 一键部署配置

运行时数据默认保存到 `backend/data/runtime.json`。Docker 部署时保存到命名卷 `smartq-runtime`，不会写入镜像。

## 本地运行

```bash
npm start
```

打开：

- 运营控制台：http://localhost:3000
- 考生端：http://localhost:3000/#/candidate?session=s-001
- 健康检查：http://localhost:3000/api/health

默认运营管理员：

- 账号：`admin`
- 密码：`123456`

正式部署前请通过 `SMARTQ_ADMIN_USER` 和 `SMARTQ_ADMIN_PASSWORD` 修改默认账号密码。

验证核心流程：

```bash
npm run check
npm run verify
```

## Docker 一键部署

项目默认使用真实 AI 出题。部署前先在环境变量或 `.env` 中配置服务端密钥：

```env
OPENAI_BASE_URL=https://edge.ai.minigameland.com/v1
OPENAI_API_KEY=你的服务端密钥
SKYISLAND_API_KEY=你的服务端密钥
OPENAI_MODEL=gpt-5.5
OPENAI_REASONING_EFFORT=high
OPENAI_WIRE_API=responses
AI_MOCK_MODE=false
SMARTQ_ADMIN_USER=admin
SMARTQ_ADMIN_PASSWORD=请改成强密码
SMARTQ_ADMIN_ROLE=admin
SMARTQ_ADMIN_ACCOUNTS=
SMARTQ_STORAGE_ADAPTER=json-file
SMARTQ_DATABASE_URL=
SMARTQ_POSTGRES_TABLE=smartq_runtime
SMARTQ_POSTGRES_KEY=default
SMARTQ_POSTGRES_SSL=
SMARTQ_POSTGRES_TIMEOUT_MS=3000
SMARTQ_EVIDENCE_DIR=
SMARTQ_EVIDENCE_ADAPTER=local-file
SMARTQ_EVIDENCE_BUCKET=
SMARTQ_EVIDENCE_ENDPOINT=
SMARTQ_EVIDENCE_ACCESS_KEY_ID=
SMARTQ_EVIDENCE_SECRET_ACCESS_KEY=
SMARTQ_EVIDENCE_REGION=us-east-1
SMARTQ_EVIDENCE_PREFIX=smartq-evidence
SMARTQ_EVIDENCE_TIMEOUT_MS=5000
SMARTQ_BACKUP_RETENTION=20
SMARTQ_BACKUP_MIN_INTERVAL_SECONDS=60
SMARTQ_ONLINE_TTL_SECONDS=45
SMARTQ_PRESENCE_ADAPTER=memory
SMARTQ_REDIS_URL=
SMARTQ_REDIS_NAMESPACE=smartq
SMARTQ_REDIS_TIMEOUT_MS=500
SMARTQ_MAX_REQUEST_BYTES=2097152
SMARTQ_MAX_EVIDENCE_BYTES=524288
SMARTQ_LOGIN_MAX_FAILURES=5
SMARTQ_LOGIN_WINDOW_SECONDS=900
SMARTQ_LOGIN_LOCK_SECONDS=600
```

启动：

```bash
docker compose up -d --build
```

查看状态：

```bash
docker compose ps
```

停止服务：

```bash
docker compose down
```

运行时数据保存在 Docker 命名卷 `smartq-runtime` 中。需要清空演示数据时再手动删除该卷。

## AI 配置

项目使用 OpenAI API 兼容方式。密钥只放在服务端 `.env` 或部署环境变量中，不会展示在 UI。

```env
PORT=3000
SMARTQ_ADMIN_USER=admin
SMARTQ_ADMIN_PASSWORD=123456
SMARTQ_ADMIN_ROLE=admin
SMARTQ_ADMIN_ACCOUNTS=
SMARTQ_STORAGE_ADAPTER=json-file
SMARTQ_DATABASE_URL=
SMARTQ_POSTGRES_TABLE=smartq_runtime
SMARTQ_POSTGRES_KEY=default
SMARTQ_POSTGRES_SSL=
SMARTQ_POSTGRES_TIMEOUT_MS=3000
SMARTQ_DATA_FILE=backend/data/runtime.json
SMARTQ_BACKUP_DIR=backend/data/backups
SMARTQ_EVIDENCE_DIR=backend/data/evidence
SMARTQ_EVIDENCE_ADAPTER=local-file
SMARTQ_EVIDENCE_BUCKET=
SMARTQ_EVIDENCE_ENDPOINT=
SMARTQ_EVIDENCE_ACCESS_KEY_ID=
SMARTQ_EVIDENCE_SECRET_ACCESS_KEY=
SMARTQ_EVIDENCE_REGION=us-east-1
SMARTQ_EVIDENCE_PREFIX=smartq-evidence
SMARTQ_EVIDENCE_TIMEOUT_MS=5000
SMARTQ_BACKUP_RETENTION=20
SMARTQ_BACKUP_MIN_INTERVAL_SECONDS=60
SMARTQ_ONLINE_TTL_SECONDS=45
SMARTQ_PRESENCE_ADAPTER=memory
SMARTQ_REDIS_URL=
SMARTQ_REDIS_NAMESPACE=smartq
SMARTQ_REDIS_TIMEOUT_MS=500
SMARTQ_MAX_EVIDENCE_BYTES=524288
SMARTQ_LOGIN_MAX_FAILURES=5
SMARTQ_LOGIN_WINDOW_SECONDS=900
SMARTQ_LOGIN_LOCK_SECONDS=600
OPENAI_BASE_URL=https://edge.ai.minigameland.com/v1
OPENAI_API_KEY=
SKYISLAND_API_KEY=
OPENAI_MODEL=gpt-5.5
OPENAI_REASONING_EFFORT=high
OPENAI_WIRE_API=responses
AI_MOCK_MODE=false
```

本地接入真实 AI 服务：

```bash
cp .env.example .env
```

然后设置：

```env
OPENAI_API_KEY=你的服务端密钥
SKYISLAND_API_KEY=你的服务端密钥
AI_MOCK_MODE=false
```

本地 `npm start` 会自动读取项目根目录 `.env`。如果同名环境变量已经由 shell、Docker 或部署平台注入，则优先使用外部环境变量，不会被 `.env` 覆盖。

`OPENAI_WIRE_API=responses` 会请求 `${OPENAI_BASE_URL}/responses`，与 Codex 中 `wire_api = "responses"` 的配置一致。需要兼容传统 Chat Completions 服务时，可改为 `OPENAI_WIRE_API=chat`。

`npm run verify` 会显式使用 `AI_MOCK_MODE=true` 启动临时验证服务，避免自动化测试消耗真实 AI 接口；正常启动和 Docker 部署默认不会使用 mock。

## 安全基线

- 运营控制台支持角色权限。默认单账号使用 `SMARTQ_ADMIN_USER`、`SMARTQ_ADMIN_PASSWORD`、`SMARTQ_ADMIN_ROLE`。
- 多账号可通过 `SMARTQ_ADMIN_ACCOUNTS` 配置 JSON，例如：

```json
[
  { "username": "admin", "password": "change-me", "role": "admin" },
  { "username": "proctor", "password": "change-me", "role": "proctor" },
  { "username": "grader", "password": "change-me", "role": "grader" }
]
```

- 内置角色：`admin` 全权限，`author` 出题/试卷/分析，`operator` 参与者/分配/监考/分析，`proctor` 仅监考，`grader` 阅卷/分析，`analyst` 仅分析。
- 运营控制台和考生系统登录都启用失败限流。默认 15 分钟窗口内失败 5 次后锁定 10 分钟。
- 限流参数可通过 `SMARTQ_LOGIN_MAX_FAILURES`、`SMARTQ_LOGIN_WINDOW_SECONDS`、`SMARTQ_LOGIN_LOCK_SECONDS` 调整。
- 监考在线状态由 presence store 承载，默认内存适配器 `SMARTQ_PRESENCE_ADAPTER=memory`；默认 45 秒无心跳显示离线，可通过 `SMARTQ_ONLINE_TTL_SECONDS` 调整。
- 配置 `SMARTQ_PRESENCE_ADAPTER=redis` 与 `SMARTQ_REDIS_URL` 后，考生心跳会写入 Redis 并可跨进程共享监考在线状态；Redis 不可达时会在 `/api/health` 中标记降级并继续使用本进程内存镜像。
- 普通 keepalive 心跳不再每次写入 `runtime.json`；只有首次进入答题中、进度/设备变化或风险信号才持久化，减少高频 I/O。
- 监考工作台支持 SSE 实时事件通道 `/api/proctor/stream`，有 `proctor` 权限的账号可连接；8 秒轮询仍作为兜底。
- 监考证据附件默认保存到 `SMARTQ_EVIDENCE_DIR`，未配置时使用本地 `backend/data/evidence`；单个附件大小通过 `SMARTQ_MAX_EVIDENCE_BYTES` 限制。
- 配置 `SMARTQ_EVIDENCE_ADAPTER=s3|object-storage`、`SMARTQ_EVIDENCE_ENDPOINT`、`SMARTQ_EVIDENCE_BUCKET` 和访问密钥后，证据附件会上传到 S3 兼容对象存储；对象存储不可达时会降级写入本地文件，并在 `/api/health` 标记。
- 监考取证报告会基于风险事件、设备状态、证据附件、提交来源和答题覆盖自动生成风险分、异常发现和处置建议，辅助监考员复核。
- API 请求体默认限制为 2MB，可通过 `SMARTQ_MAX_REQUEST_BYTES` 调整；超限请求会返回 `413`，避免大 JSON 导入或恢复压垮进程。
- 当前持久化适配器默认为 `SMARTQ_STORAGE_ADAPTER=json-file`。配置 `SMARTQ_DATABASE_URL` 或 `SMARTQ_STORAGE_ADAPTER=postgres` 后，运行时状态会写入 PostgreSQL JSONB 文档表；同时保留本地 JSON 镜像和自动备份，便于下载、恢复和故障兜底。基础适配器支持 trust、明文密码和 MD5 认证，SCRAM、连接池和关系化迁移仍建议在大规模生产部署前补强。
- JSON、静态资源和 SSE 响应会附带基础安全响应头，包括 `X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy` 和 `Permissions-Policy`。
- 登录失败、被限流、成功登录和退出都会写入审计日志。
- `system` 权限账号可在首页“数据维护”面板查看运营会话、撤销异常会话、检索并导出审计日志。
- 运行时备份会剔除管理员会话和登录限流状态，避免把当前 token 或临时锁定信息带到备份文件中。

## 数据维护

运营控制台首页提供“数据维护”面板：

- 查看当前运行时存储适配器、PostgreSQL 可达性、本地镜像文件状态、大小和更新时间。
- 下载完整运行时备份 JSON。备份会自动移除管理员会话，不会导出当前登录 token。
- 粘贴备份 JSON 并输入 `RESTORE` 后恢复数据。
- 查看自动备份历史并下载任一历史 JSON。系统写入运行时数据前会保留上一版文件，默认至少间隔 60 秒生成一份自动备份，避免心跳高频写入造成大量 I/O；保留数量通过 `SMARTQ_BACKUP_RETENTION` 调整，间隔通过 `SMARTQ_BACKUP_MIN_INTERVAL_SECONDS` 调整。
- 查看当前运营会话，必要时撤销异常登录。
- 按类型或关键词检索审计日志，并导出为表格。
- 查看运维告警与检查项。`/api/admin/ops` 会汇总 AI、存储、Redis 在线状态、证据存储、备份、监考风险和阅卷待办，返回机器可读的 `status`、`metrics`、`alerts` 和 `checks`。

恢复备份会替换当前运行时数据，并清空管理员登录会话；恢复完成后需要重新登录运营控制台。建议在正式考试前、批量导入前、发布试卷前和考试结束后各保留一份备份。

`/api/health` 会返回 AI 模式、存储状态、备份数量和监考在线 TTL，便于容器健康检查或反向代理探活。

## 正式流程

1. 在运营控制台填写 AI 命题任务并生成试卷。
2. 执行质量复检，必要时自动修复。
3. 人工审核题目，只有结构合法题目才能标记为已校验。
4. 使用已校验题目保存试卷。
5. 发布试卷。
6. 分配考生考试会话并复制考生入口。
7. 考生进入页面，开始答题后进入答题中状态。
8. 考生提交后，后端自动阅卷并生成主观题复核队列。
9. 运营端完成人工复核。
10. 分析报告基于已完成复核的成绩生成。

当题库、题目内容、质量修复或正式试卷结构发生变化时，系统会清空旧答卷、旧阅卷结果和旧分析范围，并将考生考试状态重置为待开考，避免新试卷混用旧成绩。

## 上线检查清单

- 修改默认管理员账号密码，避免使用 `admin / 123456`。
- 按组织分工配置运营角色，避免监考员、阅卷员使用全权限账号。
- 按考试风险设置登录限流参数，确认不会误伤正式考生批量登录。
- 考试前检查运营会话列表，撤销不再使用的登录。
- 定期导出审计日志，留存出题、发布、监考处置、阅卷复核和系统维护记录。
- 配置真实 AI 服务密钥，并确认 `AI_MOCK_MODE=false`。
- 执行 `npm run check` 和 `npm run verify`。
- 在运营控制台下载一次初始备份，确认备份文件可安全保存。
- 使用 HTTPS 或反向代理保护公网访问。
- 对正式考试场景，优先配置 PostgreSQL、Redis presence 和对象存储，并提前压测并发写入、备份恢复和监考证据上传。

## 当前边界

当前版本已形成完整考试闭环，并提供基础 PostgreSQL JSONB 运行时存储、Redis presence、S3 兼容证据存储、SSE 监考事件、角色权限、审计日志、备份恢复和运维检查。它仍是 MVP 形态：PostgreSQL 目前保存整份运行时 JSON 文档，尚未拆成关系化表结构；大规模生产部署前建议补齐连接池、数据库迁移、SCRAM/托管数据库兼容性压测、更细粒度监控告警和更完整的前端可访问性优化。
