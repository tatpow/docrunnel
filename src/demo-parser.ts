import { unzipSync } from "fflate";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

export type BlockLocation = {
  page?: number;
  rotation?: number;
  path?: number[];
};

export type ParsedBlock = {
  location: BlockLocation;
  text: string;
};

export type ParseWarning = {
  code: string;
  page?: number;
};

export type ParseResult = {
  blocks: ParsedBlock[];
  warnings: ParseWarning[];
};

export class DemoParseError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

const MAX_CHARS = 2_000_000;
const MAX_DOCX_BLOCKS = 20_000;
const MAX_ZIP_ENTRIES = 4000;
const MAX_ZIP_UNCOMPRESSED = 100 * 1024 * 1024;
const MAX_PDF_PAGES = 300;

function extractParagraphText(pElement: Element): string {
  const parts: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    const local = el.localName;
    if (local === "delText" || local === "instrText" || local === "fldChar") return;
    if (local === "t") {
      parts.push(el.textContent ?? "");
      return;
    }
    if (local === "tab") {
      parts.push("\t");
      return;
    }
    if (local === "br" || local === "cr") {
      parts.push("\n");
      return;
    }
    for (let child = el.firstChild; child; child = child.nextSibling) {
      walk(child);
    }
  };
  walk(pElement);
  return parts.join("").normalize("NFC");
}

function getDirectAttr(el: Element, localAttr: string): string | null {
  for (let i = 0; i < el.attributes.length; i++) {
    const attr = el.attributes[i];
    if (attr.localName === localAttr) return attr.value;
  }
  return null;
}

function findDirectChild(el: Element, localName: string): Element | null {
  for (let child = el.firstElementChild; child; child = child.nextElementSibling) {
    if (child.localName === localName) return child;
  }
  return null;
}

function walkDocxContainer(container: Element, path: number[], blocks: ParsedBlock[], counter: { chars: number }) {
  let contentIndex = 0;
  for (let child = container.firstElementChild; child; child = child.nextElementSibling) {
    const local = child.localName;
    if (local !== "p" && local !== "tbl") continue;
    const itemPath = [...path, contentIndex];
    contentIndex += 1;

    if (local === "p") {
      const text = extractParagraphText(child);
      if (text.trim()) {
        counter.chars += text.length;
        if (counter.chars > MAX_CHARS || blocks.length >= MAX_DOCX_BLOCKS) {
          throw new DemoParseError("PARSE_LIMIT");
        }
        blocks.push({ location: { path: itemPath }, text });
      }
    } else if (local === "tbl") {
      let rowIndex = 0;
      for (let tr = child.firstElementChild; tr; tr = tr.nextElementSibling) {
        if (tr.localName !== "tr") continue;
        let colIndex = 0;
        for (let tc = tr.firstElementChild; tc; tc = tc.nextElementSibling) {
          if (tc.localName !== "tc") continue;
          const tcPr = findDirectChild(tc, "tcPr");
          const gridSpanEl = tcPr ? findDirectChild(tcPr, "gridSpan") : null;
          const spanRaw = gridSpanEl ? Number(getDirectAttr(gridSpanEl, "val") ?? "1") : 1;
          const span = Number.isFinite(spanRaw) && spanRaw >= 1 ? Math.floor(spanRaw) : 1;

          const vMergeEl = tcPr ? findDirectChild(tcPr, "vMerge") : null;
          const vMergeVal = vMergeEl ? getDirectAttr(vMergeEl, "val") : null;
          const isVerticalContinuation = Boolean(vMergeEl && vMergeVal !== "restart");

          if (!isVerticalContinuation) {
            walkDocxContainer(tc, [...itemPath, rowIndex, colIndex], blocks, counter);
          }
          colIndex += span;
        }
        rowIndex += 1;
      }
    }
  }
}

export function parseDocxBytes(bytes: Uint8Array): ParseResult {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new DemoParseError("CORRUPT_FILE");
  }

  const keys = Object.keys(entries);
  if (keys.length > MAX_ZIP_ENTRIES) {
    throw new DemoParseError("PARSE_LIMIT");
  }
  let totalSize = 0;
  for (const key of keys) {
    totalSize += entries[key].byteLength;
    if (totalSize > MAX_ZIP_UNCOMPRESSED) {
      throw new DemoParseError("PARSE_LIMIT");
    }
  }

  const documentEntry = entries["word/document.xml"];
  if (!documentEntry) {
    throw new DemoParseError("CORRUPT_FILE");
  }

  const xmlText = new TextDecoder("utf-8", { fatal: false }).decode(documentEntry);
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new DemoParseError("CORRUPT_FILE");
  }

  const root = doc.documentElement;
  const body = findDirectChild(root, "body");
  if (!body) {
    throw new DemoParseError("CORRUPT_FILE");
  }

  const blocks: ParsedBlock[] = [];
  walkDocxContainer(body, [], blocks, { chars: 0 });
  if (!blocks.length) {
    throw new DemoParseError("NO_TEXT_LAYER");
  }
  return { blocks, warnings: [] };
}

type PositionedItem = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

let pdfWorkerConfigured = false;

export async function parsePdfBytes(bytes: Uint8Array): Promise<ParseResult> {
  const pdfjs = await import("pdfjs-dist");
  if (!pdfWorkerConfigured) {
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    pdfWorkerConfigured = true;
  }

  let loadingTask: ReturnType<typeof pdfjs.getDocument>;
  let pdfDocument: Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]>;
  try {
    loadingTask = pdfjs.getDocument({
      data: bytes.slice(),
      useWorkerFetch: false,
      verbosity: 0,
    });
    pdfDocument = await loadingTask.promise;
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    const msg = error instanceof Error ? error.message : "";
    if (name === "PasswordException" || /password/i.test(msg)) {
      throw new DemoParseError("ENCRYPTED");
    }
    throw new DemoParseError("CORRUPT_FILE");
  }

  const blocks: ParsedBlock[] = [];
  const warnings: ParseWarning[] = [];
  let totalChars = 0;

  try {
    if (pdfDocument.numPages > MAX_PDF_PAGES) {
      throw new DemoParseError("PARSE_LIMIT");
    }

    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber++) {
      const page = await pdfDocument.getPage(pageNumber);
      try {
        const [cropXMin, cropYMin, cropXMax, cropYMax] = page.view;
        const content = await page.getTextContent();
        const positioned: PositionedItem[] = [];

        for (const rawItem of content.items) {
          if (!("str" in rawItem) || !rawItem.str) continue;
          const str = rawItem.str.normalize("NFC");
          if (!str.trim()) continue;

          const tx = rawItem.transform;
          const fontHeight = Math.hypot(tx[2], tx[3]) || Math.abs(rawItem.height) || 10;
          const width = Math.abs(rawItem.width || 0);
          const x = tx[4];
          const y = tx[5];
          const centerX = x + width / 2;
          const centerY = y + fontHeight * 0.35;

          if (
            centerX >= cropXMin - 2 &&
            centerX <= cropXMax + 2 &&
            centerY >= cropYMin - 2 &&
            centerY <= cropYMax + 2
          ) {
            positioned.push({ text: str, x, y, width, height: fontHeight });
          }
        }

        // PDF user space has Y increasing upwards, so top-to-bottom is descending Y.
        positioned.sort((a, b) => b.y - a.y || a.x - b.x);
        const lines: PositionedItem[][] = [];
        for (const item of positioned) {
          const lastLine = lines[lines.length - 1];
          if (!lastLine) {
            lines.push([item]);
            continue;
          }
          const refY = lastLine[0].y;
          const tolerance = Math.max(2.5, Math.min(item.height, lastLine[0].height) * 0.45);
          if (Math.abs(item.y - refY) <= tolerance) {
            lastLine.push(item);
          } else {
            lines.push([item]);
          }
        }

        const lineStrings: string[] = [];
        for (const line of lines) {
          line.sort((a, b) => a.x - b.x);
          let lineText = "";
          let prevEnd = -Infinity;
          for (const item of line) {
            const cleaned = item.text;
            if (!lineText) {
              lineText = cleaned;
            } else {
              const gap = item.x - prevEnd;
              const needsSpace =
                gap > Math.max(1.5, item.height * 0.14) &&
                !/\s$/.test(lineText) &&
                !/^\s/.test(cleaned);
              lineText += (needsSpace ? " " : "") + cleaned;
            }
            prevEnd = Math.max(prevEnd, item.x + item.width);
          }
          const normalizedLine = lineText.replace(/[ \t]+/g, " ").trim();
          if (normalizedLine) lineStrings.push(normalizedLine);
        }

        const pageText = lineStrings.join("\n").normalize("NFC");
        totalChars += pageText.length;
        if (totalChars > MAX_CHARS) {
          throw new DemoParseError("PARSE_LIMIT");
        }
        if (pageText.trim()) {
          blocks.push({
            location: { page: pageNumber, rotation: ((page.rotate % 360) + 360) % 360 },
            text: pageText,
          });
        } else {
          warnings.push({ code: "PAGE_WITHOUT_TEXT", page: pageNumber });
        }
      } finally {
        page.cleanup();
      }
    }
  } catch (error) {
    if (error instanceof DemoParseError) throw error;
    throw new DemoParseError("CORRUPT_FILE");
  } finally {
    await loadingTask.destroy().catch(() => {});
  }

  if (!blocks.length) {
    throw new DemoParseError("NO_TEXT_LAYER");
  }
  return { blocks, warnings };
}

export async function parseDocumentBytes(bytes: Uint8Array, format: "pdf" | "docx"): Promise<ParseResult> {
  return format === "pdf" ? parsePdfBytes(bytes) : parseDocxBytes(bytes);
}
