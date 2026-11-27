import type { CatalogItem } from "./graph";
import type { PersonalNode, ScriptNode } from "./live-graph";

type SavedVersion = { id: string; version_id: string; version: number; name: string; draft: boolean; graph: unknown };
type PreviewStorage = { workflows: SavedVersion[]; personal: PersonalNode[]; scripts: ScriptNode[] };
const storageKey = "docrunnel-vercel-preview-v1";
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
  personal: [{ node_id: "sample-normalizer", version_id: "sample-normalizer-v1", version: 1,
    definition: { name: "Очистить номер", input_field: "number", output_field: "clean_number", expression: "trim(value)" } }],
  scripts: [{ node_id: "sample-script", version_id: "sample-script-v1", version: 1,
    definition: {
      name: "Текст первого блока", category: "Документы", description: "Пример текстового входа и строкового выхода.",
      inputs: { document: "text" }, outputs: { text: { type: "scalar" } }, parameters: {},
      code: 'def process(inputs, params):\n    blocks = inputs["document"]\n    return {"outputs": {"text": blocks[0]["text"][:100] if blocks else ""}, "diagnostics": []}',
    } }],
};

const reply = (value: unknown) => Response.json(value);
const missing = () => Response.json({ detail: "preview_item_missing" }, { status: 404 });
const withoutGraph = ({ id, version_id, version, name, draft }: SavedVersion) => ({ id, version_id, version, name, draft });

function exampleValue(expression: string, value: string): string | undefined {
  const operators = [];
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

export function previewRequest(path: string, body: unknown) {
  const previous = localStorage.getItem(storageKey);
  const state = previous ? JSON.parse(previous) as PreviewStorage : structuredClone(initial);
  const save = () => localStorage.setItem(storageKey, JSON.stringify(state));

  if (body === undefined) {
    if (path === "/documents" || path === "/runs") return reply([]);
    if (path === "/workflows/catalog") return reply(catalog);
    if (path === "/personal-nodes") return reply(state.personal);
    if (path === "/script-nodes") return reply(state.scripts);
    if (path === "/workflows") return reply(Array.from(
      new Map(state.workflows.map(item => [item.id, withoutGraph(item)])).values()).reverse());
    const item = state.workflows.find(({ version_id }) => path === `/workflows/versions/${version_id}`);
    return item ? reply(item) : missing();
  }

  const workflowPath = /^\/workflows(?:\/([^/]+)\/versions)?$/.exec(path);
  if (workflowPath) {
    const id = workflowPath[1];
    const prior = id ? state.workflows.findLast(item => item.id === id) : undefined;
    if (id && !prior) return missing();
    const { name, draft, graph } = body as Pick<SavedVersion, "name" | "draft" | "graph">;
    const item = { id: prior?.id ?? crypto.randomUUID(), version_id: crypto.randomUUID(),
      version: (prior?.version ?? 0) + 1, name, draft, graph };
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
  const [ , kind, id ] = nodePath;
  const library: (PersonalNode | ScriptNode)[] = kind === "personal-nodes" ? state.personal : state.scripts;
  const index = library.findIndex(item => item.node_id === id);
  if (id && index < 0) return missing();
  const item = { node_id: id ?? crypto.randomUUID(), version_id: crypto.randomUUID(),
    version: index < 0 ? 1 : library[index].version + 1, definition: body } as PersonalNode | ScriptNode;
  if (index < 0) library.push(item);
  else library[index] = item;
  save();
  return reply(item);
}
