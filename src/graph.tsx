import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  CaretDown, Code, Copy, CornersOut, Database, FileArrowDown, FileDoc, FileText,
  GitBranch, GitMerge, ListChecks, MapTrifold, Minus,  Plus, ShieldCheck,
  Table as TableIcon,  WarningCircle,
} from "@phosphor-icons/react";
import {
  Handle, MiniMap, NodeToolbar, Panel, Position, useNodesState, useReactFlow, useStore,
  useUpdateNodeInternals, type NodeProps,
} from "@xyflow/react";
import { Card } from "./components/ui/card";
import { Collapsible, CollapsibleContent } from "./components/ui/collapsible";
import { ActionButton } from "./control-help";

const narrowGraph = window.matchMedia("(max-width: 860px)");
function watchWidth(listener: () => void) {
  narrowGraph.addEventListener("change", listener);
  return () => narrowGraph.removeEventListener("change", listener);
}

export function useVerticalGraph() {
  return useSyncExternalStore(watchWidth, () => narrowGraph.matches);
}

export const steps = [
  { id: "input", type: "input", label: "Документы", detail: "PDF и DOCX", Icon: FileDoc, substeps: ["Приём файлов", "Проверка формата", "Сохранение оригиналов"] },
  { id: "parse", type: "parse", label: "Разбор", detail: "Текст и координаты", Icon: FileText, substeps: ["Чтение PDF или DOCX", "Выделение блоков", "Привязка к источнику"] },
  { id: "extract", type: "extract", label: "Извлечение", detail: "Реквизиты договора", Icon: Database, substeps: ["Поиск подписей полей", "Сбор значений", "Приведение к формату"] },
  { id: "validate", type: "validate", label: "Проверка", detail: "Типы и пропуски", Icon: ShieldCheck, substeps: ["Проверка формата", "Поиск пропусков", "Отметка спорных значений"] },
  { id: "export", type: "export", label: "Экспорт", detail: "CSV, JSON и XLSX", Icon: FileArrowDown, substeps: ["Сбор строк", "Подготовка CSV", "Подготовка JSON и XLSX"] },
] as const;
export const builtInSteps = [...steps,
  { id: "branch", type: "branch", label: "Ветвление", detail: "Правила для строк", Icon: GitBranch, substeps: ["Проверка полей", "Выбор выхода"] },
  { id: "review", type: "review", label: "Ручная проверка", detail: "Причины и цитаты", Icon: ListChecks, substeps: ["Сбор проблемных строк"] },
  { id: "combine", type: "combine", label: "Объединение", detail: "Общие столбцы", Icon: GitMerge, substeps: ["Сопоставление схем", "Сбор строк"] },
  { id: "assemble", type: "assemble", label: "Сборка записи", detail: "Поля в одну строку", Icon: Database, substeps: ["Сбор отдельных полей"] },
  { id: "table", type: "table", label: "Таблица", detail: "Метаданные и строки", Icon: TableIcon, substeps: ["Приём таблицы", "Привязка метаданных", "Подготовка столбцов"] },
] as const;
export const nodeKinds = [...builtInSteps, { id: "personal", type: "personal", label: "Личный узел", detail: "Преобразование строки", Icon: Code,
  substeps: ["Чтение поля", "Вычисление выражения", "Запись результата"] },
  { id: "script", type: "script", label: "Starlark", detail: "Программируемый узел", Icon: Code, substeps: ["Проверка портов", "Изолированный вызов"] }] as const;
export type NodeKind = typeof nodeKinds[number]["type"];
export type PortType = "document" | "text" | "rows" | "region" | "record" | "scalar" | "table";
export type BranchPort = "pass" | "review";
export type CatalogItem = {
  type: NodeKind;
  input: PortType | null;
  output: PortType | null;
  multiple_inputs: boolean;
  outputs?: BranchPort[];
  inputs?: Record<string, PortType>;
  optional_inputs?: string[];
};
export const portLabels: Record<PortType, string> = {
  document: "Документы", text: "Текст и блоки", rows: "Строки таблицы",
  region: "Область", record: "Поля записи", scalar: "Строка", table: "Таблица",
};
export const portShortCodes: Record<PortType, string> = {
  document: "DOC", text: "TXT", rows: "ROW", region: "REG", record: "REC", scalar: "STR", table: "TBL",
};
export const branchLabels: Record<BranchPort, string> = { pass: "Годные", review: "На проверку" };

export type NodeQuickActions = {
  onDuplicate?: (id: string) => void;
  canDuplicate?: boolean;
};

export const initialNodes = (vertical: boolean, rowHeight = 80) => steps.map((step, index) => ({
  id: step.id, type: "step", position: vertical ? { x: 0, y: index * rowHeight } : { x: index * 204, y: 0 },
  data: { index, vertical, active: false, expanded: false },
}));

export function usePipelineNodes(vertical: boolean) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes(vertical));
  useEffect(() => {
    setNodes(current => current[0]?.data.vertical === vertical ? current : initialNodes(vertical));
  }, [vertical, setNodes]);
  function setExpanded(id?: string) {
    setNodes(current => {
      let offset = 0;
      return current.map(node => {
        const expanded = id === undefined ? false : node.id === id ? !node.data.expanded : node.data.expanded;
        const y = node.position.y + (vertical ? offset : 0);
        offset += 96 * (Number(expanded) - Number(node.data.expanded));
        return { ...node, position: { ...node.position, y }, data: { ...node.data, expanded } };
      });
    });
  }
  return [nodes, onNodesChange, setExpanded] as const;
}
export const allowed = steps.slice(1).map((step, index) => [steps[index].id, step.id]);
export const initialEdges = allowed.filter(([source]) => source !== "extract").map(([source, target]) => ({
  id: source + "-" + target, source, target,
}));

function PortRow({ direction, kind, name, handleId, branch, handle = true }: {
  direction: "target" | "source"; kind: PortType; name?: string; handleId?: string; branch?: BranchPort; handle?: boolean;
}) {
  const input = direction === "target";
  return <div className="step-port-row" data-direction={direction}>
    <dt>
      <span>{input ? "Вход" : "Выход"}</span>
      {name && <span className="step-port-name">{name}</span>}
    </dt>
    <dd className="step-port-type" data-port={kind}>
      <span>{portLabels[kind]}</span>
      {handle && <Handle type={direction} id={branch ?? handleId ?? name} position={input ? Position.Left : Position.Right}
        data-port={kind} data-branch={branch} />}
    </dd>
  </div>;
}

function StepNode({ id, data, selected }: NodeProps) {
  const step = nodeKinds[Number(data.index)] ?? nodeKinds[0];
  const Icon = step.Icon;
  const update = useUpdateNodeInternals();
  const expanded = Boolean(data.expanded);
  const ports = data.ports as CatalogItem | undefined;
  const named = data.named as { inputs: Record<string, PortType>; outputs: Record<string, { type: PortType }> } | undefined;
  const branchOutputs = step.type === "branch" ? ports?.outputs ?? (["pass", "review"] as const) : undefined;
  const toggle = data.toggle as (id: string) => void;
  const actions = data.actions as NodeQuickActions | undefined;
  const summary = typeof data.summary === "string" ? data.summary : "";
  const isSelected = Boolean(selected || data.active);
  const missingInput = Boolean(data.missingInput);
  const nodeError = typeof data.nodeError === "string" ? data.nodeError : "";

  useEffect(() => update(id), [id, data.vertical, expanded, named, ports, summary, nodeError, update]);

  return (
    <Collapsible open={expanded}>
      {actions && (
        <NodeToolbar isVisible={isSelected} position={Position.Top} align="center" offset={8} className="node-quick-toolbar nodrag nopan">
          <div className="node-quick-bar" role="toolbar" aria-label={`Действия узла «${String(data.title ?? step.label)}»`}>
            {actions.onDuplicate && (
              <ActionButton type="button" size="icon-xs" variant="ghost" disabled={!actions.canDuplicate}
                aria-label="Дублировать узел" hint="Дублировать узел"
                onClick={event => { event.stopPropagation(); actions.onDuplicate?.(id); }}>
                <Copy />
              </ActionButton>
            )}
          </div>
        </NodeToolbar>
      )}
      <Card size="sm" className={isSelected ? "step-node selected" : "step-node"} data-kind={step.type} data-missing-input={missingInput} data-error={Boolean(nodeError)}>
        {step.id !== "input" && step.id !== "script" && step.id !== "table" && (!ports || Boolean(data.vertical)) &&
          <Handle type="target" data-port={ports?.input} position={data.vertical ? Position.Top : Position.Left} />}
        <div className="step-icon"><Icon size={15} /></div>
        <div className="step-copy">
          <strong>{String(data.title ?? step.label)}{data.instance ? ` · ${data.instance}` : ""}</strong>
          <span>{summary || step.detail}</span>
        </div>
        <ActionButton type="button" size="icon-xs" variant="ghost" className="nodrag nopan step-toggle" aria-expanded={expanded}
          aria-label={`${expanded ? "Свернуть" : "Развернуть"} этап «${step.label}»`}
          onClick={event => { event.stopPropagation(); toggle(id); }} onDoubleClick={event => event.stopPropagation()}><CaretDown /></ActionButton>
        {(ports || named || branchOutputs) && <dl className="step-ports">
          {ports?.input && <PortRow direction="target" kind={ports.input} handle={!data.vertical} />}
          {ports?.inputs && Object.entries(ports.inputs).map(([port, kind]) =>
            <PortRow key={`in:${port}`} direction="target" kind={kind} handleId={port}
              name={ports.optional_inputs?.includes(port) ? `${port} (опц.)` : port} />)}
          {named && Object.entries(named.inputs).map(([port, kind]) =>
            <PortRow key={`in:${port}`} direction="target" kind={kind} handleId={port} name={port} />)}
          {branchOutputs ? branchOutputs.map(port =>
            <PortRow key={port} direction="source" kind={ports?.output ?? "rows"} name={branchLabels[port]} branch={port} />)
            : ports?.output && <PortRow direction="source" kind={ports.output} handle={!data.vertical} />}
          {named && Object.entries(named.outputs).map(([port, spec]) =>
            <PortRow key={`out:${port}`} direction="source" kind={spec.type} handleId={port} name={port} />)}
        </dl>}
        {step.id !== "branch" && step.id !== "export" && step.id !== "review" && step.id !== "script" && (!ports || Boolean(data.vertical)) &&
          <Handle type="source" data-port={ports?.output} position={data.vertical ? Position.Bottom : Position.Right} />}
        {nodeError && <span className="step-issue step-issue-error"><WarningCircle size={12} weight="fill" aria-hidden="true" /> {nodeError}</span>}
        {missingInput && nodeError !== "Подключите вход" && <span className="step-issue"><WarningCircle size={12} weight="fill" aria-hidden="true" /> Подключите вход</span>}
        <CollapsibleContent className="step-substeps"><ol>{step.substeps.map(item => <li key={item}>{item}</li>)}</ol></CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
export const nodeTypes = { step: StepNode };

export function GraphControls({
  collapseAll,
  expanded,
  fitOnResize = false,
  showZoomMeta = false,
  minimapOpen: controlledMap,
  onToggleMinimap,
  addNode,
}: {
  collapseAll: () => void;
  expanded: boolean;
  fitOnResize?: boolean;
  showZoomMeta?: boolean;
  minimapOpen?: boolean;
  onToggleMinimap?: () => void;
  addNode?: () => void;
}) {
  const flow = useReactFlow();
  const zoom = useStore(state => Math.round(state.transform[2] * 100));
  const [internalMap, setInternalMap] = useState(false);
  const mapOpen = controlledMap ?? internalMap;
  const toggleMap = onToggleMinimap ?? (() => setInternalMap(open => !open));
  const width = useStore(state => fitOnResize ? state.width : 0);
  const previous = useRef(width);
  useEffect(() => {
    const oldWidth = previous.current;
    previous.current = width;
    if (oldWidth > 0 && width > 0 && width !== oldWidth) void flow.fitView({ maxZoom: 1, padding: 0.08 });
  }, [flow, width]);

  function duration() { return matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 180; }

  return <>
    {mapOpen && (
      <MiniMap
        className="workspace-map"
        position="bottom-right"
        pannable
        zoomable
        nodeColor="var(--indigo-outline)"
        maskColor="color-mix(in oklch, var(--background) 65%, transparent)"
      />
    )}
    <Panel position="bottom-left" className="graph-controls" aria-label="Масштаб схемы">
      <ActionButton size="icon-sm" variant="outline" aria-label="Приблизить" onClick={() => void flow.zoomIn({ duration: duration() })}><Plus /></ActionButton>
      {showZoomMeta && <span className="graph-zoom" aria-label="Текущий масштаб">{zoom}%</span>}
      <ActionButton size="icon-sm" variant="outline" aria-label="Отдалить" onClick={() => void flow.zoomOut({ duration: duration() })}><Minus /></ActionButton>
      <ActionButton size="icon-sm" variant="outline" aria-label="Показать схему целиком" onClick={() => void flow.fitView({ duration: duration(), padding: 0.08, maxZoom: 1 })}><CornersOut /></ActionButton>
      {showZoomMeta && (
        <ActionButton size="icon-sm" variant={mapOpen ? "secondary" : "outline"} aria-label="Мини-карта" aria-pressed={mapOpen} onClick={toggleMap}>
          <MapTrifold />
        </ActionButton>
      )}
      {addNode && <ActionButton variant="outline" size="sm" onClick={addNode}>Добавить узел</ActionButton>}
      <ActionButton variant="outline" size="sm" disabled={!expanded} onClick={collapseAll}>Свернуть все этапы</ActionButton>
    </Panel>
  </>;
}
