import type { CatalogItem } from "./graph";
import type { Graph, PersonalNode } from "./live-graph";
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

export const DEMO_MAX_DOCUMENTS = 3;
const DEMO_MAX_FILE_BYTES = 20 * 1024 * 1024;

type SavedVersion = { id: string; version_id: string; version: number; name: string; draft: boolean; graph: Graph };
type PreviewStorage = { workflows: SavedVersion[]; personal: PersonalNode[] };
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

export async function previewRequest(path: string, body: unknown): Promise<Response> {
  if (/^\/(?:ai|script-nodes)(?:\/|$)/.test(path)) {
    return reply({ detail: "DEMO_SERVER_REQUIRED" }, 403);
  }

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
    if (path === "/workflows/catalog") return reply(catalog);
    if (path === "/personal-nodes") return reply(state.personal);
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

  const nodePath = /^\/personal-nodes(?:\/([^/]+)\/versions)?$/.exec(path);
  if (!nodePath) return missing();
  const [, id] = nodePath;
  const library = state.personal;
  const index = library.findIndex(item => item.node_id === id);
  if (id && index < 0) return missing();
  const item = {
    node_id: id ?? crypto.randomUUID(),
    version_id: crypto.randomUUID(),
    version: index < 0 ? 1 : library[index].version + 1,
    definition: body,
  } as PersonalNode;
  if (index < 0) library.push(item);
  else library[index] = item;
  save();
  return reply(item);
}
