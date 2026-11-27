import { NodeCatalogPanel } from "./components/workspace/NodeCatalogPanel";
import { DocumentsContextPanel, SchemesContextPanel } from "./components/workspace/LeftContextPanels";
import { GraphToolbar } from "./components/workspace/GraphToolbar";
import { WorkflowTabsBar } from "./components/workspace/WorkflowTabsBar";
import { buildNodeRegistry, filterCompatibleChoices } from "./node-registry";
import { BUILTIN_TEMPLATES } from "./templates";
import { createEmptyTab, type WorkflowTab, type WorkflowVersionRef } from "./workflow-tabs";
import { useWorkspaceUiState } from "./workspace-state";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowSquareOut, CaretLeft, CaretRight, Lock, Trash, X } from "@phosphor-icons/react";
import { Pagination, PaginationContent, PaginationItem, PaginationLink } from "./components/ui/pagination";
import { Background, MarkerType, ReactFlow, type ReactFlowInstance, type XYPosition } from "@xyflow/react";
import { ActionButton, FormField } from "./control-help";
import { Alert } from "./components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "./components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./components/ui/dialog";
import { Card } from "./components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./components/ui/collapsible";

import { NativeSelect, NativeSelectOption } from "./components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { WorkspaceShell, type WorkspaceSection } from "./workspace-shell";
import { GraphControls, branchLabels, builtInSteps, nodeTypes, portLabels, useVerticalGraph, type BranchPort, type CatalogItem, type PortType } from "./graph";
import { contractFields, fields, getExtractionFieldIssues, invalidExtractNodeIds, requiresServer, serializeGraph, useLiveGraph, type InsertLink, type PersonalNode, type ScriptNode, type TableColumn } from "./live-graph";
import { ScriptNodeEditor } from "./script-node-editor";
import { PersonalNodeEditor } from "./personal-node-editor";
import { AIGraphDialog, type LMStatus } from "./ai-graph-dialog";
import { BranchSettings, ColumnSettings, ExtractionSettings } from "./field-settings";
import { ThemeButton } from "./workspace-shell";
import { Input } from "./components/ui/input";
import { Checkbox } from "./components/ui/checkbox";

type Session = { id: string; role: "admin" | "editor" | "employee"; csrf_token: string };
type DocumentRecord = { id: string; name: string; format: string };
type Version = { id: string; version_id: string; version?: number; name: string; published?: boolean; draft?: boolean };
const emptySchemeName = "Новая схема";
const emptyDraft = JSON.stringify({ name: emptySchemeName, graph: { format_version: 2, edges: [], nodes: [] } });
type Fragment = { quote: string; context: string; locator: { page?: number; path?: number[] } };
type Value = string | number | { decimal: string; currency: string | null } | null;
type Field = { value: Value; status: string; candidates: { value?: Value; sources: Fragment[] }[]; invalid_sources: Fragment[] };
type TableRowItem = { row_index: number; status: string; issues: { column: string; code: string }[]; cells: Record<string, Field>; sources: Fragment[]; diagnostics?: string[] };
type TableResult = { columns: TableColumn[]; status: string; rows: TableRowItem[]; sources: Fragment[]; diagnostics?: string[] };
type ResultRow = { position: number; filename: string; document_id: string; fields: Record<string, Field>; table?: TableResult };
type Report = { id: string; state: string; field_order: string[]; field_names?: Record<string, string>; table_columns?: TableColumn[]; rows: ResultRow[];
  review?: (ResultRow & { reasons: { field: string; code: string; first_position?: number }[] })[];
  inspection?: { node: string; type: string; inputs: unknown[]; output: unknown };
  target?: string; schema_version?: string; schema_revision?: number; graph_format?: number;
  errors: { position: number; filename: string; error: { code: string; node?: string; message?: string } }[]; total: number };
type Account = { id: string; role: string; state: string; last_login_at: string | null };
type AuditItem = { actor_id: string; action: string; target_id: string; occurred_at: string };
type Run = { id: string; state: string; owner_id?: string; created_at?: string };
const browserPreview = import.meta.env.MODE === "vercel";

const states: Record<string, string> = { queued: "В очереди", running: "Обрабатывается", succeeded: "Готово", partial: "Частично готово", failed: "Ошибка", interrupted: "Прерван", cancelled: "Отменён", pending: "Ожидает активации", active: "Активна", blocked: "Заблокирована" };
const tableStatusLabels: Record<string, string> = { ok: "Готова", incomplete: "Неполная", missing: "Не найдена", ambiguous: "Неоднозначна", invalid: "Некорректна" };
const reviewLabels: Record<string, string> = {
  missing: "Незаполненное обязательное поле", invalid: "Неверный формат",
  ambiguous: "Несколько значений", OUT_OF_RANGE: "За пределами диапазона", DUPLICATE: "Повтор ключа",
  TABLE_MISSING: "Таблица не найдена", TABLE_INCOMPLETE: "В таблице есть неполные или спорные строки",
  TABLE_AMBIGUOUS: "Найдено несколько конкурирующих таблиц", TABLE_INVALID: "Некорректная структура таблицы",
};
const issues: Record<string, string> = { missing: "Не найдено", invalid: "Неверный формат", ambiguous: "Несколько значений", NO_TEXT_LAYER: "Без текстового слоя", CORRUPT_FILE: "Повреждённый файл", ENCRYPTED: "Файл защищён паролем", PARSE_LIMIT: "Файл превышает лимит объёма разбора", UNSUPPORTED_FORMAT: "Неподдерживаемый формат", FILE_TOO_LARGE: "Файл превышает 20 МБ", DEMO_FILE_LIMIT: "В веб-демо можно загрузить до 3 файлов. Удалите лишний файл, чтобы загрузить новый", SCRIPT_DEMO_UNSUPPORTED: "Выполнение Starlark-узлов доступно в локальной версии Docker", document_in_use: "Документ используется в текущем запуске", account_exists: "Такой логин уже используется", account_link: "Ссылка недействительна или уже использована" };

const nodeErrorLabels: Record<string, string> = {
  server_node: "Требуется Docker",
  fields: "Проверьте поля",
  required_input: "Подключите вход",
  input_count: "Лишняя связь на входе",
  port_type: "Несовместимые порты",
  cycle: "Цикл в схеме",
  edge: "Ошибка связи",
  export_count: "Оставьте один экспорт",
  review_count: "Оставьте одну проверку",
  branch_rules: "Проверьте условия",
  review_required: "Подключите «На проверку»",
  pass_required: "Подключите «Годные»",
  export_columns: "Проверьте столбцы",
  table_columns: "Проверьте столбцы таблицы",
  deduplicate_field: "Проверьте ключ дублей",
  personal_input: "Нет входного поля",
  assemble_fields: "Повтор ключей полей",
  combine_columns: "Несовместимые поля",
  script_parameters: "Неизвестные параметры",
};

class ApiError extends Error {
  constructor(readonly status: number, readonly code?: string, readonly reason?: string, readonly nodes?: string[], readonly detailMessage?: string) {
    super(detailMessage || code);
  }
}

async function api<T>(path: string, options: { body?: unknown; session?: Session; signal?: AbortSignal } = {}): Promise<T> {
  const data = options.body;
  const headers = new Headers();
  if (data !== undefined && !(data instanceof FormData)) headers.set("Content-Type", "application/json");
  if (data !== undefined && options.session) headers.set("X-CSRF-Token", options.session.csrf_token);
  const response = browserPreview
    ? await (await import("./preview-data")).previewRequest(path, data)
    : await fetch(`/api/v1${path}`, { method: data === undefined ? "GET" : "POST", headers,
        body: data instanceof FormData ? data : data === undefined ? undefined : JSON.stringify(data), signal: options.signal });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const detail = payload.detail;
    const errorNodes = Array.isArray(detail?.nodes)
      ? detail.nodes.filter((id: unknown): id is string => typeof id === "string")
      : undefined;
    const fieldValidation = Array.isArray(detail) && detail.some(
      (item: { loc?: unknown }) => Array.isArray(item?.loc) && item.loc.includes("fields"),
    );
    throw new ApiError(
      response.status,
      typeof detail === "string" ? detail : detail?.code ?? (fieldValidation ? "SCHEMA_INVALID" : undefined),
      detail?.reason ?? (fieldValidation ? "fields" : undefined),
      errorNodes,
      typeof detail?.message === "string" ? detail.message : undefined,
    );
  }
  return response.status === 204 ? undefined as T : response.json();
}

function message(error: unknown) {
  if (!(error instanceof ApiError)) return "Сервер недоступен. Повторите попытку";
  if (error.detailMessage) return error.detailMessage;
  if (error.code === "DEMO_SERVER_REQUIRED") return "Эта функция доступна в локальной Docker-версии";
  if (error.code === "rate_limited") return "Слишком много попыток входа. Повторите через несколько минут";
  const reasons: Record<string, string> = {
    port_type: "Соедините порты одного типа", cycle: "В схеме есть цикл", edge: "Проверьте концы связи и удалите повторы",
    required_input: "Подключите обязательные входы узлов", input_count: "На одном из входов допустима только одна связь",
    export_count: "Добавьте ровно один узел экспорта", fields: "Проверьте ключи и подписи полей извлечения",
    empty_graph: "Добавьте узлы в схему",
    assemble_fields: "Сборка записи требует уникальных ключей полей",
    script_parameters: "Настройки узла содержат неизвестные параметры",
    personal_input: "В строках на входе личного узла отсутствует указанное поле",
    export_columns: "В экспорте есть повторяющиеся или отсутствующие на входе столбцы",
    table_columns: "В настройках таблицы есть повторяющиеся или отсутствующие на входе столбцы",
    branch_rules: "Добавьте условия для входящих полей или таблицы и проверьте границы диапазона",
    review_required: "Подключите выход «На проверку» к узлу ручной проверки",
    pass_required: "Подключите выход «Годные» к цепочке обработки",
    review_count: "В схеме может быть один узел ручной проверки",
    combine_columns: "Объединение принимает строки с одинаковыми ключами и типами полей",
    deduplicate_field: "Ключ поиска дублей должен присутствовать на входе экспорта",
  };
  const personalMessages: Record<string, string> = { personal_expression: "Допустимы value и функции trim, lower и upper с одним аргументом",
    personal_publish: "Схема с личным узлом доступна только её владельцу", personal_node: "Личный узел или его версия недоступны",
    workflow_draft: "Сохраните черновик как готовую схему перед пакетным запуском или публикацией" };
  return reasons[error.reason ?? ""] ?? personalMessages[error.code ?? ""] ?? issues[error.code ?? ""] ?? ({ 401: "Проверьте логин и пароль", 403: "Действие недоступно", 413: "Пакет превышает 85 МБ", 422: "Проверьте введённые данные", 429: "В очереди слишком много запусков" }[error.status] || "Не удалось выполнить действие");
}

function formatCellValue(data?: Field) {
  if (!data) return issues.missing;
  if (typeof data.value === "object" && data.value) return `${data.value.decimal} ${data.value.currency ?? ""}`.trim();
  if (data.value !== null && data.value !== undefined) return String(data.value);
  return issues[data.status] ?? data.status;
}

export default function Live() {
  return browserPreview
    ? <Workspace session={{ id: "Демо-редактор", role: "editor", csrf_token: "" }} onEnd={() => {}} />
    : <LiveSession />;
}

function LiveSession() {
  const [session, setSession] = useState<Session>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState(() => {
    const hash = new URLSearchParams(location.hash.slice(1));
    return hash.get("activate") ?? hash.get("reset");
  });

  useEffect(() => {
    if (token) { setLoading(false); return; }
    api<Session>("/session").then(setSession).catch(error => { if (!(error instanceof ApiError) || error.status !== 401) setError(message(error)); }).finally(() => setLoading(false));
  }, [token]);

  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try {
      if (token) {
        await api("/session/password", { body: { token, password: values.get("password") } });
        history.replaceState(null, "", location.pathname);
        setToken(null);
      } else {
        setSession(await api<Session>("/session/login", { body: { account_id: values.get("account"), password: values.get("password") } }));
      }
    } catch (error) { setError(message(error)); }
    finally { setBusy(false); }
  }

  if (session && !token) return <Workspace session={session} onEnd={() => setSession(undefined)} />;
  return <><header className="workspace-header"><div className="brand"><img src={`${import.meta.env.BASE_URL}brand.png`} alt="DocRunnel" /></div><div className="workspace-actions"><ThemeButton /></div></header><main className="signin"><Card className="signin-card"><h1>{token ? "Установить пароль" : "Вход в DocRunnel"}</h1>
    {loading ? <p role="status">Проверяем сессию…</p> : <form key={token ?? "login"} onSubmit={authenticate}>
      {!token && <FormField label="Логин" help="Имя выданной вам учётной записи"><Input name="account" required autoComplete="username" /></FormField>}
      <FormField label="Пароль" help={token ? "Введите новый пароль из 12 символов или больше" : "Пароль вашей учётной записи"}><Input name="password" type="password" required minLength={token ? 12 : undefined} autoComplete={token ? "new-password" : "current-password"} /></FormField>
      {error && <Alert variant="destructive" className="message">{error}</Alert>}
      <ActionButton disabled={busy} type="submit">{token ? "Сохранить пароль" : "Войти"}</ActionButton>
    </form>}</Card></main></>;
}

function Workspace({ session, onEnd }: { session: Session; onEnd: () => void }) {
  const [admin, setAdmin] = useState(false);
  const vertical = useVerticalGraph();
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const workspace = useWorkspaceUiState(!browserPreview && new URLSearchParams(location.search).has("run"));
  const { ui, patch } = workspace;
  const { leftPanel, resultsOpen, inspectorOpen } = ui;
  const setInspectorOpen = (open: boolean) => patch({ inspectorOpen: open });
  const [activeTab, setActiveTab] = useState(createEmptyTab);
  const [inactiveTabs, setInactiveTabs] = useState<WorkflowTab[]>([]);
  const [order, setOrder] = useState<string[]>([]);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [lmStatus, setLmStatus] = useState<LMStatus>({ connected: false });
  const [templateSearch, setTemplateSearch] = useState("");
  const [documentDetails, setDocumentDetails] = useState<DocumentRecord>();
  const [deletingDoc, setDeletingDoc] = useState<DocumentRecord>();
  const [runSetup, setRunSetup] = useState<{ preview: boolean; node?: string }>();
  const settingsId = useId();
  const inspectorToggleRef = useRef<HTMLButtonElement>(null);
  const [picker, setPicker] = useState<{ position?: XYPosition; link?: InsertLink; kind?: PortType }>();
  const [pickerSearch, setPickerSearch] = useState("");
  const [pickerError, setPickerError] = useState("");
  const [savedDraft, setSavedDraft] = useState(emptyDraft);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const flow = useRef<ReactFlowInstance<any, any> | null>(null);
  const reconnecting = useRef<string | undefined>(undefined);
  const draggedKind = useRef<{ kind: typeof builtInSteps[number]["type"] | "personal" | "script"; personal?: PersonalNode; script?: ScriptNode }>(undefined);
  const canAuthor = session.role === "editor" || session.role === "admin";
  const [personal, setPersonal] = useState<PersonalNode[]>([]);
  const [editing, setEditing] = useState<PersonalNode | "new">();
  const [scripts, setScripts] = useState<ScriptNode[]>([]);
  const [editingScript, setEditingScript] = useState<ScriptNode | "new">();
  const editor = useLiveGraph(vertical, catalog);
  const { nodes, edges, selected, active } = editor;
  const selectedKind = selected?.data.schema.type;
  const selectedPorts = editor.ports(selectedKind);
  const selectedScript = selected?.data.schema.script_definition;
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [workflows, setWorkflows] = useState<Version[]>([]);
  const [version, setVersion] = useState<Version>();
  const [name, setName] = useState(emptySchemeName);
  const [runs, setRuns] = useState<Run[]>([]);
  const [run, setRun] = useState<string>(() => browserPreview ? "" : new URLSearchParams(location.search).get("run") ?? "");
  const [report, setReport] = useState<Report>();
  const [source, setSource] = useState<{ key: string; file: string; name: string; fragments: Fragment[] }>();
  const [error, setError] = useState("");
  const [errorNodes, setErrorNodes] = useState<Record<string, { reason?: string; label: string }>>({});
  const [busy, setBusy] = useState(false);
  const query = <T,>(path: string, body?: unknown) => api<T>(path, { body, session });
  const graph = editor.serialize;
  const draft = JSON.stringify({ name, graph: graph() });
  const dirty = draft !== savedDraft;
  const registry = buildNodeRegistry(catalog, personal, scripts, canAuthor);
  const selectedRegistry = selected && registry.find(item => item.kind === selectedKind
    && (!item.personal || item.personal.version_id === selected.data.schema.personal_version)
    && (!item.script || item.script.version_id === selected.data.schema.script_version));
  const templates = BUILTIN_TEMPLATES.filter(template =>
    [template.name, template.description, template.categoryLabel].join(" ").toLocaleLowerCase("ru").includes(templateSearch.trim().toLocaleLowerCase("ru")));
  const term = pickerSearch.trim().toLocaleLowerCase("ru");
  const originKind = nodes.find(node => node.id === picker?.link?.nodeId)?.data.schema.type;
  const pickerChoices = filterCompatibleChoices(registry.filter(item =>
    [item.name, item.description, item.shortDetail, item.categoryLabel].some(value => value.toLocaleLowerCase("ru").includes(term))),
    picker?.link, picker?.kind, originKind);
  function openPicker(position?: XYPosition, link?: InsertLink, kind?: PortType) {
    if (busy || nodes.length >= 24) return;
    setPickerSearch("");
    setPickerError("");
    setPicker({ position, link, kind });
  }
  const resultFields = (report?.field_order.length ? report.field_order : Object.keys(report?.rows[0]?.fields ?? {}))
    .map(id => ({ id, name: report?.field_names?.[id] ?? fields.find(field => field.id === id)?.name ?? id }));
  const hasTabularResults = Boolean(report?.rows.some(row => row.table));

  function failure(error: unknown) {
    if (error instanceof ApiError && error.status === 401) {
      onEnd();
      return;
    }
    if (error instanceof ApiError) {
      const affected = new Set<string>(error.nodes ?? []);
      if (error.reason === "fields") {
        for (const id of invalidExtractNodeIds(nodes)) affected.add(id);
      }
      if (affected.size) {
        const label = nodeErrorLabels[error.reason ?? ""] ?? "Ошибка настройки";
        setErrorNodes(Object.fromEntries(Array.from(affected, id => [id, { reason: error.reason, label }])));
      } else {
        setErrorNodes({});
      }
    }
    setError(message(error));
  }
  function clearNodeError(id: string) {
    setErrorNodes(current => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }
  async function action(work: () => Promise<void>) {
    setBusy(true); setError(""); setErrorNodes({});
    try { await work(); } catch (error) { failure(error); }
    finally { setBusy(false); }
  }
  const refresh = () => Promise.all([query<DocumentRecord[]>("/documents").then(setDocuments), query<Version[]>("/workflows").then(setWorkflows), query<Run[]>("/runs").then(setRuns)]);
  useEffect(() => { Promise.all([refresh(), query<CatalogItem[]>("/workflows/catalog").then(setCatalog)]).catch(failure); }, []);
  useEffect(() => { if (canAuthor) void Promise.all([
    query<PersonalNode[]>("/personal-nodes").then(setPersonal),
    !browserPreview && query<ScriptNode[]>("/script-nodes").then(setScripts),
  ]).catch(failure); }, [canAuthor]);
  useEffect(() => {
    if (!run) return;
    const controller = new AbortController();
    let timer: number;
    async function poll() {
      try {
        const next = await api<Report>(`/runs/${run}`, { session, signal: controller.signal });
        setReport(next);
        if (["queued", "running"].includes(next.state)) timer = window.setTimeout(poll, 1200);
        else await query<Run[]>("/runs").then(setRuns);
      } catch (error) { if (!controller.signal.aborted) failure(error); }
    }
    void poll();
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [run]);

  function selectRun(id: string) {
    if (id) patch({ resultsOpen: true });
    if (id === run) return;
    setReport(undefined); setSource(undefined); setRun(id);
    if (!browserPreview) history.replaceState(null, "", id ? `?run=${encodeURIComponent(id)}` : location.pathname);
  }

  async function upload(files: FileList) {
    const data = new FormData();
    for (const file of Array.from(files)) data.append("files", file);
    const entries = await query<(DocumentRecord & { error?: string })[]>("/documents", data);
    await refresh();
    setChosen(current => [...current, ...entries.flatMap(entry => entry.id ? [entry.id] : [])]);
    const rejected = entries.filter(entry => entry.error).map(entry => `${entry.name ?? "Файл"} — ${issues[entry.error!] ?? entry.error}`);
    if (rejected.length) setError(rejected.join("\n"));
  }

  async function openDemoOriginal(docId: string) {
    const { getDemoDocumentUrl } = await import("./preview-data");
    const url = getDemoDocumentUrl(docId);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }

  async function exportDemoFile(runId: string, format: "csv" | "json" | "xlsx") {
    const { downloadDemoRunExport } = await import("./preview-data");
    downloadDemoRunExport(runId, format);
  }

  async function deleteDocument(doc: DocumentRecord) {
    await query(`/documents/${doc.id}/delete`, {});
    setChosen(current => current.filter(id => id !== doc.id));
    setDocumentDetails(current => current?.id === doc.id ? undefined : current);
    setSource(current => current?.key === doc.id ? undefined : current);
    await refresh();
  }

  async function start(preview: boolean, inspected?: string) {
    const output = nodes.find(node => node.data.schema.type === "export");
    if (preview && !inspected && !output) { setError("Добавьте узел экспорта для предпросмотра"); return; }
    const payload = preview ? { ...(!dirty && version ? { schema_version: version.version_id } : { graph: graph() }),
      target: inspected ?? output?.id, documents: chosen.slice(0, 1) }
      : { schema_version: version?.version_id, documents: chosen };
    const item = await query<Run>("/runs", payload);
    selectRun(item.id);
  }

  function toggleDocument(id: string, checked: boolean) {
    setChosen(current => checked ? [...new Set([...current, id])] : current.filter(item => item !== id));
  }

  function navigate(next: WorkspaceSection) {
    if (next === "runs") { patch({ resultsOpen: !resultsOpen }); return; }
    patch({ leftPanel: leftPanel === next ? null : next });
  }

  const snapshot = (): WorkflowTab => ({ ...activeTab, name, version, nodes, edges, activeNodeId: active,
    viewport: flow.current?.getViewport(), savedDraft });
  const changed = (tab: WorkflowTab) =>
    JSON.stringify({ name: tab.name, graph: serializeGraph(tab.nodes, tab.edges) }) !== tab.savedDraft;
  const hasUnsavedTabs = dirty || inactiveTabs.some(changed);
  useEffect(() => {
    if (!hasUnsavedTabs) return;
    function warnOnExit(event: BeforeUnloadEvent) { event.preventDefault(); event.returnValue = ""; }
    window.addEventListener("beforeunload", warnOnExit);
    return () => window.removeEventListener("beforeunload", warnOnExit);
  }, [hasUnsavedTabs]);

  function activate(tab: WorkflowTab) {
    setActiveTab(tab); setName(tab.name); setVersion(tab.version); setSavedDraft(tab.savedDraft);
    setDocumentDetails(undefined); setError(""); setErrorNodes({});
    editor.replaceState(tab.nodes, tab.edges, tab.activeNodeId);
  }

  function changeTab(id: string) {
    const next = inactiveTabs.find(tab => tab.tabId === id);
    if (!next || busy) return;
    setInactiveTabs(tabs => [...tabs.filter(tab => tab.tabId !== id), snapshot()]);
    activate(next);
  }

  function closeTab(id: string) {
    if (busy) return;
    const tab = id === activeTab.tabId ? snapshot() : inactiveTabs.find(item => item.tabId === id);
    if (!tab || (changed(tab) && !window.confirm("Закрыть схему без сохранения изменений?"))) return;
    setOrder(ids => ids.filter(item => item !== id));
    if (id !== activeTab.tabId) { setInactiveTabs(tabs => tabs.filter(item => item.tabId !== id)); return; }
    activate(inactiveTabs.at(-1) ?? createEmptyTab());
    setInactiveTabs(tabs => tabs.slice(0, -1));
  }

  function openTab(tab: WorkflowTab, stored?: ReturnType<typeof graph>) {
    if (inactiveTabs.length >= 9) { setError("Можно открыть до 10 схем одновременно."); return; }
    const keep = !stored || dirty || version || nodes.length;
    if (keep) setInactiveTabs(tabs => [...tabs, snapshot()]);
    setOrder(ids => [...new Set([...ids.filter(id => keep || id !== activeTab.tabId), ...(keep ? [activeTab.tabId] : []), tab.tabId])]);
    activate(tab);
    if (stored) {
      const normalized = editor.load(stored);
      if (tab.version) setSavedDraft(JSON.stringify({ name: tab.name, graph: normalized }));
    }
    setTemplatesOpen(false);
    patch({ leftPanel: null });
  }

  function openWorkflow(item: WorkflowVersionRef) {
    if (version?.version_id === item.version_id) { patch({ leftPanel: null }); return; }
    const opened = inactiveTabs.find(tab => tab.version?.version_id === item.version_id);
    if (opened) { changeTab(opened.tabId); patch({ leftPanel: null }); return; }
    void action(async () => {
      const saved = await query<{ graph: ReturnType<typeof graph> }>("/workflows/versions/" + item.version_id);
      openTab({ ...createEmptyTab(item.name), version: item }, saved.graph);
    });
  }

  async function save(asDraft: boolean) {
    const payload = { name, graph: graph() };
    const item = await query<Omit<Version, "name">>(`/workflows${version && !version.published ? `/${version.id}/versions` : ""}`,
      { ...payload, draft: asDraft });
    setVersion({ ...item, name });
    setSavedDraft(JSON.stringify(payload));
    await refresh();
  }

  function exportSchemaJson() {
    const safeName = (name.trim() || "схема").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 60);
    const payload = {
      schema_format: "docrunnel-workflow-v1",
      name: name.trim() || emptySchemeName,
      exported_at: new Date().toISOString(),
      graph: graph(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `схема_${safeName}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importSchemaJson(file: File) {
    setError("");
    try {
      const parsed = JSON.parse(await file.text()) as { name?: unknown; graph?: ReturnType<typeof graph> };
      const importedGraph = parsed?.graph;
      if (!importedGraph || !Array.isArray(importedGraph.nodes) || !Array.isArray(importedGraph.edges)) {
        setError("Некорректный JSON-файл схемы: отсутствуют узлы или связи.");
        return;
      }
      const importedName = typeof parsed.name === "string" && parsed.name.trim()
        ? parsed.name.trim().slice(0, 80)
        : file.name.replace(/\.json$/i, "").slice(0, 80) || emptySchemeName;
      openTab(createEmptyTab(importedName), importedGraph);
    } catch {
      setError("Не удалось прочитать JSON-файл схемы.");
    }
  }

  function toggleInspector() {
    setInspectorOpen(!inspectorOpen);
    requestAnimationFrame(() => inspectorToggleRef.current?.focus());
  }

  async function syncRunsAfterClear() {
    const nextRuns = await query<Run[]>("/runs");
    setRuns(nextRuns);
    if (run && !nextRuns.some(item => item.id === run)) selectRun("");
  }

  async function handleWorkflowDeleted(workflowId: string) {
    if (version?.id === workflowId) {
      setVersion(undefined);
      setSavedDraft("");
    }
    setInactiveTabs(tabs => tabs.map(tab => tab.version?.id === workflowId ? { ...tab, version: undefined, savedDraft: "" } : tab));
    await refresh();
  }

  return <WorkspaceShell account={session.id} admin={admin} canAdmin={!browserPreview && session.role === "admin"} changeView={setAdmin} demo={browserPreview}
    leftPanel={leftPanel} resultsOpen={resultsOpen} onSection={navigate}
    topBarContent={<WorkflowTabsBar tabs={[...inactiveTabs, snapshot()].sort((a, b) => order.indexOf(a.tabId) - order.indexOf(b.tabId)).map(tab => ({
      tabId: tab.tabId, name: tab.name, dirty: changed(tab), versionLabel: tab.version?.draft ? "Черновик" : tab.version ? "v" + (tab.version.version ?? 1) : undefined,
    }))} activeTabId={activeTab.tabId} busy={busy} onSelectTab={changeTab} onCloseTab={closeTab}
      onNewTab={() => openTab(createEmptyTab())} onRenameActive={setName}
      onOpenTemplates={() => { setTemplateSearch(""); setTemplatesOpen(true); }}
      onExportJson={exportSchemaJson} onImportJson={file => void importSchemaJson(file)} />}
    changePassword={browserPreview ? undefined : async (current_password, password) => {
      try { await query("/session/change-password", { current_password, password }); }
      catch (error) { throw new Error(error instanceof ApiError && error.code === "current_password" ? "Текущий пароль неверен" : message(error)); }
    }}
    signOut={browserPreview ? undefined : () => void action(async () => { await query("/session/logout", {}); history.replaceState(null, "", location.pathname); onEnd(); })}>
    {admin && !browserPreview ? <Admin session={session} failure={failure} workflows={workflows} onRefresh={refresh}
      onWorkflowDeleted={handleWorkflowDeleted} onRunsCleared={syncRunsAfterClear} /> : <div className="main live-workspace">
      <GraphToolbar busy={busy} browserPreview={browserPreview} hasNodes={Boolean(nodes.length)} chosenCount={chosen.length}
        dirty={dirty} draftStatusLabel={dirty ? "Есть несохранённые изменения" : version?.draft ? "Черновик сохранён" : version ? "Схема сохранена" : "Пустая схема"}
        lmStatus={lmStatus}
        canSaveDraft={!busy && !!name.trim() && !(version?.draft && !dirty)}
        canSaveVersion={!busy && !!name.trim() && !!nodes.length && (dirty || !!version?.draft)}
        canRunBatch={!!version && !version.draft} onOpenSearch={() => openPicker()} onOpenAiGraph={browserPreview ? undefined : () => setAiOpen(true)}
        onSaveDraft={() => void action(() => save(true))} onSaveVersion={() => void action(() => save(false))}
        onRunPreviewQuick={() => chosen.length ? void action(() => start(true)) : setRunSetup({ preview: true })}
        onRunBatchQuick={() => chosen.length ? void action(() => start(false)) : setRunSetup({ preview: false })} />
      {browserPreview && <Alert className="live-alert">Веб-демо обрабатывает до 3 файлов PDF/DOCX в браузере и выгружает результаты в CSV, JSON и XLSX. AI-генерация, Starlark и связанные узлы доступны в локальной Docker-версии.</Alert>}
      {error && <Alert variant="destructive" className="message live-alert">{error}</Alert>}
      <div className="editor live-editor" data-catalog={Boolean(leftPanel)} data-inspector={inspectorOpen}
        style={{ "--studio-left-width": ui.leftWidth + "px", "--studio-inspector-width": ui.inspectorWidth + "px" } as React.CSSProperties}>
        {leftPanel === "nodes" && <NodeCatalogPanel registry={registry} canAuthor={canAuthor} busy={busy} nodeCount={nodes.length}
          catalogLoaded={!!catalog.length} favoriteNodes={ui.favoriteNodes} recentNodes={ui.recentNodes}
          expandedCategories={ui.expandedCategories} onSetCategoryOpen={workspace.setCategoryOpen} onToggleFavorite={workspace.toggleFavorite}
          onAddNode={item => {
            editor.add(item.kind, undefined, item.personal, item.script);
            workspace.recordRecent(item.key);
            setDocumentDetails(undefined);
            patch({ inspectorOpen: true, ...(vertical ? { leftPanel: null } : {}) });
          }}
          onDragStartNode={(kind, personal, script) => { draggedKind.current = { kind, personal, script }; }}
          onDragEndNode={() => { draggedKind.current = undefined; }}
          onCreatePersonal={() => setEditing("new")} onEditPersonal={setEditing}
          onCreateScript={browserPreview ? undefined : () => setEditingScript("new")}
          onEditScript={setEditingScript} onClose={() => patch({ leftPanel: null })} />}
        {leftPanel === "documents" && <DocumentsContextPanel documents={documents} chosen={chosen} selectedDocId={documentDetails?.id}
          busy={busy} browserPreview={browserPreview} onUpload={files => void action(() => upload(files))}
          onToggleChoose={toggleDocument} onDeleteDoc={setDeletingDoc} onSelectDoc={doc => {
            setDocumentDetails(doc); editor.setActive("");
            patch({ inspectorOpen: true, ...(vertical ? { leftPanel: null } : {}) });
          }}
          onClose={() => patch({ leftPanel: null })} />}
        {leftPanel === "schemes" && <SchemesContextPanel workflows={workflows} activeVersionId={version?.version_id}
          busy={busy} onOpenWorkflow={openWorkflow} onClose={() => patch({ leftPanel: null })} />}
        <section aria-label="Холст схемы" className="panel canvas-panel">
        <div className="canvas" tabIndex={0} aria-label="Граф. Shift+A открывает поиск узлов" onKeyDown={event => {
          if (event.shiftKey && event.code === "KeyA" && !event.altKey && !event.ctrlKey &&
            !(event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable]"))) {
            event.preventDefault();
            openPicker();
          }
        }} onDragOver={event => {
          if (draggedKind.current) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }
        }} onDrop={event => {
          if (!flow.current || !draggedKind.current || busy || nodes.length >= 24) return;
          event.preventDefault();
          editor.add(draggedKind.current.kind, flow.current.screenToFlowPosition({ x: event.clientX, y: event.clientY }), draggedKind.current.personal, draggedKind.current.script);
          draggedKind.current = undefined;
          setInspectorOpen(true); setError("");
        }}>
        <ReactFlow key={activeTab.tabId} defaultViewport={activeTab.viewport} nodes={nodes.map(node => {
          const spec = editor.ports(node.data.schema.type);
          const serverOnly = browserPreview && requiresServer(node.data.schema.type);
          const missingInput = node.data.schema.script_definition
            ? Object.keys(node.data.schema.script_definition.inputs).some(port => !edges.some(link => link.target === node.id && link.targetHandle === port))
            : spec?.inputs
              ? Object.keys(spec.inputs).some(port => !spec.optional_inputs?.includes(port) && !edges.some(link => link.target === node.id && link.targetHandle === port))
              : Boolean(spec?.input && !edges.some(link => link.target === node.id));
          const serverError = errorNodes[node.id];
          const nodeError = serverError?.reason === "fields" && node.data.schema.type === "extract"
            ? (getExtractionFieldIssues(node.data.schema.fields).nodeError ?? "")
            : (serverError?.label ?? (serverOnly ? nodeErrorLabels.server_node : ""));
          return { ...node, data: { ...node.data, vertical, active: node.id === active,
            title: editor.nodeLabel(node), instance: node.id.startsWith(`${node.data.schema.type}-`) ? node.id.split("-").at(-1) : undefined,
            ports: spec, named: node.data.schema.script_definition, toggle: editor.toggle, missingInput, nodeError,
            actions: {
              onDuplicate: (id: string) => setError(editor.duplicate(id)),
              canDuplicate: !serverOnly && !busy && nodes.length < 24,
            } } };
        })}
          edges={edges.map(link => {
            const origin = nodes.find(node => node.id === link.source)?.data.schema;
            const port = editor.outputType(origin, link.sourceHandle);
            const color = port ? `var(--port-${port})` : "var(--wire)";
            return { ...link, markerEnd: { type: MarkerType.ArrowClosed, color }, style: { stroke: color, strokeWidth: link.selected ? 2.5 : 1.5 } };
          })} nodeTypes={nodeTypes}
          onNodesChange={editor.onNodesChange} onEdgesChange={editor.onEdgesChange} onNodeClick={(_, node) => { editor.setActive(node.id); setInspectorOpen(true); }}
          onNodeDoubleClick={(_, node) => editor.toggle(node.id)} zoomOnDoubleClick={false}
          onPaneClick={event => {
            if (event.detail === 2) openPicker(flow.current?.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
            else { editor.setActive(""); setDocumentDetails(undefined); }
          }}
          onPaneContextMenu={event => { event.preventDefault(); openPicker(flow.current?.screenToFlowPosition({ x: event.clientX, y: event.clientY })); }}
          onInit={instance => { flow.current = instance; }}
          onConnect={link => { setError(editor.connect(link.source, link.target, undefined, link.sourceHandle, link.targetHandle)); clearNodeError(link.source); clearNodeError(link.target); }}
          onReconnectStart={(_, link) => { reconnecting.current = link.id; setError(""); }}
          onReconnect={(link, next) => { setError(editor.connect(next.source, next.target, link.id, next.sourceHandle, next.targetHandle)); clearNodeError(next.source); clearNodeError(next.target); }}
          onReconnectEnd={(_, link, handle, state) => {
            reconnecting.current = undefined;
            if (state.isValid || !state.toNode) return;
            const source = handle === "target" ? state.toNode.id : link.source;
            const target = handle === "source" ? state.toNode.id : link.target;
            const port = handle === "target" ? state.toHandle?.id : link.sourceHandle;
            const destinationPort = handle === "source" ? state.toHandle?.id : link.targetHandle;
            setError(editor.connectionError(source, target, link.id, port, destinationPort) || "Перетащите конец связи на совместимый порт");
          }}
          isValidConnection={edge => !editor.connectionError(edge.source, edge.target, reconnecting.current, edge.sourceHandle, edge.targetHandle)}
          onConnectEnd={(event, state) => {
            if (reconnecting.current || state.isValid || !state.fromNode || !state.fromHandle) return;
            const fromOutput = state.fromHandle?.type === "source";
            if (!state.toNode) {
              const pointer = "changedTouches" in event ? event.changedTouches[0] : event;
              if (!pointer || !document.elementFromPoint(pointer.clientX, pointer.clientY)?.closest(".react-flow__pane")) return;
              const schema = nodes.find(node => node.id === state.fromNode?.id)?.data.schema;
              const handle = state.fromHandle.id;
              const spec = editor.ports(schema?.type);
              const kind = fromOutput ? editor.outputType(schema, handle)
                : schema?.script_definition?.inputs[handle ?? ""] ?? spec?.inputs?.[handle ?? ""] ?? spec?.input;
              if (kind) openPicker(flow.current?.screenToFlowPosition({ x: pointer.clientX, y: pointer.clientY }), { nodeId: state.fromNode.id, fromOutput, handle }, kind);
              return;
            }
            setError(fromOutput
              ? editor.connectionError(state.fromNode.id, state.toNode.id, undefined, state.fromHandle?.id, state.toHandle?.id) || "Перетащите связь на вход узла"
              : editor.connectionError(state.toNode.id, state.fromNode.id, undefined, state.toHandle?.id, state.fromHandle?.id) || "Перетащите связь на выход узла");
          }}
          fitView={!activeTab.viewport} fitViewOptions={{ padding: 0.08, maxZoom: 1 }}><Background gap={20} color="var(--grid)" /><GraphControls
            collapseAll={() => editor.toggle()} expanded={nodes.some(node => node.data.expanded)}
            showZoomMeta minimapOpen={ui.minimapOpen} onToggleMinimap={() => patch({ minimapOpen: !ui.minimapOpen })} /></ReactFlow>
      </div></section><section className="inspector live-inspector" aria-label="Настройки узла">
        <header className="inspector-header">
          {inspectorOpen && <h2>{selected ? editor.title(selected) : documentDetails?.name ?? "Свойства схемы"}</h2>}
          <ActionButton ref={inspectorToggleRef} className="inspector-toggle" type="button" variant={inspectorOpen ? "ghost" : "outline"}
            size={inspectorOpen ? "icon-sm" : "sm"} aria-controls={settingsId} aria-expanded={inspectorOpen}
            aria-label={inspectorOpen ? "Свернуть настройки" : "Открыть настройки"}
            onClick={toggleInspector}>
            {inspectorOpen ? <CaretRight aria-hidden="true" /> : <><CaretLeft aria-hidden="true" />Настройки</>}
          </ActionButton>
        </header>
        <div className="settings live-settings" id={settingsId} hidden={!inspectorOpen}>
          {selectedRegistry && <details className="field-stack"><summary>Операция и порты</summary>
            <p className="muted">{selectedRegistry.originLabel}{selectedRegistry.version ? " · версия " + selectedRegistry.version : ""}</p>
            <p>{selectedRegistry.description}</p>
            {([["Входы", selectedRegistry.inputs], ["Выходы", selectedRegistry.outputs]] as const).map(([label, ports]) =>
              ports.length > 0 && <div key={label}><h3>{label}</h3><ul>{ports.map((port, index) =>
                <li key={port.name ?? index}>{port.name ? port.name + " · " : ""}{portLabels[port.type]}</li>)}</ul></div>)}
          </details>}
          {selected && <ActionButton variant="outline" size="sm" disabled={!chosen.length || busy} onClick={() => void action(() => start(true, selected.id))}>Предпросмотр узла</ActionButton>}
          {selected && selectedKind === "extract" && <>
            <ExtractionSettings key={selected.id} value={selected.data.schema.fields ?? []}
              showErrors={Boolean(errorNodes[selected.id])}
              change={fields => editor.updateSchema(selected.id, { fields })} />
            {!selected.data.schema.fields?.length && <ActionButton variant="ghost" size="sm"
              onClick={() => editor.updateSchema(selected.id, { fields: contractFields() })}>Добавить поля договора</ActionButton>}
          </>}
          {selected && selectedKind === "branch" && <BranchSettings rules={selected.data.schema.rules ?? []}
            columns={editor.upstreamColumns(selected.id)} hasTable={editor.upstreamTableColumns(selected.id).length > 0}
            change={rules => { editor.updateSchema(selected.id, { rules }); clearNodeError(selected.id); }} />}
          {selected && selectedKind === "table" && <ColumnSettings title="Столбцы таблицы" emptyText="Подключите источник таблицы ко входу table."
            available={editor.upstreamTableColumns(selected.id)} selected={selected.data.schema.table_columns}
            change={table_columns => { editor.updateSchema(selected.id, { table_columns }); clearNodeError(selected.id); }} />}
          {selected && selectedKind === "export" && <>
            {(editor.upstreamColumns(selected.id).length > 0 || !editor.upstreamTableColumns(selected.id).length) &&
              <ColumnSettings available={editor.upstreamColumns(selected.id)}
                selected={selected.data.schema.columns} change={columns => { editor.updateSchema(selected.id, { columns }); clearNodeError(selected.id); }} />}
            {editor.upstreamTableColumns(selected.id).length > 0 &&
              <ColumnSettings title="Столбцы таблицы" emptyText="Подключите узел таблицы."
                available={editor.upstreamTableColumns(selected.id)} selected={selected.data.schema.table_columns}
                change={table_columns => { editor.updateSchema(selected.id, { table_columns }); clearNodeError(selected.id); }} />}
            <FormField label="Ключ дублей" help="Первая строка остаётся в выгрузке. Повторы идут на ручную проверку">
              <NativeSelect value={selected.data.schema.deduplicate_by ?? ""} onChange={event => {
                editor.updateSchema(selected.id, { deduplicate_by: event.target.value || undefined });
                clearNodeError(selected.id);
              }}>
                <NativeSelectOption value="">Не искать дубли</NativeSelectOption>
                {editor.upstreamColumns(selected.id).map(field => <NativeSelectOption key={field.id} value={field.id}>{field.name}</NativeSelectOption>)}
              </NativeSelect>
            </FormField>
          </>}
          {selected?.data.schema.personal_definition && <div className="field-stack">
            <p>{selected.data.schema.personal_definition.input_field} → {selected.data.schema.personal_definition.output_field}</p>
            <code>{selected.data.schema.personal_definition.expression}</code>
          </div>}
          {selected && selectedScript && <div className="field-stack">
            {selectedScript.description && <p>{selectedScript.description}</p>}
            {Object.entries(selectedScript.parameters).map(([key, value]) => <FormField key={key} label={key} help="Параметр этого экземпляра">
              <Input maxLength={2048} value={selected.data.schema.script_params?.[key] ?? value} onChange={event =>
                editor.updateSchema(selected.id, { script_params: { ...selected.data.schema.script_params, [key]: event.target.value } })} />
            </FormField>)}
            <details><summary>Код закреплённой версии</summary><pre className="script-code">{selectedScript.code}</pre></details>
          </div>}
          {selected && (selectedPorts?.input || selectedPorts?.inputs || selectedScript) && <>
            {(selectedScript ? Object.entries(selectedScript.inputs) : selectedPorts?.inputs ? Object.entries(selectedPorts.inputs) : [["", selectedPorts!.input!]] as const).map(([targetPort, kind]) =>
            <FormField key={targetPort} label={targetPort ? `Подключить вход ${targetPort}` : "Подключить вход"}
              help={`Выберите узел-источник для порта «${portLabels[kind]}»`}>
              <NativeSelect value="" onChange={event => {
                const [node, port] = event.target.value.split(":");
                setError(editor.connect(node, selected.id, undefined, port, targetPort || undefined));
              }}>
                <NativeSelectOption value="" disabled>Выберите узел-источник</NativeSelectOption>
                {nodes.filter(node => node.id !== selected.id && (node.data.schema.script_definition || editor.ports(node.data.schema.type)?.output))
                  .flatMap(node => (node.data.schema.script_definition ? Object.keys(node.data.schema.script_definition.outputs)
                    : editor.ports(node.data.schema.type)?.outputs ?? [undefined]).map(port =>
                    <NativeSelectOption key={port ? `${node.id}:${port}` : node.id} value={port ? `${node.id}:${port}` : node.id}>
                      {editor.title(node)}{port && ` · ${node.data.schema.type === "branch" ? branchLabels[port as BranchPort] : port}`}
                    </NativeSelectOption>))}
              </NativeSelect>
            </FormField>)}
            {edges.filter(link => link.target === selected.id).map(link => {
              const origin = nodes.find(node => node.id === link.source);
              return origin && <ActionButton key={link.id} variant="ghost" onClick={() => { editor.removeEdge(link.id); setError(""); }}>
                Удалить связь от «{editor.title(origin)}{link.sourceHandle &&
                  ` · ${origin.data.schema.type === "branch" ? branchLabels[link.sourceHandle as BranchPort] : link.sourceHandle}`}{link.targetHandle && ` → ${link.targetHandle}`}»
              </ActionButton>;
            })}
          </>}
          {selected && <ActionButton variant="ghost" onClick={() => { editor.remove(selected.id); clearNodeError(selected.id); setError(""); }}>Удалить узел</ActionButton>}
          {!selected && (documentDetails ? <div className="field-stack"><p>{documentDetails.format.toUpperCase()}</p>
            {browserPreview
              ? <ActionButton variant="outline" onClick={() => void openDemoOriginal(documentDetails.id)}>Открыть оригинал</ActionButton>
              : <ActionButton variant="outline" asChild><a href={"/api/v1/documents/" + documentDetails.id + "/content"}>Открыть оригинал</a></ActionButton>}
            <ActionButton variant="ghost" disabled={busy} onClick={() => setDeletingDoc(documentDetails)}><Trash size={15} />Удалить документ</ActionButton>
            </div> : <div className="field-stack"><strong>{name}</strong>
              {editor.diagnostics().map((item, index) => <p key={index} className="muted">{item.text}</p>)}</div>)}
        </div></section></div>
      <Dialog open={Boolean(picker)} onOpenChange={open => { if (!open) setPicker(undefined); }}>
        <DialogContent className="workspace-dialog node-picker">
          <DialogHeader><DialogTitle>Добавить узел</DialogTitle><DialogDescription>
            {picker?.kind ? `Подходящий ${picker.link?.fromOutput ? "вход" : "выход"} · ${portLabels[picker.kind]}` : "Выберите операцию для графа."}
          </DialogDescription></DialogHeader>
          <Input type="search" aria-label="Поиск операций" placeholder="Поиск операций" value={pickerSearch} onChange={event => setPickerSearch(event.target.value)} />
          {pickerError && <p role="alert" className="text-destructive">{pickerError}</p>}
          <div className="node-picker-list">{pickerChoices.map(({ item, port, portLabel }) => <div key={`${item.key}:${port ?? ""}`} className="node-picker-row">
            <div><strong>{item.name}</strong><p className="muted">{item.originLabel} · {item.shortDetail}</p>
              <p className="muted">{[item.inputs.length ? `Вход: ${item.inputs.map(port => portLabels[port.type]).join(", ")}` : "",
                item.outputs.length ? `Выход: ${item.outputs.map(port => portLabels[port.type]).join(", ")}` : ""].filter(Boolean).join(" · ")}</p>
            </div>
            <ActionButton variant="outline" size="sm" aria-label={`Добавить «${item.name}»${port ? ` через ${port}` : ""}`}
              onClick={() => {
                if (!picker || nodes.length >= 24) return;
                const err = editor.add(item.kind, picker.position, item.personal, item.script, picker.link ? { ...picker.link, port } : undefined);
                if (err) { setPickerError(err); return; }
                setError(""); setInspectorOpen(true); setPicker(undefined);
              }}>{portLabel ?? "Добавить"}</ActionButton>
          </div>)}{!pickerChoices.length && <p className="muted">Подходящие узлы не найдены</p>}</div>
        </DialogContent>
      </Dialog>
      {!browserPreview && <AIGraphDialog
        open={aiOpen}
        onOpenChange={setAiOpen}
        documents={documents}
        selectedDocId={documentDetails?.id ?? chosen[0]}
        query={query}
        onStatusChange={setLmStatus}
        onApplyGraph={(workflowName, generatedGraph) => {
          openTab(createEmptyTab(workflowName), generatedGraph);
          setInspectorOpen(true);
        }}
        onSaveGraph={async (workflowName, generatedGraph) => {
          const item = await query<Omit<Version, "name">>("/workflows", {
            name: workflowName,
            graph: generatedGraph,
            draft: false,
          });
          openTab({ ...createEmptyTab(workflowName), version: { ...item, name: workflowName } }, generatedGraph);
          setInspectorOpen(true);
          await refresh();
        }}
      />}
      <Dialog open={templatesOpen} onOpenChange={setTemplatesOpen}><DialogContent className="workspace-dialog">
        <DialogHeader><DialogTitle>Шаблоны схем</DialogTitle><DialogDescription>Начните с готового графа обработки.</DialogDescription></DialogHeader>
        <Input type="search" aria-label="Поиск шаблонов" placeholder="Поиск шаблонов" value={templateSearch} onChange={event => setTemplateSearch(event.target.value)} />
        {!templates.length && <p className="muted">Шаблоны не найдены</p>}
        <div className="template-grid">{templates.map(template => <Card className="template-card" key={template.id}><strong>{template.name}</strong>
          <p className="muted">{template.categoryLabel} · {template.nodeCount} узлов · {template.formats}</p><p>{template.description}</p>
          <p className="muted">{template.outputType}</p>
          <ActionButton variant="outline" aria-label={"Использовать шаблон «" + template.name + "»"}
            onClick={() => openTab(createEmptyTab(template.id === "builtin-contract" ? "Реквизиты договора" : template.name), template.buildGraph?.())}>Использовать шаблон</ActionButton>
        </Card>)}</div>
      </DialogContent></Dialog>
      <Dialog open={Boolean(runSetup)} onOpenChange={open => { if (!open) setRunSetup(undefined); }}><DialogContent className="workspace-dialog run-dialog">
        <DialogHeader><DialogTitle>{runSetup?.preview ? "Документы для предпросмотра" : "Документы для запуска"}</DialogTitle>
          <DialogDescription>{name}</DialogDescription></DialogHeader>
        <DocumentsContextPanel embedded documents={documents} chosen={chosen} busy={busy} browserPreview={browserPreview}
          onUpload={files => void action(() => upload(files))} onToggleChoose={toggleDocument} onDeleteDoc={setDeletingDoc} />
        <ActionButton disabled={busy || !chosen.length} onClick={() => {
          if (!runSetup) return;
          setRunSetup(undefined);
          void action(() => start(runSetup.preview, runSetup.node));
        }}>{runSetup?.preview ? "Выполнить предпросмотр" : "Подтвердить запуск"}</ActionButton>
      </DialogContent></Dialog>
      <AlertDialog open={Boolean(deletingDoc)} onOpenChange={open => { if (!open) setDeletingDoc(undefined); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить документ «{deletingDoc?.name}»?</AlertDialogTitle>
            <AlertDialogDescription>{browserPreview ? "Файл будет удалён из текущей сессии браузера." : "Файл будет удалён из списка и с сервера."}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => {
              if (!deletingDoc) return;
              const targetDoc = deletingDoc;
              setDeletingDoc(undefined);
              void action(() => deleteDocument(targetDoc));
            }}>Удалить</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {editing && <PersonalNodeEditor node={editing === "new" ? undefined : editing} close={() => setEditing(undefined)}
        preview={async (expression, value) => {
          try { return (await query<{ value: string }>("/personal-nodes/preview", { expression, value })).value; }
          catch (error) { throw new Error(message(error)); }
        }} save={async definition => {
          try {
            await query(editing === "new" ? "/personal-nodes" : `/personal-nodes/${editing.node_id}/versions`, definition);
            setPersonal(await query("/personal-nodes"));
            setEditing(undefined);
          } catch (error) { throw new Error(message(error)); }
        }} />}
      {editingScript && <ScriptNodeEditor node={editingScript === "new" ? undefined : editingScript} close={() => setEditingScript(undefined)}
        save={async definition => {
          try {
            const saved = await query<ScriptNode>(editingScript === "new" ? "/script-nodes" : `/script-nodes/${editingScript.node_id}/versions`, definition);
            setScripts(current => [...current.filter(item => item.node_id !== saved.node_id), saved]);
            setEditingScript(undefined);
          } catch (error) { throw new Error(message(error)); }
        }} />}
      <section className="results workspace-results" hidden={!resultsOpen} data-large={ui.resultsExpanded} aria-label="Результаты"><div className="panel-head"><h2>Результаты</h2><div className="toolbar">
        <ActionButton variant="ghost" size="sm" onClick={() => patch({ resultsExpanded: !ui.resultsExpanded })}>{ui.resultsExpanded ? "Уменьшить панель" : "Расширить панель"}</ActionButton>
        <ActionButton variant="ghost" size="icon-sm" aria-label="Скрыть результаты" onClick={() => patch({ resultsOpen: false })}><X /></ActionButton>
        {runs.length > 0 && <FormField label="Открыть запуск" help="Выбрать предыдущий запуск и посмотреть его результаты"><NativeSelect value={run} onChange={event => selectRun(event.target.value)}><NativeSelectOption value="">Выберите запуск</NativeSelectOption>{runs.map(item => <NativeSelectOption key={item.id} value={item.id}>{item.created_at ? new Date(item.created_at).toLocaleString("ru-RU") : item.id.slice(0, 8)} · {states[item.state]}</NativeSelectOption>)}</NativeSelect></FormField>}
        {runs.some(item => !["queued", "running"].includes(item.state)) && <AlertDialog>
          <AlertDialogTrigger asChild><ActionButton variant="ghost" size="sm" disabled={busy}><Trash size={14} />Очистить историю</ActionButton></AlertDialogTrigger>
          <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Очистить историю запусков?</AlertDialogTitle><AlertDialogDescription>Все ваши завершённые запуски будут удалены. Загруженные документы и схемы сохранятся.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Отмена</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => void action(async () => { await query("/runs/clear", {}); await syncRunsAfterClear(); })}>Очистить</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
        </AlertDialog>}
        {report && !["queued", "running"].includes(report.state) && (!report.inspection || report.inspection.type === "export") &&
          (["csv", "json", "xlsx"] as const).map(format => browserPreview
            ? <ActionButton key={format} variant="ghost" onClick={() => void exportDemoFile(report.id, format)}>{format.toUpperCase()}</ActionButton>
            : <ActionButton key={format} variant="ghost" asChild><a href={`/api/v1/runs/${report.id}/export/${format}`}>{format.toUpperCase()}</a></ActionButton>)}
      </div></div>
      {!report ? <p className="empty">{run ? "Открываем запуск…" : "Запустите обработку, чтобы увидеть реквизиты и источники."}</p> : <>
        <p className="run-status" role="status">{states[report.state]} · {report.total} файлов
          {report.schema_revision ? ` · Версия схемы ${report.schema_revision}` : report.target && !report.schema_version ? " · Черновик" : ""}
        </p>
        {report.inspection && <section className="field-stack node-inspection" aria-label="Предпросмотр выбранного узла">
          <h3>{builtInSteps.find(step => step.type === report.inspection?.type)?.label ?? (report.inspection.type === "script" ? "Starlark" : "Личный узел")} · {report.inspection.node}</h3>
          <details><summary>Входные данные</summary><pre>{JSON.stringify(report.inspection.inputs, null, 2)}</pre></details>
          <details><summary>Выходные данные</summary><pre>{JSON.stringify(report.inspection.output, null, 2)}</pre></details>
        </section>}
        {report.rows.length > 0 && !hasTabularResults && <div className="table-scroll"><Table><TableHeader><TableRow><TableHead>Документ</TableHead>{resultFields.map(field => <TableHead key={field.id}>{field.name}</TableHead>)}</TableRow></TableHeader><TableBody>
          {report.rows.map(row => <TableRow key={row.position}><TableCell>{row.filename}</TableCell>{resultFields.map(field => {
            const data = row.fields[field.id];
            const info = formatCellValue(data);
            const fragments = data ? [...data.candidates.flatMap(item => item.sources), ...data.invalid_sources] : [];
            return <TableCell key={field.id}>{fragments.length ? <ActionButton variant="link" className="text-action" onClick={() => setSource({ key: row.document_id, file: row.filename, name: field.name, fragments })}>{info}</ActionButton> : info}</TableCell>;
          })}</TableRow>)}
        </TableBody></Table></div>}
        {report.rows.length > 0 && hasTabularResults && report.rows.map(row => {
          const table = row.table;
          const cols = report.table_columns?.length ? report.table_columns : (table?.columns ?? []);
          return <section key={row.position} className="tabular-result" aria-label={`Таблица документа ${row.filename}`}>
            <div className="tabular-header">
              <h3>{row.filename}</h3>
              <span className="muted">Таблица: {tableStatusLabels[table?.status ?? "missing"] ?? table?.status} · {table?.rows.length ?? 0} строк</span>
            </div>
            {resultFields.length > 0 && <div className="tabular-meta">
              {resultFields.map(field => {
                const data = row.fields[field.id];
                const info = formatCellValue(data);
                const fragments = data ? [...data.candidates.flatMap(item => item.sources), ...data.invalid_sources] : [];
                return <div key={field.id} className="tabular-meta-item">
                  <strong>{field.name}:</strong>
                  {fragments.length
                    ? <ActionButton variant="link" size="sm" className="text-action p-0 h-auto" onClick={() => setSource({ key: row.document_id, file: row.filename, name: field.name, fragments })}>{info}</ActionButton>
                    : <span>{info}</span>}
                </div>;
              })}
            </div>}
            {!!table?.diagnostics?.length && <p className="muted">{table.diagnostics.join(" · ")}</p>}
            {table && table.rows.length > 0 && <div className="table-scroll"><Table><TableHeader><TableRow>
              {cols.map(col => <TableHead key={col.key}>{col.name}</TableHead>)}
            </TableRow></TableHeader><TableBody>
              {table.rows.map(item => <TableRow key={item.row_index}>
                {cols.map(col => {
                  const cell = item.cells[col.key];
                  const info = formatCellValue(cell);
                  const fragments = cell ? [...cell.candidates.flatMap(c => c.sources), ...cell.invalid_sources] : [];
                  return <TableCell key={col.key}>{fragments.length
                    ? <ActionButton variant="link" className="text-action" onClick={() => setSource({ key: row.document_id, file: row.filename, name: `${col.name} · строка ${item.row_index}`, fragments })}>{info}</ActionButton>
                    : info}</TableCell>;
                })}
              </TableRow>)}
            </TableBody></Table></div>}
          </section>;
        })}
        {!!report.review?.length && <section className="manual-review" aria-label="Ручная проверка">
          <h3>Ручная проверка</h3>
          <div className="table-scroll"><Table><TableHeader><TableRow><TableHead>Документ</TableHead><TableHead>Причина</TableHead><TableHead>Источник</TableHead></TableRow></TableHeader>
            <TableBody>{report.review.flatMap((row, rowIndex) => row.reasons.map((reason, index) => {
              const isTableReason = reason.code.startsWith("TABLE_");
              const label = isTableReason ? "Таблица" : (report.field_names?.[reason.field] ?? fields.find(field => field.id === reason.field)?.name ?? reason.field);
              const data = row.fields[reason.field];
              const tableFragments = isTableReason && row.table
                ? [...row.table.sources, ...row.table.rows.flatMap(item => item.status !== "ok" ? item.sources : [])].slice(0, 6)
                : [];
              const fragments = isTableReason ? tableFragments : (data ? [...data.invalid_sources, ...data.candidates.flatMap(item => item.sources)] : []);
              const context = fragments.length ? fragments : Object.values(row.fields).flatMap(item =>
                [...item.invalid_sources, ...item.candidates.flatMap(value => value.sources)]).slice(0, 1);
              return <TableRow key={`${rowIndex}-${index}`}><TableCell>{row.filename}</TableCell>
                <TableCell>{label} · {reviewLabels[reason.code] ?? reason.code}{reason.first_position && ` · строка ${reason.first_position}`}
                  {isTableReason && row.table?.diagnostics?.length ? ` (${row.table.diagnostics[0]})` : ""}</TableCell>
                <TableCell><ActionButton variant="link" onClick={() => setSource({ key: row.document_id, file: row.filename, name: label, fragments: context })}>
                  {fragments.length ? "Цитата" : context.length ? "Контекст документа" : "Открыть оригинал"}
                </ActionButton></TableCell></TableRow>;
            }))}</TableBody></Table></div>
        </section>}
        {report.errors.map(row => <Alert key={row.position} variant="destructive" className="message">
          {row.filename}{row.error.node && ` · ${row.error.node}`} · {issues[row.error.code] ?? row.error.code}{row.error.message && ` · ${row.error.message}`}
        </Alert>)}
      </>}
      {source && <section className="source-fragment" aria-label="Исходный фрагмент"><div className="toolbar"><h3>{source.name} · {source.file}</h3>{browserPreview
        ? <ActionButton variant="link" onClick={() => void openDemoOriginal(source.key)}><ArrowSquareOut size={16} /> Оригинал</ActionButton>
        : <ActionButton variant="link" asChild><a href={`/api/v1/documents/${source.key}/content`}><ArrowSquareOut size={16} /> Оригинал</a></ActionButton>}<ActionButton variant="ghost" onClick={() => setSource(undefined)}>Закрыть</ActionButton></div>
        {source.fragments.map((fragment, index) => <blockquote className="document-quote" key={index}><p>{fragment.locator.page ? `Страница ${fragment.locator.page}` : `Блок ${fragment.locator.path?.map(part => part + 1).join(".") ?? ""}`}</p><mark>{fragment.quote}</mark></blockquote>)}
      </section>}
      </section>
    </div>}
  </WorkspaceShell>;
}

function Admin({ session, failure, workflows, onRefresh, onWorkflowDeleted, onRunsCleared }: {
  session: Session;
  failure: (error: unknown) => void;
  workflows: Version[];
  onRefresh: () => Promise<unknown>;
  onWorkflowDeleted: (workflowId: string) => Promise<void>;
  onRunsCleared: () => Promise<void>;
}) {
  const [tab, setTab] = useState("Запуски");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [link, setLink] = useState("");
  const [jobs, setJobs] = useState<Run[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [queryText, setQueryText] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const pages = Math.max(1, Math.ceil(total / 10));
  const [events, setEvents] = useState<AuditItem[]>([]);
  const hasFinishedJobs = jobs.some(job => !["queued", "running"].includes(job.state));
  const update = async () => {
    if (tab === "Пользователи") {
      const response = await api<{ items: Account[]; total: number; page: number }>(`/admin/users?page=${page}&q=${encodeURIComponent(queryText)}`);
      setAccounts(response.items); setTotal(response.total); setPage(response.page);
    }
    if (tab === "Запуски") setJobs(await api<Run[]>("/admin/runs"));
    if (tab === "Журнал") setEvents(await api<AuditItem[]>("/admin/audit"));
  };
  async function act(work: () => Promise<void>) {
    setBusy(true); setError("");
    try { await work(); } catch (error) {
      if (error instanceof ApiError && error.status === 401) failure(error);
      else setError(message(error));
    } finally { setBusy(false); }
  }
  useEffect(() => { setLink(""); void act(update); }, [tab, page, queryText]);

  return <div className="main"><header className="page-head"><div><h1>Админ-панель</h1></div></header>
    <section className="admin-panel" aria-label="Управление"><Tabs value={tab} onValueChange={setTab}><TabsList aria-label="Разделы админ-панели">{["Запуски", "Пользователи", "Общие схемы", "Журнал"].map(item => <TabsTrigger key={item} value={item}>{item}</TabsTrigger>)}</TabsList><TabsContent value={tab}>
      {error && <Alert variant="destructive" className="message">{error}</Alert>}
      {tab === "Запуски" && <>
        <div className="toolbar mb-2">
          <ActionButton variant="ghost" disabled={busy} onClick={() => void act(update)}>Обновить</ActionButton>
          <AlertDialog>
            <AlertDialogTrigger asChild><ActionButton variant="outline" size="sm" disabled={busy || !hasFinishedJobs}><Trash size={14} />Очистить историю</ActionButton></AlertDialogTrigger>
            <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Очистить историю запусков?</AlertDialogTitle><AlertDialogDescription>Все завершённые запуски пользователей будут удалены. Активные запуски в очереди и в работе останутся.</AlertDialogDescription></AlertDialogHeader>
            <AlertDialogFooter><AlertDialogCancel>Отмена</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => void act(async () => { await api("/admin/runs/clear", { session, body: {} }); await update(); await onRunsCleared(); })}>Очистить</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
          </AlertDialog>
        </div>
        <div className="table-scroll"><Table><TableHeader><TableRow><TableHead>Запуск</TableHead><TableHead>Владелец</TableHead><TableHead>Состояние</TableHead></TableRow></TableHeader><TableBody>{jobs.map(job => <TableRow key={job.id}><TableCell>{job.id.slice(0, 8)}</TableCell><TableCell>{job.owner_id}</TableCell><TableCell>{states[job.state]} {job.state === "queued" && <ActionButton variant="ghost" disabled={busy} onClick={() => void act(async () => { await api(`/admin/runs/${job.id}/cancel`, { session, body: {} }); await update(); })}>Отменить</ActionButton>}</TableCell></TableRow>)}</TableBody></Table></div>{!jobs.length && !busy && <p className="empty">Запусков пока нет.</p>}
      </>}
      {tab === "Пользователи" && <>
        <form className="toolbar account-form" onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); void act(async () => {
          const result = await api<{ url: string }>("/admin/users", { session, body: Object.fromEntries(data) }); setLink(result.url); await update();
        }); }}><FormField label="Логин" help="Идентификатор нового сотрудника. Используйте строчные латинские буквы и цифры"><Input name="account_id" required pattern="[a-z0-9][a-z0-9_.@\-]{0,79}" /></FormField><FormField label="Роль" help="Уровень доступа будущего пользователя"><NativeSelect name="role"><NativeSelectOption value="employee">Сотрудник</NativeSelectOption><NativeSelectOption value="editor">Редактор</NativeSelectOption><NativeSelectOption value="admin">Администратор</NativeSelectOption></NativeSelect></FormField><ActionButton type="submit" disabled={busy}>Пригласить</ActionButton></form>
        {link && <FormField label="Одноразовая ссылка" help="Передайте ссылку пользователю, которому нужно установить пароль"><Input readOnly value={link} onFocus={event => event.target.select()} /></FormField>}
        <form className="toolbar account-form" onSubmit={event => { event.preventDefault(); setSelected([]); setPage(1); setQueryText(search.trim()); }}>
          <FormField label="Поиск по логину" help="Введите логин или его часть"><Input value={search} maxLength={80} onChange={event => setSearch(event.target.value)} /></FormField>
          <ActionButton type="submit" disabled={busy}>Найти</ActionButton>
          <ActionButton type="button" variant="outline" disabled={busy || !selected.length} onClick={() => void act(async () => {
            await api("/admin/users/block", { session, body: { accounts: selected } }); setSelected([]); await update();
          })}>Заблокировать выбранных ({selected.length})</ActionButton>
        </form>
        <div className="table-scroll rounded-md border"><Table><TableHeader><TableRow>
          <TableHead><Checkbox aria-label="Выбрать сотрудников на странице" disabled={!accounts.some(row => row.role !== "admin" && row.state !== "blocked")}
            checked={accounts.some(row => row.role !== "admin" && row.state !== "blocked") && accounts.filter(row => row.role !== "admin" && row.state !== "blocked").every(row => selected.includes(row.id))}
            onCheckedChange={checked => setSelected(checked === true ? accounts.filter(row => row.role !== "admin" && row.state !== "blocked").map(row => row.id) : [])} /></TableHead>
          <TableHead>Логин</TableHead><TableHead>Роль</TableHead><TableHead>Состояние</TableHead><TableHead>Последний вход</TableHead><TableHead>Действия</TableHead>
        </TableRow></TableHeader><TableBody>{accounts.map(account => {
          const blocked = account.state === "blocked";
          const path = `/admin/users/${encodeURIComponent(account.id)}`;
          return <TableRow key={account.id} data-state={selected.includes(account.id) ? "selected" : undefined} className={blocked ? "bg-destructive/10" : undefined}>
            <TableCell><Checkbox aria-label={`Выбрать ${account.id}`} checked={selected.includes(account.id)} disabled={blocked || account.role === "admin" || busy}
              onCheckedChange={checked => setSelected(previous => checked === true ? [...previous, account.id] : previous.filter(id => id !== account.id))} /></TableCell>
            <TableCell>{account.id}</TableCell><TableCell>{account.role === "admin" ? "Администратор" : account.role === "editor" ? "Редактор" : "Сотрудник"}</TableCell>
            <TableCell>{blocked ? <span className="inline-flex items-center gap-1 text-destructive"><Lock />Заблокирована</span> : states[account.state]}</TableCell>
            <TableCell>{account.last_login_at ? new Date(account.last_login_at).toLocaleString("ru-RU") : "—"}</TableCell>
            <TableCell>{blocked ? <>
              <ActionButton variant="ghost" disabled={busy} onClick={() => void act(async () => { await api(path + "/unblock", { session, body: {} }); await update(); })}>Разблокировать</ActionButton>
              <AlertDialog><AlertDialogTrigger asChild><ActionButton variant="ghost" disabled={busy}>Удалить</ActionButton></AlertDialogTrigger>
                <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Удалить {account.id}?</AlertDialogTitle><AlertDialogDescription>Учётная запись, файлы, схемы и результаты обработки будут удалены.</AlertDialogDescription></AlertDialogHeader>
                <AlertDialogFooter><AlertDialogCancel>Отмена</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => void act(async () => { await api(path + "/delete", { session, body: {} }); await update(); })}>Удалить с файлами</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
              </AlertDialog>
            </> : <ActionButton variant="ghost" disabled={busy} onClick={() => void act(async () => { setLink((await api<{ url: string }>(path + "/reset", { session, body: {} })).url); })}>Выдать ссылку</ActionButton>}</TableCell>
          </TableRow>;
        })}{!accounts.length && <TableRow><TableCell colSpan={6}>Пользователи не найдены</TableCell></TableRow>}</TableBody></Table></div>
        <Pagination className="mt-3"><PaginationContent>
          <PaginationItem><ActionButton variant="outline" disabled={busy || page <= 1} onClick={() => { setSelected([]); setPage(page - 1); }}>Назад</ActionButton></PaginationItem>
          <PaginationItem><PaginationLink isActive aria-label={`Страница ${page} из ${pages}`}>{page} / {pages}</PaginationLink></PaginationItem>
          <PaginationItem><ActionButton variant="outline" disabled={busy || page >= pages} onClick={() => { setSelected([]); setPage(page + 1); }}>Далее</ActionButton></PaginationItem>
        </PaginationContent></Pagination>
      </>}
      {tab === "Общие схемы" && (workflows.length ? <ul>{workflows.map(item => <li key={item.version_id} className="admin-row">
        <span>{item.name}</span>
        <div className="toolbar">
          {item.published
            ? <span className="muted">Опубликована</span>
            : <ActionButton variant="outline" size="sm" disabled={busy} onClick={() => void act(async () => { await api(`/workflows/versions/${item.version_id}/publish`, { session, body: {} }); await onRefresh(); })}>Опубликовать</ActionButton>}
          <AlertDialog>
            <AlertDialogTrigger asChild><ActionButton variant="ghost" size="sm" disabled={busy}><Trash size={14} />Удалить</ActionButton></AlertDialogTrigger>
            <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Удалить схему «{item.name}»?</AlertDialogTitle><AlertDialogDescription>Все версии схемы будут удалены. Сохранённые результаты прошлых запусков останутся.</AlertDialogDescription></AlertDialogHeader>
            <AlertDialogFooter><AlertDialogCancel>Отмена</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => void act(async () => { await api(`/workflows/${item.id}/delete`, { session, body: {} }); await onWorkflowDeleted(item.id); })}>Удалить</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
          </AlertDialog>
        </div>
      </li>)}</ul> : <p className="empty">Сохраните схему в рабочем месте, чтобы опубликовать её.</p>)}
      {tab === "Журнал" && <>
        <div className="toolbar mb-2">
          <ActionButton variant="ghost" disabled={busy} onClick={() => void act(update)}>Обновить</ActionButton>
          <AlertDialog>
            <AlertDialogTrigger asChild><ActionButton variant="outline" size="sm" disabled={busy || !events.length}><Trash size={14} />Очистить журнал</ActionButton></AlertDialogTrigger>
            <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Очистить журнал?</AlertDialogTitle><AlertDialogDescription>Все записи журнала действий будут безвозвратно удалены.</AlertDialogDescription></AlertDialogHeader>
            <AlertDialogFooter><AlertDialogCancel>Отмена</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => void act(async () => { await api("/admin/audit/clear", { session, body: {} }); await update(); })}>Очистить</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
          </AlertDialog>
        </div>
        {events.length ? <div className="table-scroll"><Table><TableHeader><TableRow><TableHead>Время</TableHead><TableHead>Кто</TableHead><TableHead>Действие</TableHead><TableHead>Объект</TableHead></TableRow></TableHeader><TableBody>{events.map((event, index) => <TableRow key={index}><TableCell>{new Date(event.occurred_at).toLocaleString("ru-RU")}</TableCell><TableCell>{event.actor_id}</TableCell><TableCell>{event.action}</TableCell><TableCell>{event.target_id}</TableCell></TableRow>)}</TableBody></Table></div> : !busy && <p className="empty">Записей пока нет.</p>}
      </>}
    </TabsContent></Tabs></section></div>;
}
