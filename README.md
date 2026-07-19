# SmartQ

SmartQ 是一个面向考试与测评内容生产的轻量管理系统。当前版本聚焦命题、题目审核、试卷保存与发布，不再包含参与者、考试分配、在线监考、阅卷分析或考生端。

## 功能范围

- AI 命题：配置考卷名称、出题方向、难度、题型、题量、分值和知识点
- 生成稳定性：规范化 AI 输出并校验题量、题型、总分和必填字段
- 题目质量：质量复检、自动修复、人工审核和题目编辑
- 试卷管理：保存草稿、发布试卷、查看详情、切换当前试卷和删除试卷
- 管理员系统：登录限流和出题、试卷角色权限
- 存储适配：默认 JSON 文件，可选 PostgreSQL JSONB 存储并保留本地镜像

## 项目结构

- `frontend/`：Vue 单页管理控制台
- `backend/`：Node API、AI 封装和运行时存储
- `scripts/`：端到端验证脚本
- `Dockerfile` / `docker-compose.yml`：容器部署配置

运行时数据默认保存到 `backend/data/runtime.json`。加载旧数据时，系统会清除已退役的参与者、分配、考试会话、答卷、监考和阅卷字段。

## 本地运行

```bash
npm start
```

打开：

- 管理控制台：http://localhost:3000
- 健康检查：http://localhost:3000/api/health

登录后默认进入“已出卷子”，可从左侧第二个入口进入“出题制卷”。

默认管理员：

- 账号：`admin`
- 密码：`123456`

正式部署前请修改默认账号密码。

验证：

```bash
npm run check
npm run verify
```

## 环境变量

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
SMARTQ_BACKUP_RETENTION=20
SMARTQ_BACKUP_MIN_INTERVAL_SECONDS=60
SMARTQ_MAX_REQUEST_BYTES=2097152
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

`SMARTQ_ADMIN_ROLE` 支持：

- `admin`：出题和试卷权限
- `author`：出题和试卷权限

`npm run verify` 会使用 `AI_MOCK_MODE=true` 启动临时服务，不会调用真实 AI 接口。

## Docker

```bash
docker compose up -d --build
docker compose ps
```

运行时数据保存在 `smartq-runtime` 命名卷中。
