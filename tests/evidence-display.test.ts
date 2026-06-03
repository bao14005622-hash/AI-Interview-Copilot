import assert from "node:assert/strict";
import test from "node:test";

import { getDisplayEvidenceItems } from "../lib/evidence-display";
import type { EvidenceChunk } from "../lib/evidence-chunks";

function buildChunk(overrides: Partial<EvidenceChunk>): EvidenceChunk {
  return {
    id: "chunk-1",
    fileName: "candidate.pdf",
    title: "AI 招聘辅助工具",
    text: "AI 招聘辅助工具\n负责候选人评分体系、Prompt 设计和批量简历排序。",
    sectionType: "project",
    jdMatchedKeywords: ["Prompt 设计", "批量简历排序"],
    preferenceMatchedKeywords: [],
    relevanceScore: 8,
    ...overrides,
  };
}

test("does not display personal resume header as hit evidence", () => {
  const badHeaderChunk = buildChunk({
    title: "gz 冯凯淇 RESUME 出生年月",
    text: "gz 冯凯淇 RESUME 出生年月\n电话 13800138000\nemail test@example.com",
    sectionType: "achievement",
    jdMatchedKeywords: ["性能"],
  });

  assert.deepEqual(
    getDisplayEvidenceItems([badHeaderChunk], [badHeaderChunk.id]),
    [],
  );
});

test("uses a clean line from the chunk when the stored title is noisy", () => {
  const noisyTitleChunk = buildChunk({
    title: "gz 冯凯淇 RESUME 出生年月",
    text: [
      "gz 冯凯淇 RESUME 出生年月",
      "United Crew 宣传部干事 2023.03 — 2024.7",
      "负责活动组织、内容运营和社群沟通。",
    ].join("\n"),
    sectionType: "leadership",
    jdMatchedKeywords: ["内容运营", "沟通"],
  });

  const items = getDisplayEvidenceItems([noisyTitleChunk], [noisyTitleChunk.id]);

  assert.equal(items.length, 1);
  assert.equal(items[0].title, "United Crew 宣传部干事 2023.03 — 2024.7");
});

test("displays normal project evidence with keywords", () => {
  const projectChunk = buildChunk({});
  const items = getDisplayEvidenceItems([projectChunk], [projectChunk.id]);

  assert.equal(items.length, 1);
  assert.equal(items[0].title, "AI 招聘辅助工具");
  assert.deepEqual(items[0].keywords, ["Prompt 设计", "批量简历排序"]);
});
