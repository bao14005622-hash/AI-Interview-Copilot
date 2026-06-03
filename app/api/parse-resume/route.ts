import { NextRequest, NextResponse } from "next/server";
import {
  extractResumeText,
  getParseErrorMessage,
} from "@/lib/resume-parser";
import { createEvidenceChunks } from "@/lib/evidence-chunks";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const resumeFile = formData.get("resumeFile");

    if (!(resumeFile instanceof File)) {
      return NextResponse.json(
        { error: "请上传一份 PDF 或 DOCX 简历。" },
        { status: 400 },
      );
    }

    const text = await extractResumeText(resumeFile);
    const evidenceChunks = createEvidenceChunks(resumeFile.name, text);

    return NextResponse.json({
      fileName: resumeFile.name,
      text,
      evidenceChunks,
    });
  } catch (error) {
    return NextResponse.json(
      { error: getParseErrorMessage(error) },
      { status: 400 },
    );
  }
}
