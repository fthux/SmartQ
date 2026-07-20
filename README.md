# SmartQ

SmartQ 是一个面向考试与测评内容生产的轻量管理系统。当前版本聚焦命题、题目审核、试卷保存与发布，不再包含参与者、考试分配、在线监考、阅卷分析或考生端。

## 功能范围

- AI 命题：配置考卷名称、出题方向、难度、题型、题量、分值和知识点
- 出题资料：管理文本、TXT、Markdown、PDF 和 DOCX 资料，支持多选资料及资料题/AI 独立题配额
- 题库管理：支持人工建题、审核题目入库、试卷题目入库、自动去重、版本记录和试卷使用关系
- 题目复用：同一道题从多套试卷入库时只保留一条题库记录，各试卷仍保存独立题目快照
- 来源追溯：资料题保存资料版本和引用片段，人工修改及历史试卷仍保留来源记录
- 生成稳定性：规范化 AI 输出并校验题量、题型、总分和必填字段
- 题目质量：质量复检、自动修复、人工审核和题目编辑
- 试卷管理：保存草稿、发布试卷、查看详情、切换当前试卷和删除试卷
- 用户管理：创建、编辑、启停、重置密码和强制下线
- 账号安全：登录限流和 scrypt 密码哈希
- 存储适配：默认 JSON 文件，可选 PostgreSQL JSONB 存储并保留本地镜像

## 项目结构

- `frontend/`：Vite + Vue 3 SFC + Element Plus 单页管理控制台
- `backend/`：Node API、AI 封装和运行时存储
- `scripts/`：端到端验证脚本
- `Dockerfile` / `docker-compose.yml`：容器部署配置

运行时数据默认保存到 `backend/data/runtime.json`。加载旧数据时，系统会清除已退役的参与者、分配、考试会话、答卷、监考和阅卷字段。

## 本地运行

```bash
npm install
npm run dev
```

打开：

- 管理控制台：http://localhost:5173
- 健康检查：http://localhost:3000/api/health

登录后默认进入“已出卷子”，可从左侧第二个入口进入“出题制卷”。

默认管理员：

- 账号：`admin`
- 密码：`123456`

默认账号可以直接登录。正式部署前请通过环境变量设置独立的初始管理员账号和密码。

验证：

```bash
npm run check
npm run verify
```

生产运行前先构建前端：

```bash
npm run build
npm start
```

## 环境变量

```env
PORT=3000
SMARTQ_ADMIN_USER=admin
SMARTQ_ADMIN_PASSWORD=123456
SMARTQ_ADMIN_ACCOUNTS=
SMARTQ_STORAGE_ADAPTER=json-file
SMARTQ_DATABASE_URL=
SMARTQ_POSTGRES_TABLE=smartq_runtime
SMARTQ_POSTGRES_KEY=default
SMARTQ_POSTGRES_SSL=
SMARTQ_POSTGRES_TIMEOUT_MS=3000
SMARTQ_DATA_FILE=backend/data/runtime.json
SMARTQ_BACKUP_DIR=backend/data/backups
SMARTQ_BACKUP_RETENTION=20
SMARTQ_BACKUP_MIN_INTERVAL_SECONDS=60
SMARTQ_MAX_REQUEST_BYTES=2097152
SMARTQ_MATERIAL_DIR=backend/data/materials
SMARTQ_MATERIAL_FILE_MAX_BYTES=8388608
SMARTQ_MATERIAL_TEXT_MAX_CHARS=400000
SMARTQ_LOGIN_MAX_FAILURES=5
SMARTQ_LOGIN_WINDOW_SECONDS=900
SMARTQ_LOGIN_LOCK_SECONDS=600
OPENAI_BASE_URL=
OPENAI_API_KEY=
SKYISLAND_API_KEY=
OPENAI_MODEL=gpt-5.5
OPENAI_REASONING_EFFORT=high
OPENAI_WIRE_API=responses
AI_MOCK_MODE=false
```

`SMARTQ_ADMIN_USER`、`SMARTQ_ADMIN_PASSWORD` 和 `SMARTQ_ADMIN_ACCOUNTS` 只用于首次初始化账号。初始化完成后，账号和密码以运行时存储中的 `adminUsers` 为准；已有 `adminProfiles` 会自动合并到对应用户，旧会话会失效。所有有效账号均可使用完整控制台功能，密码只以 scrypt 哈希保存，不会把环境变量中的明文密码写入运行时文件。

出题资料元数据保存在运行时状态中，原始文件和解析后的版本正文保存在 `SMARTQ_MATERIAL_DIR`。Docker 默认将其放入与 `runtime.json` 相同的持久卷。单个文件默认最大 8 MB，单份解析正文默认最多 40 万字符。

`npm run verify` 会使用 `AI_MOCK_MODE=true` 启动临时服务，不会调用真实 AI 接口。

## Docker

```bash
docker compose up -d --build
docker compose ps
```

运行时数据保存在 `smartq-runtime` 命名卷中。
