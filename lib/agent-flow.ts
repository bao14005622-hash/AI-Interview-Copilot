export type AgentStatus = "pending" | "running" | "completed" | "failed";

export type AgentFlowStep = {
  agentName: string;
  status: AgentStatus;
  inputSummary: string;
  outputSummary: string;
  confidence: number;
  evidenceCount: number;
};

export const AGENT_FLOW_AGENT_NAMES = [
  "JD Agent",
  "Resume Agent",
  "Evidence Agent",
  "Scoring Agent",
  "Risk Agent",
  "Ranking Agent",
] as const;

const AGENT_STATUS_VALUES = new Set<AgentStatus>([
  "pending",
  "running",
  "completed",
  "failed",
]);

export function normalizeAgentFlowSteps(
  value: unknown,
  fallbackSteps: AgentFlowStep[],
): AgentFlowStep[] {
  const rawSteps = Array.isArray(value) ? value : [];

  return AGENT_FLOW_AGENT_NAMES.map((agentName, index) => {
    const fallback = fallbackSteps[index] || {
      agentName,
      status: "completed" as const,
      inputSummary: "输入信息已接收。",
      outputSummary: "分析步骤已完成。",
      confidence: 0.7,
      evidenceCount: 0,
    };
    const rawStep = rawSteps.find(
      (step) =>
        isObject(step) &&
        typeof step.agentName === "string" &&
        step.agentName.trim() === agentName,
    );

    return {
      agentName,
      status: normalizeAgentStatus(rawStep?.status, fallback.status),
      inputSummary: normalizeSummary(
        rawStep?.inputSummary,
        fallback.inputSummary,
      ),
      outputSummary: normalizeSummary(
        rawStep?.outputSummary,
        fallback.outputSummary,
      ),
      confidence: normalizeConfidence(rawStep?.confidence, fallback.confidence),
      evidenceCount: normalizeEvidenceCount(
        rawStep?.evidenceCount,
        fallback.evidenceCount,
      ),
    };
  });
}

function normalizeAgentStatus(value: unknown, fallback: AgentStatus) {
  return typeof value === "string" && AGENT_STATUS_VALUES.has(value as AgentStatus)
    ? (value as AgentStatus)
    : fallback;
}

function normalizeSummary(value: unknown, fallback: string) {
  if (typeof value !== "string" || !value.trim()) return fallback;
  return value.trim().slice(0, 120);
}

function normalizeConfidence(value: unknown, fallback: number) {
  const source = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  const clamped = Math.max(0, Math.min(1, source));
  return Math.round(clamped * 100) / 100;
}

function normalizeEvidenceCount(value: unknown, fallback: number) {
  const source = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(0, Math.round(source));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
