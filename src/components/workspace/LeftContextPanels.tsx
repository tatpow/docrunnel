import { useMemo, useRef, useState } from "react";
import {
  FileDoc, FilePdf, FolderOpen, Globe, MagnifyingGlass, UploadSimple, X,
} from "@phosphor-icons/react";
import { ActionButton } from "../../control-help";
import type { WorkflowVersionRef } from "../../workflow-tabs";
import { Badge } from "../ui/badge";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";

export type DocumentItem = { id: string; name: string; format: string };

export function DocumentsContextPanel({
  documents,
  chosen,
  selectedDocId,
  busy,
  browserPreview,
  onUpload,
  onToggleChoose,
  onSelectDoc,
  embedded = false,
  onClose,
}: {
  documents: DocumentItem[];
  chosen: string[];
  selectedDocId?: string;
  busy: boolean;
  browserPreview: boolean;
  onUpload: (files: FileList) => void;
  onToggleChoose: (id: string, checked: boolean) => void;
  onSelectDoc?: (doc: DocumentItem) => void;
  embedded?: boolean;
  onClose?: () => void;
}) {
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const term = search.trim().toLocaleLowerCase("ru");

  const nameCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const doc of documents) map.set(doc.name, (map.get(doc.name) ?? 0) + 1);
    return map;
  }, [documents]);

  const visible = useMemo(
    () => (term ? documents.filter(doc => `${doc.name} ${doc.format} ${doc.id}`.toLocaleLowerCase("ru").includes(term)) : documents),
    [documents, term],
  );

  return (
    <section aria-label="Документы" className="context-panel">
      {!embedded && <div className="context-panel-header">
        <h2>Документы</h2>
        <ActionButton variant="ghost" size="icon-xs" aria-label="Закрыть документы" onClick={onClose}>
          <X size={15} />
        </ActionButton>
      </div>}

      <div className="context-panel-actions">
        <input
          ref={inputRef}
          id="workspace-upload-docs"
          type="file"
          accept=".pdf,.docx"
          multiple
          className="sr-only"
          aria-label="Добавить PDF или DOCX"
          disabled={busy || browserPreview}
          onChange={event => {
            const files = event.target.files;
            if (files?.length) onUpload(files);
            event.target.value = "";
          }}
        />
        <ActionButton
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          disabled={busy || browserPreview}
          hint={browserPreview ? "Загрузка документов доступна в локальном Docker-режиме" : "Загрузить PDF с текстовым слоем или DOCX (до 20 МБ)"}
          onClick={() => inputRef.current?.click()}
        >
          <UploadSimple size={15} />
          <span>Добавить PDF или DOCX</span>
        </ActionButton>
      </div>

      {documents.length > 0 && (
        <div className="catalog-search-box">
          <MagnifyingGlass size={14} className="catalog-search-icon" aria-hidden="true" />
          <Input
            type="search"
            aria-label="Поиск документов"
            placeholder="Фильтр документов…"
            value={search}
            onChange={event => setSearch(event.target.value)}
          />
        </div>
      )}

      <div className="context-panel-scroll">
        {visible.length > 0 ? (
          <fieldset className="doc-compact-list">
            <legend className="doc-list-legend">
              <span>Выбрано для запуска: {chosen.length} из {documents.length}</span>
            </legend>
            {visible.map(doc => {
              const isChecked = chosen.includes(doc.id);
              const isSelected = selectedDocId === doc.id;
              const duplicateName = (nameCounts.get(doc.name) ?? 0) > 1;
              const isPdf = doc.format.toLowerCase() === "pdf";
              return (
                <div key={doc.id} className="doc-compact-row" data-selected={isSelected}>
                  <Checkbox
                    aria-label={doc.name}
                    checked={isChecked}
                    onCheckedChange={checked => onToggleChoose(doc.id, checked === true)}
                  />
                  <button
                    type="button"
                    className="doc-compact-btn"
                    title={`${doc.name} (${doc.format.toUpperCase()} · ${doc.id.slice(0, 8)})`}
                    onClick={() => onSelectDoc?.(doc)}
                  >
                    {isPdf ? <FilePdf size={15} className="doc-fmt-icon" aria-hidden="true" /> : <FileDoc size={15} className="doc-fmt-icon" aria-hidden="true" />}
                    <span className="doc-compact-info">
                      <span className="doc-compact-name">{doc.name}</span>
                      <span className="doc-compact-meta">
                        {doc.format.toUpperCase()}
                        {duplicateName ? ` · #${doc.id.slice(0, 6)}` : ""}
                      </span>
                    </span>
                  </button>
                </div>
              );
            })}
          </fieldset>
        ) : (
          <p className="muted catalog-empty-note">
            {browserPreview
              ? "Веб-демо позволяет собирать и сохранять схемы. Загрузка PDF/DOCX работает в локальном DocRunnel."
              : documents.length
                ? "Документы по запросу не найдены."
                : "Загрузите PDF или DOCX для предпросмотра и пакетного запуска."}
          </p>
        )}
      </div>

    </section>
  );
}

export function SchemesContextPanel({
  workflows,
  activeVersionId,
  busy,
  onOpenWorkflow,
  onClose,
}: {
  workflows: WorkflowVersionRef[];
  activeVersionId?: string;
  busy: boolean;
  onOpenWorkflow: (item: WorkflowVersionRef) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const term = search.trim().toLocaleLowerCase("ru");

  const visible = useMemo(
    () => (term ? workflows.filter(w => w.name.toLocaleLowerCase("ru").includes(term)) : workflows),
    [workflows, term],
  );

  return (
    <section aria-label="Схемы" className="context-panel">
      <div className="context-panel-header">
        <h2>Схемы</h2>
        <ActionButton variant="ghost" size="icon-xs" aria-label="Закрыть схемы" onClick={onClose}>
          <X size={15} />
        </ActionButton>
      </div>

      {workflows.length > 0 && (
        <div className="catalog-search-box">
          <MagnifyingGlass size={14} className="catalog-search-icon" aria-hidden="true" />
          <Input
            type="search"
            aria-label="Поиск схем"
            placeholder="Поиск сохранённых схем…"
            value={search}
            onChange={event => setSearch(event.target.value)}
          />
        </div>
      )}

      <div className="context-panel-scroll">
        {visible.length > 0 ? (
          <ul className="schemes-compact-list" aria-label="Сохранённые схемы">
            {visible.map(item => {
              const isCurrent = item.version_id === activeVersionId;
              return (
                <li key={item.version_id}>
                  <button
                    type="button"
                    className="scheme-list-item"
                    data-active={isCurrent}
                    disabled={busy}
                    onClick={() => onOpenWorkflow(item)}
                  >
                    <FolderOpen size={15} className="scheme-list-icon" aria-hidden="true" />
                    <span className="scheme-list-copy">
                      <strong title={item.name}>{item.name}</strong>
                      <small>
                        {item.draft ? "Черновик" : `Версия ${item.version ?? 1}`}
                        {item.published ? " · Общая" : ""}
                      </small>
                    </span>
                    {item.published && (
                      <Badge variant="secondary" className="scheme-pub-badge">
                        <Globe size={11} aria-hidden="true" />
                      </Badge>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted catalog-empty-note">
            {workflows.length ? "Схемы не найдены." : "Сохранённых схем пока нет. Создайте схему или выберите шаблон."}
          </p>
        )}
      </div>
    </section>
  );
}
