import type { EvidenceChunk, SectionType } from "@/lib/evidence-chunks";

export type DisplayEvidenceItem = {
  id: string;
  title: string;
  sectionType: SectionType;
  keywords: string[];
};

const LOW_VALUE_TITLE_PATTERN =
  /出生年月|出生日期|年龄|性别|籍贯|民族|政治面貌|联系方式|电话|手机|邮箱|email|wechat|微信|resume/i;
const GENERIC_TITLE_PATTERN =
  /^(个人简历|简历|项目经历|项目经验|实习经历|工作经历|教育经历|教育背景|技能|专业技能|获奖经历|荣誉奖项|校园经历)$/;

export function getDisplayEvidenceItems(
  chunks: EvidenceChunk[],
  evidenceIds: string[],
) {
  const chunkById = new Map(chunks.map((chunk) => [chunk.id, chunk]));

  return evidenceIds
    .map((evidenceId) => chunkById.get(evidenceId))
    .filter((chunk): chunk is EvidenceChunk => Boolean(chunk))
    .map(toDisplayEvidenceItem)
    .filter((item): item is DisplayEvidenceItem => Boolean(item))
    .slice(0, 3);
}

function toDisplayEvidenceItem(chunk: EvidenceChunk): DisplayEvidenceItem | null {
  const title = getDisplayTitle(chunk);
  if (!title) return null;

  return {
    id: chunk.id,
    title,
    sectionType: chunk.sectionType,
    keywords: getEvidenceKeywords(chunk),
  };
}

function getDisplayTitle(chunk: EvidenceChunk) {
  const directTitle = cleanTitle(chunk.title);
  if (isMeaningfulTitle(directTitle)) return directTitle.slice(0, 42);

  const lineTitle = chunk.text
    .split(/\n+/)
    .map(cleanTitle)
    .find(isMeaningfulTitle);

  return lineTitle ? lineTitle.slice(0, 42) : "";
}

function cleanTitle(value: string) {
  return value
    .replace(/[●•]/g, " ")
    .replace(/[|｜]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(/[。；;:：]/)[0]
    .trim();
}

function isMeaningfulTitle(title: string) {
  if (title.length < 2) return false;
  if (LOW_VALUE_TITLE_PATTERN.test(title)) return false;
  if (GENERIC_TITLE_PATTERN.test(title.replace(/\s+/g, ""))) return false;
  return true;
}

function getEvidenceKeywords(evidence: EvidenceChunk) {
  return Array.from(
    new Set([
      ...evidence.jdMatchedKeywords,
      ...evidence.preferenceMatchedKeywords,
    ]),
  )
    .filter((keyword) => !LOW_VALUE_TITLE_PATTERN.test(keyword))
    .slice(0, 5);
}
