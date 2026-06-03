import {
  SCORE_DIMENSIONS,
  type ScoreBreakdownKey,
} from "@/lib/candidate-scoring";

export type SectionType =
  | "education"
  | "internship"
  | "project"
  | "skill"
  | "achievement"
  | "leadership"
  | "other";

export type EvidenceChunk = {
  id: string;
  fileName: string;
  text: string;
  sectionType: SectionType;
  jdMatchedKeywords: string[];
  preferenceMatchedKeywords: string[];
  relevanceScore: number;
};

export type DimensionEvidence = {
  score: number;
  maxScore: number;
  evidenceIds: string[];
  matchedKeywords: string[];
  missingKeywords: string[];
  missingEvidence: string[];
  reasoning: string;
};

export type DimensionEvidenceKey = ScoreBreakdownKey;

export type DimensionEvidenceMap = Record<DimensionEvidenceKey, DimensionEvidence>;

const MAX_CHUNK_LENGTH = 260;
const MIN_CHUNK_LENGTH = 18;
const MAX_SELECTED_EVIDENCE_CHUNKS = 10;

const SECTION_KEYWORDS: Record<SectionType, string[]> = {
  education: [
    "教育",
    "学历",
    "本科",
    "硕士",
    "博士",
    "大学",
    "学院",
    "专业",
    "gpa",
    "degree",
  ],
  internship: [
    "实习",
    "intern",
    "公司",
    "部门",
    "岗位",
    "任职",
    "工作经历",
    "employment",
  ],
  project: [
    "项目",
    "prd",
    "需求",
    "用户调研",
    "竞品",
    "原型",
    "开发",
    "上线",
    "迭代",
    "测试",
    "portfolio",
  ],
  skill: [
    "技能",
    "工具",
    "语言",
    "python",
    "java",
    "sql",
    "excel",
    "figma",
    "tableau",
    "solidworks",
    "matlab",
  ],
  achievement: [
    "奖",
    "竞赛",
    "证书",
    "论文",
    "专利",
    "获奖",
    "荣誉",
    "certificate",
  ],
  leadership: [
    "负责人",
    "leader",
    "领导",
    "组织",
    "社团",
    "团队",
    "协作",
    "跨部门",
    "推进",
  ],
  other: [],
};

const DIMENSION_RULES: Record<
  DimensionEvidenceKey,
  {
    preferredSections: SectionType[];
    keywords: string[];
    limit: number;
  }
> = {
  jobRelevantExperience: {
    preferredSections: ["internship", "project"],
    keywords: ["实习", "项目", "岗位", "职责", "行业", "业务", "产品", "研发", "开发"],
    limit: 3,
  },
  projectEvidenceStrength: {
    preferredSections: ["project", "internship", "achievement"],
    keywords: ["项目", "结果", "数据", "指标", "产出", "上线", "优化", "复盘", "负责"],
    limit: 3,
  },
  transferableCapability: {
    preferredSections: ["project", "internship", "skill", "leadership"],
    keywords: ["分析", "沟通", "协作", "推进", "学习", "研究", "解决", "优化", "业务"],
    limit: 2,
  },
  resumeClarity: {
    preferredSections: ["project", "internship", "achievement"],
    keywords: ["负责", "完成", "输出", "推动", "提升", "降低", "上线", "%", "人", "次"],
    limit: 2,
  },
  interviewerPreferenceMatch: {
    preferredSections: ["internship", "project", "skill", "education", "achievement"],
    keywords: [],
    limit: 2,
  },
};

const DIMENSION_PRIORITY: DimensionEvidenceKey[] = [
  "jobRelevantExperience",
  "projectEvidenceStrength",
  "transferableCapability",
  "resumeClarity",
  "interviewerPreferenceMatch",
];

export function createEvidenceChunks(fileName: string, resumeText: string) {
  return splitResumeText(resumeText).map((text, index) => ({
    id: `${slugFileName(fileName)}-chunk-${index + 1}`,
    fileName,
    text,
    sectionType: detectSectionType(text),
    jdMatchedKeywords: [],
    preferenceMatchedKeywords: [],
    relevanceScore: 0,
  }));
}

export function enrichEvidenceChunks({
  chunks,
  jobDescription,
  interviewerPreferences,
}: {
  chunks: EvidenceChunk[];
  jobDescription: string;
  interviewerPreferences: string;
}) {
  const jdKeywords = extractKeywords(jobDescription);
  const preferenceKeywords = extractPreferenceKeywords(interviewerPreferences);

  return chunks.map((chunk) => {
    const jdMatchedKeywords = matchKeywords(chunk.text, jdKeywords);
    const preferenceMatchedKeywords = matchKeywords(
      chunk.text,
      preferenceKeywords.map((preference) => preference.keyword),
    );
    const preferenceScore = preferenceKeywords
      .filter((preference) => preferenceMatchedKeywords.includes(preference.keyword))
      .reduce((total, preference) => total + preference.weight, 0);

    return {
      ...chunk,
      jdMatchedKeywords,
      preferenceMatchedKeywords,
      relevanceScore:
        jdMatchedKeywords.length * 2 +
        preferenceScore +
        getSectionWeight(chunk.sectionType),
    };
  });
}

export function selectEvidenceByDimension(chunks: EvidenceChunk[]) {
  const selectedByDimension = DIMENSION_PRIORITY.reduce<
    Record<DimensionEvidenceKey, EvidenceChunk[]>
  >((result, dimension) => {
    const rule = DIMENSION_RULES[dimension];
    result[dimension] = [...chunks]
      .map((chunk) => ({
        chunk,
        score: getDimensionChunkScore(chunk, dimension),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, rule.limit)
      .map((item) => item.chunk);
    return result;
  }, {} as Record<DimensionEvidenceKey, EvidenceChunk[]>);

  const mergedChunks: EvidenceChunk[] = [];
  const seenIds = new Set<string>();

  for (const dimension of DIMENSION_PRIORITY) {
    for (const chunk of selectedByDimension[dimension]) {
      if (seenIds.has(chunk.id)) continue;
      if (mergedChunks.length >= MAX_SELECTED_EVIDENCE_CHUNKS) break;
      seenIds.add(chunk.id);
      mergedChunks.push(chunk);
    }
  }

  return {
    selectedByDimension,
    selectedChunks: mergedChunks,
  };
}

export function emptyDimensionEvidenceMap(): DimensionEvidenceMap {
  return SCORE_DIMENSIONS.reduce<DimensionEvidenceMap>((result, dimension) => {
    result[dimension.key] = {
      score: 0,
      maxScore: dimension.maxScore,
      evidenceIds: [],
      matchedKeywords: [],
      missingKeywords: [],
      missingEvidence: [],
      reasoning: "该维度缺少足够证据，需在面试中进一步验证。",
    };
    return result;
  }, {} as DimensionEvidenceMap);
}

function splitResumeText(resumeText: string) {
  const lines = resumeText
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= MIN_CHUNK_LENGTH);

  const chunks: string[] = [];
  let current = "";

  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length > MAX_CHUNK_LENGTH && current) {
      chunks.push(current);
      current = line;
    } else {
      current = next;
    }
  }

  if (current) chunks.push(current);

  return chunks.length ? chunks : [resumeText.slice(0, MAX_CHUNK_LENGTH)];
}

function detectSectionType(text: string): SectionType {
  const normalizedText = text.toLowerCase();
  const scoredSections = (Object.keys(SECTION_KEYWORDS) as SectionType[])
    .filter((section) => section !== "other")
    .map((section) => ({
      section,
      score: SECTION_KEYWORDS[section].filter((keyword) =>
        normalizedText.includes(keyword.toLowerCase()),
      ).length,
    }))
    .sort((a, b) => b.score - a.score);

  return scoredSections[0]?.score ? scoredSections[0].section : "other";
}

function extractKeywords(text: string) {
  const normalized = text
    .replace(/[，。！？；：、（）【】《》]/g, " ")
    .replace(/[,.;:!?()[\]{}]/g, " ");
  const tokens = normalized
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && token.length <= 24);
  const phraseMatches = normalized.match(/[\u4e00-\u9fa5A-Za-z0-9+#.]{2,24}/g) || [];

  return Array.from(new Set([...tokens, ...phraseMatches])).slice(0, 80);
}

function extractPreferenceKeywords(interviewerPreferences: string) {
  return interviewerPreferences
    .split("\n")
    .map((line, index) => ({
      keywords: extractKeywords(line),
      weight: Math.max(1, 5 - index),
    }))
    .flatMap((item) =>
      item.keywords.map((keyword) => ({
        keyword,
        weight: item.weight,
      })),
    );
}

function matchKeywords(text: string, keywords: string[]) {
  const normalizedText = text.toLowerCase();
  return keywords.filter((keyword) =>
    normalizedText.includes(keyword.toLowerCase()),
  );
}

function getSectionWeight(sectionType: SectionType) {
  if (sectionType === "internship" || sectionType === "project") return 3;
  if (sectionType === "skill" || sectionType === "achievement") return 2;
  if (sectionType === "education" || sectionType === "leadership") return 1;
  return 0;
}

function getDimensionChunkScore(
  chunk: EvidenceChunk,
  dimension: DimensionEvidenceKey,
) {
  const rule = DIMENSION_RULES[dimension];
  const sectionScore = rule.preferredSections.includes(chunk.sectionType) ? 3 : 0;
  const ruleKeywordScore = matchKeywords(chunk.text, rule.keywords).length * 2;
  const jdScore = chunk.jdMatchedKeywords.length * 2;
  const preferenceScore =
    dimension === "interviewerPreferenceMatch"
      ? chunk.preferenceMatchedKeywords.length * 4
      : chunk.preferenceMatchedKeywords.length;

  return sectionScore + ruleKeywordScore + jdScore + preferenceScore;
}

function slugFileName(fileName: string) {
  return fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 36);
}
