import mammoth from "mammoth";

export class UserFacingError extends Error {}

export async function extractResumeText(file: File) {
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
    const text = parsedDocx.value.trim();

    if (!text) {
      throw new UserFacingError(
        `${file.name} 未能提取到文本，请检查文件内容。`,
      );
    }

    return text;
  }

  if (mimeType === "application/msword" || fileName.endsWith(".doc")) {
    throw new UserFacingError(
      "暂不支持旧版 .doc 文件，请上传 DOCX 或 PDF 简历。",
    );
  }

  throw new UserFacingError("仅支持 PDF 或 DOCX 简历。");
}

export function getParseErrorMessage(error: unknown) {
  if (error instanceof UserFacingError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return "简历解析失败，请检查文件是否损坏。";
}

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
        "未能从 PDF 中提取到文本，请检查 PDF 是否为可复制文本。",
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
