import { useEffect, useState } from "react";
import { ArrowsClockwise, CheckCircle, Cpu, FloppyDisk, PlugsConnected, Sparkle, WarningCircle } from "@phosphor-icons/react";
import { ActionButton, FormField } from "./control-help";
import { Alert } from "./components/ui/alert";
import { Badge } from "./components/ui/badge";
import { Checkbox } from "./components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./components/ui/dialog";
import { Input } from "./components/ui/input";
import { NativeSelect, NativeSelectOption } from "./components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./components/ui/table";
import type { DocumentItem } from "./components/workspace/LeftContextPanels";
import type { Graph } from "./live-graph";

export type LMStatus = {
  connected: boolean;
  model?: string;
};

export type AIGeneratedResult = {
  model: string;
  base_url: string;
  latency_ms: number;
  repair_attempts: number;
  document_name: string;
  workflow_name: string;
  summary: string;
  components: { kind: string; title: string; detail: string }[];
  fields_preview: {
    id: string;
    name: string;
    type: string;
    labels?: string[];
    source_mode?: string;
    status: string;
    sample: string;
    quote: string;
  }[];
  matched_fields: number;
  total_fields: number;
  warnings: string[];
  graph: Graph;
};

type AIConfigResponse = {
  default_base_url: string;
  default_model: string;
  timeout_seconds: number;
  retries: number;
};

const STORAGE_URL = "docrunnel-ai-base-url";
const STORAGE_MODEL = "docrunnel-ai-model";
const STORAGE_KEY = "docrunnel-ai-api-key";
const STORAGE_SAVE_KEY = "docrunnel-ai-save-key";

const DOCKER_PRESETS = [
  { label: "LM Studio (1234)", url: "http://host.docker.internal:1234/v1" },
  { label: "llama.cpp (8080)", url: "http://host.docker.internal:8080/v1" },
  { label: "Ollama (11434)", url: "http://host.docker.internal:11434/v1" },
] as const;

const BROWSER_PRESETS = [
  { label: "LM Studio (1234)", url: "http://localhost:1234/v1" },
  { label: "llama.cpp (8080)", url: "http://localhost:8080/v1" },
  { label: "Ollama (11434)", url: "http://localhost:11434/v1" },
] as const;

const PROMPT_EXAMPLES = [
  "Извлеки номер договора и итоговую сумму, проверь формат суммы > 0, проблемные отправь на ручную проверку",
  "Извлеки из таблицы ИНН поставщика и дату договора с проверкой обязательности",
  "Вытащи ключевые реквизиты документа (номер, дату, контрагента, сумму) и настрой проверку формата",
] as const;

const COMPONENT_LABELS: Record<string, string> = {
  heading: "Заголовок",
  section: "Раздел",
  field: "Реквизит",
  table: "Таблица",
};

const STATUS_LABELS: Record<string, string> = {
  ok: "Найдено",
  missing: "Не найдено",
  ambiguous: "Несколько",
  invalid: "Формат",
};

export function AIGraphDialog({
  open,
  onOpenChange,
  documents,
  selectedDocId,
  browserPreview,
  query,
  onStatusChange,
  onApplyGraph,
  onSaveGraph,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documents: DocumentItem[];
  selectedDocId?: string;
  browserPreview: boolean;
  query: <T>(path: string, body?: unknown) => Promise<T>;
  onStatusChange?: (status: LMStatus) => void;
  onApplyGraph: (name: string, graph: Graph) => void;
  onSaveGraph?: (name: string, graph: Graph) => Promise<void>;
}) {
  const presets = browserPreview ? BROWSER_PRESETS : DOCKER_PRESETS;
  const [baseUrl, setBaseUrl] = useState(() => localStorage.getItem(STORAGE_URL) || (browserPreview ? "http://localhost:1234/v1" : "http://host.docker.internal:1234/v1"));
  const [model, setModel] = useState(() => localStorage.getItem(STORAGE_MODEL) || "");
  const [saveKey, setSaveKey] = useState(() => localStorage.getItem(STORAGE_SAVE_KEY) === "1");
  const [apiKey, setApiKey] = useState(() => (localStorage.getItem(STORAGE_SAVE_KEY) === "1" ? localStorage.getItem(STORAGE_KEY) || "" : ""));
  const [disableThinking, setDisableThinking] = useState(true);
  const [autoRepair, setAutoRepair] = useState(true);
  const [models, setModels] = useState<string[]>([]);
  const [docId, setDocId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [connStatus, setConnStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AIGeneratedResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setError("");
    if (selectedDocId && documents.some(d => d.id === selectedDocId)) {
      setDocId(selectedDocId);
    } else if (!docId || !documents.some(d => d.id === docId)) {
      setDocId(documents[0]?.id ?? (browserPreview ? "demo-contract" : ""));
    }
    if (!localStorage.getItem(STORAGE_URL)) {
      void query<AIConfigResponse>("/ai/config")
        .then(cfg => {
          if (cfg.default_base_url) setBaseUrl(cfg.default_base_url);
          if (cfg.default_model && !model) setModel(cfg.default_model);
        })
        .catch(() => {});
    }
  }, [open, documents, selectedDocId, browserPreview]);

  useEffect(() => {
    localStorage.setItem(STORAGE_URL, baseUrl);
  }, [baseUrl]);

  useEffect(() => {
    localStorage.setItem(STORAGE_MODEL, model);
  }, [model]);

  useEffect(() => {
    localStorage.setItem(STORAGE_SAVE_KEY, saveKey ? "1" : "0");
    if (saveKey && apiKey) {
      localStorage.setItem(STORAGE_KEY, apiKey);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [saveKey, apiKey]);

  function extractErrorMessage(err: unknown): string {
    if (err instanceof Error && err.message) return err.message;
    return "Не удалось выполнить запрос к LM-серверу";
  }

  async function handleTestConnection() {
    setBusy(true);
    setError("");
    setConnStatus(null);
    try {
      const res = await query<{ models: string[]; message?: string }>("/ai/test", {
        base_url: baseUrl,
        api_key: apiKey || undefined,
      });
      const list = res.models ?? [];
      setModels(list);
      const activeModel = model || list[0] || "";
      if (list.length && !model) {
        setModel(list[0]);
      }
      setConnStatus({ ok: true, text: res.message || `LM подключена. Моделей: ${list.length}` });
      onStatusChange?.({ connected: true, model: activeModel || undefined });
    } catch (err) {
      const msg = extractErrorMessage(err);
      setConnStatus({ ok: false, text: msg });
      setError(msg);
      onStatusChange?.({ connected: false });
    } finally {
      setBusy(false);
    }
  }

  async function handleGenerate() {
    if (!docId) {
      setError("Сначала загрузите и выберите PDF или DOCX файл.");
      return;
    }
    if (!baseUrl.trim()) {
      setError("Укажите URL локальной модели (LM Studio, llama.cpp или Ollama).");
      return;
    }
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const generated = await query<AIGeneratedResult>("/ai/generate-graph", {
        document_id: docId,
        prompt: prompt.trim(),
        base_url: baseUrl,
        model: model.trim() || undefined,
        api_key: apiKey || undefined,
        disable_thinking: disableThinking,
        auto_repair: autoRepair,
      });
      setResult(generated);
      onStatusChange?.({ connected: true, model: generated.model || model || undefined });
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const effectiveDocs = browserPreview && !documents.length
    ? [{ id: "demo-contract", name: "01-paragraph.docx (демо)", format: "docx" }]
    : documents;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="workspace-dialog ai-graph-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkle size={18} aria-hidden="true" />
            <span>Создание схемы с локальной LM</span>
          </DialogTitle>
          <DialogDescription>
            Подключите локальную модель (LM Studio, llama.cpp, Ollama или внешний OpenAI-совместимый API), опишите задачу и выберите файл — модель создаст валидную схему и проверит её на документе.
          </DialogDescription>
        </DialogHeader>

        <div className="field-stack">
          <div className="ai-config-box">
            <div className="toolbar">
              <span className="muted">Локальный сервер:</span>
              {presets.map(preset => (
                <ActionButton
                  key={preset.label}
                  type="button"
                  size="xs"
                  variant={baseUrl === preset.url ? "secondary" : "outline"}
                  onClick={() => setBaseUrl(preset.url)}
                >
                  {preset.label}
                </ActionButton>
              ))}
            </div>

            <div className="ai-grid">
              <FormField label="URL сервера OpenAI API (/v1)" help="Для Docker на Windows используйте host.docker.internal вместо localhost">
                <Input
                  value={baseUrl}
                  onChange={event => setBaseUrl(event.target.value)}
                  placeholder="http://host.docker.internal:1234/v1"
                />
              </FormField>

              <FormField label="Модель" help="Загрузите список моделей с сервера или укажите имя вручную">
                {models.length > 0 ? (
                  <NativeSelect value={model} onChange={event => setModel(event.target.value)}>
                    {models.map(item => (
                      <NativeSelectOption key={item} value={item}>{item}</NativeSelectOption>
                    ))}
                  </NativeSelect>
                ) : (
                  <Input
                    value={model}
                    onChange={event => setModel(event.target.value)}
                    placeholder="Автовыбор с /v1/models или имя модели"
                  />
                )}
              </FormField>
            </div>

            <FormField label="API-ключ (необязательно для локальной LM)" help="Хранится только в этом браузере. Никогда не записывается на сервер, в БД, логи или JSON-схему">
              <Input
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={event => setApiKey(event.target.value)}
                placeholder="Оставьте пустым для LM Studio / llama.cpp / Ollama"
              />
            </FormField>

            <div className="ai-checkbox-row">
              <label className="document-choice">
                <Checkbox checked={saveKey} onCheckedChange={checked => setSaveKey(checked === true)} />
                <span>Сохранить ключ только в этом браузере</span>
              </label>
              <label className="document-choice">
                <Checkbox checked={disableThinking} onCheckedChange={checked => setDisableThinking(checked === true)} />
                <span>Отключить thinking-режим</span>
              </label>
              <label className="document-choice">
                <Checkbox checked={autoRepair} onCheckedChange={checked => setAutoRepair(checked === true)} />
                <span>Автоисправление подписей по файлу</span>
              </label>
            </div>

            <div className="toolbar">
              <ActionButton type="button" variant="outline" size="sm" disabled={busy || !baseUrl.trim()} onClick={() => void handleTestConnection()}>
                {busy ? <ArrowsClockwise size={14} className="animate-spin" /> : <PlugsConnected size={14} />}
                <span>Проверить соединение и загрузить модели</span>
              </ActionButton>
              {connStatus && (
                <span className={connStatus.ok ? "ai-conn-ok" : "text-destructive"} role="status">
                  {connStatus.ok ? <CheckCircle size={14} /> : <WarningCircle size={14} />}
                  <span>{connStatus.text}</span>
                </span>
              )}
            </div>
          </div>

          <FormField label="Файл-образец (PDF или DOCX)" help="Модель прочитает структуру файла и сразу проверит на нём созданную схему">
            <NativeSelect value={docId} onChange={event => setDocId(event.target.value)}>
              {!effectiveDocs.length && <NativeSelectOption value="">Сначала загрузите файл в разделе «Документы»</NativeSelectOption>}
              {effectiveDocs.map(doc => (
                <NativeSelectOption key={doc.id} value={doc.id}>
                  {doc.name} ({doc.format.toUpperCase()})
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </FormField>

          <FormField label="Запрос к локальной модели" help="Опишите, какие поля извлечь, какие проверки и ветвление на ручную проверку добавить">
            <textarea
              className="ai-prompt-input"
              rows={3}
              maxLength={1500}
              value={prompt}
              onChange={event => setPrompt(event.target.value)}
              placeholder="Например: Извлеки номер договора и сумму в рублях, проверь что сумма > 0, проблемные документы отправь на ручную проверку"
            />
          </FormField>

          <div className="toolbar">
            <span className="muted">Примеры:</span>
            {PROMPT_EXAMPLES.map((example, idx) => (
              <ActionButton key={idx} type="button" size="xs" variant="ghost" onClick={() => setPrompt(example)}>
                Сценарий {idx + 1}
              </ActionButton>
            ))}
          </div>

          {error && <Alert variant="destructive" className="message">{error}</Alert>}

          <div className="toolbar">
            <ActionButton
              type="button"
              disabled={busy || saving || !docId || !baseUrl.trim()}
              onClick={() => void handleGenerate()}
            >
              <Cpu size={15} />
              <span>{busy ? "Модель создаёт и проверяет схему…" : "Создать схему по запросу и файлу"}</span>
            </ActionButton>
            {result && (
              <>
                <ActionButton
                  type="button"
                  variant="outline"
                  disabled={saving}
                  onClick={() => {
                    onApplyGraph(result.workflow_name, result.graph);
                    onOpenChange(false);
                  }}
                >
                  <CheckCircle size={15} />
                  <span>Открыть на холсте</span>
                </ActionButton>
                {onSaveGraph && (
                  <ActionButton
                    type="button"
                    variant="secondary"
                    disabled={saving}
                    onClick={() => {
                      setSaving(true);
                      setError("");
                      void onSaveGraph(result.workflow_name, result.graph)
                        .then(() => onOpenChange(false))
                        .catch(err => setError(extractErrorMessage(err)))
                        .finally(() => setSaving(false));
                    }}
                  >
                    <FloppyDisk size={15} />
                    <span>{saving ? "Сохраняем…" : "Создать и сохранить схему"}</span>
                  </ActionButton>
                )}
              </>
            )}
          </div>

          {result && (
            <section className="ai-result-panel" aria-label="Предложенная моделью схема">
              <div className="tabular-header">
                <h3>{result.workflow_name}</h3>
                <div className="toolbar">
                  <Badge variant="secondary">LM · {result.model}</Badge>
                  <Badge variant="secondary">Проверено на файле: {result.matched_fields} / {result.total_fields}</Badge>
                  <Badge variant="outline">{(result.latency_ms / 1000).toFixed(1)} с</Badge>
                  {result.repair_attempts > 0 && <Badge variant="outline">Автоисправлений: {result.repair_attempts}</Badge>}
                </div>
              </div>
              <p className="muted">{result.summary}</p>

              {result.components.length > 0 && (
                <div className="ai-components">
                  <strong>Найденные составляющие файла:</strong>
                  <div className="ai-component-tags">
                    {result.components.map((comp, idx) => (
                      <div key={idx} className="ai-component-chip">
                        <Badge variant="outline">{COMPONENT_LABELS[comp.kind] ?? comp.kind}</Badge>
                        <span>{comp.title}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {result.fields_preview.length > 0 && (
                <div className="table-scroll">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Поле</TableHead>
                        <TableHead>Тип / режим</TableHead>
                        <TableHead>Проверка на файле</TableHead>
                        <TableHead>Извлечённое значение и цитата</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.fields_preview.map(item => (
                        <TableRow key={item.id}>
                          <TableCell><strong>{item.name}</strong> <span className="muted">({item.id})</span></TableCell>
                          <TableCell>{item.type}{item.source_mode && item.source_mode !== "any" ? ` · ${item.source_mode}` : ""}</TableCell>
                          <TableCell>{STATUS_LABELS[item.status] ?? item.status}</TableCell>
                          <TableCell>{item.sample || item.quote || "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {result.warnings.map((w, idx) => (
                <Alert key={idx} className="message">{w}</Alert>
              ))}
            </section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
