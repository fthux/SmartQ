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

## 当前边界

当前 MVP 使用 JSON 文件持久化，适合早期验证和产品评审。生产化建议后续替换为 PostgreSQL、Redis、对象存储、WebSocket 监考通道、鉴权与角色权限系统。
