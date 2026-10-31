/**
 * Send receipt files through the same import routes as a pasted list.
 * Pictures are not written to local storage. The server reads them and
 * discards them.
 */

import { imageBlobs } from "./receiptImages.js";
import { PHOTO_OFF_RECEIPT } from "./receiptCopy.js";

async function readBlob(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

function linesFrom(payload, receiptNumber) {
  const source = payload?.receipt?.lines || payload?.lines || [];
  return source.map((line) => ({ ...line, receipt: receiptNumber }));
}

export async function mapPool(items, limit, worker) {
  if (!items.length) return [];
  const results = new Array(items.length);
  let cursor = 0;
  const lanes = Math.max(1, Math.min(items.length, limit || 1));
  async function lane() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: lanes }, () => lane()));
  return results;
}

function pullNdjson(state, chunk, last) {
  state.buffer += chunk;
  const parts = state.buffer.split("\n");
  state.buffer = last ? "" : parts.pop() || "";
  const events = [];
  for (const line of parts) {
    if (!line.trim()) continue;
    events.push(JSON.parse(line));
  }
  return events;
}

/** Progress events, then the analysis. An error event throws. */
export async function readNdjsonResponse(response, onProgress) {
  const handle = (events) => {
    let analysis = null;
    for (const event of events) {
      if (event?.type === "progress") onProgress?.(event);
      if (event?.type === "error") throw new Error(event.error || "We couldn't read that.");
      if (event?.type === "result") analysis = event.analysis || null;
    }
    return analysis;
  };
  if (!response?.body || typeof response.body.getReader !== "function") {
    const analysis = handle(pullNdjson({ buffer: "" }, await response.text(), true));
    if (!analysis) throw new Error("We couldn't read that.");
    return analysis;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const state = { buffer: "" };
  let analysis = null;
  for (;;) {
    const { done, value } = await reader.read();
    const chunk = decoder.decode(value || new Uint8Array(), { stream: !done });
    const found = handle(pullNdjson(state, chunk, done));
    if (found) analysis = found;
    if (done) break;
  }
  if (!analysis) throw new Error("We couldn't read that.");
  return analysis;
}

/**
 * @param {{
 *   photo?: boolean,
 *   postPhoto?: (file: File) => Promise<object>,
 *   postPdf?: (file: File) => Promise<object>,
 *   postText?: (text: string) => Promise<object>,
 *   postLines?: (lines: object[]) => Promise<object>,
 *   onProgress?: (event: { message?: string, ratio?: number }) => void,
 * }} deps
 * @param {{ files?: File[], text?: string }} input
 */
export async function readReceiptBatch(deps, input) {
  const report = (message, ratio) => {
    if (message) deps.onProgress?.({ message, ratio });
  };
  report("Preparing…", 0.08);
  const texts = [];
  const lines = [];
  let photoOff = false;
  let receiptNumber = 0;
  let note = "";
  if (String(input?.text || "").trim()) {
    receiptNumber += 1;
    texts.push(String(input.text).trim());
  }
  const files = (input?.files || []).filter(Boolean);
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    receiptNumber += 1;
    const type = String(file.type || "");
    const name = String(file.name || "");
    if (files.length > 1) report(`Reading file ${index + 1} of ${files.length}…`, 0.12 + (0.5 * index) / files.length);
    try {
      if (type.startsWith("image/") || /\.hei[cf]$/i.test(name)) {
        if (!deps.photo) {
          photoOff = true;
          continue;
        }
        const blobs = await imageBlobs(file);
        const parts = await mapPool(blobs, 3, async (blob, blobIndex) => {
          report(`Reading part ${blobIndex + 1} of ${blobs.length}…`, 0.15 + (0.55 * (blobIndex + 1)) / Math.max(1, blobs.length));
          return deps.postPhoto(blob.type ? blob : file);
        });
        for (const payload of parts) lines.push(...linesFrom(payload, receiptNumber));
        continue;
      }
      if (type === "application/pdf" || /\.pdf$/i.test(name)) {
        const payload = await deps.postPdf(file);
        lines.push(...linesFrom(payload, receiptNumber));
        continue;
      }
      const text = await file.text();
      if (String(text || "").trim()) texts.push(String(text).trim());
    } catch (error) {
      note = error instanceof Error ? error.message : "We couldn't read that file.";
    }
  }
  if (texts.length && deps.postText) {
    try {
      const payload = await deps.postText(texts.join("\n\n--- receipt ---\n\n"));
      lines.push(...linesFrom(payload, lines.length ? receiptNumber + 1 : 1));
    } catch (error) {
      note = error instanceof Error ? error.message : note;
    }
  }
  if (!lines.length) {
    return {
      lines: [],
      learned: [],
      paper: false,
      paperNote: "",
      error: photoOff && !String(input?.text || "").trim() ? PHOTO_OFF_RECEIPT : note || "We couldn't find grocery items in that. Try an online order, or paste the text.",
      photoOff,
    };
  }
  let analysis = { lines, learned: [], paper: false, paperNote: "" };
  report("Matching brands…", 0.9);
  if (deps.postLines) {
    try {
      analysis = await deps.postLines(lines);
    } catch (error) {
      return {
        lines: [],
        learned: [],
        paper: false,
        paperNote: "",
        error: error instanceof Error ? error.message : "We couldn't read that.",
        photoOff,
      };
    }
  }
  return {
    lines: analysis.lines || lines,
    learned: analysis.learned || [],
    paper: Boolean(analysis.paper),
    paperNote: analysis.paperNote || "",
    error: "",
    photoOff,
    photoMessage: photoOff ? PHOTO_OFF_RECEIPT : "",
  };
}

export async function fileToBase64(file) {
  return readBlob(file);
}
