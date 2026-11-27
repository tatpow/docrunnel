import type { CatalogItem } from "./graph";
import type { ExtractionField, Graph, PersonalNode, ScriptNode } from "./live-graph";
import {
  DemoSchemaError,
  prepareGraph,
  renderDemoCsv,
  renderDemoJson,
  renderDemoXlsx,
  runGraphOnDocuments,
  type DemoDocumentInput,
  type DemoReport,
} from "./demo-engine";
import { DemoParseError, parseDocumentBytes, type ParsedBlock } from "./demo-parser";

export const DEMO_MAX_DOCUMENTS = 3;
const DEMO_MAX_FILE_BYTES = 20 * 1024 * 1024;

type SavedVersion = { id: string; version_id: string; version: number; name: string; draft: boolean; graph: Graph };
type PreviewStorage = { workflows: SavedVersion[]; personal: PersonalNode[]; scripts: ScriptNode[] };
type StoredDemoDoc = DemoDocumentInput & { url: string };

const storageKey = "docrunnel-vercel-preview-v1";
const demoDocuments = new Map<string, StoredDemoDoc>();
const demoRuns = new Map<string, DemoReport>();
const demoRunOrder: string[] = [];

const catalog: CatalogItem[] = [
  { type: "input", input: null, output: "document", multiple_inputs: false },
  { type: "parse", input: "document", output: "text", multiple_inputs: false },
  { type: "extract", input: "text", output: "rows", multiple_inputs: false },
  { type: "validate", input: "rows", output: "rows", multiple_inputs: true },
  { type: "personal", input: "rows", output: "rows", multiple_inputs: false },
  { type: "branch", input: "rows", output: "rows", multiple_inputs: false, outputs: ["pass", "review"] },
  { type: "review", input: "rows", output: null, multiple_inputs: true },
  { type: "combine", input: "rows", output: "rows", multiple_inputs: true },
  { type: "assemble", input: "record", output: "rows", multiple_inputs: true },
  { type: "table", input: null, output: "rows", multiple_inputs: false, inputs: { table: "table", meta: "rows" }, optional_inputs: ["meta"] },
  { type: "export", input: "rows", output: null, multiple_inputs: false },
];

const initial: PreviewStorage = {
  workflows: [],
  personal: [{
    node_id: "sample-normalizer",
    version_id: "sample-normalizer-v1",
    version: 1,
    definition: { name: "Очистить номер", input_field: "number", output_field: "clean_number", expression: "trim(value)" },
  }],
  scripts: [{
    node_id: "sample-script",
    version_id: "sample-script-v1",
    version: 1,
    definition: {
      name: "Текст первого блока",
      category: "Документы",
      description: "Пример текстового входа и строкового выхода.",
      inputs: { document: "text" },
      outputs: { text: { type: "scalar" } },
      parameters: {},
      code: 'def process(inputs, params):\n    blocks = inputs["document"]\n    return {"outputs": {"text": blocks[0]["text"][:100] if blocks else ""}, "diagnostics": []}',
    },
  }],
};

const reply = (value: unknown, status = 200) => Response.json(value, { status });
const noContent = () => new Response(null, { status: 204 });
const missing = () => Response.json({ detail: "preview_item_missing" }, { status: 404 });
const withoutGraph = ({ id, version_id, version, name, draft }: SavedVersion) => ({ id, version_id, version, name, draft });

export function getDemoDocumentUrl(id: string): string | undefined {
  return demoDocuments.get(id)?.url;
}

export function downloadDemoRunExport(runId: string, format: "csv" | "json" | "xlsx"): boolean {
  const report = demoRuns.get(runId);
  if (!report) return false;
  const blob = format === "csv"
    ? renderDemoCsv(report)
    : format === "xlsx"
      ? renderDemoXlsx(report)
      : renderDemoJson(report);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `docrunnel-demo.${format}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

function exampleValue(expression: string, value: string): string | undefined {
  const operators: string[] = [];
  let remaining = expression.trim();
  while (remaining !== "value") {
    const parsed = /^(trim|lower|upper)\s*\(([\s\S]*)\)$/.exec(remaining);
    if (!parsed) return undefined;
    operators.push(parsed[1]);
    remaining = parsed[2].trim();
  }
  return operators.reduceRight((current, operator) => {
    if (operator === "lower") return current.toLowerCase();
    if (operator === "upper") return current.toUpperCase();
    return current.trim();
  }, value);
}

function detectFormat(fileName: string, bytes: Uint8Array): "pdf" | "docx" | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) {
    return bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 ? "pdf" : null;
  }
  if (lower.endsWith(".docx")) {
    return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b ? "docx" : null;
  }
  return null;
}

const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
  х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

function slugifyKey(raw: string, fallback: string): string {
  const translit = raw.trim().toLowerCase().split("").map(ch => TRANSLIT[ch] ?? ch).join("");
  const cleaned = translit.replace(/[^a-z0-9_-]+/g, "_").replace(/^[_-]+|[_-]+$/g, "").slice(0, 40);
  return cleaned && /^[A-Za-z0-9_-]{1,48}$/.test(cleaned) ? cleaned : fallback;
}

function inferFieldType(label: string, value: string): ExtractionField["type"] {
  const trimmed = value.trim();
  if (/^(?:[0-9]{10}|[0-9]{12})$/.test(trimmed) || /инн/i.test(label)) return "inn";
  if (/(?:₽|руб\.?|RUB)\s*$/i.test(trimmed) || /сумм|итого|стоимост|цен/i.test(label)) return "money";
  if (/^\d{1,2}[./]\d{1,2}[./]\d{4}$/.test(trimmed) || /^\d{4}-\d{2}-\d{2}$/.test(trimmed) || /дата/i.test(label)) return "date";
  return "text";
}

function buildHeuristicFields(blocks: ParsedBlock[]): { fields: ExtractionField[]; components: { kind: string; title: string; detail: string }[] } {
  const components: { kind: string; title: string; detail: string }[] = [];
  const fields: ExtractionField[] = [];
  const usedIds = new Set<string>();
  const usedLabels = new Set<string>();

  const pushField = (label: string, sample: string, sourceMode: "inline" | "table") => {
    const cleanLabel = label.trim().replace(/:+$/, "");
    if (!cleanLabel || cleanLabel.length > 60 || usedLabels.has(cleanLabel.toLowerCase()) || fields.length >= 6) return;
    usedLabels.add(cleanLabel.toLowerCase());
    const type = inferFieldType(cleanLabel, sample);
    let id = slugifyKey(cleanLabel, `field_${fields.length + 1}`);
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${id.slice(0, 34)}_${suffix++}`;
    }
    usedIds.add(id);
    fields.push({
      id,
      name: cleanLabel,
      type,
      labels: [cleanLabel],
      source_mode: sourceMode,
      ...(type === "money" ? { currency: "RUB" as const } : {}),
      ...(type === "text" ? { cleanup: "collapse" as const } : {}),
    });
    components.push({ kind: "field", title: cleanLabel, detail: `${type} · ${sourceMode}` });
  };

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (components.length < 4 && block.text.length <= 100 && !block.location.path?.slice(2).length) {
      components.push({ kind: "heading", title: block.text.slice(0, 80), detail: block.location.page ? `Стр. ${block.location.page}` : `Блок ${i + 1}` });
    }
    for (const line of block.text.split(/\r?\n/)) {
      const m = /^[ \t]*([^:\n№]{2,50}?)[ \t]*(?::|№)[ \t]*([^\r\n]{1,120})$/.exec(line);
      if (m) pushField(m[1], m[2], "inline");
    }
    const cell = block.location.path ?? [];
    const next = blocks[i + 1]?.location.path ?? [];
    if (
      cell.length >= 4 &&
      next.length === cell.length &&
      cell.slice(0, -2).every((v, idx) => v === next[idx]) &&
      next[next.length - 2] === cell[cell.length - 2] + 1
    ) {
      pushField(block.text, blocks[i + 1].text, "table");
    }
  }

  if (!fields.length) {
    fields.push(
      { id: "number", name: "Номер договора", type: "text", labels: ["Номер договора", "Договор"], source_mode: "any", cleanup: "collapse" },
      { id: "amount", name: "Сумма", type: "money", labels: ["Сумма договора", "Итого по договору", "Сумма"], currency: "RUB", source_mode: "any" },
    );
  }
  return { fields, components };
}

function normalizeUrl(raw?: string): string {
  const cleaned = (raw ?? "").trim().replace(/\/+$/, "");
  if (!cleaned) return "";
  return cleaned.endsWith("/v1") ? cleaned : `${cleaned}/v1`;
}

async function tryFetchModels(baseUrl: string, apiKey?: string): Promise<string[] | null> {
  if (!baseUrl) return null;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 6000);
  try {
    const headers: Record<string, string> = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const res = await fetch(`${baseUrl}/models`, { headers, signal: controller.signal });
    if (!res.ok) return null;
    const data = await res.json() as { data?: { id?: string }[] };
    return Array.isArray(data?.data) ? data.data.map(m => m.id).filter((id): id is string => Boolean(id)) : [];
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function previewRequest(path: string, body: unknown): Promise<Response> {
  const previous = localStorage.getItem(storageKey);
  const state = previous ? JSON.parse(previous) as PreviewStorage : structuredClone(initial);
  const save = () => localStorage.setItem(storageKey, JSON.stringify(state));

  if (body === undefined) {
    if (path === "/documents") {
      return reply(Array.from(demoDocuments.values(), ({ id, name, format }) => ({ id, name, format })));
    }
    if (path === "/runs") {
      return reply(
        demoRunOrder
          .map(id => demoRuns.get(id))
          .filter((item): item is DemoReport => Boolean(item))
          .map(({ id, state: runState, created_at }) => ({ id, state: runState, created_at })),
      );
    }
    const runMatch = /^\/runs\/([^/]+)$/.exec(path);
    if (runMatch) {
      const report = demoRuns.get(runMatch[1]);
      return report ? reply(report) : missing();
    }
    if (path === "/ai/config") {
      return reply({ default_base_url: "http://localhost:1234/v1", default_model: "", timeout_seconds: 600, retries: 2 });
    }
    if (path === "/workflows/catalog") return reply(catalog);
    if (path === "/personal-nodes") return reply(state.personal);
    if (path === "/script-nodes") return reply(state.scripts);
    if (path === "/workflows") {
      return reply(Array.from(new Map(state.workflows.map(item => [item.id, withoutGraph(item)])).values()).reverse());
    }
    const item = state.workflows.find(({ version_id }) => path === `/workflows/versions/${version_id}`);
    return item ? reply(item) : missing();
  }

  if (path === "/documents" && body instanceof FormData) {
    const uploadedFiles = body.getAll("files").filter((entry): entry is File => entry instanceof File);
    const results: ({ id?: string; name: string; format?: string; error?: string })[] = [];

    for (const file of uploadedFiles) {
      if (demoDocuments.size >= DEMO_MAX_DOCUMENTS) {
        results.push({ name: file.name, error: "DEMO_FILE_LIMIT" });
        continue;
      }
      if (file.size > DEMO_MAX_FILE_BYTES) {
        results.push({ name: file.name, error: "FILE_TOO_LARGE" });
        continue;
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const format = detectFormat(file.name, bytes);
      if (!format) {
        results.push({ name: file.name, error: "UNSUPPORTED_FORMAT" });
        continue;
      }
      const id = crypto.randomUUID();
      const url = URL.createObjectURL(file);
      demoDocuments.set(id, { id, name: file.name, format, bytes, url });
      results.push({ id, name: file.name, format });
    }
    return reply(results);
  }

  const docDeleteMatch = /^\/documents\/([^/]+)\/delete$/.exec(path);
  if (docDeleteMatch) {
    const doc = demoDocuments.get(docDeleteMatch[1]);
    if (!doc) return missing();
    URL.revokeObjectURL(doc.url);
    demoDocuments.delete(doc.id);
    return noContent();
  }

  if (path === "/runs/clear") {
    demoRuns.clear();
    demoRunOrder.length = 0;
    return noContent();
  }

  if (path === "/runs") {
    const req = body as { documents?: string[]; schema_version?: string; graph?: Graph; target?: string };
    const docIds = Array.isArray(req.documents) ? req.documents : [];
    if (!docIds.length) return reply({ detail: "run_parameters" }, 422);

    let graph: Graph | undefined = req.graph;
    let revision: number | null = null;
    if (req.schema_version) {
      const saved = state.workflows.find(item => item.version_id === req.schema_version);
      if (!saved) return missing();
      if (saved.draft && !req.target) return reply({ detail: "workflow_draft" }, 422);
      graph = saved.graph;
      revision = saved.version;
    }
    if (!graph) return reply({ detail: "run_parameters" }, 422);

    const docs: StoredDemoDoc[] = [];
    for (const id of docIds) {
      const found = demoDocuments.get(id);
      if (!found) return reply({ detail: "document" }, 404);
      docs.push(found);
    }

    try {
      const runId = crypto.randomUUID();
      const report = await runGraphOnDocuments({
        runId,
        graph,
        documents: docs,
        target: req.target ?? null,
        schemaVersion: req.schema_version ?? null,
        schemaRevision: revision,
      });
      demoRuns.set(runId, report);
      demoRunOrder.unshift(runId);
      if (demoRunOrder.length > 20) {
        const dropped = demoRunOrder.pop();
        if (dropped) demoRuns.delete(dropped);
      }
      return reply({ id: report.id, state: report.state, created_at: report.created_at }, 202);
    } catch (error) {
      if (error instanceof DemoSchemaError) {
        return reply({ detail: { code: error.code, reason: error.reason, nodes: error.nodes } }, 422);
      }
      throw error;
    }
  }

  if (path === "/ai/test" || path === "/ai/models") {
    const req = body as { base_url?: string; api_key?: string };
    const base = normalizeUrl(req.base_url);
    const started = performance.now();
    const liveModels = await tryFetchModels(base, req.api_key);
    const latency = Math.round(performance.now() - started);
    if (liveModels !== null) {
      return reply({
        ok: true,
        base_url: base,
        models: liveModels,
        latency_ms: latency,
        message: liveModels.length
          ? `LM подключена напрямую из браузера (${latency} мс). Моделей: ${liveModels.length}.`
          : `LM подключена (${latency} мс). Укажите имя модели вручную.`,
      });
    }
    return reply({
      ok: true,
      base_url: base || "http://localhost:1234/v1",
      models: ["offline-demo-analyzer"],
      latency_ms: latency,
      message: "Демо-режим: LM-сервер не ответил напрямую (CORS или не запущен). Доступен локальный автоанализ загруженного файла в браузере.",
    });
  }

  if (path === "/ai/generate-graph") {
    const req = body as { document_id?: string; base_url?: string; model?: string; prompt?: string };
    const started = performance.now();
    const uploadedDoc = req.document_id ? demoDocuments.get(req.document_id) : undefined;

    if (uploadedDoc) {
      let blocks: ParsedBlock[];
      try {
        blocks = (await parseDocumentBytes(uploadedDoc.bytes, uploadedDoc.format)).blocks;
      } catch (error) {
        const code = error instanceof DemoParseError ? error.code : "CORRUPT_FILE";
        return reply({ detail: { code, message: `Не удалось разобрать документ (${code}).` } }, 422);
      }

      const { fields, components } = buildHeuristicFields(blocks);
      const graph: Graph = {
        format_version: 2,
        nodes: [
          { id: "input", type: "input", position: { x: 0, y: 40 } },
          { id: "parse", type: "parse", position: { x: 220, y: 40 } },
          { id: "extract", type: "extract", position: { x: 440, y: 40 }, fields },
          {
            id: "branch",
            type: "branch",
            position: { x: 680, y: 40 },
            rules: fields.slice(0, 3).map(f => ({ field: f.id, kind: "required" as const })),
          },
          { id: "export", type: "export", position: { x: 920, y: 40 }, columns: fields.map(f => f.id) },
          { id: "review", type: "review", position: { x: 920, y: 210 } },
        ],
        edges: [
          ["input", "parse"],
          ["parse", "extract"],
          ["extract", "branch"],
          ["branch", "export", "pass"],
          ["branch", "review", "review"],
        ],
      };

      const checkReport = await runGraphOnDocuments({
        runId: "ai-check",
        graph,
        documents: [uploadedDoc],
        target: "extract",
      });
      const rowFields = checkReport.rows[0]?.fields ?? {};
      const fieldsPreview = fields.map(f => {
        const entry = rowFields[f.id];
        const val = entry?.value;
        const sample = val && typeof val === "object"
          ? `${val.decimal} ${val.currency ?? ""}`.trim()
          : val != null ? String(val) : "";
        const quote = entry?.candidates?.[0]?.sources?.[0]?.quote ?? entry?.invalid_sources?.[0]?.quote ?? "";
        return {
          id: f.id,
          name: f.name ?? f.id,
          type: f.type,
          labels: f.labels,
          source_mode: f.source_mode ?? "any",
          status: entry?.status ?? "missing",
          sample,
          quote,
        };
      });
      const matched = fieldsPreview.filter(item => item.status === "ok").length;
      return reply({
        model: req.model || "browser-heuristic-demo",
        base_url: normalizeUrl(req.base_url) || "browser-local",
        latency_ms: Math.round(performance.now() - started),
        repair_attempts: 0,
        document_name: uploadedDoc.name,
        workflow_name: `Схема · ${uploadedDoc.name.slice(0, 40)}`,
        summary: `В веб-демо разобран файл «${uploadedDoc.name}» (${blocks.length} блоков) и автоматически предложено ${fields.length} полей. Для генерации по произвольному промпту через локальную LM используйте Docker-версию.`,
        components,
        fields_preview: fieldsPreview,
        matched_fields: matched,
        total_fields: fieldsPreview.length,
        warnings: [
          "Веб-демо выполнило локальный структурный анализ файла в браузере и проверило извлечение реальных цитат.",
        ],
        graph,
      });
    }

    return reply({
      model: req.model || "demo-preview",
      base_url: normalizeUrl(req.base_url) || "http://localhost:1234/v1",
      latency_ms: 120,
      repair_attempts: 0,
      document_name: "01-paragraph.docx (пример)",
      workflow_name: "LM · Договор поставки",
      summary: req.prompt
        ? `Демонстрация по запросу «${req.prompt.slice(0, 80)}»: загрузите свой PDF/DOCX в «Документы», чтобы проверить схему на реальном файле.`
        : "Демонстрационная схема договора. Загрузите PDF или DOCX (до 3 файлов), чтобы протестировать извлечение на своих данных.",
      components: [
        { kind: "heading", title: "Договор поставки ДР-001", detail: "Абзац 1" },
        { kind: "field", title: "Номер договора", detail: "text · Договор поставки" },
        { kind: "field", title: "Итоговая сумма", detail: "money · Итого по договору" },
      ],
      fields_preview: [
        { id: "number", name: "Номер договора", type: "text", source_mode: "inline", status: "ok", sample: "ДР-001", quote: "Договор поставки ДР-001" },
        { id: "amount", name: "Итоговая сумма", type: "money", source_mode: "inline", status: "ok", sample: "12345.67 RUB", quote: "Итого по договору: 12 345,67 руб." },
      ],
      matched_fields: 2,
      total_fields: 2,
      warnings: ["Загрузите файл в разделе «Документы» (до 3 шт.), чтобы разобрать реальный документ прямо в браузере."],
      graph: {
        format_version: 2,
        nodes: [
          { id: "input", type: "input", position: { x: 0, y: 40 } },
          { id: "parse", type: "parse", position: { x: 220, y: 40 } },
          {
            id: "extract",
            type: "extract",
            position: { x: 440, y: 40 },
            fields: [
              { id: "number", name: "Номер договора", type: "text", labels: ["Договор поставки"], source_mode: "inline", cleanup: "collapse" },
              { id: "amount", name: "Итоговая сумма", type: "money", labels: ["Итого по договору"], currency: "RUB", source_mode: "inline" },
            ],
          },
          {
            id: "branch",
            type: "branch",
            position: { x: 680, y: 40 },
            rules: [
              { field: "number", kind: "required" },
              { field: "amount", kind: "range", minimum: "0" },
            ],
          },
          { id: "export", type: "export", position: { x: 920, y: 40 }, columns: ["number", "amount"], deduplicate_by: "number" },
          { id: "review", type: "review", position: { x: 920, y: 210 } },
        ],
        edges: [
          ["input", "parse"],
          ["parse", "extract"],
          ["extract", "branch"],
          ["branch", "export", "pass"],
          ["branch", "review", "review"],
        ],
      },
    });
  }

  const workflowPath = /^\/workflows(?:\/([^/]+)\/versions)?$/.exec(path);
  if (workflowPath) {
    const id = workflowPath[1];
    const prior = id ? state.workflows.findLast(item => item.id === id) : undefined;
    if (id && !prior) return missing();
    const { name, draft, graph } = body as Pick<SavedVersion, "name" | "draft" | "graph">;
    if (!draft) {
      try {
        prepareGraph(graph);
      } catch (error) {
        if (error instanceof DemoSchemaError) {
          return reply({ detail: { code: error.code, reason: error.reason, nodes: error.nodes } }, 422);
        }
        throw error;
      }
    }
    const item: SavedVersion = {
      id: prior?.id ?? crypto.randomUUID(),
      version_id: crypto.randomUUID(),
      version: (prior?.version ?? 0) + 1,
      name,
      draft,
      graph,
    };
    state.workflows.push(item);
    save();
    return reply(withoutGraph(item));
  }

  if (path === "/personal-nodes/preview") {
    const { expression, value } = body as { expression: string; value: string };
    const result = exampleValue(expression, value);
    return result === undefined ? Response.json({ detail: "personal_expression" }, { status: 422 }) : reply({ value: result });
  }

  const nodePath = /^\/(personal-nodes|script-nodes)(?:\/([^/]+)\/versions)?$/.exec(path);
  if (!nodePath) return missing();
  const [, kind, id] = nodePath;
  const library: (PersonalNode | ScriptNode)[] = kind === "personal-nodes" ? state.personal : state.scripts;
  const index = library.findIndex(item => item.node_id === id);
  if (id && index < 0) return missing();
  const item = {
    node_id: id ?? crypto.randomUUID(),
    version_id: crypto.randomUUID(),
    version: index < 0 ? 1 : library[index].version + 1,
    definition: body,
  } as PersonalNode | ScriptNode;
  if (index < 0) library.push(item);
  else library[index] = item;
  save();
  return reply(item);
}
