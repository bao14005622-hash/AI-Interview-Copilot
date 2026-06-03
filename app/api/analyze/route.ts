import { NextRequest, NextResponse } from "next/server";
import {
  extractResumeText,
  getParseErrorMessage,
  UserFacingError,
} from "@/lib/resume-parser";
import {
  createEvidenceChunks,
  emptyDimensionEvidenceMap,
  enrichEvidenceChunks,
  selectEvidenceByDimension,
  type DimensionEvidenceMap,
  type EvidenceChunk,
} from "@/lib/evidence-chunks";
import {
  normalizeScoreBreakdown,
  SCORE_DIMENSIONS,
  type ScoreBreakdown,
  type ScoreBreakdownKey,
} from "@/lib/candidate-scoring";

type CandidateResume = {
  fileName: string;
  text: string;
  evidenceChunks?: EvidenceChunk[];
};

type EvidencePreparedResume = CandidateResume & {
  evidenceChunks: EvidenceChunk[];
  evidenceByDimension: Record<ScoreBreakdownKey, EvidenceChunk[]>;
};

type FailedResume = {
  fileName: string;
  error: string;
};

type CandidateAnalysis = {
  candidateName: string;
  fileName: string;
  matchScore: number;
  matchLevel: string;
  scoreBreakdown: ScoreBreakdown;
  dimensionScores: DimensionEvidenceMap;
  evidenceChunks: EvidenceChunk[];
  strengths: string[];
  risks: string[];
  recommendation: "Yes" | "Maybe" | "No";
  recommendationReason: string;
};

type BatchAnalysis = {
  candidates: CandidateAnalysis[];
  failedResumes: FailedResume[];
};

type BatchAnalyzeJsonBody = {
  resumes?: CandidateResume[];
  failedResumes?: FailedResume[];
  jobDescription?: string;
  interviewerPreferences?: string;
};

export const runtime = "nodejs";

const MAX_RESUME_COUNT = 20;

export async function POST(request: NextRequest) {
  try {
    const requestData = await readAnalyzeRequest(request);
    const jobDescription = requestData.jobDescription.trim();
    const interviewerPreferences = requestData.interviewerPreferences.trim();

    if (!requestData.resumes.length) {
      return NextResponse.json(
        {
          error: requestData.failedResumes.length
            ? "所有简历都解析失败，请检查文件格式或内容。"
            : "请先批量上传候选人简历。",
          failedResumes: requestData.failedResumes,
        },
        { status: 400 },
      );
    }

    if (!jobDescription) {
      return NextResponse.json(
        { error: "请输入岗位描述。" },
        { status: 400 },
      );
    }

    if (!process.env.DEEPSEEK_API_KEY) {
      return NextResponse.json(
        { error: "缺少 DEEPSEEK_API_KEY，无法调用 DeepSeek 分析服务。" },
        { status: 500 },
      );
    }

    const preparedResumes = prepareEvidenceForAnalysis({
      resumes: requestData.resumes,
      jobDescription,
      interviewerPreferences,
    });

    const aiResponse = await fetch(
      `${process.env.DEEPSEEK_API_BASE || "https://api.deepseek.com"}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
          messages: [
            {
              role: "system",
              content:
                "You are an expert recruiting analyst for HR users. Return only valid JSON. Be fair, avoid protected-class assumptions, compare candidates against the same job description and preference priority, and identify missing evidence as risks instead of inventing facts.",
            },
            {
              role: "user",
              content: buildBatchAnalysisPrompt({
                resumes: preparedResumes,
                jobDescription,
                interviewerPreferences,
              }),
            },
          ],
          response_format: { type: "json_object" },
          temperature: 0.2,
        }),
      },
    );

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("DeepSeek batch analysis request failed:", errorText);
      return NextResponse.json(
        { error: "批量分析失败，请重试。" },
        { status: 502 },
      );
    }

    const data = await aiResponse.json();
    const rawText = data.choices?.[0]?.message?.content;

    if (typeof rawText !== "string") {
      console.error("Unexpected DeepSeek response:", data);
      return NextResponse.json(
        { error: "批量分析失败，请重试。" },
        { status: 502 },
      );
    }

    const analysis = parseAndValidateBatchAnalysis(
      rawText,
      preparedResumes,
    );

    return NextResponse.json({
      ...analysis,
      failedResumes: requestData.failedResumes,
    });
  } catch (error) {
    console.error("Batch candidate analysis failed:", error);

    if (error instanceof UserFacingError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json(
      { error: "服务端分析失败，请稍后重试。" },
      { status: 500 },
    );
  }
}

function buildBatchAnalysisPrompt({
  resumes,
  jobDescription,
  interviewerPreferences,
}: {
  resumes: EvidencePreparedResume[];
  jobDescription: string;
  interviewerPreferences: string;
}) {
  const preferenceLines = interviewerPreferences
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const preferencePriority = preferenceLines.length
    ? preferenceLines
        .map((line, index) => `${index + 1}. ${line}`)
        .join("\n")
    : "未填写";

  const resumeBlocks = resumes
    .map(
      (resume, index) => [
        `候选人 ${index + 1}`,
        `文件名：${resume.fileName}`,
        "召回证据 chunks：",
        formatEvidenceChunksForPrompt(resume.evidenceChunks),
        "按评分维度召回结果：",
        formatDimensionEvidenceForPrompt(resume.evidenceByDimension),
      ].join("\n"),
    )
    .join("\n\n---\n\n");

  return [
    "请基于同一个岗位 JD 和同一组面试官偏好，对多位候选人进行横向比较、评分和排序。",
    "评分定位：这是一个“面试推荐型”评分，不是基础学历筛选。用户导入简历前已经筛过学历和专业，所以不要让学历、学校、专业主导总分。",
    "你必须基于 evidence chunks 评分。每个评分维度都必须引用 evidenceIds；如果证据不足，不能给高分。",
    "你必须返回 JSON 对象，不要使用 Markdown，不要包裹代码块。",
    "",
    "总分规则：",
    "- 总分为 100 分，必须由五个维度综合得出。",
    ...SCORE_DIMENSIONS.map(
      (dimension) => `- ${dimension.label}：${dimension.maxScore} 分。`,
    ),
    "- 相关经历包括产品经理实习、运营、数据分析、商业分析、用户研究、增长、战略，或能体现 PRD、用户调研、竞品分析、需求拆解、数据分析、项目推进、业务复盘等能力的项目。",
    "- 面试官偏好只占 15 分，按行优先级递减；它会影响排序，但不能覆盖 JD 相关度和项目证据。",
    "- 不要编造简历中没有的经历、数据或成果。缺少证据时应写入 risks。",
    "- 如果某个维度没有足够 evidence，missingEvidence 必须明确写出缺少什么，例如“未发现 SQL 使用证据”“未发现用户研究经历”“未发现相关实习经历”。",
    "- 如果某个维度 evidenceIds 为空，该维度分数不能超过该维度满分的 40%。如果只有 1 条弱证据，该维度分数不能超过该维度满分的 60%。",
    "",
    "JSON 格式必须严格为：",
    "{",
    '  "candidates": [',
    "    {",
    '      "candidateName": string,',
    '      "fileName": string,',
    '      "matchScore": number,',
    '      "matchLevel": "Strong Match" | "Medium Match" | "Weak Match",',
    '      "scoreBreakdown": {',
    '        "jobRelevantExperience": number,',
    '        "projectEvidenceStrength": number,',
    '        "transferableCapability": number,',
    '        "resumeClarity": number,',
    '        "interviewerPreferenceMatch": number',
    "      },",
    '      "dimensionScores": {',
    '        "jobRelevantExperience": { "score": number, "maxScore": 35, "evidenceIds": string[], "matchedKeywords": string[], "missingKeywords": string[], "missingEvidence": string[], "reasoning": string },',
    '        "projectEvidenceStrength": { "score": number, "maxScore": 25, "evidenceIds": string[], "matchedKeywords": string[], "missingKeywords": string[], "missingEvidence": string[], "reasoning": string },',
    '        "transferableCapability": { "score": number, "maxScore": 15, "evidenceIds": string[], "matchedKeywords": string[], "missingKeywords": string[], "missingEvidence": string[], "reasoning": string },',
    '        "resumeClarity": { "score": number, "maxScore": 10, "evidenceIds": string[], "matchedKeywords": string[], "missingKeywords": string[], "missingEvidence": string[], "reasoning": string },',
    '        "interviewerPreferenceMatch": { "score": number, "maxScore": 15, "evidenceIds": string[], "matchedKeywords": string[], "missingKeywords": string[], "missingEvidence": string[], "reasoning": string }',
    "      },",
    '      "strengths": string[],',
    '      "risks": string[],',
    '      "recommendation": "Yes" | "Maybe" | "No",',
    '      "recommendationReason": string',
    "    }",
    "  ]",
    "}",
    "",
    "输出要求：",
    "- candidates 必须包含每一份简历对应的一位候选人，不要遗漏。",
    "- candidates 必须按 matchScore 从高到低排序。",
    "- candidateName 尽量从简历中提取真实姓名，无法确认时使用“候选人 X”。",
    "- fileName 必须使用输入中的原始文件名。",
    "- matchScore 必须是 0 到 100 的数字。",
    "- scoreBreakdown 中每一项不能超过对应维度满分。",
    "- dimensionScores 中每个维度的 score 必须和 scoreBreakdown 对应字段一致。",
    "- dimensionScores 中每个 evidenceIds 只能引用输入 evidence chunks 中存在的 id。",
    "- 不要在 JSON 中返回完整简历原文或完整 evidence chunk 文本，只返回 evidenceIds 和简短解释。",
    "- 85-100 分 recommendation 为 Yes；75-84 分通常为 Maybe；60-74 分为 Maybe 或 No；0-59 分为 No。",
    "- strengths 输出 2 到 4 个简洁中文短语。",
    "- risks 输出 2 到 4 个简洁中文短语。",
    "- recommendation 只能是 Yes、Maybe 或 No。",
    "- recommendationReason 使用中文，一句话说明推荐或不推荐的主要原因。",
    "- 面试官偏好按行优先级递减，越靠前权重越高。",
    "",
    `岗位描述：\n${jobDescription}`,
    "",
    `面试官偏好优先级：\n${preferencePriority}`,
    "",
    `候选人简历列表：\n${resumeBlocks}`,
  ].join("\n");
}

function parseAndValidateBatchAnalysis(
  rawText: string,
  resumes: EvidencePreparedResume[],
): Omit<BatchAnalysis, "failedResumes"> {
  const jsonText = rawText
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");
  const analysis = JSON.parse(jsonText) as Partial<BatchAnalysis>;

  if (!Array.isArray(analysis.candidates)) {
    throw new Error("Invalid DeepSeek batch analysis response.");
  }

  const candidates = analysis.candidates.map((candidate, index) =>
    normalizeCandidateAnalysis(candidate, resumes[index], index),
  );

  return {
    candidates: candidates.sort((a, b) => b.matchScore - a.matchScore),
  };
}

function normalizeCandidateAnalysis(
  candidate: Partial<CandidateAnalysis>,
  fallbackResume: EvidencePreparedResume,
  index: number,
): CandidateAnalysis {
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    typeof candidate.matchScore !== "number" ||
    !Number.isFinite(candidate.matchScore) ||
    !Array.isArray(candidate.strengths) ||
    !Array.isArray(candidate.risks) ||
    !["Yes", "Maybe", "No"].includes(String(candidate.recommendation))
  ) {
    throw new Error("Invalid DeepSeek candidate analysis response.");
  }

  const recommendation = normalizeRecommendation(candidate.recommendation);
  const scoreBreakdown = normalizeScoreBreakdown(candidate.scoreBreakdown);
  const dimensionScores = normalizeDimensionScores(
    candidate.dimensionScores,
    scoreBreakdown,
    fallbackResume,
  );
  const rawMatchScore = Math.max(
    0,
    Math.min(100, Math.round(candidate.matchScore)),
  );

  return {
    candidateName:
      typeof candidate.candidateName === "string" &&
      candidate.candidateName.trim()
        ? candidate.candidateName.trim()
        : `候选人 ${index + 1}`,
    fileName:
      typeof candidate.fileName === "string" && candidate.fileName.trim()
        ? candidate.fileName.trim()
        : fallbackResume.fileName,
    matchScore: rawMatchScore,
    matchLevel:
      typeof candidate.matchLevel === "string" && candidate.matchLevel.trim()
        ? candidate.matchLevel.trim()
        : "Medium Match",
    scoreBreakdown,
    dimensionScores,
    evidenceChunks: normalizeReferencedEvidenceChunks(
      candidate.evidenceChunks,
      fallbackResume.evidenceChunks,
      dimensionScores,
    ),
    strengths: candidate.strengths.map(String).slice(0, 4),
    risks: candidate.risks.map(String).slice(0, 4),
    recommendation,
    recommendationReason:
      typeof candidate.recommendationReason === "string" &&
      candidate.recommendationReason.trim()
        ? candidate.recommendationReason.trim()
        : "建议在面试中进一步验证候选人与岗位要求的匹配度。",
  };
}

function normalizeRecommendation(
  recommendation: Partial<CandidateAnalysis>["recommendation"],
) {
  if (recommendation === "Yes" || recommendation === "Maybe" || recommendation === "No") {
    return recommendation;
  }

  throw new Error("Invalid DeepSeek recommendation response.");
}

async function readAnalyzeRequest(request: NextRequest) {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const body = (await request.json()) as BatchAnalyzeJsonBody;
    return {
      resumes: Array.isArray(body.resumes)
        ? body.resumes.filter(
            (resume) =>
              typeof resume.fileName === "string" &&
              typeof resume.text === "string" &&
              resume.text.trim(),
          )
        : [],
      failedResumes: Array.isArray(body.failedResumes)
        ? body.failedResumes.filter(
            (resume) =>
              typeof resume.fileName === "string" &&
              typeof resume.error === "string",
          )
        : [],
      jobDescription: body.jobDescription || "",
      interviewerPreferences: body.interviewerPreferences || "",
    };
  }

  if (!contentType.includes("multipart/form-data")) {
    throw new UserFacingError("请上传 PDF 或 DOCX 简历文件。");
  }

  const formData = await request.formData();
  const jobDescription = getFormString(formData, "jobDescription");
  const interviewerPreferences = getFormString(
    formData,
    "interviewerPreferences",
  );
  const resumeFiles = formData
    .getAll("resumeFiles")
    .filter((file): file is File => file instanceof File);

  if (resumeFiles.length > MAX_RESUME_COUNT) {
    throw new UserFacingError(`单次最多支持 ${MAX_RESUME_COUNT} 份简历。`);
  }

  const parseResults = await Promise.all(
    resumeFiles.map(async (file) => {
      try {
        const text = await extractResumeText(file);
        return {
          status: "success" as const,
          resume: {
            fileName: file.name,
            text,
            evidenceChunks: createEvidenceChunks(file.name, text),
          },
        };
      } catch (error) {
        return {
          status: "failed" as const,
          failedResume: {
            fileName: file.name,
            error: getParseErrorMessage(error),
          },
        };
      }
    }),
  );
  const resumes = parseResults
    .filter((result) => result.status === "success")
    .map((result) => result.resume);
  const failedResumes = parseResults
    .filter((result) => result.status === "failed")
    .map((result) => result.failedResume);

  return {
    resumes,
    failedResumes,
    jobDescription,
    interviewerPreferences,
  };
}

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function prepareEvidenceForAnalysis({
  resumes,
  jobDescription,
  interviewerPreferences,
}: {
  resumes: CandidateResume[];
  jobDescription: string;
  interviewerPreferences: string;
}): EvidencePreparedResume[] {
  return resumes.map((resume) => {
    const baseChunks = resume.evidenceChunks?.length
      ? resume.evidenceChunks
      : createEvidenceChunks(resume.fileName, resume.text);
    const enrichedChunks = enrichEvidenceChunks({
      chunks: baseChunks,
      jobDescription,
      interviewerPreferences,
    });
    const { selectedByDimension, selectedChunks } =
      selectEvidenceByDimension(enrichedChunks);

    return {
      ...resume,
      evidenceChunks: selectedChunks,
      evidenceByDimension: selectedByDimension,
    };
  });
}

function formatEvidenceChunksForPrompt(chunks: EvidenceChunk[]) {
  if (!chunks.length) return "未召回到证据片段。";

  return chunks
    .map(
      (chunk) =>
        [
          `id: ${chunk.id}`,
          `title: ${chunk.title}`,
          `sectionType: ${chunk.sectionType}`,
          `relevanceScore: ${chunk.relevanceScore}`,
          `jdMatchedKeywords: ${chunk.jdMatchedKeywords.join(", ") || "无"}`,
          `preferenceMatchedKeywords: ${
            chunk.preferenceMatchedKeywords.join(", ") || "无"
          }`,
          `text: ${chunk.text}`,
        ].join("\n"),
    )
    .join("\n\n");
}

function formatDimensionEvidenceForPrompt(
  evidenceByDimension: Record<ScoreBreakdownKey, EvidenceChunk[]>,
) {
  return SCORE_DIMENSIONS.map((dimension) => {
    const chunks = evidenceByDimension[dimension.key] || [];
    const evidenceIds = chunks.map((chunk) => chunk.id).join(", ") || "无";
    return `${dimension.label}(${dimension.key}, ${dimension.maxScore}分): ${evidenceIds}`;
  }).join("\n");
}

function normalizeDimensionScores(
  value: unknown,
  scoreBreakdown: ScoreBreakdown,
  fallbackResume: EvidencePreparedResume,
): DimensionEvidenceMap {
  const source =
    typeof value === "object" && value !== null
      ? (value as Partial<DimensionEvidenceMap>)
      : {};
  const availableEvidenceChunks = fallbackResume.evidenceChunks;
  const availableIds = new Set(availableEvidenceChunks.map((chunk) => chunk.id));

  return SCORE_DIMENSIONS.reduce<DimensionEvidenceMap>((result, dimension) => {
    const rawDimension = source[dimension.key];
    const fallbackChunks = fallbackResume.evidenceByDimension[dimension.key] || [];
    const fallbackEvidenceIds = fallbackChunks.map((chunk) => chunk.id);
    const rawEvidenceIds = Array.isArray(rawDimension?.evidenceIds)
      ? rawDimension.evidenceIds.map(String)
      : [];
    const evidenceIds = rawEvidenceIds.filter((id) => availableIds.has(id));
    const finalEvidenceIds = evidenceIds.length ? evidenceIds : fallbackEvidenceIds;
    const fallbackMatchedKeywords = Array.from(
      new Set(
        fallbackChunks.flatMap((chunk) => [
          ...chunk.jdMatchedKeywords,
          ...chunk.preferenceMatchedKeywords,
        ]),
      ),
    ).slice(0, 8);
    const score =
      typeof rawDimension?.score === "number" &&
      Number.isFinite(rawDimension.score)
        ? rawDimension.score
        : scoreBreakdown[dimension.key];

    result[dimension.key] = {
      score: Math.max(0, Math.min(dimension.maxScore, Math.round(score))),
      maxScore: dimension.maxScore,
      evidenceIds: finalEvidenceIds,
      matchedKeywords: Array.isArray(rawDimension?.matchedKeywords)
        ? rawDimension.matchedKeywords.map(String).slice(0, 8)
        : fallbackMatchedKeywords,
      missingKeywords: Array.isArray(rawDimension?.missingKeywords)
        ? rawDimension.missingKeywords.map(String).slice(0, 8)
        : [],
      missingEvidence: Array.isArray(rawDimension?.missingEvidence)
        ? rawDimension.missingEvidence.map(String).slice(0, 5)
        : finalEvidenceIds.length
          ? []
          : [`${dimension.label}缺少足够证据。`],
      reasoning:
        typeof rawDimension?.reasoning === "string" &&
        rawDimension.reasoning.trim()
          ? rawDimension.reasoning.trim()
          : "该维度需要在面试中进一步验证。",
    };

    return result;
  }, emptyDimensionEvidenceMap());
}

function normalizeReferencedEvidenceChunks(
  value: unknown,
  fallbackEvidenceChunks: EvidenceChunk[],
  dimensionScores: DimensionEvidenceMap,
) {
  const fallbackById = new Map(
    fallbackEvidenceChunks.map((chunk) => [chunk.id, chunk]),
  );
  const referencedIds = new Set(
    SCORE_DIMENSIONS.flatMap(
      (dimension) => dimensionScores[dimension.key].evidenceIds,
    ),
  );
  const aiChunks = Array.isArray(value) ? value : [];
  const aiChunkById = new Map(
    aiChunks
      .filter(
        (chunk): chunk is EvidenceChunk =>
          typeof chunk === "object" &&
          chunk !== null &&
          typeof (chunk as EvidenceChunk).id === "string",
      )
      .map((chunk) => [chunk.id, chunk]),
  );

  return Array.from(referencedIds)
    .map((id) => fallbackById.get(id) || aiChunkById.get(id))
    .filter((chunk): chunk is EvidenceChunk => Boolean(chunk));
}
