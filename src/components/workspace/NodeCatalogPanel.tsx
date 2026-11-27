import { useMemo, useState, type ReactNode } from "react";
import { CaretDown, ClockCounterClockwise, Folder, Info, MagnifyingGlass, PencilSimple, Plus, Star, X } from "@phosphor-icons/react";
import { ActionButton } from "../../control-help";
import { portLabels, type NodeKind } from "../../graph";
import type { PersonalNode, ScriptNode } from "../../live-graph";
import { BUILTIN_CATEGORIES, type RegistryNodeItem } from "../../node-registry";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { Input } from "../ui/input";

function TreeGroup({
  label,
  count,
  search,
  hidden,
  open,
  onOpenChange,
  nested = false,
  children,
}: {
  label: string;
  count?: number;
  search: string;
  hidden?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nested?: boolean;
  children: ReactNode;
}) {
  const [closedSearch, setClosedSearch] = useState("");
  const isOpen = search ? closedSearch !== search : open;

  return (
    <Collapsible
      className={nested ? "catalog-tree-subgroup" : "node-library-group"}
      hidden={hidden}
      open={isOpen}
      onOpenChange={next => (search ? setClosedSearch(next ? "" : search) : onOpenChange(next))}
    >
      <div className="catalog-tree-heading">
        <CollapsibleTrigger asChild>
          <button type="button" className={nested ? "catalog-sub-trigger" : "node-library-trigger"}>
            <span className="catalog-trigger-left">
              {nested && <Folder size={13} aria-hidden="true" />}
              <span>{label}</span>
              {count !== undefined && <span className="catalog-count">{count}</span>}
            </span>
            <CaretDown size={13} aria-hidden="true" />
          </button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent className="node-library-group-content">{children}</CollapsibleContent>
    </Collapsible>
  );
}

export function NodeCatalogPanel({
  registry,
  canAuthor,
  busy,
  nodeCount,
  catalogLoaded,
  favoriteNodes,
  recentNodes,
  expandedCategories,
  onSetCategoryOpen,
  onToggleFavorite,
  onAddNode,
  onDragStartNode,
  onDragEndNode,
  onCreatePersonal,
  onEditPersonal,
  onCreateScript,
  onEditScript,
  onClose,
}: {
  registry: RegistryNodeItem[];
  canAuthor: boolean;
  busy: boolean;
  nodeCount: number;
  catalogLoaded: boolean;
  favoriteNodes: string[];
  recentNodes: string[];
  expandedCategories: Record<string, boolean>;
  onSetCategoryOpen: (id: string, open: boolean) => void;
  onToggleFavorite: (key: string) => void;
  onAddNode: (item: RegistryNodeItem) => void;
  onDragStartNode: (kind: NodeKind, personal?: PersonalNode, script?: ScriptNode) => void;
  onDragEndNode: () => void;
  onCreatePersonal: () => void;
  onEditPersonal: (node: PersonalNode) => void;
  onCreateScript: () => void;
  onEditScript: (node: ScriptNode) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [hovered, setHovered] = useState<RegistryNodeItem | null>(null);
  const searchTerm = search.trim().toLocaleLowerCase("ru");
  const atLimit = nodeCount >= 24;

  const filtered = useMemo(() => {
    if (!searchTerm) return registry;
    return registry.filter(item =>
      `${item.name} ${item.shortDetail} ${item.description} ${item.categoryLabel} ${item.originLabel}`
        .toLocaleLowerCase("ru")
        .includes(searchTerm),
    );
  }, [registry, searchTerm]);

  const builtInItems = filtered.filter(item => item.origin === "builtin");
  const personalItems = filtered.filter(item => item.origin === "personal");
  const scriptItems = filtered.filter(item => item.origin === "script");

  const favoriteItems = useMemo(
    () => favoriteNodes.map(key => registry.find(item => item.key === key)).filter((v): v is RegistryNodeItem => Boolean(v)),
    [favoriteNodes, registry],
  );
  const recentItems = useMemo(
    () => recentNodes.map(key => registry.find(item => item.key === key)).filter((v): v is RegistryNodeItem => Boolean(v)),
    [recentNodes, registry],
  );

  const builtInByCategory = useMemo(() => {
    return BUILTIN_CATEGORIES
      .map(cat => ({
        ...cat,
        items: builtInItems.filter(item => item.categoryId === cat.id),
      }))
      .filter(cat => cat.items.length > 0);
  }, [builtInItems]);

  const scriptByCategory = useMemo(() => {
    const map = new Map<string, RegistryNodeItem[]>();
    for (const item of scriptItems) {
      const cat = item.categoryLabel || "Прочие";
      const list = map.get(cat) ?? [];
      list.push(item);
      map.set(cat, list);
    }
    return Array.from(map.entries());
  }, [scriptItems]);

  function renderNodeRow(item: RegistryNodeItem, compact = false) {
    const Icon = item.Icon;
    const isFav = favoriteNodes.includes(item.key);
    const ariaName = item.origin === "builtin"
      ? `Добавить узел «${item.name}»`
      : item.origin === "script"
        ? `${item.name} ${item.shortDetail}`
        : item.name;
    return (
      <li key={item.key} className="catalog-node-row">
        <button
          type="button"
          className="node-library-item"
          disabled={busy || atLimit}
          aria-label={ariaName}
          title={`${item.name} — ${item.description}`}
          draggable={!busy && !atLimit}
          onDragStart={event => {
            onDragStartNode(item.kind, item.personal, item.script);
            event.dataTransfer.setData("application/docrunnel-node", item.kind);
            event.dataTransfer.effectAllowed = "copy";
          }}
          onDragEnd={onDragEndNode}
          onClick={() => onAddNode(item)}
        >
          <Icon size={15} className="catalog-node-icon" aria-hidden="true" />
          <span className="catalog-node-text">
            <strong>{item.name}</strong>
            {!compact && <small>{item.shortDetail}</small>}
          </span>
          <span className="catalog-node-ports" aria-hidden="true">
            {item.inputs.slice(0, 2).map((port, idx) => (
              <span key={`i-${idx}`} className="port-dot" data-port={port.type} />
            ))}
            {item.outputs.slice(0, 2).map((port, idx) => (
              <span key={`o-${idx}`} className="port-dot" data-port={port.type} />
            ))}
          </span>
        </button>
        <div className="catalog-row-actions">
          <button type="button" className="catalog-row-action-btn" aria-label={`Информация об узле «${item.name}»`}
            aria-pressed={hovered?.key === item.key} onClick={() => setHovered(current => current?.key === item.key ? null : item)}>
            <Info size={13} />
          </button>
          {item.personal && (
            <ActionButton
              type="button"
              variant="ghost"
              size="icon-xs"
              className="catalog-row-action-btn"
              aria-label={`Изменить узел «${item.name}»`}
              hint="Изменить личный узел"
              onClick={() => onEditPersonal(item.personal!)}
            >
              <PencilSimple size={13} />
            </ActionButton>
          )}
          {item.script && (
            <ActionButton
              type="button"
              variant="ghost"
              size="icon-xs"
              className="catalog-row-action-btn"
              aria-label={`Изменить код «${item.name}»`}
              hint="Изменить код Starlark-узла"
              onClick={() => onEditScript(item.script!)}
            >
              <PencilSimple size={13} />
            </ActionButton>
          )}
          <button
            type="button"
            className="catalog-star-btn"
            data-active={isFav}
            aria-label={isFav ? `Убрать «${item.name}» из избранного` : `Добавить «${item.name}» в избранное`}
            aria-pressed={isFav}
            onClick={() => onToggleFavorite(item.key)}
          >
            <Star size={13} weight={isFav ? "fill" : "regular"} aria-hidden="true" />
          </button>
        </div>
      </li>
    );
  }

  return (
    <section aria-label="Каталог узлов" className="context-panel node-library">
      <div className="context-panel-header">
        <h2>Узлы</h2>
        <ActionButton variant="ghost" size="icon-xs" aria-label="Закрыть каталог" onClick={onClose}>
          <X size={15} />
        </ActionButton>
      </div>

      <div className="catalog-search-box">
        <MagnifyingGlass size={14} className="catalog-search-icon" aria-hidden="true" />
        <Input
          type="search"
          aria-label="Поиск узлов"
          placeholder="Поиск узлов…"
          value={search}
          onChange={event => setSearch(event.target.value)}
        />
      </div>

      <div className="node-library-list">
        {!searchTerm && favoriteItems.length > 0 && (
          <TreeGroup
            label="Избранное"
            count={favoriteItems.length}
            search=""
            open={expandedCategories["fav"] ?? false}
            onOpenChange={open => onSetCategoryOpen("fav", open)}
          >
            <ul className="catalog-items-list">{favoriteItems.map(item => renderNodeRow(item, true))}</ul>
          </TreeGroup>
        )}

        {!searchTerm && recentItems.length > 0 && (
          <TreeGroup
            label="Недавние"
            count={recentItems.length}
            search=""
            open={expandedCategories["recent"] ?? false}
            onOpenChange={open => onSetCategoryOpen("recent", open)}
          >
            <ul className="catalog-items-list">{recentItems.map(item => renderNodeRow(item, true))}</ul>
          </TreeGroup>
        )}

        <TreeGroup
          label="Встроенные"
          count={builtInItems.length}
          search={searchTerm}
          hidden={Boolean(searchTerm && !builtInItems.length)}
          open={expandedCategories["builtin"] ?? false}
          onOpenChange={open => onSetCategoryOpen("builtin", open)}
        >
          {builtInByCategory.map(cat => (
            <TreeGroup
              key={cat.id}
              nested
              label={cat.label}
              count={cat.items.length}
              search={searchTerm}
              open={expandedCategories[cat.id] ?? false}
              onOpenChange={open => onSetCategoryOpen(cat.id, open)}
            >
              <ul className="catalog-items-list">{cat.items.map(item => renderNodeRow(item))}</ul>
            </TreeGroup>
          ))}
        </TreeGroup>

        {canAuthor && (
          <TreeGroup
            label="Мои узлы"
            count={personalItems.length}
            search={searchTerm}
            hidden={Boolean(searchTerm && !personalItems.length)}
            open={expandedCategories["personal"] ?? false}
            onOpenChange={open => onSetCategoryOpen("personal", open)}
          >
            <ul className="catalog-items-list">{personalItems.map(item => renderNodeRow(item))}</ul>
            {!searchTerm && (
              <ActionButton variant="outline" size="xs" className="node-library-create" onClick={onCreatePersonal}>
                <Plus size={13} /> Создать личный узел
              </ActionButton>
            )}
          </TreeGroup>
        )}

        {canAuthor && (
          <TreeGroup
            label="Программируемые"
            count={scriptItems.length}
            search={searchTerm}
            hidden={Boolean(searchTerm && !scriptItems.length)}
            open={expandedCategories["script"] ?? false}
            onOpenChange={open => onSetCategoryOpen("script", open)}
          >
            {scriptByCategory.length <= 1 ? (
              <ul className="catalog-items-list">{scriptItems.map(item => renderNodeRow(item))}</ul>
            ) : (
              scriptByCategory.map(([catName, catItems]) => (
                <TreeGroup
                  key={`script:${catName}`}
                  nested
                  label={catName}
                  count={catItems.length}
                  search={searchTerm}
                  open={expandedCategories[`script:${catName}`] ?? false}
                  onOpenChange={open => onSetCategoryOpen(`script:${catName}`, open)}
                >
                  <ul className="catalog-items-list">{catItems.map(item => renderNodeRow(item))}</ul>
                </TreeGroup>
              ))
            )}
            {!searchTerm && (
              <ActionButton variant="outline" size="xs" className="node-library-create" onClick={onCreateScript}>
                <Plus size={13} /> Создать Starlark-узел
              </ActionButton>
            )}
          </TreeGroup>
        )}

        {searchTerm && !filtered.length && <p className="muted catalog-empty-note" role="status">Узлы не найдены</p>}
        {!searchTerm && !catalogLoaded && <p className="muted catalog-empty-note">Каталог пока недоступен</p>}
        {atLimit && <p className="muted catalog-empty-note">В схеме может быть до 24 узлов</p>}
      </div>

      {hovered && (
        <div className="catalog-preview-footer" aria-live="polite">
          <div className="catalog-preview-head">
            <strong>{hovered.name}</strong>
            <span className="catalog-preview-badge">{hovered.originLabel}</span>
          </div>
          <p className="catalog-preview-desc">{hovered.description}</p>
          <div className="catalog-preview-ports">
            {hovered.inputs.length > 0 && (
              <span>
                Вход: {hovered.inputs.map(p => p.name ? `${p.name} (${portLabels[p.type]})` : portLabels[p.type]).join(", ")}
              </span>
            )}
            {hovered.outputs.length > 0 && (
              <span>
                Выход: {hovered.outputs.map(p => p.name ? `${p.name} (${portLabels[p.type]})` : portLabels[p.type]).join(", ")}
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
