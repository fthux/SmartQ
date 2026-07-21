# SmartQ

SmartQ 是一个面向智能命题与试卷内容生产的轻量管理系统。当前版本聚焦 AI 命题、题目编辑、题库复用、试卷保存与发布，不再包含参与者、考试分配、在线监考、阅卷分析或考生端。

## SmartQ 小助手

登录控制台后，可从全局页头打开 SmartQ 小助手。助手通过只读工具查询试卷、题库、分类、出题资料、命题工作区等业务数据；普通用户只能查询自己的数据，超级管理员可切换到全系统范围。密码哈希、登录会话、API Key、数据库配置、备份内容和服务器路径不会提供给模型。

基础配置沿用现有 AI 服务：

```env
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=
OPENAI_MODEL=
OPENAI_WIRE_API=responses
SMARTQ_ASSISTANT_ENABLED=true
SMARTQ_ASSISTANT_MODEL=
SMARTQ_ASSISTANT_TIMEOUT_MS=90000
SMARTQ_ASSISTANT_TOOL_RESULT_MAX_BYTES=32768
```

助手会在模型调用前移除头像、令牌、密钥等字段，并将单次工具结果限制在上述字节数内，避免大字段占满模型上下文。

使用 Responses 协议时，`SMARTQ_ASSISTANT_NATIVE_WEB_SEARCH=true` 会启用模型服务提供的原生 `web_search`。也可以配置自有搜索服务：

```env
SMARTQ_WEB_SEARCH_ENDPOINT=
SMARTQ_WEB_SEARCH_API_KEY=
```

自有搜索端点接收 `POST` JSON：`{"query":"关键词","maxResults":5}`，可返回数组，或以 `results`、`data`、`items` 包裹的数组；每项支持 `title`、`url`、`snippet`、`publishedAt` 字段。配置自有端点后会优先使用该端点。开发和自动化验证可设置 `AI_MOCK_MODE=true`，无需连接真实模型。
