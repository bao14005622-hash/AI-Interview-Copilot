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
  title: string;
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
const MAX_SELECTED_EVIDENCE_CHUNKS = 10;
const GENERIC_TITLE_PATTERNS = [
  "个人简历",
  "简历",
  "项目经历",
  "项目经验",
  "实习经历",
  "工作经历",
  "教育经历",
  "教育背景",
  "技能",
  "专业技能",
  "获奖经历",
  "荣誉奖项",
  "校园经历",
];

const SECTION_HEADERS: Array<{
  sectionType: SectionType;
  patterns: string[];
}> = [
  {
    sectionType: "education",
    patterns: ["教育经历", "教育背景", "学历背景", "学历", "教育"],
  },
  {
    sectionType: "internship",
    patterns: ["实习经历", "工作经历", "职业经历", "任职经历", "实践经历"],
  },
  {
    sectionType: "project",
    patterns: ["项目经历", "项目经验", "项目", "作品集"],
  },
  {
    sectionType: "skill",
    patterns: ["专业技能", "技能", "工具", "语言能力"],
  },
  {
    sectionType: "achievement",
    patterns: ["获奖经历", "荣誉奖项", "证书", "奖项", "荣誉"],
  },
  {
    sectionType: "leadership",
    patterns: ["校园经历", "社团经历", "学生工作", "组织经历", "领导力"],
  },
];

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
    preferredSections: ["project", "internship"],
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
  return splitResumeText(resumeText).map((chunk, index) => ({
    id: `${slugFileName(fileName)}-chunk-${index + 1}`,
    fileName,
    title: chunk.title,
    text: chunk.text,
    sectionType: chunk.sectionType,
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
    .filter(Boolean);

  const chunks: Array<{
    text: string;
    sectionType: SectionType;
    title: string;
  }> = [];
  let currentSection: SectionType = "other";
  let currentLines: string[] = [];

  const flushSection = () => {
    if (!currentLines.length) return;

    const sectionText = currentLines.join("\n").trim();
    const sectionType =
      currentSection === "other" ? detectSectionType(sectionText) : currentSection;
    const sectionChunks = splitSectionIntoChunks(currentLines);

    for (const chunkLines of sectionChunks) {
      const text = chunkLines.join("\n").trim();
      if (!text) continue;
      chunks.push({
        text,
        sectionType,
        title: extractEvidenceTitle(sectionType, chunkLines),
      });
    }

    currentLines = [];
  };

  for (const line of lines) {
    const sectionStart = parseSectionStart(line);
    if (sectionStart) {
      flushSection();
      currentSection = sectionStart.sectionType;
      if (sectionStart.remainingText) currentLines.push(sectionStart.remainingText);
      continue;
    }

    currentLines.push(line);
  }

  flushSection();

  return chunks.length
    ? chunks
    : [
        {
          text: resumeText.slice(0, MAX_CHUNK_LENGTH),
          sectionType: detectSectionType(resumeText),
          title: extractEvidenceTitle(detectSectionType(resumeText), [resumeText]),
        },
      ];
}

function splitSectionIntoChunks(lines: string[]) {
  const chunks: string[][] = [];
  let current: string[] = [];
  let currentLength = 0;

  for (const line of lines) {
    const nextLength = currentLength + line.length + 1;
    if (nextLength > MAX_CHUNK_LENGTH && current.length) {
      chunks.push(current);
      current = [line];
      currentLength = line.length;
    } else {
      current.push(line);
      currentLength = nextLength;
    }
  }

  if (current.length) chunks.push(current);

  return chunks;
}

function parseSectionStart(line: string) {
  const compactLine = line.replace(/\s+/g, "");

  for (const { sectionType, patterns } of SECTION_HEADERS) {
    for (const pattern of patterns) {
      const normalizedPattern = pattern.replace(/\s+/g, "");
      const headerPattern = new RegExp(
        `^${escapeRegExp(pattern)}\\s*($|[:：｜|\\-—])`,
      );
      if (compactLine !== normalizedPattern && !headerPattern.test(line)) continue;

      const remainingText = line
        .replace(new RegExp(`^${escapeRegExp(pattern)}\\s*[:：｜|\\-—]*\\s*`), "")
        .trim();

      return {
        sectionType,
        remainingText:
          remainingText && remainingText !== line && !isGenericTitle(remainingText)
            ? remainingText
            : "",
      };
    }
  }

  return null;
}

function extractEvidenceTitle(sectionType: SectionType, lines: string[]) {
  const candidates = lines
    .map((line) => cleanEvidenceTitle(line))
    .filter((line) => line.length >= 2 && !isGenericTitle(line));

  const preferredCandidate =
    candidates.find((line) => isPreferredTitleCandidate(sectionType, line)) ||
    candidates[0] ||
    sectionTypeFallbackTitle(sectionType);

  return preferredCandidate.slice(0, 36);
}

function cleanEvidenceTitle(line: string) {
  return line
    .replace(/[●•]/g, " ")
    .replace(/[|｜]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(/[。；;:：]/)[0]
    .trim();
}

function isGenericTitle(text: string) {
  const compactText = text.replace(/\s+/g, "");
  return GENERIC_TITLE_PATTERNS.some((pattern) => compactText === pattern);
}

function isPreferredTitleCandidate(sectionType: SectionType, text: string) {
  if (sectionType === "project") {
    return /项目|系统|平台|工具|模型|分析|研究|产品|设计/.test(text);
  }

  if (sectionType === "internship") {
    return /实习|公司|部门|HRBP|产品|运营|研发|工程师|助理/.test(text);
  }

  if (sectionType === "skill") {
    return /SQL|Python|Java|Excel|Tableau|Figma|技能|工具/i.test(text);
  }

  if (sectionType === "achievement") {
    return /奖|证书|荣誉|竞赛|论文|专利/.test(text);
  }

  return true;
}

function sectionTypeFallbackTitle(sectionType: SectionType) {
  const labels: Record<SectionType, string> = {
    education: "教育背景",
    internship: "实习经历",
    project: "项目经历",
    skill: "技能",
    achievement: "成果",
    leadership: "协作经历",
    other: "简历证据",
  };

  return labels[sectionType];
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
  const isPreferenceDimension = dimension === "interviewerPreferenceMatch";

  if (isLowValueEvidenceChunk(chunk)) return 0;
  if (!isPreferenceDimension && chunk.sectionType === "education") return 0;
  if (
    (dimension === "jobRelevantExperience" ||
      dimension === "projectEvidenceStrength" ||
      dimension === "resumeClarity") &&
    !rule.preferredSections.includes(chunk.sectionType)
  ) {
    return 0;
  }

  const ruleKeywordScore = matchKeywords(chunk.text, rule.keywords).length * 2;
  const jdScore = chunk.jdMatchedKeywords.length * 2;
  const preferenceScore =
    isPreferenceDimension
      ? chunk.preferenceMatchedKeywords.length * 4
      : chunk.preferenceMatchedKeywords.length;

  return sectionScore + ruleKeywordScore + jdScore + preferenceScore;
}

function isLowValueEvidenceChunk(chunk: EvidenceChunk) {
  const content = `${chunk.title} ${chunk.text}`.toLowerCase();
  const hasContactSignal =
    /出生年月|出生日期|年龄|性别|籍贯|民族|政治面貌|联系方式|电话|手机|邮箱|email|wechat|微信|resume/.test(
      content,
    ) ||
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(content) ||
    /\b1[3-9]\d{9}\b/.test(content);

  if (!hasContactSignal) return false;

  const hasStrongExperienceSignal =
    /项目|实习|负责|推进|分析|调研|设计|上线|优化|指标|产出|用户|业务|产品|研发|开发/.test(
      content,
    );

  return !hasStrongExperienceSignal || chunk.sectionType === "other";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function slugFileName(fileName: string) {
  return fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 36);
}
