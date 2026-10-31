/**
 * Turn a picture-only PDF into JPEG slices for the vision reader.
 *
 * iOS share/print of a long order page is one very tall page of images.
 * pdftoppm (poppler) crops that page into overlapping bands so a line is
 * not cut in half. The PDF is written only to a temp file and deleted.
 * Railway installs poppler with RAILPACK_DEPLOY_APT_PACKAGES=poppler-utils.
 */

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const DPI = 144;
const CHUNK_PX = 1500;
const OVERLAP_PX = 200;
const MAX_PAGES = 6;
const MAX_SLICES = 12;

export type PdfSlice = {
  jpeg: Buffer;
  page: number;
  index: number;
};

type PageBox = { page: number; widthPts: number; heightPts: number };

export function sliceBands(heightPx: number, chunkPx = CHUNK_PX, overlapPx = OVERLAP_PX, maxSlices = MAX_SLICES): Array<{ y: number; height: number }> {
  const height = Math.max(1, Math.round(heightPx));
  const overlap = Math.max(0, Math.min(overlapPx, chunkPx - 1));
  let chunk = Math.max(overlap + 1, chunkPx);
  const countFor = (size: number) => (height <= size ? 1 : Math.ceil((height - overlap) / (size - overlap)));
  while (countFor(chunk) > maxSlices) chunk += 400;
  if (height <= chunk) return [{ y: 0, height }];
  const bands: Array<{ y: number; height: number }> = [];
  const step = chunk - overlap;
  for (let y = 0; y < height; y += step) {
    const bandHeight = Math.min(chunk, height - y);
    bands.push({ y, height: bandHeight });
    if (y + bandHeight >= height) break;
  }
  return bands;
}

function run(command: string, args: string[], timeoutMs = 20_000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${command} timed out`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => out.push(chunk));
    child.stderr.on("data", (chunk) => err.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") });
    });
  });
}

export async function pdfRasterAvailable(): Promise<boolean> {
  try {
    const result = await run("pdftoppm", ["-v"], 4_000);
    return result.code === 0 || /pdftoppm/i.test(`${result.stdout}\n${result.stderr}`);
  } catch {
    return false;
  }
}

function pageBoxes(info: string): PageBox[] {
  const boxes: PageBox[] = [];
  const pattern = /Page\s+(\d+)\s+size:\s+([\d.]+)\s+x\s+([\d.]+)\s+pts/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(info))) {
    const widthPts = Number(match[2]);
    const heightPts = Number(match[3]);
    if (widthPts > 0 && heightPts > 0) boxes.push({ page: Number(match[1]), widthPts, heightPts });
  }
  return boxes.slice(0, MAX_PAGES);
}

/** JPEG bands, top to bottom. Empty when poppler is missing or the file will not render. */
export async function rasterizePdf(buffer: Buffer): Promise<PdfSlice[]> {
  if (!buffer?.length) return [];
  const dir = await mkdtemp(path.join(tmpdir(), "gg-pdf-"));
  const pdfPath = path.join(dir, "order.pdf");
  try {
    await writeFile(pdfPath, buffer);
    const info = await run("pdfinfo", ["-f", "1", `-l`, String(MAX_PAGES), pdfPath]);
    if (info.code !== 0) return [];
    const pages = pageBoxes(info.stdout);
    const slices: PdfSlice[] = [];
    for (const page of pages) {
      const heightPx = Math.ceil((page.heightPts * DPI) / 72);
      const perPage = Math.max(1, Math.floor(MAX_SLICES / pages.length));
      for (const band of sliceBands(heightPx, CHUNK_PX, OVERLAP_PX, perPage)) {
        const stem = path.join(dir, `p${page.page}-${band.y}`);
        const rendered = await run("pdftoppm", [
          "-jpeg",
          "-r",
          String(DPI),
          "-f",
          String(page.page),
          "-l",
          String(page.page),
          "-y",
          String(band.y),
          "-H",
          String(band.height),
          "-singlefile",
          pdfPath,
          stem,
        ]);
        if (rendered.code !== 0) continue;
        const jpeg = await readFile(`${stem}.jpg`).catch(() => null);
        if (!jpeg?.length) continue;
        slices.push({ jpeg, page: page.page, index: slices.length });
        if (slices.length >= MAX_SLICES) return slices;
      }
    }
    return slices;
  } catch {
    return [];
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
