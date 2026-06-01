import { NextRequest, NextResponse } from "next/server";
import mammoth from "mammoth";

type CandidateResume = {
  fileName: string;
  text: string;
};

type CandidateAnalysis = {
  candidateName: string;
  fileName: string;
  matchScore: number;
  matchLevel: string;
  strengths: string[];
  risks: string[];
  recommendation: "Yes" | "Maybe" | "No";
  recommendationReason: string;
};

type BatchAnalysis = {
  candidates: CandidateAnalysis[];
};

export const runtime = "nodejs";

const MAX_RESUME_COUNT = 20;
const MAX_RESUME_TEXT_LENGTH = 7000;

export async function POST(request: NextRequest) {
  try {
    const requestData = await readAnalyzeRequest(request);
    const jobDescription = requestData.jobDescription.trim();
    const interviewerPreferences = requestData.interviewerPreferences.trim();

    if (!requestData.resumes.length) {
      return NextResponse.json(
        { error: "请先批量上传候选人简历。" },
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
                resumes: requestData.resumes,
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
      requestData.resumes.map((resume) => resume.fileName),
    );

    return NextResponse.json(analysis);
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
  resumes: CandidateResume[];
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
        "简历文本：",
        resume.text.slice(0, MAX_RESUME_TEXT_LENGTH),
      ].join("\n"),
    )
    .join("\n\n---\n\n");

  return [
    "请基于同一个岗位 JD 和同一组面试官偏好，对多位候选人进行横向比较、评分和排序。",
    "你必须返回 JSON 对象，不要使用 Markdown，不要包裹代码块。",
    "",
    "JSON 格式必须严格为：",
    "{",
    '  "candidates": [',
    "    {",
    '      "candidateName": string,',
    '      "fileName": string,',
    '      "matchScore": number,',
    '      "matchLevel": "Strong Match" | "Medium Match" | "Weak Match",',
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
  fileNames: string[],
): BatchAnalysis {
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
    normalizeCandidateAnalysis(candidate, fileNames[index], index),
  );

  return {
    candidates: candidates.sort((a, b) => b.matchScore - a.matchScore),
  };
}

function normalizeCandidateAnalysis(
  candidate: Partial<CandidateAnalysis>,
  fallbackFileName: string,
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

  return {
    candidateName:
      typeof candidate.candidateName === "string" &&
      candidate.candidateName.trim()
        ? candidate.candidateName.trim()
        : `候选人 ${index + 1}`,
    fileName:
      typeof candidate.fileName === "string" && candidate.fileName.trim()
        ? candidate.fileName.trim()
        : fallbackFileName,
    matchScore: Math.max(0, Math.min(100, Math.round(candidate.matchScore))),
    matchLevel:
      typeof candidate.matchLevel === "string" && candidate.matchLevel.trim()
        ? candidate.matchLevel.trim()
        : "Medium Match",
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

  const resumes = await Promise.all(
    resumeFiles.map(async (file) => ({
      fileName: file.name,
      text: await extractResumeText(file),
    })),
  );

  return {
    resumes,
    jobDescription,
    interviewerPreferences,
  };
}

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

async function extractResumeText(file: File) {
  const fileName = file.name.toLowerCase();
  const mimeType = file.type;
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (mimeType === "application/pdf" || fileName.endsWith(".pdf")) {
    return extractPdfText(buffer);
  }

  if (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    fileName.endsWith(".docx")
  ) {
    const parsedDocx = await mammoth.extractRawText({ buffer });
    const text = parsedDocx.value.trim();

    if (!text) {
      throw new UserFacingError(
        `${file.name} 未能提取到文本，请检查文件内容。`,
      );
    }

    return text;
  }

  if (mimeType === "application/msword" || fileName.endsWith(".doc")) {
    throw new UserFacingError(
      "暂不支持旧版 .doc 文件，请上传 DOCX 或 PDF 简历。",
    );
  }

  throw new UserFacingError("仅支持 PDF 或 DOCX 简历。");
}

class UserFacingError extends Error {}

async function extractPdfText(buffer: Buffer) {
  ensurePromiseWithResolvers();
  await ensurePdfCanvasPolyfills();

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdfjsWorker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  (
    globalThis as typeof globalThis & {
      pdfjsWorker?: typeof pdfjsWorker;
    }
  ).pdfjsWorker = pdfjsWorker;

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: true,
    isEvalSupported: false,
    useWorkerFetch: false,
  } as unknown as Parameters<typeof pdfjs.getDocument>[0]);

  const document = await loadingTask.promise;

  try {
    const pageTexts = await Promise.all(
      Array.from({ length: document.numPages }, async (_, index) => {
        const page = await document.getPage(index + 1);
        const textContent = await page.getTextContent();
        return textContent.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ");
      }),
    );
    const text = pageTexts.join("\n").trim();

    if (!text) {
      throw new UserFacingError(
        "未能从 PDF 中提取到文本，请检查 PDF 是否为可复制文本。",
      );
    }

    return text;
  } finally {
    await document.destroy();
  }
}

async function ensurePdfCanvasPolyfills() {
  try {
    const canvas = await import("@napi-rs/canvas");
    const globalScope = globalThis as unknown as Record<string, unknown>;

    if (!globalScope.DOMMatrix && canvas.DOMMatrix) {
      globalScope.DOMMatrix = canvas.DOMMatrix;
    }

    if (!globalScope.ImageData && canvas.ImageData) {
      globalScope.ImageData = canvas.ImageData;
    }

    if (!globalScope.Path2D && canvas.Path2D) {
      globalScope.Path2D = canvas.Path2D;
    }
  } catch (error) {
    console.warn("PDF canvas polyfills are unavailable:", error);
  }
}

function ensurePromiseWithResolvers() {
  const promiseConstructor = Promise as unknown as {
    withResolvers?: <T>() => {
      promise: Promise<T>;
      resolve: (value: T | PromiseLike<T>) => void;
      reject: (reason?: unknown) => void;
    };
  };

  if (promiseConstructor.withResolvers) return;

  promiseConstructor.withResolvers = function withResolvers<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((promiseResolve, promiseReject) => {
      resolve = promiseResolve;
      reject = promiseReject;
    });

    return { promise, resolve, reject };
  };
}
