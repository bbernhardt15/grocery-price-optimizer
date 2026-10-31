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
function lineNames(rows) {
  return (rows || []).map((line) => String(line?.name || "").trim()).filter(Boolean);
}

export async function readReceiptBatch(deps, input) {
  const report = (message, ratio, extra) => {
    if (message || extra) deps.onProgress?.({ message: message || "", ratio, ...(extra || {}) });
  };
  report("Preparing…", 0.08);
  const texts = [];
  const lines = [];
  /** @type {Array<{ index: number, name: string, lines: object[], error: string }>} */
  const filesOut = [];
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
    const name = String(file.name || "Order");
    const ratio = 0.12 + (0.5 * index) / Math.max(1, files.length);
    if (files.length > 1) report(`Reading file ${index + 1} of ${files.length}…`, ratio, { fileIndex: index, fileName: name, status: "reading", fileRatio: 0.15, found: 0, items: [] });
    try {
      if (type.startsWith("image/") || /\.hei[cf]$/i.test(name)) {
        if (!deps.photo) {
          photoOff = true;
          const error = PHOTO_OFF_RECEIPT;
          filesOut.push({ index, name, lines: [], error });
          report("", ratio, { fileIndex: index, fileName: name, status: "error", error, found: 0, items: [], fileRatio: 1 });
          continue;
        }
        const blobs = await imageBlobs(file);
        const fileLines = [];
        await mapPool(blobs, 3, async (blob, blobIndex) => {
          const partRatio = 0.15 + (0.55 * (blobIndex + 1)) / Math.max(1, blobs.length);
          report(`Reading part ${blobIndex + 1} of ${blobs.length}…`, partRatio, {
            fileIndex: index,
            fileName: name,
            status: "reading",
            fileRatio: (blobIndex + 1) / Math.max(1, blobs.length),
            found: fileLines.length,
            items: lineNames(fileLines),
          });
          const payload = await deps.postPhoto(blob.type ? blob : file);
          const got = linesFrom(payload, receiptNumber);
          fileLines.push(...got);
          report(`Reading part ${blobIndex + 1} of ${blobs.length}…`, partRatio, {
            fileIndex: index,
            fileName: name,
            status: "reading",
            fileRatio: (blobIndex + 1) / Math.max(1, blobs.length),
            found: fileLines.length,
            items: lineNames(fileLines),
          });
          return payload;
        });
        lines.push(...fileLines);
        filesOut.push({ index, name, lines: fileLines, error: "" });
        report("", ratio, { fileIndex: index, fileName: name, status: "done", fileRatio: 1, found: fileLines.length, items: lineNames(fileLines) });
        continue;
      }
      if (type === "application/pdf" || /\.pdf$/i.test(name)) {
        const payload = await deps.postPdf(file);
        const got = linesFrom(payload, receiptNumber);
        lines.push(...got);
        filesOut.push({ index, name, lines: got, error: "" });
        report("", ratio, { fileIndex: index, fileName: name, status: "done", fileRatio: 1, found: got.length, items: lineNames(got) });
        continue;
      }
      const text = await file.text();
      if (String(text || "").trim()) texts.push(String(text).trim());
      filesOut.push({ index, name, lines: [], error: "" });
    } catch (error) {
      note = error instanceof Error ? error.message : "We couldn't read that file.";
      filesOut.push({ index, name, lines: [], error: note });
      report("", ratio, { fileIndex: index, fileName: name, status: "error", error: note, found: 0, items: [], fileRatio: 1 });
    }
  }
  if (texts.length && deps.postText) {
    try {
      const payload = await deps.postText(texts.join("\n\n--- receipt ---\n\n"));
      const got = linesFrom(payload, lines.length ? receiptNumber + 1 : 1);
      lines.push(...got);
      const pasted = filesOut.find((row) => row.index === -1);
      if (pasted) {
        pasted.lines = got;
      } else if (!files.length) {
        filesOut.push({ index: -1, name: "Pasted order", lines: got, error: "" });
      }
      report("", 0.72, { fileIndex: files.length ? filesOut[0]?.index ?? 0 : -1, fileName: files[0]?.name || "Pasted order", status: "done", fileRatio: 1, found: got.length, items: lineNames(got) });
    } catch (error) {
      note = error instanceof Error ? error.message : note;
      report("", 0.72, { fileIndex: files.length ? 0 : -1, fileName: files[0]?.name || "Pasted order", status: "error", error: note, found: 0, items: [], fileRatio: 1 });
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
      files: filesOut,
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
        files: filesOut,
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
    files: filesOut,
  };
}

export async function fileToBase64(file) {
  return readBlob(file);
}
