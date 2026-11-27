import { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { useState } from "react";
import {
  ArrowSquareOut, Check, Circle, FileText,
  GearSix, LinkSimple, Play, WarningCircle,
} from "@phosphor-icons/react";
import {
  Background, MarkerType, ReactFlow, useEdgesState,
  type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Alert, AlertDescription } from "./components/ui/alert";
import { Card } from "./components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "./components/ui/empty";
import { Input } from "./components/ui/input";
import { NativeSelect, NativeSelectOption } from "./components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { TooltipProvider } from "./components/ui/tooltip";
import { WorkspaceShell } from "./workspace-shell";
import { ActionButton, FormField } from "./control-help";
import "./theme.css";

import { allowed, GraphControls, initialEdges, nodeTypes, steps, usePipelineNodes, useVerticalGraph } from "./graph";
import { Badge } from "./components/ui/badge";

const sampleFile = "Договор поставки ДР-004.pdf";

function Status({ children, kind = "neutral" }: { children: React.ReactNode; kind?: string }) {
  return <Badge variant="secondary" className="ds-status" data-status={kind}><Circle size={7} weight="fill" />{children}</Badge>;
}

function App() {
  const [demoAccount, setDemoAccount] = useState<string | null>("Демо-пользователь");
  if (demoAccount === null) return <main className="signin"><Card className="signin-card">
    <h1>Вход в демоверсию</h1>
    <form onSubmit={event => { event.preventDefault(); const name = new FormData(event.currentTarget).get("account"); if (typeof name === "string" && name.trim()) setDemoAccount(name.trim()); }}>
      <FormField label="Имя" help="Имя отображается в панели аккаунта демоверсии"><Input name="account" required maxLength={80} /></FormField>
      <ActionButton type="submit">Войти</ActionButton>
    </form>
  </Card></main>;
  return <DemoWorkspace account={demoAccount} signOut={() => setDemoAccount(null)} />;
}

function DemoWorkspace({ account, signOut }: { account: string; signOut: () => void }) {
  const [admin, setAdmin] = useState(false);
  const vertical = useVerticalGraph();
  const [nodes, onNodesChange, toggleStep] = usePipelineNodes(vertical);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selected, setSelected] = useState("extract");
  const [from, setFrom] = useState("extract");
  const [to, setTo] = useState("validate");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [adminTab, setAdminTab] = useState("Запуски");
  const step = steps.find(item => item.id === selected)!;
  const valid = (source: string | null, target: string | null) => allowed.some(pair => pair[0] === source && pair[1] === target);

  function link(source: string | null, target: string | null) {
    setNotice("");
    if (!source || !target || !valid(source, target)) {
      setError("Эти узлы нельзя соединить. Проверьте тип входа");
      return;
    }
    if (edges.some(edge => edge.source === source && edge.target === target)) {
      setError("Такая связь уже есть");
      return;
    }
    setEdges(current => [...current, {
      id: source + "-" + target,
      source: source as (typeof current)[number]["source"],
      target: target as (typeof current)[number]["target"],
    }]);
    setError("");
    setNotice("Связь создана");
  }

  function runPreview() {
    if (allowed.some(([source, target]) => !edges.some(edge => edge.source === source && edge.target === target))) {
      setSelected("extract");
      setError("Соедините «Извлечение» и «Проверка» перед запуском");
      return;
    }
    setError("");
    setNotice("");
    setPreview(true);
  }

  function changeView(mode: boolean) {
    setAdmin(mode);
    setError("");
    setNotice("");
  }

  return (
    <WorkspaceShell admin={admin} canAdmin changeView={changeView} account={account} signOut={signOut} demo>
      <div className="main">
        <header className="page-head">
          <div>
            <h1>{admin ? "Админ-панель" : "Реквизиты договора"}</h1>
          </div>
          {admin ? <Status kind="success">Обработчик доступен</Status> :
            <ActionButton onClick={runPreview}><Play data-icon size={17} weight="fill" /> Запустить предпросмотр</ActionButton>}
        </header>
        {admin ? (
          <section className="panel admin-panel" aria-label="Управление">
            <Tabs value={adminTab} onValueChange={setAdminTab}><TabsList aria-label="Разделы админ-панели">
              {["Запуски", "Пользователи", "Общие схемы", "Журнал"].map(tab =>
                <TabsTrigger key={tab} value={tab}>{tab}</TabsTrigger>)}
            </TabsList><TabsContent value={adminTab}>
            {adminTab === "Запуски" ? <Table><TableHeader><TableRow><TableHead>Запуск</TableHead><TableHead>Схема</TableHead><TableHead>Состояние</TableHead></TableRow></TableHeader>
              <TableBody><TableRow><TableCell>DR-004</TableCell><TableCell>Реквизиты договора</TableCell><TableCell><Status kind="success">Завершён</Status></TableCell></TableRow>
              <TableRow><TableCell>DR-005</TableCell><TableCell>Реквизиты договора</TableCell><TableCell><Status kind="warning">Ожидает</Status></TableCell></TableRow></TableBody></Table> :
              <Empty><EmptyDescription>В тестовом наборе раздел «{adminTab}» пуст.</EmptyDescription></Empty>}
            </TabsContent></Tabs>
          </section>
        ) : (
          <>
            <div className="editor">
              <section className="panel canvas-panel" aria-label="Холст схемы">
                <div className="canvas">
                  <ReactFlow nodes={nodes.map(node => ({ ...node, data: { ...node.data, active: node.id === selected, toggle: toggleStep } }))} edges={edges} nodeTypes={nodeTypes}
                    onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
                    onNodeClick={(_, node) => setSelected(node.id)}
                    onNodeDoubleClick={(_, node) => toggleStep(node.id)} zoomOnDoubleClick={false}
                    onConnect={(connection: Connection) => link(connection.source, connection.target)}
                    isValidConnection={connection => valid(connection.source, connection.target)}
                    defaultEdgeOptions={{ markerEnd: { type: MarkerType.ArrowClosed }, style: { stroke: "var(--wire)", strokeWidth: 1.5 } }}
                    fitView fitViewOptions={{ padding: vertical ? 0.08 : 0.05, maxZoom: 1 }} minZoom={0.2} maxZoom={1.5}>
                    <Background gap={20} color="var(--grid)" /><GraphControls collapseAll={() => toggleStep()} expanded={nodes.some(node => node.data.expanded)} />
                  </ReactFlow>
                </div>
              </section>
              <section className="panel inspector" aria-label="Настройки узла">
                <div className="panel-head"><h2>{step.label}</h2><GearSix size={19} aria-hidden="true" /></div>
                <div className="settings">
                  <div><h3>Образец</h3><Card size="sm" className="file"><FileText size={18} aria-hidden="true" /><span>{sampleFile}</span></Card></div>
                  <form onSubmit={event => { event.preventDefault(); link(from, to); }}>
                    <FormField label="Откуда" help="Этап, результат которого передаётся по связи"><NativeSelect id="link-from" value={from} onChange={event => setFrom(event.target.value)}>{steps.map(item => <NativeSelectOption key={item.id} value={item.id}>{item.label}</NativeSelectOption>)}</NativeSelect></FormField>
                    <FormField label="Куда" help="Этап, который получит результат предыдущего этапа"><NativeSelect id="link-to" value={to} onChange={event => setTo(event.target.value)}>{steps.map(item => <NativeSelectOption key={item.id} value={item.id}>{item.label}</NativeSelectOption>)}</NativeSelect></FormField>
                    <ActionButton type="submit" variant="outline"><LinkSimple data-icon size={17} /> Создать связь</ActionButton>
                  </form>
                  {error && <Alert variant="destructive" className="message"><WarningCircle size={17} /><AlertDescription>{error}</AlertDescription></Alert>}
                  {notice && <Alert role="status" className="message"><Check size={17} /><AlertDescription>{notice}</AlertDescription></Alert>}
                </div>
              </section>
            </div>
            <section className="panel results" aria-label="Предпросмотр результата">
              <div className="panel-head"><div><h2>Предпросмотр результата</h2><span>{preview ? sampleFile : "Образец для проверки схемы"}</span></div>
                {preview && <Status kind="success">1 документ обработан</Status>}</div>
              {preview ? <Table><TableHeader><TableRow><TableHead>Номер договора</TableHead><TableHead>Дата</TableHead><TableHead>Сумма</TableHead><TableHead>Источник</TableHead></TableRow></TableHeader>
                <TableBody><TableRow><TableCell>ДР-004</TableCell><TableCell>25.11.2026</TableCell><TableCell className="money">48 200,50 ₽</TableCell>
                <TableCell><ActionButton variant="ghost" onClick={() => setShowSource(!showSource)} aria-expanded={showSource}>
                  <ArrowSquareOut data-icon size={17} /> Открыть источник</ActionButton></TableCell></TableRow></TableBody></Table> :
                <Empty className="results-empty"><EmptyHeader><EmptyMedia variant="icon"><FileText /></EmptyMedia><EmptyDescription>Запустите предпросмотр, чтобы увидеть извлечённые поля.</EmptyDescription></EmptyHeader></Empty>}
              {preview && showSource && <section className="source-fragment" aria-label="Исходный фрагмент">
                <h3>Исходный фрагмент</h3><p>{sampleFile} · страница 1</p>
                <blockquote className="document-quote">Общая стоимость поставки по настоящему договору составляет <mark>48 200,50 руб.</mark></blockquote>
              </section>}
            </section>
          </>
        )}
      </div>
    </WorkspaceShell>
  );
}

const Live = lazy(() => import("./live"));
createRoot(document.getElementById("root")!).render(
  <TooltipProvider>{import.meta.env.MODE === "vercel" || import.meta.env.VITE_DOCRUNNEL_LIVE === "1"
    ? <Suspense fallback={<main className="empty">Подключаемся к DocRunnel…</main>}><Live /></Suspense>
    : <App />}</TooltipProvider>,
);
