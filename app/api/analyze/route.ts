import { NextRequest, NextResponse } from "next/server";
import mammoth from "mammoth";

type AnalyzeRequest = {
  resumeText?: string;
  jobDescription?: string;
  interviewerPreferences?: string;
};

type CandidateAnalysis = {
  matchScore: number;
  matchLevel: string;
  strengths: string[];
  risks: string[];
  recommendation: "Yes" | "Maybe" | "No";
  recommendationReason: string;
};

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const requestData = await readAnalyzeRequest(request);
    const resumeText = requestData.resumeText.trim();
    const jobDescription = requestData.jobDescription.trim();
    const interviewerPreferences = requestData.interviewerPreferences.trim();

    if (!resumeText) {
      return NextResponse.json(
        { error: "请上传 PDF/DOCX 或粘贴候选人简历文本。" },
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
                "You are an expert recruiting analyst for HR users. Return only valid JSON. Be fair, avoid protected-class assumptions, and identify missing evidence as risks instead of inventing facts.",
            },
            {
              role: "user",
              content: [
                "请基于以下候选人简历文本、岗位描述和面试官偏好进行招聘匹配分析。",
                "你必须返回 JSON 对象，不要使用 Markdown，不要包裹代码块。",
                "",
                "JSON 格式必须严格为：",
                "{",
                '  "matchScore": number,',
                '  "matchLevel": "Strong Match" | "Medium Match" | "Weak Match",',
                '  "strengths": string[],',
                '  "risks": string[],',
                '  "recommendation": "Yes" | "Maybe" | "No",',
                '  "recommendationReason": string',
                "}",
                "",
                "输出要求：",
                "- matchScore 必须是 0 到 100 的数字。",
                "- strengths 输出 3 到 6 个简洁中文短语。",
                "- risks 输出 2 到 6 个简洁中文短语。",
                "- recommendation 只能是 Yes、Maybe 或 No。",
                "- recommendationReason 使用中文，说明推荐原因和需要面试验证的点。",
                "",
                `候选人简历：\n${resumeText}`,
                "",
                `岗位描述：\n${jobDescription}`,
                "",
                `面试官偏好：\n${interviewerPreferences || "未填写"}`,
              ].join("\n"),
            },
          ],
          response_format: { type: "json_object" },
          temperature: 0.2,
        }),
      },
    );

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("DeepSeek analysis request failed:", errorText);
      return NextResponse.json(
        { error: "分析失败，请重试。" },
        { status: 502 },
      );
    }

    const data = await aiResponse.json();
    const rawText = data.choices?.[0]?.message?.content;

    if (typeof rawText !== "string") {
      console.error("Unexpected DeepSeek response:", data);
      return NextResponse.json(
        { error: "分析失败，请重试。" },
        { status: 502 },
      );
    }

    const analysis = parseAndValidateAnalysis(rawText);
    return NextResponse.json(analysis);
  } catch (error) {
    console.error("Candidate analysis failed:", error);

    if (error instanceof UserFacingError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json(
      { error: "服务端分析失败，请稍后重试。" },
      { status: 500 },
    );
  }
}

function parseAndValidateAnalysis(rawText: string): CandidateAnalysis {
  const jsonText = rawText
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");
  const analysis = JSON.parse(jsonText) as Partial<CandidateAnalysis>;

  if (
    typeof analysis.matchScore !== "number" ||
    !Number.isFinite(analysis.matchScore) ||
    typeof analysis.matchLevel !== "string" ||
    !Array.isArray(analysis.strengths) ||
    !Array.isArray(analysis.risks) ||
    !["Yes", "Maybe", "No"].includes(String(analysis.recommendation)) ||
    typeof analysis.recommendationReason !== "string"
  ) {
    throw new Error("Invalid DeepSeek analysis response.");
  }

  const recommendation = normalizeRecommendation(analysis.recommendation);

  return {
    matchScore: Math.max(0, Math.min(100, Math.round(analysis.matchScore))),
    matchLevel: analysis.matchLevel,
    strengths: analysis.strengths.map(String).slice(0, 6),
    risks: analysis.risks.map(String).slice(0, 6),
    recommendation,
    recommendationReason: analysis.recommendationReason,
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

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const pastedResumeText = getFormString(formData, "resumeText");
    const jobDescription = getFormString(formData, "jobDescription");
    const interviewerPreferences = getFormString(
      formData,
      "interviewerPreferences",
    );
    const resumeFile = formData.get("resumeFile");
    const fileResumeText =
      resumeFile instanceof File ? await extractResumeText(resumeFile) : "";

    return {
      resumeText: pastedResumeText || fileResumeText,
      jobDescription,
      interviewerPreferences,
    };
  }

  const body = (await request.json()) as AnalyzeRequest;
  return {
    resumeText: body.resumeText || "",
    jobDescription: body.jobDescription || "",
    interviewerPreferences: body.interviewerPreferences || "",
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
    return parsedDocx.value.trim();
  }

  if (mimeType === "application/msword" || fileName.endsWith(".doc")) {
    throw new UserFacingError(
      "暂不支持旧版 .doc 文件，请上传 DOCX 或粘贴简历文本。",
    );
  }

  throw new UserFacingError("仅支持 PDF、DOCX，或直接粘贴简历文本。");
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
        "未能从 PDF 中提取到文本，请尝试粘贴简历文本。",
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
