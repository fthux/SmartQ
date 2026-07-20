export const typeClass = {
  单选: "bg-cyan-50 text-ocean",
  多选: "bg-indigo-50 text-iris",
  判断: "bg-amber-50 text-amber-700",
  简答: "bg-rose-50 text-coral",
  论述: "bg-rose-50 text-coral",
  填空: "bg-indigo-50 text-iris",
};

export const paperTypeConfig = [
  { type: "单选", countKey: "singleCount", scoreKey: "singleScore", apiKey: "single", defaultScore: 2 },
  { type: "多选", countKey: "multipleCount", scoreKey: "multipleScore", apiKey: "multiple", defaultScore: 4 },
  { type: "判断", countKey: "judgeCount", scoreKey: "judgeScore", apiKey: "judge", defaultScore: 2 },
  { type: "填空", countKey: "blankCount", scoreKey: "blankScore", apiKey: "blank", defaultScore: 2 },
  { type: "简答", countKey: "shortCount", scoreKey: "shortScore", apiKey: "short", defaultScore: 5 },
  { type: "论述", countKey: "essayCount", scoreKey: "essayScore", apiKey: "essay", defaultScore: 10 },
];

export const defaultSpec = {
  paperName: "",
  direction: "",
  difficulty: "中",
  singleCount: 0,
  singleScore: 2,
  multipleCount: 0,
  multipleScore: 4,
  judgeCount: 0,
  judgeScore: 2,
  blankCount: 0,
  blankScore: 2,
  shortCount: 0,
  shortScore: 5,
  essayCount: 0,
  essayScore: 10,
  knowledge: "",
  requirements: "",
  sourceMode: "ai-only",
  materialIds: [],
  materialQuestionCount: 0,
  coverageStrategy: "balanced",
};
