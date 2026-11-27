import {
  Eye, FloppyDisk, ListMagnifyingGlass, Play,
} from "@phosphor-icons/react";
import { ActionButton } from "../../control-help";

export function GraphToolbar({
  busy,
  browserPreview,
  canSaveDraft,
  canSaveVersion,
  canRunBatch,
  hasNodes,
  chosenCount,
  draftStatusLabel,
  dirty,

  onOpenSearch,

  onSaveDraft,
  onSaveVersion,
  onRunBatchQuick,
  onRunPreviewQuick,

}: {
  busy: boolean;
  browserPreview: boolean;
  canSaveDraft: boolean;
  canSaveVersion: boolean;
  canRunBatch: boolean;
  hasNodes: boolean;
  chosenCount: number;
  draftStatusLabel: string;
  dirty: boolean;

  onOpenSearch: () => void;

  onSaveDraft: () => void;
  onSaveVersion: () => void;
  onRunBatchQuick: () => void;
  onRunPreviewQuick: () => void;

}) {
  const batchHint = browserPreview
    ? "Запуск обработки доступен в локальном Docker-режиме"
    : !canRunBatch
      ? "Сохраните готовую версию схемы для пакетного запуска"
      : chosenCount
        ? `Запустить на выбранных документах (${chosenCount})`
        : "Открыть выбор документов для запуска";

  return (
    <header className="studio-command-bar"><div className="toolbar">
          <ActionButton
            type="button"
            variant="ghost"
            size="sm"
            className="floating-btn"
            disabled={busy}
            hint="Поиск и добавление узла (Shift+A)"
            onClick={onOpenSearch}
          >
            <ListMagnifyingGlass size={15} />
            <span>Добавить узел</span>
          </ActionButton>
          <span className="draft-status-pill" data-dirty={dirty}>{draftStatusLabel}</span>
          <div className="command-spacer" />
          <ActionButton
            type="button"
            variant="ghost"
            size="sm"
            className="floating-btn"
            disabled={!canSaveDraft}
            hint="Сохранить текущее состояние как черновик"
            onClick={onSaveDraft}
          >
            <span>Сохранить черновик</span>
          </ActionButton>
          <ActionButton
            type="button"
            variant="outline"
            size="sm"
            className="floating-btn"
            disabled={!canSaveVersion}
            hint={hasNodes ? "Проверить и сохранить готовую версию схемы" : "Добавьте узлы в схему перед сохранением"}
            onClick={onSaveVersion}
          >
            <FloppyDisk size={15} />
            <span>Сохранить схему</span>
          </ActionButton>

          <ActionButton
            type="button"
            variant="ghost"
            size="sm"
            className="floating-btn"
            disabled={busy || browserPreview}
            hint={browserPreview ? "Предпросмотр на документах доступен в локальном Docker-режиме" : "Выполнить предпросмотр на одном документе"}
            onClick={onRunPreviewQuick}
          >
            <Eye size={15} />
            <span>Предпросмотр</span>
          </ActionButton>


            <ActionButton
              type="button"
              variant="default"
              size="sm"
              className="split-run-main"
              disabled={busy || browserPreview || !canRunBatch}
              hint={batchHint}
              onClick={onRunBatchQuick}
            >
              <Play size={14} weight="fill" />
              <span>Запустить пакет</span>
              {chosenCount > 0 && <span className="run-doc-count" aria-hidden="true">{chosenCount}</span>}
            </ActionButton>
    </div></header>
  );
}
