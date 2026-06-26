import { questions } from "../data/store.js";

const defaultBaseUrl = "https://edge.ai.minigameland.com/v1";
const questionTypes = ["单选", "多选", "判断", "填空", "简答", "论述"];
const typeCountKeys = {
  单选: ["single", "singleChoice", "单选", "单选题"],
  多选: ["multiple", "multipleChoice", "多选", "多选题"],
  判断: ["judge", "judgement", "trueFalse", "判断", "判断题"],
  填空: ["blank", "fillBlank", "填空", "填空题"],
  简答: ["short", "shortAnswer", "简答", "简答题"],
  论述: ["essay", "discussion", "论述", "论述题"],
};

export function aiConfig() {
  return {
    baseUrl: process.env.OPENAI_BASE_URL || defaultBaseUrl,
    apiKey: process.env.OPENAI_API_KEY || process.env.SKYISLAND_API_KEY || "",
    model: process.env.OPENAI_MODEL || "gpt-5.5",
    reasoningEffort: process.env.OPENAI_REASONING_EFFORT || "high",
    wireApi: process.env.OPENAI_WIRE_API || "responses",
    mockMode: process.env.AI_MOCK_MODE === "true",
  };
}

export async function generateQuestions(spec = {}) {
  const config = aiConfig();
  const normalizedSpec = normalizeGenerationSpec(spec);
  if (config.mockMode) {
    const generated = generateMockQuestions(normalizedSpec);
    const finalized = finalizeGeneratedQuestions(generated, normalizedSpec);
    return {
      source: "mock",
      spec: normalizedSpec,
      ...finalized,
    };
  }
  if (!config.apiKey) {
    throw new Error("OPENAI_API_KEY 或 SKYISLAND_API_KEY 未配置，无法使用真实 AI 出题");
  }

  const prompt = [
    "你是严谨的考试命题专家。只允许输出 JSON，不允许输出 Markdown 或解释文本。",
    "JSON 根对象必须是 {\"questions\":[...]}，questions 必须是题目数组。",
    "每道题字段必须包含 id,type,stem,options,answer,score,difficulty,knowledge,explanation,rubric。",
    `考试目标：${normalizedSpec.title}`,
    `出题方向：${normalizedSpec.direction}`,
    `题目数量：${normalizedSpec.count}`,
    `目标难度：${normalizedSpec.difficulty}`,
    `总分：${normalizedSpec.totalScore}`,
    `题型分布：${normalizedSpec.typeMixText}`,
    `知识点范围：${normalizedSpec.knowledge.join("、")}`,
    `补充要求：${normalizedSpec.requirements || "无"}`,
    "要求：严格按题型分布和总分生成；选择题答案用 A/B/C/D，多选答案为数组；判断题答案只用“正确”或“错误”；主观题必须给 rubric；答案唯一或评分规则明确；不输出多余文本。",
    "自检要求：输出前逐题核对题干事实、选项、答案和解析是否一致；如果无法确认客观题答案，必须改写成可确定答案的题目。",
    "事实边界示例：localStorage/sessionStorage 不会随 HTTP 请求自动发送到服务器；Cookie 才会在满足 domain/path/SameSite/Secure 等条件时由浏览器随请求携带。",
  ].join("\n");

  let response;
  try {
    const request = buildAiRequest(config, prompt);
    response = await fetch(request.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(request.body),
    });
  } catch (error) {
    const cause = error.cause;
    const detail = [
      cause?.code,
      cause?.message,
    ].filter(Boolean).join(" · ");
    const timeout = detail.includes("UND_ERR_CONNECT_TIMEOUT") || detail.includes("Connect Timeout");
    const hint = timeout
      ? "AI 服务连接超时，请检查服务器网络是否能访问 edge.ai.minigameland.com:443，或确认 OPENAI_BASE_URL 服务可用"
      : "请检查 OPENAI_BASE_URL、网络、DNS、代理或服务端证书配置";
    const wrapped = new Error(`AI 出题服务连接失败：${hint}${detail ? `（${detail}）` : ""}`);
    wrapped.statusCode = 502;
    throw wrapped;
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`AI 出题请求失败：${response.status}${text ? ` ${text.slice(0, 180)}` : ""}`);
  }

  const payload = await response.json();
  const content = extractMessageContent(payload);
  const parsed = parseAiJson(content);
  if (parsed?.error) {
    const message = parsed.error.message || parsed.error.type || "AI 上游返回错误";
    throw new Error(`AI 出题请求失败：${message}`);
  }
  const generated = extractGeneratedQuestions(parsed);
  if (!generated.length) {
    throw new Error(`AI 返回内容中没有可识别的试题数组：${summarizeAiShape(parsed, content)}`);
  }
  const finalized = finalizeGeneratedQuestions(generated, normalizedSpec);

  return {
    source: "provider",
    spec: normalizedSpec,
    ...finalized,
  };
}

function buildAiRequest(config, prompt) {
  const baseUrl = String(config.baseUrl || "").replace(/\/+$/, "");
  if (config.wireApi === "chat") {
    return {
      url: `${baseUrl}/chat/completions`,
      body: {
        model: config.model,
        reasoning_effort: config.reasoningEffort,
        messages: [
          { role: "system", content: "输出稳定、可校验的考试题目 JSON。" },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
      },
    };
  }
  return {
    url: `${baseUrl}/responses`,
    body: {
      model: config.model,
      reasoning: { effort: config.reasoningEffort },
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: "输出稳定、可校验的考试题目 JSON。" }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: prompt }],
        },
      ],
      text: {
        format: { type: "json_object" },
      },
    },
  };
}

function extractMessageContent(payload) {
  const content =
    payload?.output_text ??
    payload?.choices?.[0]?.message?.content ??
    payload?.choices?.[0]?.text ??
    extractResponsesOutputText(payload) ??
    "";
  if (Array.isArray(content)) {
    return content.map((item) => (typeof item === "string" ? item : item?.text || item?.content || "")).join("");
  }
  return String(content || "");
}

function extractResponsesOutputText(payload) {
  const output = Array.isArray(payload?.output) ? payload.output : [];
  return output
    .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
    .map((item) => item.text || item.content || "")
    .filter(Boolean)
    .join("");
}

function parseAiJson(content) {
  const text = String(content || "").trim();
  if (!text) throw new Error("AI 返回内容为空");
  try {
    return JSON.parse(text);
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return JSON.parse(fenced[1]);
    const objectValue = parseJsonSlice(text, "{", "}");
    if (objectValue) return objectValue;
    const arrayValue = parseJsonSlice(text, "[", "]");
    if (arrayValue) return arrayValue;
    throw new Error("AI 返回内容不是可解析的 JSON");
  }
}

function parseJsonSlice(text, startChar, endChar) {
  const start = text.indexOf(startChar);
  const end = text.lastIndexOf(endChar);
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function extractGeneratedQuestions(parsed) {
  if (Array.isArray(parsed)) return parsed.filter(isQuestionLike);
  const candidates = [
    parsed?.questions,
    parsed?.paper?.questions,
    parsed?.exam?.questions,
    parsed?.data?.questions,
    parsed?.result?.questions,
    parsed?.output?.questions,
    parsed?.items,
    parsed?.paper?.items,
    parsed?.exam?.items,
    parsed?.data?.items,
    parsed?.result?.items,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.some(isQuestionLike)) return candidate;
  }
  return findQuestionArray(parsed);
}

function isQuestionLike(item) {
  if (!item || typeof item !== "object") return false;
  return Boolean(
    item.stem ||
    item.question ||
    item.prompt ||
    item.content ||
    item.title ||
    item.type ||
    item.answer !== undefined ||
    item.correctAnswer !== undefined,
  );
}

function findQuestionArray(value, depth = 0) {
  if (depth > 6 || !value) return [];
  if (Array.isArray(value)) {
    if (value.some(isQuestionLike)) return value;
    for (const item of value) {
      const nested = findQuestionArray(item, depth + 1);
      if (nested.length) return nested;
    }
    return [];
  }
  if (typeof value !== "object") return [];
  for (const nestedValue of Object.values(value)) {
    const nested = findQuestionArray(nestedValue, depth + 1);
    if (nested.length) return nested;
  }
  return [];
}

function summarizeAiShape(parsed, rawContent) {
  if (!parsed || typeof parsed !== "object") return String(rawContent || "").slice(0, 180);
  const keys = Object.keys(parsed).slice(0, 12).join(", ") || "无顶层字段";
  const preview = JSON.stringify(parsed).slice(0, 220);
  return `顶层字段：${keys}；内容预览：${preview}`;
}

export function buildPaper(sourceQuestions = questions, meta = {}) {
  if (!meta.id && !Array.isArray(meta.questionIds)) {
    return emptyPaper(meta);
  }
  const targetScore = clampNumber(meta.targetScore || meta.buildSpec?.targetScore, 1, 200, 50);
  const selected = selectPaperQuestions(sourceQuestions, meta);
  const score = selected.reduce((total, item) => total + Number(item.score || 0), 0);
  const typeGroups = selected.reduce((acc, item) => {
    acc[item.type] = (acc[item.type] || 0) + 1;
    return acc;
  }, {});

  return {
    id: meta.id || null,
    name: meta.name || "",
    status: meta.status || null,
    publishedAt: meta.publishedAt || null,
    questionIds: selected.map((item) => item.id),
    buildSpec: meta.buildSpec || { targetScore, source: "preview" },
    score,
    questionCount: selected.length,
    typeGroups,
    questions: selected,
  };
}

function emptyPaper(meta = {}) {
  return {
    id: meta.id || null,
    name: meta.name || "",
    status: meta.status || null,
    publishedAt: meta.publishedAt || null,
    questionIds: [],
    buildSpec: meta.buildSpec || null,
    score: 0,
    questionCount: 0,
    typeGroups: {},
    questions: [],
  };
}

export function saveFormalPaper(sourceQuestions = questions, meta = {}) {
  const eligible = sourceQuestions.filter((item) => item.status === "已校验");
  const pending = sourceQuestions.length - eligible.length;
  if (!eligible.length) {
    return {
      error: "没有已审核题目可保存为试卷",
      eligibleCount: eligible.length,
      pending,
    };
  }
  if (pending > 0) {
    return {
      error: `还有 ${pending} 道题待审核，请审核完成后再保存试卷`,
      eligibleCount: eligible.length,
      pending,
    };
  }
  const score = eligible.reduce((sum, item) => sum + Number(item.score || 0), 0);
  const buildSpec = {
    targetScore: score,
    source: "saved-reviewed-questions",
    eligibleCount: eligible.length,
    savedAt: new Date().toISOString(),
  };
  return buildPaper(sourceQuestions, {
    ...meta,
    id: meta.id || "paper-a",
    name: meta.name || "A 卷",
    status: "未发布",
    questionIds: eligible.map((item) => item.id),
    buildSpec,
  });
}

function selectPaperQuestions(sourceQuestions, meta = {}) {
  if (Array.isArray(meta.questionIds) && meta.questionIds.length) {
    const byId = new Map(sourceQuestions.map((item) => [item.id, item]));
    return meta.questionIds.map((id) => byId.get(id)).filter(Boolean);
  }

  const targetScore = clampNumber(meta.targetScore || meta.buildSpec?.targetScore, 1, 200, 50);
  const eligible = sourceQuestions.filter((item) => item.status === "已校验");
  const selected = pickQuestionsForScore(eligible.length ? eligible : sourceQuestions, targetScore);
  return selected.length ? selected : sourceQuestions.slice(0, 12);
}

function pickQuestionsForScore(sourceQuestions, targetScore) {
  const ordered = [...sourceQuestions].sort((a, b) => {
    const typeOrder = typeRank(a.type) - typeRank(b.type);
    if (typeOrder !== 0) return typeOrder;
    return String(a.id).localeCompare(String(b.id));
  });
  let best = [];
  let bestScore = 0;
  for (const question of ordered) {
    const score = Number(question.score || 0);
    if (score <= 0 || bestScore + score > targetScore) continue;
    best.push(question);
    bestScore += score;
    if (bestScore === targetScore) return best;
  }
  return bestScore === targetScore ? best : [];
}

function typeRank(type) {
  return questionTypes.indexOf(type);
}

function normalizeGenerationSpec(spec = {}) {
  const typePlan = normalizeTypePlan(spec.typeCounts || spec.typeMix, spec.count);
  const count = typePlan.reduce((sum, item) => sum + item.count, 0);
  const totalScore = clampNumber(spec.totalScore, Math.max(1, count), 200, 50);
  const knowledge = normalizeList(spec.knowledge).length ? normalizeList(spec.knowledge) : ["综合能力"];
  return {
    title: cleanText(spec.title, "综合能力测评"),
    paperName: cleanText(spec.paperName || spec.paper, "A 卷"),
    direction: cleanText(spec.direction, "综合能力"),
    count,
    difficulty: normalizeDifficulty(spec.difficulty),
    totalScore,
    typeMix: typePlan,
    typeMixText: typePlan.map((item) => `${item.type}${item.count}`).join("，"),
    knowledge,
    requirements: cleanText(spec.requirements, ""),
  };
}

function generateMockQuestions(spec) {
  const scores = distributeScores(spec.totalScore, spec.count);
  const types = spec.typeMix.flatMap((item) => Array.from({ length: item.count }, () => item.type)).slice(0, spec.count);
  return types.map((type, index) => {
    const knowledge = spec.knowledge[index % spec.knowledge.length];
    return buildMockQuestion({
      id: `q-${String(index + 1).padStart(3, "0")}`,
      index,
      type,
      score: scores[index],
      knowledge,
      spec,
    });
  });
}

function buildMockQuestion({ id, index, type, score, knowledge, spec }) {
  const difficulty = spec.difficulty === "混合" ? ["易", "中", "难"][index % 3] : spec.difficulty;
  const base = {
    id,
    type,
    stem: buildStem(type, spec.direction, knowledge, index),
    score,
    difficulty,
    knowledge: [knowledge, spec.direction],
    explanation: `围绕${spec.direction}中的${knowledge}考查，生成依据来自本次命题任务。`,
    rubric: [],
    quality: 90 + (index % 7),
    status: "待确认",
  };

  if (type === "单选") {
    return {
      ...base,
      options: buildChoiceOptions("单选", knowledge, index),
      answer: "A",
    };
  }

  if (type === "多选") {
    return {
      ...base,
      options: buildChoiceOptions("多选", knowledge, index),
      answer: ["A", "C"],
    };
  }

  if (type === "判断") {
    return {
      ...base,
      options: ["正确", "错误"],
      answer: index % 2 === 0 ? "正确" : "错误",
    };
  }

  if (type === "填空") {
    return {
      ...base,
      options: [],
      answer: buildBlankAnswer(knowledge),
    };
  }

  return {
    ...base,
    options: [],
    answer: buildSubjectiveAnswer(type, knowledge),
    rubric: buildSubjectiveRubric(type, knowledge),
  };
}

function buildStem(type, direction, knowledge, index) {
  if (type === "单选") return `关于${knowledge}的理解，以下哪一项最准确？`;
  if (type === "多选") return `在处理${knowledge}相关问题时，哪些做法是合理的？`;
  if (type === "判断") return `${knowledge}在实际开发中只需要记忆语法，不需要结合场景判断。`;
  if (type === "填空") return buildBlankStem(knowledge);
  return `请说明${knowledge}在工程实践中的应用方式，并指出常见风险。`;
}

function buildBlankStem(knowledge) {
  const stems = {
    语法基础: "C++ 中对象在创建时完成初始值设置的过程称为 ______。",
    STL: "在 STL 中，用于表示容器中元素位置并可配合算法遍历的数据抽象称为 ______。",
    内存管理: "C++ 中通过对象生命周期自动管理资源获取和释放的惯用法称为 ______。",
    面向对象: "通过对外隐藏实现细节、只暴露必要接口来降低耦合的特性称为 ______。",
    异常处理: "异常处理过程中，即使发生错误也要保证对象状态仍满足约束，这类约束通常称为 ______。",
  };
  return stems[knowledge] || `${knowledge}相关实现中，描述资源归属、生命周期或行为边界的核心约束称为 ______。`;
}

function buildBlankAnswer(knowledge) {
  const answers = {
    语法基础: "初始化",
    STL: "迭代器",
    内存管理: "RAII",
    面向对象: "封装",
    异常处理: "不变量",
  };
  return answers[knowledge] || knowledge;
}

function buildSubjectiveAnswer(type, knowledge) {
  const answerMap = {
    语法基础: "应说明 C++ 语法规则会直接影响类型推导、对象初始化、作用域和表达式求值；工程中需要结合编译器诊断、标准语义和测试结果确认行为，避免依赖未定义行为或仅以编译通过作为正确依据。",
    STL: "应说明 STL 的核心价值是用标准容器、迭代器和算法表达数据处理意图；工程中需要按访问模式选择容器，关注复杂度、迭代器失效和拷贝成本，并用标准算法减少重复实现。",
    内存管理: "应说明 C++ 内存管理重点是资源所有权和生命周期控制；工程中优先使用 RAII、智能指针和容器管理资源，避免多处释放同一资源、异常路径泄漏以及裸指针所有权不清。",
    面向对象: "应说明面向对象通过封装、抽象和多态管理变化；工程中应保持接口稳定、隐藏实现细节，优先用组合表达复用，并避免过深继承层级和不安全的基类析构设计。",
    异常处理: "应说明异常用于表达无法在当前层处理的失败；工程中需要在合适边界捕获和转换异常，保留错误上下文，保证资源释放和对象不变量，避免静默吞掉异常。",
  };
  const base = answerMap[knowledge] || `应说明${knowledge}的定义、适用场景、边界条件和常见错误，并给出在工程代码中保持可维护性、可测试性和风险可控的处理方式。`;
  if (type === "论述") {
    return `${base} 还应进一步结合具体项目场景展开取舍依据，例如性能、可维护性、异常路径和团队协作成本，并说明如何通过代码评审、测试和运行期观测验证方案有效。`;
  }
  return base;
}

function buildSubjectiveRubric(type, knowledge) {
  const common = [`准确解释${knowledge}的核心概念`, "说明适用场景和边界条件", "指出常见错误或风险", "表达清晰并能联系工程实践"];
  if (type === "论述") return [...common, "能展开方案权衡和验证方式"];
  return common;
}

function buildChoiceOptions(type, knowledge, index) {
  const bank = {
    语法基础: {
      单选: ["根据语言规则判断表达式行为，并避免依赖未定义行为", "只要代码能够编译通过就说明语义一定正确", "所有编译器都会以完全相同的方式处理扩展语法", "语法细节只影响代码风格，不影响运行结果"],
      多选: ["区分声明、定义与初始化的语义", "忽略类型转换带来的精度或生命周期问题", "结合编译诊断和标准规则定位问题", "把所有警告统一视为可以忽略的信息"],
    },
    STL: {
      单选: ["根据访问模式和复杂度选择合适容器", "所有容器在插入和查找时都有相同复杂度", "迭代器失效只会发生在多线程场景", "算法库只能处理 vector，不能处理其他容器"],
      多选: ["关注容器操作后的迭代器有效性", "默认任何容器随机访问都为常数复杂度", "优先复用标准算法表达意图", "在不了解复杂度时随意嵌套遍历大容器"],
    },
    内存管理: {
      单选: ["使用 RAII 和智能指针表达资源所有权", "优先在多个模块间共享裸指针并分别释放", "发生异常时资源释放可以交给调用者猜测处理", "只要程序结束，运行期泄漏就不需要关注"],
      多选: ["用 RAII 保证异常路径也能释放资源", "让多个对象同时拥有同一裸指针的释放责任", "通过智能指针语义区分独占和共享所有权", "用手动 new/delete 替代清晰的对象生命周期设计"],
    },
    面向对象: {
      单选: ["通过稳定抽象隔离变化点并控制耦合", "继承层级越深越能提升系统可维护性", "所有成员都公开可以让封装更清晰", "多态只适用于图形界面程序"],
      多选: ["为可替换行为定义清晰接口", "把所有实现细节暴露给调用方", "避免基类析构非虚导致的资源释放风险", "用继承替代所有组合关系"],
    },
    异常处理: {
      单选: ["在边界处转换异常并保持资源状态一致", "捕获异常后静默忽略可以提升稳定性", "异常只能用于语法错误，不能表达运行期失败", "抛出字符串字面量比类型化异常更利于维护"],
      多选: ["保证异常路径下对象仍满足不变量", "在底层吞掉所有异常并返回成功", "为调用方保留足够的错误上下文", "用异常控制普通循环分支流程"],
    },
  };
  const fallback = {
    单选: [`准确说明${knowledge}的适用场景、边界条件和实现影响`, `只记忆${knowledge}名称而不分析上下文`, `把${knowledge}用于所有问题而不做权衡`, `忽略${knowledge}带来的维护和测试成本`],
    多选: [`明确${knowledge}的适用前提`, `忽略${knowledge}的边界条件`, `结合测试或运行结果验证${knowledge}的行为`, `在不了解影响时扩大${knowledge}的使用范围`],
  };
  const options = bank[knowledge]?.[type] || fallback[type] || fallback.单选;
  if (index % 2 === 0) return options;
  return [options[0], options[2], options[1], options[3]];
}

function finalizeGeneratedQuestions(items, spec) {
  const normalized = normalizeGeneratedQuestions(items, spec);
  const repaired = ensureSpecCompliance(normalized, spec);
  const factRepaired = repairKnownObjectiveAnswers(repaired);
  const checks = validateQuestions(factRepaired);
  const specChecks = validateGenerationSpec(repaired, spec);
  return {
    questions: factRepaired,
    checks: {
      ...checks,
      specPass: specChecks.failures.length === 0,
      specFailures: specChecks.failures,
      stabilityScore: Math.max(0, checks.stabilityScore - specChecks.failures.length * 8),
    },
  };
}

function normalizeGeneratedQuestions(items, spec) {
  const source = Array.isArray(items) ? items : [];
  return source.map((item, index) => normalizeGeneratedQuestion(item, index, spec));
}

function normalizeGeneratedQuestion(item = {}, index, spec) {
  const type = normalizeQuestionType(item.type, spec.typeMix[index % spec.typeMix.length]?.type || "单选");
  const knowledge = normalizeList(item.knowledge).length ? normalizeList(item.knowledge) : [spec.knowledge[index % spec.knowledge.length]];
  const answer = normalizeAnswer(item.answer ?? item.correctAnswer ?? item.referenceAnswer, type);
  const stem = item.stem ?? item.question ?? item.prompt ?? item.content ?? item.title;
  const question = {
    id: item.id || `q-${String(index + 1).padStart(3, "0")}`,
    type,
    stem: cleanText(stem, buildStem(type, spec.direction, knowledge[0], index)),
    options: normalizeOptions(item.options ?? item.choices),
    answer,
    score: Number(item.score || 1),
    difficulty: normalizeDifficulty(item.difficulty || spec.difficulty),
    knowledge,
    explanation: cleanText(item.explanation, `围绕${spec.direction}命题，并按结构化规则校验。`),
    rubric: Array.isArray(item.rubric) ? item.rubric.map((entry) => String(entry)) : [],
    quality: Math.max(70, Math.min(100, Number(item.quality || 88))),
    status: "待确认",
  };

  if (["单选", "多选"].includes(type) && question.options.length < 2) {
    question.options = buildChoiceOptions(type, knowledge[0], index);
  }
  if (type === "判断") question.options = ["正确", "错误"];
  if (["简答", "论述"].includes(type) && question.rubric.length === 0) {
    question.rubric = ["概念准确", "覆盖关键步骤", "结合实际场景", "表达清晰"];
  }
  return question;
}

function normalizeOptions(value) {
  if (Array.isArray(value)) {
    return value.map((option) => {
      if (option && typeof option === "object") return cleanText(option.text ?? option.content ?? option.label ?? "", "");
      return String(option);
    }).filter(Boolean);
  }
  if (value && typeof value === "object") {
    return Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, option]) => String(option))
      .filter(Boolean);
  }
  return [];
}

function ensureSpecCompliance(items, spec) {
  const targetTypes = spec.typeMix.flatMap((item) => Array.from({ length: item.count }, () => item.type)).slice(0, spec.count);
  const output = [];
  for (let index = 0; index < spec.count; index += 1) {
    const targetType = targetTypes[index] || "单选";
    const existing = items[index] || {};
    const question =
      items[index] === undefined
        ? buildMockQuestion({
          id: `q-${String(index + 1).padStart(3, "0")}`,
          index,
          type: targetType,
          score: 1,
          knowledge: spec.knowledge[index % spec.knowledge.length],
          spec,
        })
        : { ...existing, type: targetType };
    question.id = `q-${String(index + 1).padStart(3, "0")}`;
    output.push(normalizeGeneratedQuestion(question, index, spec));
  }

  const scores = distributeScores(spec.totalScore, spec.count);
  return output.map((item, index) => ({
    ...item,
    score: scores[index],
  }));
}

function validateGenerationSpec(items, spec) {
  const failures = [];
  if (items.length !== spec.count) {
    failures.push({ field: "count", message: `题目数量应为 ${spec.count}，实际 ${items.length}` });
  }
  const total = items.reduce((sum, item) => sum + Number(item.score || 0), 0);
  if (total !== spec.totalScore) {
    failures.push({ field: "totalScore", message: `总分应为 ${spec.totalScore}，实际 ${total}` });
  }
  const actualTypes = countBy(items, "type");
  spec.typeMix.forEach((item) => {
    if ((actualTypes[item.type] || 0) !== item.count) {
      failures.push({ field: "typeMix", message: `${item.type} 应为 ${item.count} 道，实际 ${actualTypes[item.type] || 0} 道` });
    }
  });
  return { failures };
}

export function paperQuestionsForSession(session = {}, sourceQuestions = questions, paper = {}) {
  const items = selectPaperQuestions(sourceQuestions, paper);
  const targetScore = items.reduce((sum, item) => sum + Number(item.score || 0), 0) || clampNumber(paper.buildSpec?.targetScore, 1, 200, 50);
  if (session.paper === "B 卷") {
    return rebalanceToScore([...items.slice(6), ...items.slice(0, 6)], targetScore);
  }
  if (session.paper === "专项卷") {
    const priority = ["在线监考", "实时状态", "考试会话", "数据分析"];
    const sorted = [...items].sort((a, b) => scoreByKnowledge(b, priority) - scoreByKnowledge(a, priority));
    return rebalanceToScore(sorted, targetScore);
  }
  if (session.paper === "补考卷") {
    return rebalanceToScore([...items].reverse(), targetScore);
  }
  return rebalanceToScore(items, targetScore);
}

export function gradeAnswers(answerMap = {}, sourceQuestions = questions) {
  let totalScore = 0;
  let objectiveScore = 0;
  let subjectiveScore = 0;
  let subjectivePending = 0;
  const details = sourceQuestions.map((question) => {
    const value = answerMap[question.id];
    const subjective = ["简答", "论述"].includes(question.type);
    const correct = subjective ? null : compareAnswer(value, question.answer);
    const awarded = subjective ? estimateSubjectiveScore(value, question) : correct ? question.score : 0;
    totalScore += awarded;
    if (subjective) {
      subjectiveScore += awarded;
      subjectivePending += 1;
    } else {
      objectiveScore += awarded;
    }
    return {
      questionId: question.id,
      type: question.type,
      stem: question.stem || "",
      options: Array.isArray(question.options) ? question.options : [],
      standardAnswer: question.answer ?? "",
      explanation: question.explanation || "",
      score: question.score,
      awarded,
      correct,
      answer: value ?? "",
      reviewRequired: subjective,
      status: subjective ? "待人工复核" : "自动判分",
      aiComment: subjective ? buildSubjectiveComment(value, question, awarded) : "",
    };
  });

  return {
    totalScore,
    objectiveScore,
    subjectiveScore,
    subjectivePending,
    reviewStatus: subjectivePending > 0 ? "待复核" : "已完成",
    maxScore: sourceQuestions.reduce((total, item) => total + item.score, 0),
    details,
    summary: subjectivePending > 0 ? "客观题已自动判分，主观题已完成 AI 初评，等待人工复核。" : "客观题已自动判分，无需人工复核。",
  };
}

export function reviewGradingResult(result = {}, reviews = []) {
  const reviewMap = new Map(reviews.map((item) => [item.questionId, item]));
  let totalScore = 0;
  let subjectivePending = 0;
  const details = (result.details || []).map((detail) => {
    const review = reviewMap.get(detail.questionId);
    if (detail.reviewRequired && review) {
      const awarded = Math.max(0, Math.min(Number(detail.score || 0), Number(review.awarded ?? detail.awarded ?? 0)));
      const next = {
        ...detail,
        awarded,
        status: "人工复核完成",
        reviewerComment: String(review.comment || "").trim(),
        reviewedAt: new Date().toISOString(),
      };
      totalScore += awarded;
      return next;
    }
    if (detail.reviewRequired && detail.status !== "人工复核完成") subjectivePending += 1;
    totalScore += Number(detail.awarded || 0);
    return detail;
  });

  const subjectiveScore = details
    .filter((item) => item.reviewRequired)
    .reduce((sum, item) => sum + Number(item.awarded || 0), 0);
  const objectiveScore = details
    .filter((item) => !item.reviewRequired)
    .reduce((sum, item) => sum + Number(item.awarded || 0), 0);

  return {
    ...result,
    totalScore,
    objectiveScore,
    subjectiveScore,
    subjectivePending,
    reviewStatus: subjectivePending > 0 ? "待复核" : "已完成",
    details,
    reviewedAt: new Date().toISOString(),
    summary: subjectivePending > 0 ? "仍有主观题等待人工复核。" : "阅卷复核已完成，成绩可进入分析统计。",
  };
}

export function analyzeExam(sourceQuestions = questions, sourceSessions = [], gradingResults = {}, paper = {}) {
  const paperQuestions = buildPaper(sourceQuestions, paper).questions;
  const pendingReview = sourceQuestions.filter((item) => item.status === "待确认").length;
  const riskCount = sourceSessions.filter((item) => item.risk !== "低").length;
  const allResults = Object.values(gradingResults || {});
  const results = allResults.filter((result) => result.reviewStatus === "已完成");
  const maxScore = paperQuestions.reduce((total, item) => total + Number(item.score || 0), 0);
  const averageScore = results.length > 0 ? round1(results.reduce((sum, result) => sum + Number(result.totalScore || 0), 0) / results.length) : 0;
  const passLine = maxScore * 0.6;
  const passRate = results.length > 0 ? Math.round((results.filter((result) => Number(result.totalScore || 0) >= passLine).length / results.length) * 100) : 0;
  const distribution = buildScoreDistribution(results, maxScore);
  const knowledge = buildKnowledgeAnalysis(paperQuestions, results);
  const weakKnowledge = knowledge.filter((item) => item.score < 60).length;

  return {
    averageScore,
    passRate,
    weakPoints: weakKnowledge + riskCount + pendingReview,
    gradedCount: results.length,
    submittedCount: sourceSessions.filter((item) => item.status === "已提交").length,
    pendingReviewCount: pendingReview,
    riskCount,
    maxScore,
    distribution,
    knowledge,
    quality: validateQuestions(sourceQuestions),
    generatedAt: new Date().toISOString(),
  };
}

function buildKnowledgeAnalysis(paperQuestions, results) {
  const buckets = new Map();
  paperQuestions.forEach((question) => {
    const knowledge = Array.isArray(question.knowledge) && question.knowledge.length ? question.knowledge : ["综合能力"];
    knowledge.forEach((name) => {
      if (!buckets.has(name)) buckets.set(name, { name, score: 0, maxScore: 0 });
      buckets.get(name).maxScore += Number(question.score || 0) * Math.max(1, results.length);
    });
  });

  results.forEach((result) => {
    const detailById = new Map((result.details || []).map((item) => [item.questionId, item]));
    paperQuestions.forEach((question) => {
      const detail = detailById.get(question.id);
      const awarded = Number(detail?.awarded || 0);
      const knowledge = Array.isArray(question.knowledge) && question.knowledge.length ? question.knowledge : ["综合能力"];
      knowledge.forEach((name) => {
        if (!buckets.has(name)) buckets.set(name, { name, score: 0, maxScore: 0 });
        buckets.get(name).score += awarded;
      });
    });
  });

  return [...buckets.values()]
    .map((item) => ({
      name: item.name,
      score: item.maxScore ? Math.round((item.score / item.maxScore) * 100) : 0,
    }))
    .sort((a, b) => a.score - b.score)
    .slice(0, 5);
}

function buildScoreDistribution(results, maxScore) {
  const buckets = [
    { label: "0-59%", count: 0 },
    { label: "60-79%", count: 0 },
    { label: "80-89%", count: 0 },
    { label: "90-100%", count: 0 },
  ];

  results.forEach((result) => {
    const percent = maxScore ? (Number(result.totalScore || 0) / maxScore) * 100 : 0;
    if (percent >= 90) buckets[3].count += 1;
    else if (percent >= 80) buckets[2].count += 1;
    else if (percent >= 60) buckets[1].count += 1;
    else buckets[0].count += 1;
  });

  return buckets;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function normalizeTypePlan(input, requestedCount) {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const plan = questionTypes
      .map((type) => {
        const keys = typeCountKeys[type] || [type];
        const raw = keys.map((key) => input[key]).find((value) => value !== undefined && value !== "");
        return { type, count: clampNumber(raw, 0, 50, 0) };
      })
      .filter((item) => item.count > 0);
    if (plan.length) return plan;
  }

  const count = clampNumber(requestedCount, 1, 50, 12);
  const text = Array.isArray(input)
    ? input.map((item) => `${item.type || ""}${item.count || ""}`).join("，")
    : String(input || "");
  const plan = [];
  for (const type of questionTypes) {
    const match = text.match(new RegExp(`${type}\\s*[x×:]?\\s*(\\d+)`));
    if (match) plan.push({ type, count: clampNumber(match[1], 0, count, 0) });
  }

  if (!plan.length) {
    plan.push({ type: "单选", count: Math.ceil(count * 0.35) });
    plan.push({ type: "多选", count: Math.floor(count * 0.15) });
    plan.push({ type: "判断", count: Math.floor(count * 0.15) });
    plan.push({ type: "填空", count: Math.floor(count * 0.15) });
    plan.push({ type: "简答", count: count });
  }

  return rebalanceTypePlan(plan.filter((item) => item.count > 0), count);
}

function rebalanceTypePlan(plan, count) {
  const normalized = plan.map((item) => ({ ...item }));
  let total = normalized.reduce((sum, item) => sum + item.count, 0);
  if (total === 0) return [{ type: "单选", count }];

  while (total > count) {
    const target = normalized.find((item) => item.count > 1) || normalized[normalized.length - 1];
    target.count -= 1;
    total -= 1;
  }

  while (total < count) {
    normalized[0].count += 1;
    total += 1;
  }

  return normalized;
}

function distributeScores(totalScore, count) {
  const base = Math.max(1, Math.floor(totalScore / count));
  const scores = Array.from({ length: count }, () => base);
  let remaining = totalScore - base * count;
  let index = 0;
  while (remaining > 0) {
    scores[index % scores.length] += 1;
    remaining -= 1;
    index += 1;
  }
  return scores;
}

function normalizeDifficulty(value) {
  return ["易", "中", "难", "混合"].includes(value) ? value : "中";
}

function normalizeQuestionType(value, fallback = "单选") {
  const text = String(value || "").trim();
  const aliases = {
    单项选择: "单选",
    单选题: "单选",
    多项选择: "多选",
    多选题: "多选",
    判断题: "判断",
    填空题: "填空",
    简答题: "简答",
    论述题: "论述",
  };
  const normalized = aliases[text] || text;
  return ["单选", "多选", "判断", "填空", "简答", "论述"].includes(normalized) ? normalized : fallback;
}

function normalizeAnswer(value, type) {
  if (type === "多选") {
    const values = Array.isArray(value) ? value : String(value || "").split(/[,，、\s]+/);
    const answers = values.map((item) => String(item).trim().toUpperCase()).filter((item) => /^[A-D]$/.test(item));
    return answers.length ? [...new Set(answers)] : ["A", "C"];
  }
  if (type === "单选") {
    const answer = String(Array.isArray(value) ? value[0] : value || "A").trim().toUpperCase();
    return /^[A-D]$/.test(answer) ? answer : "A";
  }
  if (type === "判断") {
    return normalizeJudgementAnswer(value);
  }
  return String(value || "参考答案待完善。").trim();
}

function normalizeJudgementAnswer(value) {
  if (value === true) return "正确";
  if (value === false) return "错误";
  const text = String(value ?? "").trim().toLowerCase();
  if (["正确", "对", "是", "true", "t", "yes", "y", "1"].includes(text)) return "正确";
  if (["错误", "错", "否", "false", "f", "no", "n", "0"].includes(text)) return "错误";
  return "正确";
}

function normalizeList(value) {
  if (Array.isArray(value)) return value.map((item) => cleanText(item, "")).filter(Boolean);
  return String(value || "")
    .split(/[,，、\n]/)
    .map((item) => cleanText(item, ""))
    .filter(Boolean);
}

function cleanText(value, fallback) {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function countBy(items, field) {
  return items.reduce((acc, item) => {
    const key = item[field];
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

export function validateQuestions(items = questions) {
  const required = ["type", "stem", "answer", "score", "difficulty"];
  const failures = [];
  const seenStems = new Map();

  items.forEach((item, index) => {
    required.forEach((field) => {
      if (item[field] === undefined || item[field] === "") {
        failures.push({ index, field, message: "字段缺失" });
      }
    });

    if (!Number.isFinite(Number(item.score)) || Number(item.score) <= 0) {
      failures.push({ index, field: "score", message: "分值必须大于 0" });
    }

    if (["单选", "多选"].includes(item.type) && !Array.isArray(item.options)) {
      failures.push({ index, field: "options", message: "选择题必须包含选项" });
    }

    if (["单选", "多选"].includes(item.type) && Array.isArray(item.options)) {
      const optionLetters = item.options.map((_, optionIndex) => String.fromCharCode(65 + optionIndex));
      const answers = Array.isArray(item.answer) ? item.answer : [item.answer];
      answers.forEach((answer) => {
        if (!optionLetters.includes(answer)) {
          failures.push({ index, field: "answer", message: "答案不在选项范围内" });
        }
      });
    }

    if (["简答", "论述"].includes(item.type) && (!Array.isArray(item.rubric) || item.rubric.length === 0)) {
      failures.push({ index, field: "rubric", message: "主观题必须包含评分规则" });
    }

    const knownAnswer = inferKnownObjectiveAnswer(item);
    if (knownAnswer && !compareAnswer(item.answer, knownAnswer.answer)) {
      failures.push({ index, field: "answer", message: knownAnswer.message });
    }

    const normalizedStem = String(item.stem || "").replace(/\s+/g, "");
    if (normalizedStem) {
      if (seenStems.has(normalizedStem)) {
        failures.push({ index, field: "stem", message: `疑似重复题，重复于第 ${seenStems.get(normalizedStem) + 1} 题` });
      } else {
        seenStems.set(normalizedStem, index);
      }
    }
  });

  const pendingReview = items.filter((item) => item.status === "待确认").length;
  const subjectiveMissingRubric = failures.filter((item) => item.field === "rubric").length;
  const answerFailures = failures.filter((item) => item.field === "answer").length;
  const schemaPassRate = failures.length ? Math.max(0, Math.round(100 - failures.length * 6)) : 100;

  return {
    schemaPassRate,
    answerConsistency: Math.max(70, 100 - answerFailures * 10 - subjectiveMissingRubric * 4),
    duplicateFiltered: failures.filter((item) => item.message.includes("重复")).length,
    pendingReview,
    stabilityScore: Math.max(70, Math.round((schemaPassRate + (100 - pendingReview * 5)) / 2)),
    failures,
  };
}

export function repairQuestions(items = questions) {
  const repaired = items.map((item, index) => {
    const next = { ...item };
    next.id = next.id || `q-${String(index + 1).padStart(3, "0")}`;
    next.type = next.type || "单选";
    next.stem = next.stem || `待完善题目 ${index + 1}`;
    next.score = Number(next.score) > 0 ? Number(next.score) : 3;
    next.difficulty = next.difficulty || "中";
    next.knowledge = Array.isArray(next.knowledge) ? next.knowledge : ["综合能力"];

    if (["单选", "多选"].includes(next.type)) {
      next.options = Array.isArray(next.options) && next.options.length >= 2 ? next.options : ["选项 A", "选项 B", "选项 C", "选项 D"];
      const optionLetters = next.options.map((_, optionIndex) => String.fromCharCode(65 + optionIndex));
      if (next.type === "多选") {
        const answers = Array.isArray(next.answer) ? next.answer.filter((answer) => optionLetters.includes(answer)) : [];
        next.answer = answers.length ? answers : [optionLetters[0], optionLetters[1]].filter(Boolean);
      } else {
        next.answer = optionLetters.includes(next.answer) ? next.answer : optionLetters[0];
      }
    }

    if (next.type === "判断") {
      next.options = ["正确", "错误"];
      next.answer = normalizeJudgementAnswer(next.answer);
    }

    if (["简答", "论述"].includes(next.type)) {
      next.answer = next.answer || "参考答案待完善。";
      next.rubric = Array.isArray(next.rubric) && next.rubric.length ? next.rubric : ["观点准确", "结构清晰", "结合场景", "表达完整"];
    }

    next.quality = Math.max(Number(next.quality || 90), 90);
    next.status = "待确认";
    return repairKnownObjectiveAnswer(next);
  });

  return {
    questions: repaired,
    checks: validateQuestions(repaired),
  };
}

function repairKnownObjectiveAnswers(items = []) {
  return items.map((item) => repairKnownObjectiveAnswer(item));
}

function repairKnownObjectiveAnswer(item = {}) {
  const knownAnswer = inferKnownObjectiveAnswer(item);
  if (!knownAnswer || compareAnswer(item.answer, knownAnswer.answer)) return item;
  return {
    ...item,
    answer: knownAnswer.answer,
    explanation: knownAnswer.explanation,
    quality: Math.max(70, Math.min(100, Number(item.quality || 88) - 6)),
  };
}

function inferKnownObjectiveAnswer(item = {}) {
  if (item.type !== "判断") return null;
  const text = normalizeFactText(item.stem);
  const mentionsClientStorage = /\b(localstorage|sessionstorage)\b/.test(text);
  const mentionsRequestAutoSend =
    /自动(发送|携带)/.test(text) ||
    /随.*(http|https)?请求.*(发送|携带|提交|传给|传递|到服务器)/.test(text) ||
    /每(一)?次.*请求.*(服务器|携带|发送)/.test(text);
  const negatesRequestAutoSend =
    /(不|不会|不能|无法|并不会|不应|不适合).{0,12}(随|自动|每次|每一次|请求|发送|携带|服务器)/.test(text) ||
    /(随|自动|每次|每一次|请求|发送|携带|服务器).{0,12}(不|不会|不能|无法)/.test(text);

  if (mentionsClientStorage && mentionsRequestAutoSend) {
    return {
      answer: negatesRequestAutoSend ? "正确" : "错误",
      message: "答案与浏览器存储事实不一致：localStorage/sessionStorage 不会随 HTTP 请求自动发送",
      explanation: "localStorage 和 sessionStorage 是客户端 Web Storage，浏览器不会把它们随每次 HTTP 请求自动发送到服务器；需要自动随请求携带的会话标识通常应使用 Cookie，并受 domain、path、SameSite、Secure 等属性约束。",
    };
  }

  if (/只需要记忆语法，不需要结合场景判断/.test(text)) {
    return {
      answer: "错误",
      message: "答案与工程能力判断不一致：工程题不能只依赖语法记忆",
      explanation: "工程能力测评应结合场景、边界条件和运行结果判断，不能只依赖语法记忆。",
    };
  }

  return null;
}

function normalizeFactText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "");
}

function compareAnswer(value, answer) {
  if (Array.isArray(answer)) {
    return Array.isArray(value) && answer.slice().sort().join("|") === value.slice().sort().join("|");
  }
  return String(value ?? "").trim() === String(answer ?? "").trim();
}

function estimateSubjectiveScore(value, question) {
  const text = String(value ?? "").trim();
  if (!text) return 0;
  const rubric = Array.isArray(question.rubric) ? question.rubric : [];
  const coverage = rubric.length
    ? rubric.filter((item) => text.includes(item) || text.length >= 20).length / rubric.length
    : Math.min(1, text.length / 80);
  const lengthScore = Math.min(1, text.length / 80);
  return Math.round(Number(question.score || 0) * Math.max(0.35, (coverage + lengthScore) / 2));
}

function buildSubjectiveComment(value, question, awarded) {
  const text = String(value ?? "").trim();
  if (!text) return "未作答，AI 初评为 0 分，需人工确认。";
  return `AI 初评 ${awarded}/${question.score} 分，请人工按 rubric 复核关键点覆盖与表达完整度。`;
}

function scoreByKnowledge(question, priority) {
  const knowledge = Array.isArray(question.knowledge) ? question.knowledge : [];
  return knowledge.reduce((score, item) => score + (priority.includes(item) ? 1 : 0), 0);
}

function rebalanceToScore(items, targetScore) {
  const selected = items.slice(0, 12).map((item) => ({ ...item }));
  let total = selected.reduce((sum, item) => sum + Number(item.score || 0), 0);
  const last = selected[selected.length - 1];
  if (last && total !== targetScore) {
    last.score = Math.max(1, Number(last.score || 0) + (targetScore - total));
    total = selected.reduce((sum, item) => sum + Number(item.score || 0), 0);
  }
  return selected;
}
