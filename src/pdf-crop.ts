import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { Figure } from "./types";

/** Render only the configured source crop; no page screenshots or remote image URLs. */
export async function cropPdfToPng(
  url: string,
  pageNumber: number,
  crop: NonNullable<Figure["crop"]>,
  signal?: AbortSignal,
): Promise<{
  mimeType: "image/png";
  data: string;
  width: number;
  height: number;
  bytes: number;
}> {
  const { x, y, width, height } = crop;
  if (
    ![x, y, width, height].every(Number.isFinite) ||
    x < 0 ||
    y < 0 ||
    width <= 0 ||
    height <= 0 ||
    x + width > 1.001 ||
    y + height > 1.001
  )
    throw new Error("Invalid source figure crop.");
  if (!Number.isInteger(pageNumber) || pageNumber < 1)
    throw new Error("Invalid source page.");
  signal?.throwIfAborted();
  const { getDocument, GlobalWorkerOptions } = await import("pdfjs-dist");
  GlobalWorkerOptions.workerSrc = workerUrl;
  const task = getDocument({
    url,
    withCredentials: false,
    useSystemFonts: true,
  });
  const abort = () => {
    void task.destroy().catch(() => {});
  };
  signal?.addEventListener("abort", abort, { once: true });
  let canvas = document.createElement("canvas");
  try {
    const pdf = await task.promise;
    if (pageNumber > pdf.numPages)
      throw new Error("Source figure page is outside this PDF.");
    signal?.throwIfAborted();
    const page = await pdf.getPage(pageNumber);
    const natural = page.getViewport({ scale: 1 });
    const scale = Math.min(
      4,
      1800 / Math.max(natural.width * width, natural.height * height),
    );
    const viewport = page.getViewport({ scale });
    canvas.width = Math.max(1, Math.round(viewport.width * width));
    canvas.height = Math.max(1, Math.round(viewport.height * height));
    await page.render({
      canvas,
      viewport,
      transform: [1, 0, 0, 1, -viewport.width * x, -viewport.height * y],
      background: "#ffffff",
    }).promise;
    signal?.throwIfAborted();
    let blob: Blob | null = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      if (!blob) throw new Error("Could not encode source figure.");
      if (blob.size <= 4 * 1024 * 1024) break;
      const reduced = document.createElement("canvas");
      reduced.width = Math.max(1, Math.round(canvas.width * 0.75));
      reduced.height = Math.max(1, Math.round(canvas.height * 0.75));
      reduced
        .getContext("2d")!
        .drawImage(canvas, 0, 0, reduced.width, reduced.height);
      canvas.width = 0;
      canvas.height = 0;
      canvas = reduced;
    }
    if (!blob || blob.size > 4 * 1024 * 1024)
      throw new Error("Source figure exceeds the 4 MiB image limit.");
    signal?.throwIfAborted();
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",", 2)[1]);
      reader.onerror = () => reject(new Error("Could not read source image."));
      reader.readAsDataURL(blob!);
    });
    return {
      mimeType: "image/png",
      data,
      width: canvas.width,
      height: canvas.height,
      bytes: blob.size,
    };
  } finally {
    signal?.removeEventListener("abort", abort);
    canvas.width = 0;
    canvas.height = 0;
    await task.destroy().catch(() => {});
  }
}
