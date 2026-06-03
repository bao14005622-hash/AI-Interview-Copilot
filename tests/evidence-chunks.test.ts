import assert from "node:assert/strict";
import test from "node:test";

import {
  createEvidenceChunks,
  enrichEvidenceChunks,
  selectEvidenceByDimension,
} from "../lib/evidence-chunks";

test("selects project and internship chunks instead of education headers for job evidence", () => {
  const resumeText = [
    "教育经历",
    "宁波诺丁汉大学 商业分析 本科 GPA 3.6/4.0",
    "项目经历",
    "AI 招聘辅助工具",
    "负责候选人评分体系、Prompt 设计、需求分析和批量简历排序，输出可解释评分结果。",
    "实习经历",
    "小鹏汽车 HRBP 实习",
    "负责候选人评估、招聘流程优化和岗位数据分析，协同业务部门筛选候选人。",
    "技能",
    "SQL Tableau Python Excel",
  ].join("\n");

  const chunks = createEvidenceChunks("candidate.pdf", resumeText);
  const enrichedChunks = enrichEvidenceChunks({
    chunks,
    jobDescription: "产品经理 岗位 需要需求分析、Prompt 设计、候选人评估、数据分析能力",
    interviewerPreferences: "产品经理实习经历\n数据分析能力\n业务思维",
  });
  const { selectedByDimension } = selectEvidenceByDimension(enrichedChunks);

  assert.ok(
    chunks.some(
      (chunk) =>
        chunk.sectionType === "project" &&
        chunk.title.includes("AI 招聘辅助工具"),
    ),
  );
  assert.ok(
    chunks.some(
      (chunk) =>
        chunk.sectionType === "internship" &&
        chunk.title.includes("小鹏汽车 HRBP 实习"),
    ),
  );
  assert.equal(
    selectedByDimension.jobRelevantExperience.some(
      (chunk) => chunk.sectionType === "education",
    ),
    false,
  );
});

test("does not select personal contact lines as scoring evidence", () => {
  const resumeText = [
    "gz 冯凯淇 RESUME 出生年月",
    "电话 13800138000 email test@example.com",
    "教育背景",
    "某大学 本科",
    "技能",
    "MS Office 沟通能力 英语",
    "校园经历",
    "United Crew 宣传部干事 2023.03 — 2024.7",
    "负责活动组织、海报制作和社群沟通。",
  ].join("\n");

  const chunks = createEvidenceChunks("candidate.pdf", resumeText);
  const enrichedChunks = enrichEvidenceChunks({
    chunks,
    jobDescription: "AI 产品经理，需要 PRD、用户调研、竞品分析、数据分析、项目推进能力",
    interviewerPreferences: "AI模型\n产品经理实习经历\n数据分析能力",
  });
  const { selectedByDimension } = selectEvidenceByDimension(enrichedChunks);
  const selectedChunks = Object.values(selectedByDimension).flat();

  assert.equal(
    selectedChunks.some((chunk) =>
      /出生年月|电话|email|resume/i.test(`${chunk.title} ${chunk.text}`),
    ),
    false,
  );
});

test("does not use awards or campus activity chunks as product project evidence", () => {
  const resumeText = [
    "获奖经历",
    "全国大学生英语竞赛三等奖",
    "校园经历",
    "United Crew 宣传部干事 2023.03 — 2024.7",
    "负责活动组织、海报制作和社群沟通。",
    "技能",
    "Office 英语 沟通",
  ].join("\n");

  const chunks = createEvidenceChunks("candidate.pdf", resumeText);
  const enrichedChunks = enrichEvidenceChunks({
    chunks,
    jobDescription: "产品经理 JD：需要 PRD、用户调研、竞品分析、需求拆解、数据分析、项目推进和业务复盘",
    interviewerPreferences: "产品经理实习经历\n数据分析能力",
  });
  const { selectedByDimension } = selectEvidenceByDimension(enrichedChunks);

  assert.equal(selectedByDimension.projectEvidenceStrength.length, 0);
});
