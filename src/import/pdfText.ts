/**
 * Pull readable text out of a digital PDF in memory.
 * Picture-only scans and compressed streams we cannot inflate return nothing.
 * The buffer is not written to disk and the text is not logged.
 */

import zlib from "node:zlib";

function unescapePdf(value: string): string {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "")
    .replace(/\\t/g, " ")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\")
    .replace(/\\([0-7]{1,3})/g, (_, oct: string) => String.fromCharCode(Number.parseInt(oct, 8)));
}

function stringsFromOperators(blob: string): string[] {
  const out: string[] = [];
  const pattern = /\(((?:\\.|[^\\)])+)\)\s*Tj|\[(.*?)\]\s*TJ/gs;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(blob))) {
    if (match[1]) {
      const text = unescapePdf(match[1]).replace(/\s+/g, " ").trim();
      if (text) out.push(text);
      continue;
    }
    const inner = match[2] || "";
    const bits: string[] = [];
    const piece = /\(((?:\\.|[^\\)])*)\)/g;
    let part: RegExpExecArray | null;
    while ((part = piece.exec(inner))) bits.push(unescapePdf(part[1] || ""));
    const text = bits.join("").replace(/\s+/g, " ").trim();
    if (text) out.push(text);
  }
  return out;
}

function inflateStreams(buffer: Buffer): string[] {
  const raw = buffer.toString("latin1");
  const blobs = [raw];
  let index = 0;
  while (index < raw.length) {
    const at = raw.indexOf("stream", index);
    if (at < 0) break;
    let start = at + "stream".length;
    if (raw[start] === "\r") start += 1;
    if (raw[start] === "\n") start += 1;
    const end = raw.indexOf("endstream", start);
    if (end < 0) break;
    let stop = end;
    if (stop > start && raw[stop - 1] === "\n") stop -= 1;
    if (stop > start && raw[stop - 1] === "\r") stop -= 1;
    const slice = buffer.subarray(start, stop);
    try {
      blobs.push(zlib.inflateSync(slice).toString("latin1"));
    } catch {
      try {
        blobs.push(zlib.unzipSync(slice).toString("latin1"));
      } catch {
        /* image stream or a filter we do not handle */
      }
    }
    index = end + "endstream".length;
  }
  return blobs;
}

/** Text operators only. Font names and metadata stay out. */
export function extractPdfText(buffer: Buffer): string {
  if (!buffer?.length) return "";
  const lines: string[] = [];
  for (const blob of inflateStreams(buffer)) {
    for (const line of stringsFromOperators(blob)) {
      if (/[A-Za-z]{2,}/.test(line)) lines.push(line);
    }
  }
  return lines.join("\n").trim();
}
