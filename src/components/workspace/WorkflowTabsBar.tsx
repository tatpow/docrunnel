import { useRef, useState } from "react";
import { DotsThree, DownloadSimple, PencilSimple, Plus, SquaresFour, UploadSimple, X } from "@phosphor-icons/react";
import { ActionButton } from "../../control-help";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { Input } from "../ui/input";

export type TabSummary = {
  tabId: string;
  name: string;
  dirty: boolean;
  versionLabel?: string;
};

export function WorkflowTabsBar({
  tabs,
  activeTabId,
  busy,
  onSelectTab,
  onCloseTab,
  onNewTab,
  onRenameActive,
  onOpenTemplates,
  onExportJson,
  onImportJson,
}: {
  tabs: TabSummary[];
  activeTabId: string;
  busy: boolean;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onNewTab: () => void;
  onRenameActive: (nextName: string) => void;
  onOpenTemplates: () => void;
  onExportJson?: () => void;
  onImportJson?: (file: File) => void;
}) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  return (
    <div className="wf-tabs-bar" role="tablist" aria-label="Открытые схемы">
      <div className="wf-tabs-scroll">
        {tabs.map(tab => {
          const isActive = tab.tabId === activeTabId;
          const isRenaming = isActive && renamingId === tab.tabId;
          return (
            <div
              key={tab.tabId}
              className="wf-tab"
              data-active={isActive}
              data-dirty={tab.dirty}
            >
              {isRenaming ? (
                <Input
                  autoFocus
                  aria-label="Название схемы"
                  className="wf-tab-rename-input"
                  value={tab.name}
                  maxLength={80}
                  onChange={event => onRenameActive(event.target.value)}
                  onBlur={() => setRenamingId(null)}
                  onKeyDown={event => {
                    if (event.key === "Enter" || event.key === "Escape") {
                      event.preventDefault();
                      setRenamingId(null);
                    }
                  }}
                />
              ) : (
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className="wf-tab-btn"
                  title={`${tab.name}${tab.versionLabel ? ` (${tab.versionLabel})` : ""}${tab.dirty ? " · есть несохранённые изменения" : ""}`}
                  onClick={() => onSelectTab(tab.tabId)}
                  onDoubleClick={() => { if (isActive) setRenamingId(tab.tabId); }}
                >
                  <span className="wf-tab-title">{tab.name || "Без названия"}</span>
                  {tab.versionLabel && <span className="wf-tab-version">{tab.versionLabel}</span>}
                  {tab.dirty && <span className="wf-tab-dirty-dot" aria-label="Несохранённые изменения" title="Есть несохранённые изменения" />}
                </button>
              )}
              {tabs.length > 1 && (
                <button
                  type="button"
                  className="wf-tab-close"
                  aria-label={`Закрыть вкладку «${tab.name}»`}
                  onClick={event => { event.stopPropagation(); onCloseTab(tab.tabId); }}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      <ActionButton
        type="button"
        variant="ghost"
        size="icon-xs"
        className="wf-tab-add"
        disabled={busy || tabs.length >= 10}
        aria-label="Новая пустая схема"
        hint="Новая пустая схема"
        onClick={onNewTab}
      >
        <Plus size={14} />
      </ActionButton>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <ActionButton
            type="button"
            variant="ghost"
            size="icon-xs"
            className="wf-tab-menu"
            aria-label="Меню схемы"
            hint="Действия со схемой"
          >
            <DotsThree size={16} weight="bold" />
          </ActionButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={6}>
          <DropdownMenuItem onSelect={() => setRenamingId(activeTabId)}>
            <PencilSimple /> Переименовать схему
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onOpenTemplates}>
            <SquaresFour /> Библиотека шаблонов
          </DropdownMenuItem>
          {(onExportJson || onImportJson) && <DropdownMenuSeparator />}
          {onExportJson && (
            <DropdownMenuItem onSelect={onExportJson}>
              <DownloadSimple /> Экспорт схемы в JSON
            </DropdownMenuItem>
          )}
          {onImportJson && (
            <DropdownMenuItem onSelect={() => importRef.current?.click()}>
              <UploadSimple /> Импорт схемы из JSON
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {onImportJson && (
        <input
          ref={importRef}
          type="file"
          accept=".json,application/json"
          className="sr-only"
          aria-label="Импорт схемы из JSON"
          onChange={event => {
            const file = event.target.files?.[0];
            if (file) onImportJson(file);
            event.target.value = "";
          }}
        />
      )}
    </div>
  );
}
