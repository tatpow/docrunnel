import { strToU8, zipSync } from "fflate";
import { requiresServer, type BranchRule, type ExtractionField, type Graph, type SchemaNode, type TableColumn } from "./live-graph";
import { DemoParseError, parseDocumentBytes, type BlockLocation, type ParsedBlock } from "./demo-parser";

export type DemoFragment = {
  quote: string;
  start: number;
  end: number;
  locator: BlockLocation;
  boxes: number[][];
  context: string;
};

export type DemoValue = string | number | { decimal: string; currency: string | null } | null;

export type DemoFieldResult = {
  status: string;
  value: DemoValue;
  candidates: { value: DemoValue; sources: DemoFragment[] }[];
  invalid_sources: DemoFragment[];
};

export type DemoResultRow = {
  position: number;
  filename: string;
  document_id: string;
  fields: Record<string, DemoFieldResult>;
};

export type DemoReviewRow = DemoResultRow & {
  reasons: { field: string; code: string; first_position?: number }[];
};

export type DemoInspection = {
  node: string;
  type: string;
  inputs: unknown[];
  output: unknown;
};

export type DemoReport = {
  id: string;
  state: string;
  created_at: string;
  field_order: string[];
  field_names: Record<string, string>;
  table_columns: TableColumn[];
  rows: DemoResultRow[];
  review: DemoReviewRow[];
  inspection: DemoInspection | null;
  target: string | null;
  schema_version: string | null;
  schema_revision: number | null;
  graph_format: number;
  errors: { position: number; filename: string; error: { code: string; node?: string; message?: string } }[];
  total: number;
};

export type DemoDocumentInput = {
  id: string;
  name: string;
  format: "pdf" | "docx";
  bytes: Uint8Array;
};

export class DemoSchemaError extends Error {
  constructor(
    public readonly reason: string,
    public readonly code = "SCHEMA_INVALID",
    public readonly nodes: string[] = [],
  ) {
    super(reason);
  }
}

export class DemoExecutionError extends Error {
  constructor(
    public readonly code: string,
    public readonly node?: string,
    public readonly detailMessage?: string,
  ) {
    super(detailMessage || code);
  }
}

type PortPair = readonly [string | null, string | null];

const PORTS: Record<string, PortPair> = {
  input: [null, "document"],
  parse: ["document", "text"],
  extract: ["text", "rows"],
  validate: ["rows", "rows"],
  personal: ["rows", "rows"],
  branch: ["rows", "rows"],
  review: ["rows", null],
  combine: ["rows", "rows"],
  script: [null, null],
  assemble: ["record", "rows"],
  table: [null, "rows"],
  export: ["rows", null],
};

const TABLE_INPUTS: Record<string, string> = { table: "table", meta: "rows" };
const FIELD_TYPES = new Set(["text", "money", "number", "date", "inn"]);
const KEY_PATTERN = /^[A-Za-z0-9_-]{1,48}$/;
const MONEY_PATTERN = /^(?<amount>[+-]?(?:[0-9]{1,3}(?: [0-9]{3})+|[0-9]+)(?:[,.][0-9]{1,2})?)(?: ?(?<currency>₽|руб\.?|RUB))?$/i;
const NUMBER_PATTERN = /^[\p{L}\p{N}_][\p{L}\p{N}_/.-]{0,63}$/u;
const MONTHS = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

type IncomingEdge = [string, string | null, string | null];
type PreparedNode = SchemaNode & { _inputs: IncomingEdge[]; _table_columns?: TableColumn[] };

export type PreparedPlan = {
  nodes: Record<string, PreparedNode>;
  parents: Record<string, string[]>;
  order: string[];
  target: string;
};

function invalidExtractFields(node: SchemaNode): boolean {
  const list = node.fields ?? [];
  const ids = list.map(f => f.id ?? "");
  if (!ids.length || new Set(ids).size !== ids.length) return true;
  return list.some(
    f =>
      !f.id ||
      !KEY_PATTERN.test(f.id) ||
      !FIELD_TYPES.has(f.type) ||
      !f.labels?.length ||
      f.labels.length > 12 ||
      f.labels.some(l => !l.trim() || l.length > 80),
  );
}

function outputType(node: SchemaNode, handle: string | null): string | null {
  if (node.type === "script") {
    return handle ? (node.script_definition?.outputs[handle]?.type ?? null) : null;
  }
  if (node.type === "branch") {
    return handle === "pass" || handle === "review" ? "rows" : null;
  }
  return handle === null ? (PORTS[node.type]?.[1] ?? null) : null;
}

function inputType(node: SchemaNode, handle: string | null): string | null {
  if (node.type === "script") {
    return handle ? (node.script_definition?.inputs[handle] ?? null) : null;
  }
  if (node.type === "table") {
    return handle ? (TABLE_INPUTS[handle] ?? null) : null;
  }
  return handle === null ? (PORTS[node.type]?.[0] ?? null) : null;
}

function parseFiniteNumber(raw: string | undefined): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const cleaned = String(raw).trim().replace(/\s+/g, "").replace(",", ".");
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function validRule(rule: BranchRule): boolean {
  if (rule.kind !== "range") return true;
  const low = parseFiniteNumber(rule.minimum);
  const high = parseFiniteNumber(rule.maximum);
  if (low === null && high === null) return false;
  if (rule.minimum !== undefined && rule.minimum !== "" && low === null) return false;
  if (rule.maximum !== undefined && rule.maximum !== "" && high === null) return false;
  return low === null || high === null || low <= high;
}

function topologicalSort(parents: Record<string, string[]>): string[] {
  const keys = Object.keys(parents);
  const inDegree: Record<string, number> = {};
  const children: Record<string, string[]> = {};
  for (const key of keys) {
    inDegree[key] = parents[key].length;
    children[key] = [];
  }
  for (const key of keys) {
    for (const parent of parents[key]) {
      children[parent].push(key);
    }
  }
  const queue = keys.filter(key => inDegree[key] === 0);
  const order: string[] = [];
  while (queue.length) {
    const current = queue.shift()!;
    order.push(current);
    for (const child of children[current]) {
      inDegree[child] -= 1;
      if (inDegree[child] === 0) queue.push(child);
    }
  }
  if (order.length !== keys.length) {
    const cycleNodes = keys.filter(k => inDegree[k] > 0);
    throw new DemoSchemaError("cycle", "SCHEMA_INVALID", cycleNodes);
  }
  return order;
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
}

function mapsOfSetsEqual(a: Record<string, Set<string>>, b: Record<string, Set<string>>): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!b[key] || !setsEqual(a[key], b[key])) return false;
  }
  return true;
}

export function prepareGraph(graph: Graph, requestedTarget?: string | null): PreparedPlan {
  if (graph.format_version !== 2) {
    throw new DemoSchemaError("format_version", "SCHEMA_VERSION_UNSUPPORTED");
  }
  if (!graph.nodes?.length) {
    throw new DemoSchemaError("empty_graph");
  }

  const nodes: Record<string, PreparedNode> = {};
  for (const node of graph.nodes) {
    if (!node.id || nodes[node.id] || !(node.type in PORTS)) {
      throw new DemoSchemaError("node", "SCHEMA_INVALID", node.id ? [node.id] : []);
    }
    nodes[node.id] = { ...structuredClone(node), _inputs: [] };
  }

  const parents: Record<string, string[]> = {};
  const incoming: Record<string, IncomingEdge[]> = {};
  for (const key of Object.keys(nodes)) {
    parents[key] = [];
    incoming[key] = [];
  }

  for (const rawEdge of graph.edges ?? []) {
    const source = rawEdge[0];
    const destination = rawEdge[1];
    const handle = rawEdge.length > 2 ? (rawEdge[2] ?? null) : null;
    const targetHandle = rawEdge.length > 3 ? (rawEdge[3] ?? null) : null;
    if (!nodes[source] || !nodes[destination]) {
      throw new DemoSchemaError("edge", "SCHEMA_INVALID", [source, destination].filter(k => Boolean(nodes[k])));
    }
    const duplicate = incoming[destination].some(
      ([s, h, th]) => s === source && h === handle && th === targetHandle,
    );
    if (duplicate) {
      throw new DemoSchemaError("edge", "SCHEMA_INVALID", [source, destination]);
    }
    const out = outputType(nodes[source], handle);
    const inp = inputType(nodes[destination], targetHandle);
    if (
      out === null ||
      out !== inp ||
      (nodes[source].type === "branch" && handle === "review") !== (nodes[destination].type === "review")
    ) {
      throw new DemoSchemaError("port_type", "SCHEMA_INVALID", [source, destination]);
    }
    if (!parents[destination].includes(source)) parents[destination].push(source);
    incoming[destination].push([source, handle, targetHandle]);
  }

  const order = topologicalSort(parents);
  const exports = Object.keys(nodes).filter(k => nodes[k].type === "export");
  const reviews = Object.keys(nodes).filter(k => nodes[k].type === "review");
  const fullRun = !requestedTarget;
  let target = requestedTarget ?? "";
  if (fullRun) {
    if (exports.length !== 1) {
      throw new DemoSchemaError("export_count", "SCHEMA_INVALID", exports.length > 1 ? exports : []);
    }
    if (reviews.length > 1) {
      throw new DemoSchemaError("review_count", "SCHEMA_INVALID", reviews);
    }
    target = exports[0];
  }
  if (!nodes[target]) {
    throw new DemoSchemaError("target");
  }

  const relevant = new Set<string>([target, ...(fullRun ? reviews : [])]);
  for (let i = order.length - 1; i >= 0; i--) {
    const key = order[i];
    if (relevant.has(key)) {
      for (const p of parents[key]) relevant.add(p);
    }
  }

  const serverNodes = order.filter(key => (fullRun || relevant.has(key)) &&
    requiresServer(nodes[key].type));
  if (serverNodes.length) {
    throw new DemoSchemaError("server_node", "DEMO_SERVER_REQUIRED", serverNodes);
  }

  const columns: Record<string, string[]> = {};
  const types: Record<string, Record<string, Set<string>>> = {};
  const tableSchemas: Record<string, TableColumn[] | null> = {};

  for (const key of order) {
    if (!fullRun && !relevant.has(key)) continue;
    const node = nodes[key];
    node._inputs = incoming[key];
    const kind = node.type;
    const upstream = parents[key];

    if (PORTS[kind][0] !== null && !upstream.length) {
      throw new DemoSchemaError("required_input", "SCHEMA_INVALID", [key]);
    }
    if (!["validate", "combine", "review", "script", "assemble", "table"].includes(kind) && incoming[key].length > 1) {
      throw new DemoSchemaError("input_count", "SCHEMA_INVALID", [key]);
    }

    if (kind === "script") {
      const def = node.script_definition;
      const connected = incoming[key].map(([, , th]) => th ?? "");
      if (!def || !setsEqual(new Set(connected), new Set(Object.keys(def.inputs)))) {
        throw new DemoSchemaError("required_input", "SCHEMA_INVALID", [key]);
      }
      if (connected.length !== new Set(connected).size) {
        throw new DemoSchemaError("input_count", "SCHEMA_INVALID", [key]);
      }
      const allowedParams = new Set(Object.keys(def.parameters));
      if (Object.keys(node.script_params ?? {}).some(p => !allowedParams.has(p))) {
        throw new DemoSchemaError("script_parameters", "SCHEMA_INVALID", [key]);
      }
      columns[key] = [];
      types[key] = {};
      tableSchemas[key] = null;
      continue;
    }

    if (kind === "table") {
      const connected = incoming[key].map(([, , th]) => th ?? "");
      if (!connected.includes("table")) {
        throw new DemoSchemaError("required_input", "SCHEMA_INVALID", [key]);
      }
      if (connected.length !== new Set(connected).size) {
        throw new DemoSchemaError("input_count", "SCHEMA_INVALID", [key]);
      }
      const tableLink = incoming[key].find(([, , th]) => th === "table")!;
      let sourceCols = [...(nodes[tableLink[0]].script_definition?.outputs[tableLink[1] ?? ""]?.columns ?? [])];
      if (node.table_columns) {
        const byKey = new Map(sourceCols.map(c => [c.key, c]));
        if (new Set(node.table_columns).size !== node.table_columns.length || node.table_columns.some(k => !byKey.has(k))) {
          throw new DemoSchemaError("table_columns", "SCHEMA_INVALID", [key]);
        }
        sourceCols = node.table_columns.map(k => byKey.get(k)!);
      }
      tableSchemas[key] = sourceCols;
      node._table_columns = sourceCols;
      const metaLink = incoming[key].find(([, , th]) => th === "meta");
      columns[key] = metaLink ? [...columns[metaLink[0]]] : [];
      types[key] = metaLink ? { ...types[metaLink[0]] } : {};
      continue;
    }

    if (kind === "assemble") {
      const names: string[] = [];
      for (const [parent, port] of incoming[key]) {
        const outFields = Object.keys(nodes[parent].script_definition?.outputs[port ?? ""]?.fields ?? {});
        names.push(...outFields);
      }
      if (names.length !== new Set(names).size) {
        throw new DemoSchemaError("assemble_fields", "SCHEMA_INVALID", [key]);
      }
      columns[key] = names;
      types[key] = Object.fromEntries(names.map(n => [n, new Set(["text"])]));
      tableSchemas[key] = null;
      continue;
    }

    if (kind === "extract") {
      if (invalidExtractFields(node)) {
        const bad = order.filter(
          id => (fullRun || relevant.has(id)) && nodes[id].type === "extract" && invalidExtractFields(nodes[id]),
        );
        throw new DemoSchemaError("fields", "SCHEMA_INVALID", bad);
      }
      const list = node.fields ?? [];
      columns[key] = list.map(f => f.id);
      types[key] = Object.fromEntries(list.map(f => [f.id, new Set([f.type])]));
      tableSchemas[key] = null;
    } else {
      const colSet: string[] = [];
      for (const parent of upstream) {
        for (const f of columns[parent] ?? []) {
          if (!colSet.includes(f)) colSet.push(f);
        }
      }
      columns[key] = colSet;
      types[key] = {};
      for (const f of colSet) {
        const merged = new Set<string>();
        for (const parent of upstream) {
          for (const t of types[parent]?.[f] ?? []) merged.add(t);
        }
        types[key][f] = merged;
      }
      const parentTables = upstream.map(p => tableSchemas[p]).filter((t): t is TableColumn[] => Boolean(t));
      tableSchemas[key] = parentTables[0] ?? null;
    }

    if (kind === "combine") {
      for (const parent of upstream.slice(1)) {
        if (!mapsOfSetsEqual(types[parent], types[upstream[0]])) {
          throw new DemoSchemaError("combine_columns", "SCHEMA_INVALID", [key]);
        }
      }
    }

    if (kind === "personal") {
      const def = node.personal_definition;
      if (!def || !columns[key].includes(def.input_field)) {
        throw new DemoSchemaError("personal_input", "SCHEMA_INVALID", [key]);
      }
      if (!columns[key].includes(def.output_field)) {
        columns[key].push(def.output_field);
      }
      types[key][def.output_field] = new Set(["text"]);
    }

    if (kind === "branch") {
      const rules = node.rules ?? [];
      if (
        !rules.length ||
        rules.some(rule =>
          rule.kind === "table_required" || rule.kind === "table_complete"
            ? !tableSchemas[key]
            : !columns[key].includes(rule.field) || !validRule(rule),
        )
      ) {
        throw new DemoSchemaError("branch_rules", "SCHEMA_INVALID", [key]);
      }
      if (fullRun && !reviews.some(sink => incoming[sink].some(([s, h]) => s === key && h === "review"))) {
        throw new DemoSchemaError("review_required", "SCHEMA_INVALID", [key]);
      }
      if (
        fullRun &&
        !Array.from(relevant).some(child => incoming[child].some(([s, h]) => s === key && h === "pass"))
      ) {
        throw new DemoSchemaError("pass_required", "SCHEMA_INVALID", [key]);
      }
    }

    if (kind === "export") {
      let fieldOrder = node.columns;
      if (!fieldOrder) {
        const preferred = node.field_order ?? [];
        const unique = Array.from(new Set(preferred)).filter(f => columns[key].includes(f));
        for (const f of columns[key]) {
          if (!unique.includes(f)) unique.push(f);
        }
        fieldOrder = unique;
      } else if (new Set(fieldOrder).size !== fieldOrder.length || fieldOrder.some(f => !columns[key].includes(f))) {
        throw new DemoSchemaError("export_columns", "SCHEMA_INVALID", [key]);
      }
      if (node.deduplicate_by && !columns[key].includes(node.deduplicate_by)) {
        throw new DemoSchemaError("deduplicate_field", "SCHEMA_INVALID", [key]);
      }
      node.field_order = fieldOrder;
      node._table_columns = tableSchemas[key] ? [...tableSchemas[key]!] : [];
    }
  }

  return {
    nodes,
    parents,
    order: order.filter(k => relevant.has(k)),
    target,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatIsoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1 || year > 9999) return null;
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseMoneyValue(text: string, defaultCurrency?: string | null): { decimal: string; currency: string | null } | null {
  const collapsed = text.trim().split(/\s+/).join(" ");
  const match = MONEY_PATTERN.exec(collapsed);
  if (!match?.groups) return null;
  const currency = match.groups.currency ? "RUB" : (defaultCurrency ?? null);
  const rawNum = match.groups.amount.replace(/\s+/g, "").replace(",", ".");
  const parsed = Number(rawNum);
  if (!Number.isFinite(parsed)) return null;
  const safeVal = parsed === 0 ? 0 : parsed;
  return { decimal: safeVal.toFixed(2), currency };
}

export function normalizeFieldValue(raw: string, field: ExtractionField): DemoValue {
  const collapsed = raw.trim().split(/\s+/).join(" ");
  if (collapsed.length > 256) return null;

  switch (field.type) {
    case "text": {
      let text = collapsed;
      if (field.cleanup === "trim") text = raw.trim();
      else if (field.cleanup === "lower") text = text.toLocaleLowerCase("ru");
      else if (field.cleanup === "upper") text = text.toLocaleUpperCase("ru");
      return text.length > 0 && text.length <= 256 ? text : null;
    }
    case "money":
      return parseMoneyValue(collapsed, field.currency);
    case "inn":
      return /^(?:[0-9]{10}|[0-9]{12})$/.test(collapsed) ? collapsed : null;
    case "number":
      return NUMBER_PATTERN.test(collapsed) ? collapsed : null;
    case "date": {
      const lowered = collapsed.toLocaleLowerCase("ru").replace(/(?: года| г\.)$/, "").trim();
      const words = lowered.split(/\s+/);
      if (words.length === 3) {
        const monthIdx = MONTHS.indexOf(words[1]);
        if (monthIdx >= 0 && /^\d{1,2}$/.test(words[0]) && /^\d{4}$/.test(words[2])) {
          return formatIsoDate(Number(words[2]), monthIdx + 1, Number(words[0]));
        }
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(collapsed)) {
        const [y, m, d] = collapsed.split("-").map(Number);
        return formatIsoDate(y, m, d);
      }
      if (/^\d{1,2}[./]\d{1,2}[./]\d{4}$/.test(collapsed)) {
        const [d, m, y] = collapsed.split(/[./]/).map(Number);
        return formatIsoDate(y, m, d);
      }
      return null;
    }
    default:
      return null;
  }
}

function makeFragment(block: ParsedBlock, start: number, end: number): DemoFragment {
  const safeEnd = Math.min(end, start + 512);
  return {
    quote: block.text.slice(start, safeEnd),
    start,
    end: safeEnd,
    locator: block.location,
    boxes: [],
    context: block.text.slice(Math.max(0, start - 90), Math.min(block.text.length, safeEnd + 90)),
  };
}

type CandidateEntry = [DemoValue, DemoFragment];
type BranchFields = Record<string, CandidateEntry[]>;
type RowsData = { branches: Record<string, BranchFields> };

function extractFromBlocks(blocks: ParsedBlock[], fields: ExtractionField[]): BranchFields {
  const byField: BranchFields = {};
  for (const field of fields) {
    const collected: CandidateEntry[] = [];
    byField[field.id] = collected;
    const aliases = Array.from(new Set(field.labels)).sort((a, b) => b.length - a.length || a.localeCompare(b));
    const normalizedAliases = new Set(aliases.map(a => a.toLocaleLowerCase("ru")));
    const labelExpr = aliases
      .map(alias => alias.trim().split(/\s+/).map(escapeRegExp).join("[ \\t\\u00a0]+"))
      .join("|");
    const pattern = new RegExp(`^[ \\t]*(?:${labelExpr})[ \\t]*(?::|№)[ \\t]*([^\\r\\n]+)`, "gimu");
    const mode = field.source_mode ?? "any";

    for (let index = 0; index < blocks.length; index++) {
      const block = blocks[index];
      if (mode !== "table") {
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(block.text)) !== null) {
          const raw = match[1].replace(/\s+$/, "");
          const valStart = match.index + match[0].length - match[1].length;
          collected.push([normalizeFieldValue(raw, field), makeFragment(block, valStart, valStart + raw.length)]);
          if (collected.length >= 100) break;
        }
      }
      if (collected.length >= 100) break;
      if (mode === "inline") continue;

      const trimmedHeader = block.text.trim().replace(/:+$/, "").toLocaleLowerCase("ru");
      if (!normalizedAliases.has(trimmedHeader) || index + 1 >= blocks.length) continue;

      const cell = block.location.path ?? [];
      const nextCell = blocks[index + 1].location.path ?? [];
      if (
        cell.length >= 4 &&
        nextCell.length === cell.length &&
        cell.slice(0, -2).every((part, i) => part === nextCell[i]) &&
        nextCell[nextCell.length - 2] === cell[cell.length - 2] + 1
      ) {
        const valueBlock = blocks[index + 1];
        collected.push([
          normalizeFieldValue(valueBlock.text, field),
          makeFragment(valueBlock, 0, valueBlock.text.length),
        ]);
      }
    }
  }
  return byField;
}

function collectCandidates(branches: BranchFields[]): BranchFields {
  const result: BranchFields = {};
  for (const branch of branches) {
    for (const [field, list] of Object.entries(branch)) {
      if (!result[field]) result[field] = [];
      result[field].push(...list);
    }
  }
  return result;
}

function sameFragment(a: DemoFragment, b: DemoFragment): boolean {
  return (
    a.start === b.start &&
    a.end === b.end &&
    a.quote === b.quote &&
    JSON.stringify(a.locator) === JSON.stringify(b.locator)
  );
}

function mergeBranches(branches: BranchFields[]): Record<string, DemoFieldResult> {
  const result: Record<string, DemoFieldResult> = {};
  for (const [field, candidates] of Object.entries(collectCandidates(branches))) {
    const values = new Map<string, { value: DemoValue; sources: DemoFragment[] }>();
    const invalid: DemoFragment[] = [];

    for (const [value, fragment] of candidates) {
      if (value === null) {
        if (!invalid.some(item => sameFragment(item, fragment))) invalid.push(fragment);
      } else {
        const key =
          typeof value === "object"
            ? `money:${value.decimal}:${value.currency ?? ""}`
            : `text:${String(value)}`;
        let entry = values.get(key);
        if (!entry) {
          entry = { value, sources: [] };
          values.set(key, entry);
        }
        if (!entry.sources.some(item => sameFragment(item, fragment))) {
          entry.sources.push(fragment);
        }
      }
    }

    const choices = Array.from(values.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, item]) => item);
    const status = choices.length > 1 ? "ambiguous" : choices.length === 1 ? "ok" : invalid.length ? "invalid" : "missing";
    result[field] = {
      status,
      value: status === "ok" ? choices[0].value : null,
      candidates: choices,
      invalid_sources: invalid,
    };
  }
  return result;
}

function evaluatePersonalExpression(expression: string, value: string): string | null {
  const operators: string[] = [];
  let remaining = expression.trim();
  while (remaining !== "value") {
    const parsed = /^(trim|lower|upper)\s*\(([\s\S]*)\)$/.exec(remaining);
    if (!parsed) return null;
    operators.push(parsed[1]);
    remaining = parsed[2].trim();
  }
  return operators.reduceRight((current, op) => {
    if (op === "lower") return current.toLocaleLowerCase("ru");
    if (op === "upper") return current.toLocaleUpperCase("ru");
    return current.trim();
  }, value);
}

function evaluateReviewReasons(
  row: Record<string, DemoFieldResult>,
  rules: BranchRule[],
): { field: string; code: string }[] {
  const reasons: { field: string; code: string }[] = [];
  for (const rule of rules) {
    const field = row[rule.field] ?? { status: "missing", value: null, candidates: [], invalid_sources: [] };
    const status = field.status;
    let failed = rule.kind === "required" ? status === "missing" : status === "invalid" || status === "ambiguous";
    let code = status;

    if (rule.kind === "range") {
      failed = status !== "ok";
      if (!failed) {
        const raw = field.value;
        const numStr = typeof raw === "object" && raw !== null ? raw.decimal : String(raw ?? "");
        const num = parseFiniteNumber(numStr);
        const low = parseFiniteNumber(rule.minimum);
        const high = parseFiniteNumber(rule.maximum);
        if (num === null) {
          failed = true;
          code = "invalid";
        } else {
          failed = (low !== null && num < low) || (high !== null && num > high);
          code = "OUT_OF_RANGE";
        }
      }
    }

    if (failed && !reasons.some(r => r.field === rule.field && r.code === code)) {
      reasons.push({ field: rule.field, code });
    }
  }
  return reasons;
}

function summarizeRows(row: Record<string, DemoFieldResult>) {
  return Object.fromEntries(
    Object.entries(row)
      .slice(0, 50)
      .map(([k, v]) => [k, { status: v.status, value: v.value }]),
  );
}

function summarizeOutput(kind: string, output: unknown) {
  if (output === null || output === undefined) return null;
  if (kind === "input") return output;
  if (kind === "parse") {
    const blocks = output as ParsedBlock[];
    return {
      blocks: blocks.slice(0, 20).map(b => ({ text: b.text.slice(0, 2000), locator: b.location })),
      block_count: blocks.length,
    };
  }
  if (kind === "export") {
    return summarizeRows(output as Record<string, DemoFieldResult>);
  }
  if (kind === "review") {
    const rev = output as { fields: Record<string, DemoFieldResult>; reasons: unknown[] };
    return { ...rev, fields: summarizeRows(rev.fields) };
  }
  if (kind === "branch") {
    const br = output as { pass: RowsData | null; review: RowsData | null; reasons: unknown[] };
    const active = br.review ?? br.pass;
    return {
      route: br.review ? "review" : "pass",
      reasons: br.reasons,
      fields: active ? summarizeRows(mergeBranches(Object.values(active.branches))) : {},
    };
  }
  const rows = output as RowsData;
  return summarizeRows(mergeBranches(Object.values(rows.branches)));
}

export async function executePlanOnDocument(
  plan: PreparedPlan,
  doc: DemoDocumentInput,
  inspect: boolean,
): Promise<{
  fields: Record<string, DemoFieldResult>;
  review?: { fields: Record<string, DemoFieldResult>; reasons: { field: string; code: string }[] };
  skipped?: boolean;
  dedup_field?: DemoFieldResult;
  inspection?: DemoInspection;
}> {
  const { nodes, order, target } = plan;
  const outputs: Record<string, unknown> = {};
  let inspection: DemoInspection | undefined;
  let reviewOutput: { fields: Record<string, DemoFieldResult>; reasons: { field: string; code: string }[] } | undefined;
  let dedupField: DemoFieldResult | undefined;

  for (const key of order) {
    const node = nodes[key];
    const incoming = node._inputs;
    const upstream: unknown[] = [];
    const details: unknown[] = [];
    const reasons: { field: string; code: string }[] = [];

    for (const [parent, handle, targetHandle] of incoming) {
      let value = outputs[parent];
      if (handle && value !== null && value !== undefined) {
        const parentBranch = value as { pass: RowsData | null; review: RowsData | null; reasons: { field: string; code: string }[] };
        if (handle === "review") reasons.push(...parentBranch.reasons);
        value = handle === "review" ? parentBranch.review : parentBranch.pass;
      }
      if (inspect && key === target) {
        const kind = outputType(nodes[parent], handle);
        details.push({
          node: parent,
          port: handle,
          input: targetHandle,
          type: kind,
          data: summarizeOutput(kind === "text" ? "parse" : nodes[parent].type, value),
        });
      }
      if (value !== null && value !== undefined) {
        upstream.push(value);
      }
    }

    if (inspect && key === target) {
      inspection = { node: key, type: node.type, inputs: details, output: null };
    }
    if (incoming.length && !upstream.length) {
      outputs[key] = null;
      continue;
    }

    switch (node.type) {
      case "input":
        outputs[key] = { format: doc.format };
        break;
      case "parse": {
        const parsed = await parseDocumentBytes(doc.bytes, doc.format);
        outputs[key] = parsed.blocks;
        break;
      }
      case "extract":
        outputs[key] = { branches: { [key]: extractFromBlocks(upstream[0] as ParsedBlock[], node.fields ?? []) } } satisfies RowsData;
        break;
      case "validate":
      case "combine": {
        const merged: Record<string, BranchFields> = {};
        for (const item of upstream as RowsData[]) {
          for (const [bKey, bVal] of Object.entries(item.branches)) {
            merged[bKey] = bVal;
          }
        }
        outputs[key] = { branches: merged } satisfies RowsData;
        break;
      }
      case "personal": {
        const def = node.personal_definition!;
        const collected = collectCandidates(Object.values((upstream[0] as RowsData).branches));
        const inputList = collected[def.input_field] ?? [];
        collected[def.output_field] = inputList.map(([val, frag]) => [
          typeof val === "string" ? evaluatePersonalExpression(def.expression, val) : null,
          frag,
        ]);
        outputs[key] = { branches: { [key]: collected } } satisfies RowsData;
        break;
      }
      case "branch": {
        const rows = upstream[0] as RowsData;
        const brReasons = evaluateReviewReasons(mergeBranches(Object.values(rows.branches)), node.rules ?? []);
        outputs[key] = {
          pass: brReasons.length ? null : rows,
          review: brReasons.length ? rows : null,
          reasons: brReasons,
        };
        break;
      }
      case "review": {
        const allBranches = (upstream as RowsData[]).flatMap(r => Object.values(r.branches));
        const mergedFields = mergeBranches(allBranches);
        reviewOutput = { fields: mergedFields, reasons };
        outputs[key] = reviewOutput;
        break;
      }
      case "export": {
        const rows = upstream[0] as RowsData;
        const merged = mergeBranches(Object.values(rows.branches));
        const exported: Record<string, DemoFieldResult> = {};
        for (const fid of node.field_order ?? []) {
          exported[fid] = merged[fid] ?? { status: "missing", value: null, candidates: [], invalid_sources: [] };
        }
        if (node.deduplicate_by) {
          dedupField = merged[node.deduplicate_by];
        }
        outputs[key] = exported;
        break;
      }
      case "script":
      case "assemble":
      case "table":
        throw new DemoExecutionError(
          "SCRIPT_DEMO_UNSUPPORTED",
          key,
          "Выполнение Starlark-узлов доступно в локальной версии Docker.",
        );
    }
  }

  const targetNode = nodes[target];
  const rawOutput = outputs[target];
  if (inspection) {
    inspection.output = summarizeOutput(targetNode.type, rawOutput);
  }

  if (rawOutput === null || rawOutput === undefined) {
    return { fields: {}, review: reviewOutput, skipped: true, inspection };
  }

  let fields: Record<string, DemoFieldResult> = {};
  if (targetNode.type === "export") {
    fields = rawOutput as Record<string, DemoFieldResult>;
  } else if (["validate", "personal", "combine", "extract"].includes(targetNode.type)) {
    fields = mergeBranches(Object.values((rawOutput as RowsData).branches));
  } else if (targetNode.type === "branch") {
    const br = rawOutput as { pass: RowsData | null; review: RowsData | null };
    const active = br.review ?? br.pass;
    if (active) fields = mergeBranches(Object.values(active.branches));
  } else if (targetNode.type === "review") {
    fields = (rawOutput as { fields: Record<string, DemoFieldResult> }).fields;
  }

  return {
    fields,
    review: reviewOutput,
    dedup_field: dedupField,
    inspection,
  };
}

export async function runGraphOnDocuments(options: {
  runId: string;
  graph: Graph;
  documents: DemoDocumentInput[];
  target?: string | null;
  schemaVersion?: string | null;
  schemaRevision?: number | null;
}): Promise<DemoReport> {
  const plan = prepareGraph(options.graph, options.target);
  const outputNode = plan.nodes[plan.target];
  const fieldOrder = outputNode.field_order ?? [];
  const fieldNames: Record<string, string> = {};
  for (const key of plan.order) {
    for (const field of plan.nodes[key].fields ?? []) {
      if (field.name && (!fieldOrder.length || fieldOrder.includes(field.id))) {
        if (!fieldNames[field.id]) fieldNames[field.id] = field.name;
      }
    }
  }

  const duplicateKey = !options.target ? outputNode.deduplicate_by : undefined;
  const rows: DemoResultRow[] = [];
  const review: DemoReviewRow[] = [];
  const errors: DemoReport["errors"] = [];
  const seen = new Map<string, number>();
  let inspection: DemoInspection | null = null;

  for (let i = 0; i < options.documents.length; i++) {
    const doc = options.documents[i];
    const position = i + 1;
    try {
      const outcome = await executePlanOnDocument(plan, doc, Boolean(options.target));
      if (outcome.inspection) inspection = outcome.inspection;
      if (outcome.review) {
        review.push({
          position,
          document_id: doc.id,
          filename: doc.name,
          fields: outcome.review.fields,
          reasons: outcome.review.reasons,
        });
      }
      if (!outcome.skipped) {
        const candidate = outcome.dedup_field;
        const token =
          duplicateKey && candidate && candidate.status === "ok"
            ? JSON.stringify(candidate.value)
            : null;
        if (token !== null && seen.has(token)) {
          review.push({
            position,
            document_id: doc.id,
            filename: doc.name,
            fields: { ...outcome.fields, [duplicateKey!]: candidate! },
            reasons: [{ field: duplicateKey!, code: "DUPLICATE", first_position: seen.get(token)! }],
          });
        } else {
          if (token !== null) seen.set(token, position);
          rows.push({
            position,
            document_id: doc.id,
            filename: doc.name,
            fields: outcome.fields,
          });
        }
      }
    } catch (error) {
      if (error instanceof DemoParseError) {
        errors.push({ position, filename: doc.name, error: { code: error.code } });
      } else if (error instanceof DemoExecutionError) {
        errors.push({
          position,
          filename: doc.name,
          error: { code: error.code, node: error.node, message: error.detailMessage },
        });
      } else {
        errors.push({
          position,
          filename: doc.name,
          error: { code: "CORRUPT_FILE", message: error instanceof Error ? error.message : undefined },
        });
      }
    }
  }

  const state =
    errors.length === 0
      ? "succeeded"
      : rows.length > 0 || review.length > 0
        ? "partial"
        : "failed";

  return {
    id: options.runId,
    state,
    created_at: new Date().toISOString(),
    field_order: fieldOrder,
    field_names: fieldNames,
    table_columns: [],
    rows,
    review,
    inspection,
    target: options.target ?? null,
    schema_version: options.schemaVersion ?? null,
    schema_revision: options.schemaRevision ?? null,
    graph_format: options.graph.format_version,
    errors,
    total: options.documents.length,
  };
}

function csvSafeText(value: unknown): string {
  const text = String(value ?? "");
  const normal = text.normalize("NFKC");
  if (/^[\t\r\n]/.test(normal) || /^[=+\-@]/.test(normal.trimStart())) {
    return "'" + text;
  }
  return text;
}

function csvCell(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function csvFieldPair(field?: DemoFieldResult): [string, string] {
  if (!field || field.status !== "ok") return ["", ""];
  const value = field.value;
  if (typeof value === "object" && value !== null) {
    const amount = value.decimal;
    const safeAmount = /^-?[0-9]+\.[0-9]+$/.test(amount) ? amount : csvSafeText(amount);
    return [safeAmount, csvSafeText(value.currency ?? "")];
  }
  return [csvSafeText(value ?? ""), ""];
}

export function renderDemoCsv(report: DemoReport): Blob {
  const fields = report.field_order.length
    ? report.field_order
    : Object.keys(report.rows[0]?.fields ?? {});
  const header = [
    "position",
    "filename",
    ...fields.flatMap(f => [csvSafeText(`${f}.value`), csvSafeText(`${f}.currency`), csvSafeText(`${f}.status`)]),
  ];
  const lines = [header.map(csvCell).join(",")];
  for (const row of report.rows) {
    const cells: (string | number)[] = [row.position, csvSafeText(row.filename)];
    for (const fid of fields) {
      const field = row.fields[fid] ?? { status: "missing", value: null, candidates: [], invalid_sources: [] };
      const [val, cur] = csvFieldPair(field);
      cells.push(val, cur, field.status);
    }
    lines.push(cells.map(csvCell).join(","));
  }
  return new Blob(["\uFEFF" + lines.join("\r\n") + "\r\n"], { type: "text/csv;charset=utf-8" });
}

export function renderDemoJson(report: DemoReport): Blob {
  const { review: _r, inspection: _i, ...exported } = report;
  return new Blob([JSON.stringify(exported, null, 2)], { type: "application/json;charset=utf-8" });
}

function xmlEscape(value: string): string {
  return value
    .replace(/[^\t\n\r\x20-\uFFFF]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function colLetter(index: number): string {
  let n = index;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function displayField(field?: DemoFieldResult): string {
  if (!field || field.status !== "ok" || field.value === null || field.value === undefined) return "";
  if (typeof field.value === "object") {
    return `${field.value.decimal} ${field.value.currency ?? ""}`.trim();
  }
  return String(field.value);
}

const XLSX_STYLES_XML =
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<x:styleSheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<x:numFmts count="1"><x:numFmt numFmtId="200" formatCode="@" /></x:numFmts>' +
  '<x:fonts count="3">' +
  '<x:font><x:sz val="11" /><x:name val="Arial" /></x:font>' +
  '<x:font><x:sz val="11" /><x:color rgb="FF152A39" /><x:name val="Arial" /></x:font>' +
  '<x:font><x:b /><x:sz val="11" /><x:color rgb="FFFFFFFF" /><x:name val="Arial" /></x:font>' +
  "</x:fonts>" +
  '<x:fills count="4">' +
  '<x:fill><x:patternFill patternType="none" /></x:fill>' +
  '<x:fill><x:patternFill patternType="gray125" /></x:fill>' +
  '<x:fill><x:patternFill patternType="solid"><x:fgColor rgb="FF1C5468" /></x:patternFill></x:fill>' +
  '<x:fill><x:patternFill patternType="solid"><x:fgColor rgb="FFF0F6F8" /></x:patternFill></x:fill>' +
  "</x:fills>" +
  '<x:borders count="1"><x:border><x:left /><x:right /><x:top /><x:bottom /><x:diagonal /></x:border></x:borders>' +
  '<x:cellStyleXfs count="1"><x:xf numFmtId="0" fontId="0" fillId="0" borderId="0" /></x:cellStyleXfs>' +
  '<x:cellXfs count="4">' +
  '<x:xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" />' +
  '<x:xf numFmtId="200" fontId="2" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyAlignment="1"><x:alignment horizontal="center" vertical="center" wrapText="1" /></x:xf>' +
  '<x:xf numFmtId="200" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyAlignment="1"><x:alignment vertical="center" wrapText="1" /></x:xf>' +
  '<x:xf numFmtId="200" fontId="1" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyAlignment="1"><x:alignment vertical="center" wrapText="1" /></x:xf>' +
  "</x:cellXfs></x:styleSheet>";

export function renderDemoXlsx(report: DemoReport): Blob {
  const fields = report.field_order.length
    ? report.field_order
    : Object.keys(report.rows[0]?.fields ?? {});
  const headers = ["Позиция", "Документ", ...fields.map(id => report.field_names[id] ?? id)];
  const widths = headers.map(h => Math.max(12, h.length + 4));

  const dataRows = report.rows.length
    ? report.rows.map(row => [
        String(row.position),
        row.filename,
        ...fields.map(id => displayField(row.fields[id])),
      ])
    : [headers.map(() => "")];

  const rowsXml: string[] = [];
  const headerCells = headers
    .map((h, i) => `<x:c r="${colLetter(i + 1)}1" s="1" t="str"><x:v>${xmlEscape(csvSafeText(h))}</x:v></x:c>`)
    .join("");
  rowsXml.push(`<x:row r="1" ht="24" customHeight="1">${headerCells}</x:row>`);

  dataRows.forEach((vals, rowIdx) => {
    const rowNum = rowIdx + 2;
    const style = rowIdx % 2 ? 3 : 2;
    const cells = vals
      .map((val, colIdx) => {
        widths[colIdx] = Math.min(64, Math.max(widths[colIdx], val.length + 4));
        const ref = `${colLetter(colIdx + 1)}${rowNum}`;
        if (colIdx === 0 && /^\d+$/.test(val)) {
          return `<x:c r="${ref}" s="${style}" t="n"><x:v>${val}</x:v></x:c>`;
        }
        return `<x:c r="${ref}" s="${style}" t="str"><x:v>${xmlEscape(csvSafeText(val))}</x:v></x:c>`;
      })
      .join("");
    rowsXml.push(`<x:row r="${rowNum}" ht="20" customHeight="1">${cells}</x:row>`);
  });

  const lastRef = `A1:${colLetter(headers.length)}${dataRows.length + 1}`;
  const colsXml = widths
    .map((w, i) => `<x:col min="${i + 1}" max="${i + 1}" width="${w.toFixed(2)}" customWidth="1" />`)
    .join("");
  const sheetXml =
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<x:sheetViews><x:sheetView workbookViewId="0"><x:pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen" /></x:sheetView></x:sheetViews>' +
    `<x:sheetFormatPr defaultRowHeight="18" /><x:cols>${colsXml}</x:cols>` +
    `<x:sheetData>${rowsXml.join("")}</x:sheetData>` +
    '<x:tableParts count="1"><x:tablePart r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" /></x:tableParts>' +
    "</x:worksheet>";

  const uniqueNames = new Map<string, number>();
  const tableCols = headers
    .map((raw, i) => {
      const base = raw.trim() || "Столбец";
      const count = (uniqueNames.get(base) ?? 0) + 1;
      uniqueNames.set(base, count);
      const title = count === 1 ? base : `${base} (${count})`;
      return `<x:tableColumn id="${i + 1}" name="${xmlEscape(title)}" />`;
    })
    .join("");
  const tableXml =
    '<?xml version="1.0" encoding="utf-8"?>' +
    `<x:table id="1" name="ResultsTable" displayName="ResultsTable" ref="${lastRef}" headerRowCount="1" totalsRowCount="0" totalsRowShown="0" xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<x:autoFilter ref="${lastRef}" /><x:tableColumns count="${headers.length}">${tableCols}</x:tableColumns>` +
    '<x:tableStyleInfo name="TableStyleMedium2" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0" /></x:table>';

  const archive = zipSync({
    "[Content_Types].xml": strToU8(
      '<?xml version="1.0" encoding="utf-8"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />' +
        '<Default Extension="xml" ContentType="application/xml" />' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml" />' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml" />' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml" />' +
        '<Override PartName="/xl/tables/table1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml" />' +
        "</Types>",
    ),
    "_rels/.rels": strToU8(
      '<?xml version="1.0" encoding="utf-8"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml" />' +
        "</Relationships>",
    ),
    "xl/workbook.xml": strToU8(
      '<?xml version="1.0" encoding="utf-8"?>' +
        '<x:workbook xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<x:sheets><x:sheet name="Результаты" sheetId="1" r:id="rId2" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" /></x:sheets>' +
        "</x:workbook>",
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      '<?xml version="1.0" encoding="utf-8"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml" />' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml" />' +
        "</Relationships>",
    ),
    "xl/styles.xml": strToU8(XLSX_STYLES_XML),
    "xl/worksheets/sheet1.xml": strToU8(sheetXml),
    "xl/worksheets/_rels/sheet1.xml.rels": strToU8(
      '<?xml version="1.0" encoding="utf-8"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/table1.xml" />' +
        "</Relationships>",
    ),
    "xl/tables/table1.xml": strToU8(tableXml),
  });

  const buffer = new ArrayBuffer(archive.byteLength);
  new Uint8Array(buffer).set(archive);
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
