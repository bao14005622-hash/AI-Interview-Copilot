"use client";

import { ChangeEvent, useMemo, useState } from "react";

type Recommendation = "Yes" | "Maybe" | "No";

type AnalysisResult = {
  matchScore: number;
  matchLevel: string;
  strengths: string[];
  risks: string[];
  recommendation: Recommendation;
  recommendationReason: string;
};

const preferenceExample =
  "QS 前 200、985/211、数据分析能力、业务思维、实习/项目背景、英语流利";

export default function Home() {
  const [jd, setJd] = useState("");
  const [preferences, setPreferences] = useState("");
  const [resumeText, setResumeText] = useState("");
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AnalysisResult | null>(null);

  const resumeLabel = useMemo(() => {
    if (resumeFile) return resumeFile.name;
    if (resumeText.trim()) return "已粘贴简历文本";
    return "暂未选择简历";
  }, [resumeFile, resumeText]);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setResumeFile(file);
    setError("");
  }

  async function handleAnalyze() {
    setError("");

    if (!resumeFile && !resumeText.trim()) {
      setError("请上传 PDF/DOCX 或粘贴候选人简历文本。");
      return;
    }

    if (!jd.trim()) {
      setError("请输入岗位描述。");
      return;
    }

    setIsAnalyzing(true);

    try {
      const formData = new FormData();
      formData.append("resumeText", resumeText.trim());
      formData.append("jobDescription", jd.trim());
      formData.append("interviewerPreferences", preferences.trim());

      if (resumeFile && !resumeText.trim()) {
        formData.append("resumeFile", resumeFile);
      }

      const response = await fetch("/api/analyze", {
        method: "POST",
        body: formData,
      });

      const payload = await parseAnalyzeResponse(response);

      if (!response.ok) {
        throw new Error(payload.error || "分析失败，请重试。");
      }

      setResult(payload.data);
    } catch (analysisError) {
      setError(
        analysisError instanceof Error
          ? analysisError.message
          : "分析失败，请重试。",
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
                面向 HR 实习生与招聘团队的 AI 候选人分析产品
              </div>
              <h1 className="max-w-3xl text-4xl font-semibold tracking-normal text-white sm:text-5xl lg:text-6xl">
                AI 面试招聘助手
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-7 text-slate-200 sm:text-lg">
                把简历筛选、岗位匹配、风险识别和面试准备整合成一个结构化工作台，让招聘人员用统一标准快速判断候选人是否值得推进。
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <HeroPill label="简历解析" />
                <HeroPill label="岗位匹配" />
                <HeroPill label="风险判断" />
                <HeroPill label="招聘建议" />
              </div>
            </div>

            <div className="rounded-[1.5rem] border border-white/15 bg-white/10 p-4 shadow-xl shadow-slate-950/20 backdrop-blur">
              <div className="rounded-2xl border border-white/10 bg-white p-4 text-slate-950 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-500">今日分析预览</p>
                    <p className="mt-2 text-3xl font-semibold">实时生成</p>
                  </div>
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-700">
                    API 分析
                  </span>
                </div>
                <div className="mt-5 grid grid-cols-3 gap-3 text-center">
                  <Metric label="输入维度" value="3" />
                  <Metric label="风险点" value="动态" />
                  <Metric label="建议" value="动态" />
                </div>
                <div className="mt-5 rounded-2xl bg-slate-50 p-4">
                  <div className="mb-3 flex items-center justify-between text-sm">
                    <span className="font-medium text-slate-700">候选人决策置信度</span>
                    <span className="font-semibold text-emerald-700">待生成</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                    <div className="h-full w-[42%] rounded-full bg-emerald-500" />
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
              title="上传或粘贴候选人材料"
              description="分析多个候选人时，可以保留当前岗位描述和面试官偏好，仅替换候选人简历。"
            />

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <FileInput
                accept=".pdf,application/pdf"
                label="上传 PDF"
                helper="上传后可直接用于 AI 分析"
                onChange={handleFileChange}
              />
              <FileInput
                accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                label="上传 DOCX"
                helper="上传后可直接用于 AI 分析"
                onChange={handleFileChange}
              />
            </div>

            <div className="mt-5 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-sm font-semibold text-emerald-900">当前简历</span>
                <span className="break-all rounded-full bg-white px-3 py-1 text-sm font-medium text-slate-700 shadow-sm">
                  {resumeLabel}
                </span>
              </div>
            </div>

            <label className="mt-5 block">
              <span className="mb-2 block text-sm font-semibold text-slate-800">
                粘贴简历文本
              </span>
              <textarea
                value={resumeText}
                onChange={(event) => {
                  setResumeText(event.target.value);
                  setError("");
                }}
                rows={10}
                className="min-h-64 w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-800 outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-100"
                placeholder="请在此粘贴候选人简历内容..."
              />
            </label>
          </div>

          <div className="rounded-[1.5rem] border border-slate-200/80 bg-white p-5 shadow-xl shadow-slate-200/70 md:p-6">
            <SectionHeader
              eyebrow="岗位信息"
              title="定义候选人评估标准"
              description="每次分析完成后，岗位描述和面试官偏好都会保留，方便继续分析下一位候选人。"
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
                面试官偏好
              </span>
              <textarea
                value={preferences}
                onChange={(event) => setPreferences(event.target.value)}
                rows={6}
                className="min-h-40 w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-800 outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-100"
                placeholder={preferenceExample}
              />
            </label>
          </div>
        </section>

        <section className="sticky bottom-4 z-10 rounded-[1.5rem] border border-slate-200 bg-white/95 p-4 shadow-2xl shadow-slate-300/60 backdrop-blur">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-900">准备进行候选人分析</p>
              <p className="mt-1 text-sm text-slate-500">
                将调用后端 API 生成结构化候选人分析。
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
                {isAnalyzing ? "正在分析候选人..." : "分析候选人"}
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-[1.5rem] border border-slate-200/80 bg-white p-5 shadow-xl shadow-slate-200/70 md:p-6">
          <SectionHeader
            eyebrow="分析结果看板"
            title="候选人匹配结果"
            description="分析结果会保留在页面中，你可以继续替换简历并重新分析下一位候选人。"
          />

          {result ? (
            <div className="mt-6 grid gap-4 lg:grid-cols-4">
              <ScoreCard result={result} />
              <InsightCard title="优点分析" items={result.strengths} tone="positive" />
              <InsightCard title="风险分析" items={result.risks} tone="risk" />
              <RecommendationCard result={result} />
            </div>
          ) : (
            <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-14 text-center">
              <p className="text-base font-semibold text-slate-800">
                分析完成后，结果会展示在这里。
              </p>
              <p className="mt-2 text-sm text-slate-500">
                匹配分数、候选人优势、潜在风险和招聘建议会以看板卡片形式呈现。
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
            : "分析失败，请重试。",
        data: null,
      };
    }

    return {
      error: "",
      data: parsed as AnalysisResult,
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
      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">{description}</p>
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
      <input className="sr-only" type="file" accept={accept} onChange={onChange} />
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

function ScoreCard({ result }: { result: AnalysisResult }) {
  return (
    <article className="rounded-2xl border border-slate-900 bg-slate-950 p-5 text-white shadow-xl shadow-slate-300/60 lg:col-span-1">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-slate-300">候选人匹配分数</p>
        <span className="rounded-full bg-emerald-400/15 px-2.5 py-1 text-xs font-semibold text-emerald-200">
          {result.matchLevel}
        </span>
      </div>
      <div className="mt-6 flex items-end gap-1">
        <span className="text-6xl font-semibold">{result.matchScore}</span>
        <span className="pb-2 text-xl font-medium text-slate-300">/100</span>
      </div>
      <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/15">
        <div
          className="h-full rounded-full bg-emerald-400"
          style={{ width: `${result.matchScore}%` }}
        />
      </div>
      <p className="mt-4 text-sm leading-6 text-slate-300">
        与当前岗位要求和面试官偏好高度一致。
      </p>
    </article>
  );
}

function InsightCard({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "positive" | "risk";
}) {
  const styles =
    tone === "positive"
      ? "border-emerald-100 bg-emerald-50 text-emerald-800"
      : "border-amber-100 bg-amber-50 text-amber-800";
  const accent = tone === "positive" ? "bg-emerald-500" : "bg-amber-500";

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md">
      <div className="flex items-center gap-3">
        <span className={`h-8 w-1.5 rounded-full ${accent}`} />
        <p className="text-base font-semibold text-slate-950">{title}</p>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        {items.map((item) => (
          <span
            className={`rounded-full border px-3 py-1.5 text-sm font-medium ${styles}`}
            key={item}
          >
            {item}
          </span>
        ))}
      </div>
    </article>
  );
}

function RecommendationCard({ result }: { result: AnalysisResult }) {
  return (
    <article className="rounded-2xl border border-emerald-100 bg-gradient-to-br from-white to-emerald-50 p-5 shadow-sm transition hover:shadow-md">
      <p className="text-base font-semibold text-slate-950">招聘建议</p>
      <div className="mt-4 inline-flex rounded-xl bg-emerald-600 px-4 py-2 text-lg font-semibold text-white shadow-lg shadow-emerald-100">
        {result.recommendation}
      </div>
      <p className="mt-4 text-sm leading-6 text-slate-600">
        {result.recommendationReason}
      </p>
    </article>
  );
}
