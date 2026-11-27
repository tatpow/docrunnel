import {
  Eye, FloppyDisk, ListMagnifyingGlass, Play, Sparkle,
} from "@phosphor-icons/react";
import { ActionButton } from "../../control-help";
import type { LMStatus } from "../../ai-graph-dialog";

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
  lmStatus,

  onOpenSearch,
  onOpenAiGraph,

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
  lmStatus?: LMStatus;

  onOpenSearch: () => void;
  onOpenAiGraph?: () => void;

  onSaveDraft: () => void;
  onSaveVersion: () => void;
  onRunBatchQuick: () => void;
  onRunPreviewQuick: () => void;

}) {
  const batchHint = !canRunBatch
    ? "Сохраните готовую версию схемы для пакетного запуска"
    : chosenCount
      ? `Запустить на выбранных документах (${chosenCount})${browserPreview ? " в браузере" : ""}`
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
          {onOpenAiGraph && (
            <ActionButton
              type="button"
              variant="outline"
              size="sm"
              className="floating-btn"
              disabled={busy}
              hint={lmStatus?.connected ? `Подключена локальная модель: ${lmStatus.model ?? "LM"}` : "Подключить локальную LM (LM Studio / llama.cpp / Ollama) и создать схему по запросу и файлу"}
              onClick={onOpenAiGraph}
            >
              <span className="lm-status-dot" data-connected={Boolean(lmStatus?.connected)} aria-hidden="true" />
              <Sparkle size={15} />
              <span>{lmStatus?.connected && lmStatus.model ? `LM · ${lmStatus.model.slice(0, 18)}` : "LM-схема"}</span>
            </ActionButton>
          )}
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
            disabled={busy}
            hint={browserPreview ? "Выполнить предпросмотр на одном документе в браузере" : "Выполнить предпросмотр на одном документе"}
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
              disabled={busy || !canRunBatch}
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
