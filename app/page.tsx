"use client";

import { ChangeEvent, Fragment, useMemo, useState } from "react";
import {
  SCORE_DIMENSIONS,
  type ScoreBreakdown,
} from "@/lib/candidate-scoring";
import type {
  DimensionEvidenceMap,
  EvidenceChunk,
} from "@/lib/evidence-chunks";
import type { AgentFlowStep } from "@/lib/agent-flow";
import {
  getDisplayEvidenceItems,
  type DisplayEvidenceItem,
} from "@/lib/evidence-display";

type Recommendation = "Yes" | "Maybe" | "No";

type CandidateFile = {
  id: string;
  file: File;
};

type CandidateResult = {
  candidateName: string;
  fileName: string;
  matchScore: number;
  matchLevel: string;
  scoreBreakdown: ScoreBreakdown;
  dimensionScores: DimensionEvidenceMap;
  evidenceChunks: EvidenceChunk[];
  strengths: string[];
  risks: string[];
  recommendation: Recommendation;
  recommendationReason: string;
  agentFlow: AgentFlowStep[];
};

type FailedResume = {
  fileName: string;
  error: string;
};

type ParsedResume = {
  fileName: string;
  text: string;
  evidenceChunks: EvidenceChunk[];
};

type BatchAnalysisResult = {
  candidates: CandidateResult[];
  failedResumes: FailedResume[];
};

const preferenceExample = [
  "QS 前 200",
  "985/211",
  "产品经理实习经历",
  "数据分析能力",
  "业务思维",
  "英语流利",
].join("\n");

export default function Home() {
  const [jd, setJd] = useState("");
  const [preferences, setPreferences] = useState("");
  const [candidateFiles, setCandidateFiles] = useState<CandidateFile[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<BatchAnalysisResult | null>(null);
  const [parsedFileNames, setParsedFileNames] = useState<Set<string>>(new Set());

  const sortedCandidates = useMemo(() => {
    return [...(result?.candidates || [])].sort(
      (a, b) => b.matchScore - a.matchScore,
    );
  }, [result]);

  const recommendedCount = useMemo(() => {
    return sortedCandidates.filter(
      (candidate) => candidate.recommendation === "Yes",
    ).length;
  }, [sortedCandidates]);

  const averageScore = useMemo(() => {
    if (!sortedCandidates.length) return 0;
    const total = sortedCandidates.reduce(
      (sum, candidate) => sum + candidate.matchScore,
      0,
    );
    return Math.round(total / sortedCandidates.length);
  }, [sortedCandidates]);
  const failedResumeMap = useMemo(() => {
    return new Map(
      (result?.failedResumes || []).map((failedResume) => [
        failedResume.fileName,
        failedResume.error,
      ]),
    );
  }, [result]);
  const analyzedFileNames = useMemo(() => {
    return new Set((result?.candidates || []).map((candidate) => candidate.fileName));
  }, [result]);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    setCandidateFiles((currentFiles) => {
      const existingKeys = new Set(currentFiles.map(getCandidateFileKey));
      const nextFiles = files
        .filter((file) => !existingKeys.has(getFileKey(file)))
        .map((file) => ({
          id: `${getFileKey(file)}-${crypto.randomUUID()}`,
          file,
        }));

      return [...currentFiles, ...nextFiles];
    });
    setError("");
    setResult(null);
    setParsedFileNames(new Set());
    event.target.value = "";
  }

  function removeCandidateFile(id: string) {
    setCandidateFiles((currentFiles) =>
      currentFiles.filter((candidateFile) => candidateFile.id !== id),
    );
    setError("");
    setResult(null);
    setParsedFileNames(new Set());
  }

  async function handleAnalyze() {
    setError("");

    if (!candidateFiles.length) {
      setError("请先批量上传候选人简历。");
      return;
    }

    if (!jd.trim()) {
      setError("请输入岗位描述。");
      return;
    }

    setIsAnalyzing(true);

    try {
      setResult({ candidates: [], failedResumes: [] });
      setParsedFileNames(new Set());

      const parseResult = await parseCandidateFiles(candidateFiles, {
        onFileParsed: (fileName) => {
          setParsedFileNames((currentFileNames) => {
            const nextFileNames = new Set(currentFileNames);
            nextFileNames.add(fileName);
            return nextFileNames;
          });
        },
        onFileFailed: (failedResume) => {
          setResult((currentResult) => ({
            candidates: currentResult?.candidates || [],
            failedResumes: [
              ...(currentResult?.failedResumes || []),
              failedResume,
            ],
          }));
        },
      });

      setResult({
        candidates: [],
        failedResumes: parseResult.failedResumes,
      });

      if (!parseResult.parsedResumes.length) {
        throw new Error("所有简历都解析失败，请检查文件格式或内容。");
      }

      const response = await fetchAnalyzeWithRetry({
        resumes: parseResult.parsedResumes,
        failedResumes: parseResult.failedResumes,
        jobDescription: jd.trim(),
        interviewerPreferences: preferences.trim(),
      });

      const payload = await parseAnalyzeResponse(response);

      if (!response.ok) {
        if (payload.data?.failedResumes.length) {
          setResult(payload.data);
        }
        throw new Error(payload.error || "批量分析失败，请重试。");
      }

      if (!payload.data) {
        throw new Error("分析结果格式异常，请重试。");
      }

      setResult({
        candidates: payload.data.candidates,
        failedResumes: payload.data.failedResumes || [],
      });

      if (payload.data.failedResumes?.length) {
        setError(
          `${payload.data.failedResumes.length} 份简历解析失败，已在上传列表中标注。`,
        );
      }
    } catch (analysisError) {
      setError(
        getAnalyzeErrorMessage(analysisError),
      );
    } finally {
      setIsAnalyzing(false);
    }
  }

  return (
    <main className="min-h-screen px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-7">
        <header className="overflow-hidden rounded-[1.75rem] border border-slate-900 bg-slate-950 shadow-2xl shadow-slate-300/70">
          <div className="grid gap-8 bg-[linear-gradient(135deg,rgba(15,23,42,1)_0%,rgba(17,24,39,0.96)_48%,rgba(6,78,59,0.92)_100%)] px-5 py-7 text-white md:px-8 md:py-9 lg:grid-cols-[1.18fr_0.82fr] lg:items-center">
            <div>
              <div className="mb-5 inline-flex items-center rounded-full border border-emerald-300/30 bg-white/10 px-3 py-1 text-sm font-medium text-emerald-100">
                面向 HR 实习生与招聘团队的批量候选人排序工具
              </div>
              <h1 className="max-w-3xl text-4xl font-semibold tracking-normal text-white sm:text-5xl lg:text-6xl">
                AI 面试招聘助手
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-7 text-slate-200 sm:text-lg">
                一次上传多份简历，结合岗位描述和面试官优先级偏好，自动生成候选人排序、匹配评分、推荐程度和关键风险。
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <HeroPill label="批量上传" />
                <HeroPill label="优先级评分" />
                <HeroPill label="候选人排序" />
                <HeroPill label="招聘建议" />
              </div>
            </div>

            <div className="rounded-[1.5rem] border border-white/15 bg-white/10 p-4 shadow-xl shadow-slate-950/20 backdrop-blur">
              <div className="rounded-2xl border border-white/10 bg-white p-4 text-slate-950 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-500">批量筛选预览</p>
                    <p className="mt-2 text-3xl font-semibold">排序优先</p>
                  </div>
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-700">
                    API 分析
                  </span>
                </div>
                <div className="mt-5 grid grid-cols-3 gap-3 text-center">
                  <Metric label="候选人" value={String(candidateFiles.length)} />
                  <Metric label="输入维度" value="3" />
                  <Metric label="输出" value="排序表" />
                </div>
                <div className="mt-5 rounded-2xl bg-slate-50 p-4">
                  <div className="mb-3 flex items-center justify-between text-sm">
                    <span className="font-medium text-slate-700">候选人队列完整度</span>
                    <span className="font-semibold text-emerald-700">
                      {candidateFiles.length ? "可分析" : "待上传"}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full rounded-full bg-emerald-500"
                      style={{
                        width: `${Math.min(candidateFiles.length * 5, 100)}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="rounded-[1.5rem] border border-slate-200/80 bg-white p-5 shadow-xl shadow-slate-200/70 md:p-6">
            <SectionHeader
              eyebrow="候选人简历"
              title="批量上传候选人材料"
              description="一次上传多份 PDF 或 DOCX，上传后会形成候选人列表。发现错误简历时，可以直接从列表中删除。"
            />

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <FileInput
                accept=".pdf,application/pdf"
                label="批量上传 PDF"
                helper="支持一次选择多份 PDF 简历"
                onChange={handleFileChange}
              />
              <FileInput
                accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                label="批量上传 DOCX"
                helper="支持一次选择多份 DOCX 简历"
                onChange={handleFileChange}
              />
            </div>

            <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    候选人上传列表
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    当前 {candidateFiles.length} 份简历，分析前可随时剔除错误文件。
                  </p>
                </div>
                {candidateFiles.length ? (
                  <button
                    type="button"
                    onClick={() => {
                      setCandidateFiles([]);
                      setResult(null);
                      setError("");
                    }}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 transition hover:border-red-200 hover:text-red-600"
                  >
                    清空列表
                  </button>
                ) : null}
              </div>

              {candidateFiles.length ? (
                <div className="mt-4 flex flex-col gap-3">
                  {candidateFiles.map((candidateFile, index) => (
                    <CandidateFileRow
                      candidateFile={candidateFile}
                      failureReason={failedResumeMap.get(candidateFile.file.name)}
                      index={index}
                      isAnalyzed={analyzedFileNames.has(candidateFile.file.name)}
                      isParsing={isAnalyzing && !parsedFileNames.has(candidateFile.file.name)}
                      key={candidateFile.id}
                      onRemove={removeCandidateFile}
                    />
                  ))}
                </div>
              ) : (
                <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center">
                  <p className="text-sm font-semibold text-slate-700">
                    还没有上传简历
                  </p>
                  <p className="mt-2 text-sm text-slate-500">
                    可以一次选择 10 到 20 份候选人简历，再统一分析排序。
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-[1.5rem] border border-slate-200/80 bg-white p-5 shadow-xl shadow-slate-200/70 md:p-6">
            <SectionHeader
              eyebrow="岗位信息"
              title="定义候选人评估标准"
              description="岗位描述和面试官偏好在分析后都会保留，方便换一批简历继续筛选。"
            />

            <label className="mt-6 block">
              <span className="mb-2 block text-sm font-semibold text-slate-800">
                岗位描述
              </span>
              <textarea
                value={jd}
                onChange={(event) => {
                  setJd(event.target.value);
                  setError("");
                }}
                rows={11}
                className="min-h-72 w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-800 outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-100"
                placeholder="请在此粘贴目标岗位描述..."
              />
            </label>

            <label className="mt-5 block">
              <span className="mb-2 block text-sm font-semibold text-slate-800">
                面试官偏好优先级
              </span>
              <textarea
                value={preferences}
                onChange={(event) => setPreferences(event.target.value)}
                rows={7}
                className="min-h-44 w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-800 outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-100"
                placeholder={preferenceExample}
              />
              <span className="mt-2 block text-xs leading-5 text-slate-500">
                按行填写，越靠上的偏好优先级越高，AI 会据此调整候选人评分和排序。
              </span>
            </label>
          </div>
        </section>

        <section className="sticky bottom-4 z-10 rounded-[1.5rem] border border-slate-200 bg-white/95 p-4 shadow-2xl shadow-slate-300/60 backdrop-blur">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-900">
                准备进行批量候选人排序
              </p>
              <p className="mt-1 text-sm text-slate-500">
                将基于同一 JD 和偏好优先级，对 {candidateFiles.length} 份简历统一评分并排序。
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              {error ? (
                <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                  {error}
                </p>
              ) : null}
              <button
                type="button"
                onClick={handleAnalyze}
                disabled={isAnalyzing}
                className="min-h-12 rounded-xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-200 transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-400 disabled:shadow-none"
              >
                {isAnalyzing ? "正在批量分析..." : "批量分析候选人"}
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-[1.5rem] border border-slate-200/80 bg-white p-5 shadow-xl shadow-slate-200/70 md:p-6">
          <SectionHeader
            eyebrow="分析结果看板"
            title="候选人排序结果"
            description="结果按匹配分数降序排列，帮助招聘人员优先面试最值得推进的候选人。"
          />

          {sortedCandidates.length ? (
            <div className="mt-6 flex flex-col gap-5">
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
                <SummaryCard label="已分析候选人" value={String(sortedCandidates.length)} />
                <SummaryCard
                  label="最高匹配分"
                  value={`${sortedCandidates[0]?.matchScore || 0}/100`}
                />
                <SummaryCard label="推荐推进" value={String(recommendedCount)} />
                <SummaryCard label="平均匹配分" value={`${averageScore}/100`} />
                <SummaryCard
                  label="解析失败"
                  value={String(result?.failedResumes?.length || 0)}
                />
              </div>

              <CandidateRankingTable candidates={sortedCandidates} />
            </div>
          ) : (
            <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-14 text-center">
              <p className="text-base font-semibold text-slate-800">
                批量分析完成后，候选人排序会展示在这里。
              </p>
              <p className="mt-2 text-sm text-slate-500">
                排名、候选人姓名、匹配分数、推荐程度、优势和风险会集中呈现。
              </p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

async function parseAnalyzeResponse(response: Response) {
  const responseText = await response.text();

  try {
    const parsed = JSON.parse(responseText);

    if (!response.ok) {
      return {
        error:
          typeof parsed?.error === "string"
            ? parsed.error
            : "批量分析失败，请重试。",
        data: {
          candidates: Array.isArray(parsed?.candidates) ? parsed.candidates : [],
          failedResumes: Array.isArray(parsed?.failedResumes)
            ? parsed.failedResumes
            : [],
        } as BatchAnalysisResult,
      };
    }

    return {
      error: "",
      data: {
        candidates: Array.isArray(parsed?.candidates) ? parsed.candidates : [],
        failedResumes: Array.isArray(parsed?.failedResumes)
          ? parsed.failedResumes
          : [],
      } as BatchAnalysisResult,
    };
  } catch {
    return {
      error: response.ok
        ? "分析结果格式异常，请重试。"
        : "线上服务暂时不可用，请稍后重试。",
      data: null,
    };
  }
}

async function parseCandidateFiles(
  candidateFiles: CandidateFile[],
  callbacks: {
    onFileParsed: (fileName: string) => void;
    onFileFailed: (failedResume: FailedResume) => void;
  },
) {
  const parsedResumes: ParsedResume[] = [];
  const failedResumes: FailedResume[] = [];

  for (const candidateFile of candidateFiles) {
    const formData = new FormData();
    formData.append("resumeFile", candidateFile.file);

    try {
      const response = await fetch("/api/parse-resume", {
        method: "POST",
        body: formData,
        cache: "no-store",
      });
      const payload = await parseResumeResponse(response, candidateFile.file.name);

      if (!response.ok) {
        throw new Error(payload.error);
      }

      parsedResumes.push({
        fileName: payload.fileName,
        text: payload.text,
        evidenceChunks: payload.evidenceChunks,
      });
      callbacks.onFileParsed(candidateFile.file.name);
    } catch (error) {
      const failedResume = {
        fileName: candidateFile.file.name,
        error:
          error instanceof Error
            ? error.message
            : "简历解析失败，请检查文件是否损坏。",
      };
      failedResumes.push(failedResume);
      callbacks.onFileFailed(failedResume);
    }
  }

  return { parsedResumes, failedResumes };
}

async function parseResumeResponse(response: Response, fallbackFileName: string) {
  try {
    const parsed = await response.json();

    return {
      fileName:
        typeof parsed?.fileName === "string" ? parsed.fileName : fallbackFileName,
      text: typeof parsed?.text === "string" ? parsed.text : "",
      evidenceChunks: Array.isArray(parsed?.evidenceChunks)
        ? parsed.evidenceChunks
        : [],
      error:
        typeof parsed?.error === "string"
          ? parsed.error
          : "简历解析失败，请检查文件是否损坏。",
    };
  } catch {
    return {
      fileName: fallbackFileName,
      text: "",
      evidenceChunks: [],
      error: "简历解析失败，请检查文件是否损坏。",
    };
  }
}

async function fetchAnalyzeWithRetry(body: {
  resumes: ParsedResume[];
  failedResumes: FailedResume[];
  jobDescription: string;
  interviewerPreferences: string;
}) {
  const requestBody = {
    ...body,
    resumes: body.resumes.map((resume) => ({
      fileName: resume.fileName,
      text: resume.text,
    })),
  };

  try {
    return await fetch("/api/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      cache: "no-store",
    });
  } catch {
    return fetch("/api/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      cache: "no-store",
    });
  }
}

function getAnalyzeErrorMessage(error: unknown) {
  if (error instanceof Error && error.message !== "Failed to fetch") {
    return error.message;
  }

  return "网络连接中断，请刷新页面后再试。";
}

function getFileKey(file: File) {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

function getCandidateFileKey(candidateFile: CandidateFile) {
  return getFileKey(candidateFile.file);
}

function formatFileSize(size: number) {
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function recommendationLabel(recommendation: Recommendation) {
  if (recommendation === "Yes") return "推荐";
  if (recommendation === "Maybe") return "谨慎考虑";
  return "不推荐";
}

function recommendationClass(recommendation: Recommendation) {
  if (recommendation === "Yes") return "bg-emerald-50 text-emerald-700";
  if (recommendation === "Maybe") return "bg-amber-50 text-amber-700";
  return "bg-red-50 text-red-700";
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-20 rounded-xl border border-slate-100 bg-white px-3 py-3 shadow-sm">
      <div className="text-lg font-semibold text-slate-950">{value}</div>
      <div className="mt-1 text-xs font-medium text-slate-500">{label}</div>
    </div>
  );
}

function HeroPill({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-sm font-medium text-slate-100">
      {label}
    </span>
  );
}

function SectionHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div>
      <p className="text-xs font-bold tracking-[0.16em] text-emerald-700">
        {eyebrow}
      </p>
      <h2 className="mt-2 text-2xl font-semibold text-slate-950">{title}</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
        {description}
      </p>
    </div>
  );
}

function FileInput({
  accept,
  label,
  helper,
  onChange,
}: {
  accept: string;
  label: string;
  helper: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label className="group flex min-h-36 cursor-pointer flex-col justify-between rounded-2xl border border-dashed border-slate-300 bg-gradient-to-br from-slate-50 to-white p-4 shadow-sm transition hover:border-emerald-500 hover:bg-emerald-50/60 hover:shadow-md">
      <input
        className="sr-only"
        type="file"
        accept={accept}
        multiple
        onChange={onChange}
      />
      <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-100 bg-white text-lg font-semibold text-emerald-700 shadow-sm">
        +
      </span>
      <span>
        <span className="block text-sm font-semibold text-slate-900">{label}</span>
        <span className="mt-1 block text-sm leading-5 text-slate-500">{helper}</span>
      </span>
    </label>
  );
}

function CandidateFileRow({
  candidateFile,
  failureReason,
  index,
  isAnalyzed,
  isParsing,
  onRemove,
}: {
  candidateFile: CandidateFile;
  failureReason?: string;
  index: number;
  isAnalyzed: boolean;
  isParsing: boolean;
  onRemove: (id: string) => void;
}) {
  const fileExtension =
    candidateFile.file.name.split(".").pop()?.toUpperCase() || "FILE";
  const status = getCandidateFileStatus({
    failureReason,
    isAnalyzed,
    isParsing,
  });

  return (
    <div
      className={`grid gap-3 rounded-2xl border bg-white p-4 shadow-sm sm:grid-cols-[auto_1fr_auto] sm:items-center ${
        failureReason ? "border-red-200 bg-red-50/40" : "border-slate-200"
      }`}
    >
      <div
        className={`flex h-10 w-10 items-center justify-center rounded-xl text-sm font-bold ${
          failureReason
            ? "bg-red-100 text-red-700"
            : "bg-emerald-50 text-emerald-700"
        }`}
      >
        {index + 1}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-900">
          {candidateFile.file.name}
        </p>
        <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
          <span>{fileExtension}</span>
          <span>{formatFileSize(candidateFile.file.size)}</span>
          <span className={status.className}>{status.label}</span>
        </div>
        {failureReason ? (
          <p className="mt-2 text-xs leading-5 text-red-600">{failureReason}</p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => onRemove(candidateFile.id)}
        className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
      >
        删除
      </button>
    </div>
  );
}

function getCandidateFileStatus({
  failureReason,
  isAnalyzed,
  isParsing,
}: {
  failureReason?: string;
  isAnalyzed: boolean;
  isParsing: boolean;
}) {
  if (failureReason) {
    return {
      label: "解析失败",
      className: "font-semibold text-red-600",
    };
  }

  if (isAnalyzed) {
    return {
      label: "已分析",
      className: "font-semibold text-emerald-700",
    };
  }

  if (isParsing) {
    return {
      label: "解析中",
      className: "font-semibold text-amber-600",
    };
  }

  return {
    label: "待分析",
    className: "text-emerald-700",
  };
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-semibold text-slate-950">{value}</p>
    </article>
  );
}

function CandidateRankingTable({
  candidates,
}: {
  candidates: CandidateResult[];
}) {
  const [expandedCandidateKey, setExpandedCandidateKey] = useState("");

  function getCandidateKey(candidate: CandidateResult, index: number) {
    return `${candidate.fileName}-${index}`;
  }

  function toggleCandidate(candidate: CandidateResult, index: number) {
    const candidateKey = getCandidateKey(candidate, index);
    setExpandedCandidateKey((currentKey) =>
      currentKey === candidateKey ? "" : candidateKey,
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200">
      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full min-w-[1160px] border-collapse text-left">
          <thead className="bg-slate-950 text-white">
            <tr>
              <th className="px-5 py-4 text-sm font-semibold">排名</th>
              <th className="px-5 py-4 text-sm font-semibold">候选人</th>
              <th className="px-5 py-4 text-sm font-semibold">评分</th>
              <th className="px-5 py-4 text-sm font-semibold">推荐程度</th>
              <th className="px-5 py-4 text-sm font-semibold">核心优势</th>
              <th className="px-5 py-4 text-sm font-semibold">主要风险</th>
              <th className="px-5 py-4 text-sm font-semibold">详情</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 bg-white">
            {candidates.map((candidate, index) => {
              const candidateKey = getCandidateKey(candidate, index);
              const isExpanded = expandedCandidateKey === candidateKey;

              return (
                <Fragment key={candidateKey}>
                  <tr>
                    <td className="px-5 py-5 align-top">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-50 text-sm font-bold text-emerald-700">
                        {index + 1}
                      </span>
                    </td>
                    <td className="px-5 py-5 align-top">
                      <p className="font-semibold text-slate-950">
                        {candidate.candidateName}
                      </p>
                      <p className="mt-1 max-w-56 truncate text-xs text-slate-500">
                        {candidate.fileName}
                      </p>
                    </td>
                    <td className="px-5 py-5 align-top">
                      <p className="text-xl font-semibold text-slate-950">
                        {candidate.matchScore}/100
                      </p>
                      <p className="mt-1 text-xs font-medium text-slate-500">
                        {candidate.matchLevel}
                      </p>
                    </td>
                    <td className="px-5 py-5 align-top">
                      <span
                        className={`rounded-full px-3 py-1.5 text-sm font-semibold ${recommendationClass(candidate.recommendation)}`}
                      >
                        {recommendationLabel(candidate.recommendation)}
                      </span>
                    </td>
                    <td className="px-5 py-5 align-top">
                      <TagList items={candidate.strengths} tone="positive" />
                    </td>
                    <td className="px-5 py-5 align-top">
                      <TagList items={candidate.risks} tone="risk" />
                    </td>
                    <td className="px-5 py-5 align-top">
                      <button
                        type="button"
                        onClick={() => toggleCandidate(candidate, index)}
                        className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700"
                      >
                        {isExpanded ? "收起详情" : "查看详情"}
                      </button>
                    </td>
                  </tr>

                  {isExpanded ? (
                    <tr>
                      <td className="bg-slate-50 px-5 py-5" colSpan={7}>
                        <CandidateDetail candidate={candidate} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col divide-y divide-slate-200 bg-white lg:hidden">
        {candidates.map((candidate, index) => {
          const candidateKey = getCandidateKey(candidate, index);
          const isExpanded = expandedCandidateKey === candidateKey;

          return (
            <article className="p-4" key={candidateKey}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-emerald-700">
                    第 {index + 1} 名
                  </p>
                  <h3 className="mt-1 text-lg font-semibold text-slate-950">
                    {candidate.candidateName}
                  </h3>
                  <p className="mt-1 break-all text-xs text-slate-500">
                    {candidate.fileName}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-semibold text-slate-950">
                    {candidate.matchScore}
                  </p>
                  <p className="text-xs text-slate-500">/100</p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <span
                  className={`rounded-full px-3 py-1.5 text-sm font-semibold ${recommendationClass(candidate.recommendation)}`}
                >
                  {recommendationLabel(candidate.recommendation)}
                </span>
                <button
                  type="button"
                  onClick={() => toggleCandidate(candidate, index)}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700"
                >
                  {isExpanded ? "收起详情" : "查看详情"}
                </button>
              </div>

              <div className="mt-4">
                <p className="mb-2 text-sm font-semibold text-slate-800">核心优势</p>
                <TagList items={candidate.strengths} tone="positive" />
              </div>
              <div className="mt-4">
                <p className="mb-2 text-sm font-semibold text-slate-800">主要风险</p>
                <TagList items={candidate.risks} tone="risk" />
              </div>

              {isExpanded ? (
                <div className="mt-4">
                  <CandidateDetail candidate={candidate} />
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}

function CandidateDetail({ candidate }: { candidate: CandidateResult }) {
  const [isAgentFlowOpen, setIsAgentFlowOpen] = useState(false);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-emerald-700">候选人详情</p>
          <h4 className="mt-1 text-lg font-semibold text-slate-950">
            五维评分与证据解释
          </h4>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            展示影响评分的命中证据、缺失证据和简短评分理由。
          </p>
        </div>
        <div className="rounded-xl bg-slate-950 px-4 py-3 text-white">
          <p className="text-2xl font-semibold">{candidate.matchScore}</p>
          <p className="text-xs text-slate-300">综合分 /100</p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {SCORE_DIMENSIONS.map((dimension) => {
          const dimensionScore = candidate.dimensionScores?.[dimension.key];

          return (
            <DimensionDetailCard
              candidate={candidate}
              dimension={dimension}
              dimensionScore={dimensionScore}
              key={dimension.key}
            />
          );
        })}
      </div>

      <div className="mt-5 border-t border-slate-200 pt-4">
        <button
          type="button"
          onClick={() => setIsAgentFlowOpen((isOpen) => !isOpen)}
          className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700"
        >
          {isAgentFlowOpen ? "收起 AI 分析流程" : "查看 AI 分析流程"}
        </button>

        {isAgentFlowOpen ? (
          <AgentFlowTimeline steps={candidate.agentFlow || []} />
        ) : null}
      </div>
    </div>
  );
}

function DimensionDetailCard({
  candidate,
  dimension,
  dimensionScore,
}: {
  candidate: CandidateResult;
  dimension: (typeof SCORE_DIMENSIONS)[number];
  dimensionScore?: DimensionEvidenceMap[keyof DimensionEvidenceMap];
}) {
  const hitEvidence = getDisplayEvidenceItems(
    candidate.evidenceChunks || [],
    dimensionScore?.evidenceIds || [],
  );

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-950">
            {dimension.label}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            命中证据 {hitEvidence.length} 条
          </p>
        </div>
        <span className="rounded-full bg-white px-3 py-1 text-sm font-semibold text-slate-800 shadow-sm">
          {dimensionScore?.score ?? 0}/{dimension.maxScore}
        </span>
      </div>

      <div className="mt-3">
        <p className="text-xs font-semibold text-slate-700">命中证据</p>
        {hitEvidence.length ? (
          <div className="mt-2 grid gap-2">
            {hitEvidence.map((evidence) => (
              <div
                className="rounded-xl border border-emerald-100 bg-white px-3 py-2"
                key={evidence.id}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
                    {sectionTypeLabel(evidence.sectionType)}
                  </span>
                  <span className="text-sm font-semibold text-slate-900">
                    {evidence.title}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  关键词：{evidence.keywords.join("、") || "暂无明确关键词"}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 rounded-xl border border-amber-100 bg-white px-3 py-2 text-sm text-amber-700">
            该维度暂无可引用证据。
          </p>
        )}
      </div>

      <div className="mt-3">
        <p className="text-xs font-semibold text-slate-700">缺失证据</p>
        <TagList
          items={
            dimensionScore?.missingEvidence?.length
              ? dimensionScore.missingEvidence
              : ["暂无明显缺失"]
          }
          tone="risk"
        />
      </div>

      {dimensionScore?.missingKeywords?.length ? (
        <p className="mt-3 text-xs leading-5 text-slate-500">
          缺失关键词：{dimensionScore.missingKeywords.join("、")}
        </p>
      ) : null}

      <p className="mt-3 text-sm leading-6 text-slate-600">
        {dimensionScore?.reasoning || "该维度需要进一步验证。"}
      </p>
    </div>
  );
}

function AgentFlowTimeline({ steps }: { steps: AgentFlowStep[] }) {
  if (!steps.length) {
    return (
      <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
        暂无流程数据，建议重新分析该候选人。
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="space-y-3">
        {steps.map((step, stepIndex) => (
          <div className="relative flex gap-3" key={`${step.agentName}-${stepIndex}`}>
            <div className="flex flex-col items-center">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white">
                {stepIndex + 1}
              </span>
              {stepIndex < steps.length - 1 ? (
                <span className="mt-2 h-full min-h-8 w-px bg-slate-200" />
              ) : null}
            </div>
            <div className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-slate-950">
                    {step.agentName}
                  </p>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${agentStatusClass(step.status)}`}
                  >
                    {agentStatusLabel(step.status)}
                  </span>
                </div>
                <div className="flex gap-3 text-xs font-semibold text-slate-500">
                  <span>置信度 {formatConfidence(step.confidence)}</span>
                  <span>证据 {step.evidenceCount} 条</span>
                </div>
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {step.outputSummary}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function sectionTypeLabel(sectionType: DisplayEvidenceItem["sectionType"]) {
  const labels: Record<DisplayEvidenceItem["sectionType"], string> = {
    education: "教育",
    internship: "实习",
    project: "项目",
    skill: "技能",
    achievement: "成果",
    leadership: "组织",
    other: "其他",
  };

  return labels[sectionType] || "其他";
}

function agentStatusLabel(status: AgentFlowStep["status"]) {
  if (status === "running") return "运行中";
  if (status === "pending") return "等待中";
  if (status === "failed") return "失败";
  return "已完成";
}

function agentStatusClass(status: AgentFlowStep["status"]) {
  if (status === "running") return "bg-amber-50 text-amber-700";
  if (status === "pending") return "bg-slate-100 text-slate-600";
  if (status === "failed") return "bg-red-50 text-red-700";
  return "bg-emerald-50 text-emerald-700";
}

function formatConfidence(confidence: number) {
  return `${Math.round(Math.max(0, Math.min(1, confidence)) * 100)}%`;
}

function TagList({
  items,
  tone,
}: {
  items: string[];
  tone: "positive" | "risk";
}) {
  const styles =
    tone === "positive"
      ? "border-emerald-100 bg-emerald-50 text-emerald-800"
      : "border-amber-100 bg-amber-50 text-amber-800";

  return (
    <div className="flex max-w-sm flex-wrap gap-2">
      {items.slice(0, 3).map((item) => (
        <span
          className={`rounded-full border px-3 py-1.5 text-xs font-medium ${styles}`}
          key={item}
        >
          {item}
        </span>
      ))}
    </div>
  );
}
