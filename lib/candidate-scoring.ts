export type ScoreBreakdown = {
  jobRelevantExperience: number;
  projectEvidenceStrength: number;
  transferableCapability: number;
  resumeClarity: number;
  interviewerPreferenceMatch: number;
};

export type ScoreBreakdownKey = keyof ScoreBreakdown;

export const SCORE_CAP_WITHOUT_RELEVANT_EXPERIENCE = 75;

export const SCORE_DIMENSIONS: {
  key: ScoreBreakdownKey;
  label: string;
  maxScore: number;
}[] = [
  {
    key: "jobRelevantExperience",
    label: "岗位相关",
    maxScore: 35,
  },
  {
    key: "projectEvidenceStrength",
    label: "项目证据",
    maxScore: 25,
  },
  {
    key: "transferableCapability",
    label: "能力迁移",
    maxScore: 15,
  },
  {
    key: "resumeClarity",
    label: "表达清晰",
    maxScore: 10,
  },
  {
    key: "interviewerPreferenceMatch",
    label: "偏好匹配",
    maxScore: 15,
  },
];

export function emptyScoreBreakdown(): ScoreBreakdown {
  return {
    jobRelevantExperience: 0,
    projectEvidenceStrength: 0,
    transferableCapability: 0,
    resumeClarity: 0,
    interviewerPreferenceMatch: 0,
  };
}

export function normalizeScoreBreakdown(value: unknown): ScoreBreakdown {
  const source =
    typeof value === "object" && value !== null
      ? (value as Partial<Record<ScoreBreakdownKey, unknown>>)
      : {};

  return SCORE_DIMENSIONS.reduce<ScoreBreakdown>((breakdown, dimension) => {
    breakdown[dimension.key] = clampScore(source[dimension.key], dimension.maxScore);
    return breakdown;
  }, emptyScoreBreakdown());
}

export function getScoreBreakdownTotal(scoreBreakdown: ScoreBreakdown) {
  return SCORE_DIMENSIONS.reduce(
    (total, dimension) => total + scoreBreakdown[dimension.key],
    0,
  );
}

function clampScore(value: unknown, maxScore: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(maxScore, Math.round(value)));
}
