import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_FLOW_AGENT_NAMES,
  normalizeAgentFlowSteps,
  type AgentFlowStep,
} from "../lib/agent-flow";

function buildFallbackSteps(): AgentFlowStep[] {
  return AGENT_FLOW_AGENT_NAMES.map((agentName, index) => ({
    agentName,
    status: "completed",
    inputSummary: `fallback input ${index + 1}`,
    outputSummary: `fallback output ${index + 1}`,
    confidence: 0.75,
    evidenceCount: index,
  }));
}

test("normalizes agent flow into the six required agent steps", () => {
  const normalized = normalizeAgentFlowSteps([], buildFallbackSteps());

  assert.equal(normalized.length, 6);
  assert.deepEqual(
    normalized.map((step) => step.agentName),
    [
      "JD Agent",
      "Resume Agent",
      "Evidence Agent",
      "Scoring Agent",
      "Risk Agent",
      "Ranking Agent",
    ],
  );
});

test("uses valid model-provided agent fields and falls back per missing agent", () => {
  const normalized = normalizeAgentFlowSteps(
    [
      {
        agentName: "JD Agent",
        status: "running",
        inputSummary: "岗位 JD",
        outputSummary: "提取关键词",
        confidence: 1.5,
        evidenceCount: -3,
      },
    ],
    buildFallbackSteps(),
  );

  assert.equal(normalized[0].status, "running");
  assert.equal(normalized[0].inputSummary, "岗位 JD");
  assert.equal(normalized[0].outputSummary, "提取关键词");
  assert.equal(normalized[0].confidence, 1);
  assert.equal(normalized[0].evidenceCount, 0);
  assert.equal(normalized[1].agentName, "Resume Agent");
  assert.equal(normalized[1].inputSummary, "fallback input 2");
});
