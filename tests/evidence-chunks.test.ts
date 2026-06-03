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
