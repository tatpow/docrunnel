import { useState } from "react";
import { getOutgoers, useEdgesState, useNodesState, type Edge, type Node, type XYPosition } from "@xyflow/react";
import { allowed, initialNodes, nodeKinds, portLabels, steps, type CatalogItem, type NodeKind, type PortType } from "./graph";

export const fields = [
  { id: "number", type: "number", name: "Номер договора", labels: ["Номер договора", "Договор", "Номер приложения"] },
  { id: "date", type: "date", name: "Дата", labels: ["Дата договора", "Дата подписания"] },
  { id: "amount", type: "money", name: "Сумма", labels: ["Сумма договора", "Итого по договору", "Сумма"] },
  { id: "inn", type: "inn", name: "ИНН", labels: ["ИНН поставщика", "ИНН"] },
] as const;

export type ExtractionField = { id: string; name?: string; type: typeof fields[number]["type"] | "text"; labels: string[];
  currency?: "RUB" | null; source_mode?: "any" | "inline" | "table"; cleanup?: "collapse" | "trim" | "lower" | "upper";
  labelDraft?: string };
export type PersonalDefinition = { name: string; input_field: string; output_field: string; expression: string };
export type PersonalNode = { node_id: string; version_id: string; version: number; definition: PersonalDefinition };
export type TableColumn = { key: string; name: string; type: string };
export type ScriptDefinition = { name: string; description: string; category: string;
  inputs: Record<string, PortType>; outputs: Record<string, { type: PortType; fields?: Record<string, string>; columns?: TableColumn[] }>;
  parameters: Record<string, string>; code: string };
export type ScriptNode = { node_id: string; version_id: string; version: number; definition: ScriptDefinition };
export type InsertLink = { nodeId: string; fromOutput: boolean; handle?: string | null; port?: string };
export type BranchRule = { field: string; kind: "required" | "format" | "range" | "table_required" | "table_complete"; minimum?: string; maximum?: string };
export type SchemaNode = { id: string; type: NodeKind; position?: XYPosition; fields?: ExtractionField[]; field_order?: string[]; columns?: string[];
  table_columns?: string[]; personal_version?: string; personal_definition?: PersonalDefinition; rules?: BranchRule[]; deduplicate_by?: string;
  script_version?: string; script_definition?: ScriptDefinition; script_params?: Record<string, string> };
export type Graph = { format_version: number; nodes: SchemaNode[]; edges: ([string, string] | [string, string, string] | [string, string, string | null, string])[] };
export type EditorNode = Node<{ index: number; expanded: boolean; schema: SchemaNode }, "step">;

export type GraphDiagnostic = {
  level: "error" | "warning" | "ok";
  nodeId?: string;
  text: string;
};

export function contractFields(): ExtractionField[] {
  return fields.map(({ id, type, labels }) => ({ id, type, labels: [...labels] }));
}

function defaults(id: string, type: NodeKind, template = false): SchemaNode {
  return { id, type, ...(type === "extract" ? { fields: template ? contractFields() : [] } : {}),
    ...(template && type === "export" ? { field_order: fields.map(field => field.id) } : {}) };
}

export function createEditorNode(schema: SchemaNode, position: XYPosition): EditorNode {
  return { id: schema.id, type: "step", position: schema.position ?? position,
    data: { index: Math.max(0, nodeKinds.findIndex(step => step.type === schema.type)), expanded: false, schema } };
}

export const createEdge = (source: string, target: string, handle?: string | null, targetHandle?: string | null): Edge => ({
  id: [source, target, ...(targetHandle ? [handle ?? "", targetHandle] : handle ? [handle] : [])].join(":"),
  source, target, sourceHandle: handle, targetHandle,
});

export function serializeGraph(graphNodes: EditorNode[], graphEdges: Edge[]): Graph {
  return {
    format_version: 2,
    edges: graphEdges.map(link => link.targetHandle
      ? [link.source, link.target, link.sourceHandle ?? null, link.targetHandle]
      : link.sourceHandle ? [link.source, link.target, link.sourceHandle] : [link.source, link.target]),
    nodes: graphNodes.map(node => {
      const { schema } = node.data;
      return {
        ...schema,
        position: node.position,
        fields: schema.fields?.map(({ labelDraft, ...field }) => ({
          ...field,
          name: field.name?.trim() || undefined,
          labels: labelDraft === undefined
            ? field.labels
            : labelDraft.split(",").map(label => label.trim()).filter(Boolean),
        })),
      };
    }),
  };
}

export function useLiveGraph(vertical: boolean, catalog: CatalogItem[]) {
  const [nodes, setNodes, onNodesChange] = useNodesState<EditorNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [active, setActive] = useState("");
  const selected = nodes.find(node => node.id === active);
  const ports = (kind?: NodeKind) => catalog.find(item => item.type === kind);
  const outputType = (schema?: SchemaNode, handle?: string | null) => schema?.script_definition
    ? schema.script_definition.outputs[handle ?? ""]?.type : ports(schema?.type)?.output;
  const nodeLabel = (node: EditorNode) => node.data.schema.script_definition?.name ?? node.data.schema.personal_definition?.name ?? nodeKinds[node.data.index]?.label ?? node.data.schema.type;
  const title = (node: EditorNode) => node.id.startsWith(`${node.data.schema.type}-`)
    ? `${nodeLabel(node)} · ${node.id.split("-").at(-1)}` : nodeLabel(node);

  function connectionError(source: string, target: string, ignored?: string, handle?: string | null, targetHandle?: string | null, graphNodes = nodes) {
    const links = edges.filter(link => link.id !== ignored);
    const origin = graphNodes.find(node => node.id === source)?.data.schema;
    const destination = graphNodes.find(node => node.id === target)?.data.schema;
    const sourceKind = origin?.type;
    const to = ports(destination?.type);
    const from = outputType(origin, handle);
    const input = destination?.script_definition
      ? destination.script_definition.inputs[targetHandle ?? ""]
      : to?.inputs ? to.inputs[targetHandle ?? ""] : to?.input;
    if (!from || !input) return "Узлы должны иметь выход и вход для этой связи";
    if (from !== input) return `Несовместимые порты. Выход «${portLabels[from]}», вход «${portLabels[input]}»`;
    if (sourceKind === "branch" && !handle) return "Выберите выход ветвления";
    if ((sourceKind === "branch" && handle === "review") !== (destination?.type === "review")) return "Выход «На проверку» соединяется с узлом ручной проверки";
    if (links.some(link => link.id === createEdge(source, target, handle, targetHandle).id)) return "Эта связь уже есть";
    const pending = graphNodes.filter(node => node.id === target);
    const visited = new Set<string>();
    while (pending.length) {
      const node = pending.pop()!;
      if (node.id === source) return "Эта связь создаёт цикл";
      if (!visited.has(node.id)) {
        visited.add(node.id);
        pending.push(...getOutgoers(node, graphNodes, links));
      }
    }
    if (!to?.multiple_inputs && links.some(link => link.target === target && (link.targetHandle ?? "") === (targetHandle ?? ""))) return "Вход уже занят. Перетащите конец существующей связи";
    if (links.length >= 48) return "В схеме может быть до 48 связей";
    return "";
  }

  function connect(source: string, target: string, replaced?: string, handle?: string | null, targetHandle?: string | null) {
    const reason = connectionError(source, target, replaced, handle, targetHandle);
    if (!reason) setEdges(current => replaced
      ? current.map(link => link.id === replaced ? createEdge(source, target, handle, targetHandle) : link)
      : [...current, createEdge(source, target, handle, targetHandle)]);
    return reason;
  }

  function nextId(kind: NodeKind, currentNodes = nodes) {
    let number = 2;
    while (currentNodes.some(node => node.id === `${kind}-${number}`)) number++;
    return `${kind}-${number}`;
  }

  function add(kind: NodeKind, position?: XYPosition, personal?: PersonalNode, script?: ScriptNode, link?: InsertLink) {
    const id = nextId(kind);
    const minimumSpacing = 170;
    const y = Math.max(minimumSpacing, ...nodes.map(node =>
      node.position.y + Math.max(minimumSpacing, (node.measured?.height ?? 0) + 28)));
    const schema = defaults(id, kind);
    if (personal) {
      schema.personal_version = personal.version_id;
      schema.personal_definition = personal.definition;
    }
    if (script) {
      schema.script_version = script.version_id;
      schema.script_definition = script.definition;
    }
    const node = createEditorNode(schema, position ?? { x: 40, y });
    if (link) {
      const [source, target, sourcePort, targetPort] = link.fromOutput
        ? [link.nodeId, id, link.handle, link.port] as const
        : [id, link.nodeId, link.port, link.handle] as const;
      const error = connectionError(source, target, undefined, sourcePort, targetPort, [...nodes, node]);
      if (error) return error;
      setEdges(current => [...current, createEdge(source, target, sourcePort, targetPort)]);
    }
    setNodes(current => [...current, node]);
    setActive(id);
    return "";
  }

  function duplicate(id: string) {
    if (nodes.length >= 24) return "В схеме может быть до 24 узлов";
    const original = nodes.find(node => node.id === id);
    if (!original) return "";
    const copyId = nextId(original.data.schema.type);
    const clonedSchema: SchemaNode = structuredClone({
      ...original.data.schema,
      id: copyId,
      position: { x: original.position.x + 40, y: original.position.y + 44 },
    });
    const node = createEditorNode(clonedSchema, clonedSchema.position!);
    setNodes(current => [...current, node]);
    setActive(copyId);
    return "";
  }

  function remove(id: string) {
    setNodes(current => current.filter(node => node.id !== id));
    setEdges(current => current.filter(link => link.source !== id && link.target !== id));
    setActive(current => current === id ? (nodes.find(node => node.id !== id)?.id ?? "") : current);
  }

  function toggle(id?: string) {
    setNodes(current => current.map(node => id && node.id !== id ? node
      : { ...node, data: { ...node.data, expanded: id ? !node.data.expanded : false } }));
  }

  function updateSchema(id: string, change: Partial<SchemaNode>) {
    setNodes(current => current.map(node => node.id !== id ? node
      : { ...node, data: { ...node.data, schema: { ...node.data.schema, ...change } } }));
  }

  function upstreamColumns(id: string) {
    const visited = new Set<string>();
    const columns = new Map<string, string>();
    function visit(key: string) {
      if (visited.has(key)) return;
      visited.add(key);
      edges.filter(link => link.target === key).forEach(link => visit(link.source));
      const schema = nodes.find(node => node.id === key)?.data.schema;
      if (schema?.type === "extract") {
        for (const field of schema.fields ?? []) {
          if (field.id && !columns.has(field.id)) columns.set(field.id, field.name || fields.find(item => item.id === field.id)?.name || field.id);
        }
      } else if (schema?.personal_definition) {
        const key = schema.personal_definition.output_field;
        if (!columns.has(key)) columns.set(key, key);
      } else if (schema?.script_definition) {
        for (const spec of Object.values(schema.script_definition.outputs)) {
          for (const [field, name] of Object.entries(spec.fields ?? {})) if (!columns.has(field)) columns.set(field, name);
        }
      }
    }
    visit(id);
    const preferred = nodes.find(node => node.id === id)?.data.schema.field_order ?? [];
    const ordered = [...new Set([...preferred.filter(key => columns.has(key)), ...columns.keys()])];
    return ordered.map(key => ({ id: key, name: columns.get(key) ?? key }));
  }

  function upstreamTableColumns(id: string) {
    const visited = new Set<string>();
    const columns = new Map<string, string>();
    function visit(key: string) {
      if (visited.has(key)) return;
      visited.add(key);
      const schema = nodes.find(node => node.id === key)?.data.schema;
      if (schema?.type === "table") {
        const link = edges.find(edge => edge.target === key && edge.targetHandle === "table");
        if (link) {
          const source = nodes.find(node => node.id === link.source)?.data.schema;
          const spec = source?.script_definition?.outputs[link.sourceHandle ?? ""];
          const sourceCols = spec?.columns ?? [];
          const allowedCols = schema.table_columns && key !== id
            ? schema.table_columns.map(colKey => sourceCols.find(item => item.key === colKey)).filter((item): item is TableColumn => Boolean(item))
            : sourceCols;
          for (const col of allowedCols) if (!columns.has(col.key)) columns.set(col.key, col.name);
        }
        return;
      }
      edges.filter(link => link.target === key).forEach(link => visit(link.source));
    }
    visit(id);
    return Array.from(columns, ([colId, name]) => ({ id: colId, name }));
  }

  function diagnostics(): GraphDiagnostic[] {
    if (!nodes.length) {
      return [{ level: "warning", text: "Граф пуст. Добавьте узлы из каталога или выберите готовый шаблон." }];
    }
    const items: GraphDiagnostic[] = [];
    const exports = nodes.filter(n => n.data.schema.type === "export");
    if (exports.length === 0) {
      items.push({ level: "error", text: "Для сохранения готовой схемы добавьте узел «Экспорт»." });
    } else if (exports.length > 1) {
      items.push({ level: "error", text: "В схеме должен быть ровно один узел «Экспорт»." });
    }
    for (const node of nodes) {
      const schema = node.data.schema;
      if (schema.script_definition) {
        for (const port of Object.keys(schema.script_definition.inputs)) {
          if (!edges.some(link => link.target === node.id && link.targetHandle === port)) {
            items.push({ level: "error", nodeId: node.id, text: `Узел «${title(node)}»: подключите вход «${port}».` });
          }
        }
      } else {
        const spec = ports(schema.type);
        if (spec?.inputs) {
          for (const [port, kind] of Object.entries(spec.inputs)) {
            if (spec.optional_inputs?.includes(port)) continue;
            if (!edges.some(link => link.target === node.id && link.targetHandle === port)) {
              items.push({ level: "error", nodeId: node.id, text: `Узел «${title(node)}»: подключите обязательный вход «${port}» (${portLabels[kind]}).` });
            }
          }
        } else if (spec?.input && !edges.some(link => link.target === node.id)) {
          items.push({ level: "error", nodeId: node.id, text: `Узел «${title(node)}»: не подключён обязательный вход «${portLabels[spec.input]}».` });
        }
      }
      if (schema.type === "extract" && !(schema.fields?.length)) {
        items.push({ level: "error", nodeId: node.id, text: `Узел «${title(node)}»: добавьте хотя бы одно поле извлечения.` });
      }
      if (schema.type === "branch" && !(schema.rules?.length)) {
        items.push({ level: "warning", nodeId: node.id, text: `Узел «${title(node)}»: задайте условия маршрутизации.` });
      }
    }
    if (!items.length) {
      items.push({ level: "ok", text: "Базовая структура графа корректна и готова к сохранению." });
    }
    return items;
  }

  function serialize(graphNodes = nodes, graphEdges = edges): Graph {
    return serializeGraph(graphNodes, graphEdges);
  }

  function load(graph: Graph) {
    const layout = initialNodes(vertical, 136);
    const loadedNodes = graph.nodes.map((schema, index) => createEditorNode(schema, layout[index]?.position
      ?? { x: vertical ? 0 : index % 5 * 204, y: vertical ? index * 136 : Math.floor(index / 5) * 165 }));
    const loadedEdges = graph.edges.map(([source, target, port, targetPort]) => createEdge(source, target, port, targetPort));
    setNodes(loadedNodes);
    setEdges(loadedEdges);
    setActive(graph.nodes.find(node => node.type === "input")?.id ?? graph.nodes[0]?.id ?? "");
    return serialize(loadedNodes, loadedEdges);
  }

  function replaceState(nextNodes: EditorNode[], nextEdges: Edge[], nextActive: string) {
    setNodes(nextNodes);
    setEdges(nextEdges);
    setActive(nextActive);
  }

  function startNew(template: boolean) {
    return load({ format_version: 2, nodes: template ? steps.map(step => defaults(step.id, step.type, true)) : [],
      edges: template ? allowed.map(([source, target]) => [source, target]) : [] });
  }

  return {
    nodes, edges, selected, active, setActive, ports, outputType, title, nodeLabel,
    connectionError, connect, add, duplicate, remove, toggle, updateSchema, upstreamColumns, upstreamTableColumns,
    diagnostics, serialize, load, replaceState, startNew, onNodesChange, onEdgesChange,
    removeEdge: (id: string) => setEdges(current => current.filter(link => link.id !== id)),
  };
}
