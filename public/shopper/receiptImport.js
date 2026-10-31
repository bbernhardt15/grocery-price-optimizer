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

/**
 * @param {{
 *   photo?: boolean,
 *   postPhoto?: (file: File) => Promise<object>,
 *   postPdf?: (file: File) => Promise<object>,
 *   postText?: (text: string) => Promise<object>,
 *   postLines?: (lines: object[]) => Promise<object>,
 * }} deps
 * @param {{ files?: File[], text?: string }} input
 */
export async function readReceiptBatch(deps, input) {
  const texts = [];
  const lines = [];
  let photoOff = false;
  let receiptNumber = 0;
  let note = "";
  if (String(input?.text || "").trim()) {
    receiptNumber += 1;
    texts.push(String(input.text).trim());
  }
  for (const file of input?.files || []) {
    if (!file) continue;
    receiptNumber += 1;
    const type = String(file.type || "");
    const name = String(file.name || "");
    try {
      if (type.startsWith("image/") || /\.hei[cf]$/i.test(name)) {
        if (!deps.photo) {
          photoOff = true;
          continue;
        }
        const blobs = await imageBlobs(file);
        for (const blob of blobs) {
          const payload = await deps.postPhoto(blob.type ? blob : file);
          lines.push(...linesFrom(payload, receiptNumber));
        }
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
