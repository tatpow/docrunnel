import type { Graph, SchemaNode } from "./live-graph";
import { contractFields, fields } from "./live-graph";

export type TemplateCategoryId =
  | "all"
  | "contracts"
  | "extraction"
  | "validation"
  | "published";

export type WorkflowTemplate = {
  id: string;
  name: string;
  description: string;
  category: Exclude<TemplateCategoryId, "all">;
  categoryLabel: string;
  formats: string;
  outputType: string;
  nodeCount: number;
  requirements: string[];
  /** Built-in static graph generator OR remote version_id for published workflows */
  buildGraph?: () => Graph;
  publishedVersionId?: string;
  /** Preview topology for SVG mini-graph thumbnail */
  previewNodes: { id: string; label: string; x: number; y: number; port?: "document" | "text" | "rows" | "region" | "record" | "scalar" }[];
  previewEdges: [string, string][];
};

export const TEMPLATE_CATEGORIES: { id: TemplateCategoryId; label: string }[] = [
  { id: "all", label: "Все шаблоны" },
  { id: "contracts", label: "Договоры" },
  { id: "extraction", label: "Извлечение реквизитов" },
  { id: "validation", label: "Проверка документов" },
  { id: "published", label: "Опубликованные схемы" },
];

function contractGraph(): Graph {
  const nodes: SchemaNode[] = [
    { id: "input", type: "input", position: { x: 40, y: 120 } },
    { id: "parse", type: "parse", position: { x: 250, y: 120 } },
    { id: "extract", type: "extract", position: { x: 460, y: 120 }, fields: contractFields() },
    { id: "validate", type: "validate", position: { x: 680, y: 120 } },
    { id: "export", type: "export", position: { x: 890, y: 120 }, field_order: fields.map(f => f.id) },
  ];
  return {
    format_version: 2,
    nodes,
    edges: [
      ["input", "parse"],
      ["parse", "extract"],
      ["extract", "validate"],
      ["validate", "export"],
    ],
  };
}

function branchReviewGraph(): Graph {
  const nodes: SchemaNode[] = [
    { id: "input", type: "input", position: { x: 40, y: 130 } },
    { id: "parse", type: "parse", position: { x: 240, y: 130 } },
    { id: "extract", type: "extract", position: { x: 440, y: 130 }, fields: contractFields() },
    {
      id: "branch",
      type: "branch",
      position: { x: 660, y: 130 },
      rules: [
        { field: "inn", kind: "required" },
        { field: "amount", kind: "format" },
      ],
    },
    { id: "export", type: "export", position: { x: 900, y: 50 }, field_order: fields.map(f => f.id) },
    { id: "review", type: "review", position: { x: 900, y: 220 } },
  ];
  return {
    format_version: 2,
    nodes,
    edges: [
      ["input", "parse"],
      ["parse", "extract"],
      ["extract", "branch"],
      ["branch", "export", "pass"],
      ["branch", "review", "review"],
    ],
  };
}

function multiTemplateCombineGraph(): Graph {
  const nodes: SchemaNode[] = [
    { id: "input", type: "input", position: { x: 30, y: 140 } },
    { id: "parse", type: "parse", position: { x: 220, y: 140 } },
    { id: "extract", type: "extract", position: { x: 430, y: 50 }, fields: contractFields() },
    {
      id: "extract-2",
      type: "extract",
      position: { x: 430, y: 230 },
      fields: [
        { id: "number", type: "number", name: "Номер договора", labels: ["№ договора", "Контракт №"] },
        { id: "date", type: "date", name: "Дата", labels: ["от", "Дата составления"] },
        { id: "amount", type: "money", name: "Сумма", labels: ["Цена договора", "Стоимость"] },
        { id: "inn", type: "inn", name: "ИНН", labels: ["ИНН исполнителя", "ИНН"] },
      ],
    },
    { id: "combine", type: "combine", position: { x: 660, y: 140 } },
    { id: "validate", type: "validate", position: { x: 860, y: 140 } },
    { id: "export", type: "export", position: { x: 1060, y: 140 }, field_order: fields.map(f => f.id) },
  ];
  return {
    format_version: 2,
    nodes,
    edges: [
      ["input", "parse"],
      ["parse", "extract"],
      ["parse", "extract-2"],
      ["extract", "combine"],
      ["extract-2", "combine"],
      ["combine", "validate"],
      ["validate", "export"],
    ],
  };
}

export const BUILTIN_TEMPLATES: WorkflowTemplate[] = [
  {
    id: "builtin-contract",
    name: "Типовой шаблон договора",
    description: "Базовый конвейер извлечения номера договора, даты, суммы и ИНН с проверкой форматов и выгрузкой в CSV/JSON.",
    category: "contracts",
    categoryLabel: "Договоры",
    formats: "PDF и DOCX",
    outputType: "Таблица реквизитов (CSV, JSON)",
    nodeCount: 5,
    requirements: ["PDF с текстовым слоем или DOCX", "Встроенные узлы (без пользовательских расширений)"],
    buildGraph: contractGraph,
    previewNodes: [
      { id: "i", label: "Док", x: 14, y: 42, port: "document" },
      { id: "p", label: "Разб", x: 62, y: 42, port: "text" },
      { id: "e", label: "Извл", x: 110, y: 42, port: "rows" },
      { id: "v", label: "Пров", x: 158, y: 42, port: "rows" },
      { id: "x", label: "Эксп", x: 206, y: 42, port: "rows" },
    ],
    previewEdges: [["i", "p"], ["p", "e"], ["e", "v"], ["v", "x"]],
  },
  {
    id: "builtin-branch-review",
    name: "Контроль качества с ручной проверкой",
    description: "Разделяет обработанные договоры на годные для выгрузки и требующие ручной проверки при отсутствии ИНН или некорректной сумме.",
    category: "validation",
    categoryLabel: "Проверка документов",
    formats: "PDF и DOCX",
    outputType: "Экспорт + таблица ручной проверки",
    nodeCount: 6,
    requirements: ["PDF с текстовым слоем или DOCX", "Настраиваемые правила в узле «Ветвление»"],
    buildGraph: branchReviewGraph,
    previewNodes: [
      { id: "i", label: "Док", x: 14, y: 42, port: "document" },
      { id: "p", label: "Разб", x: 60, y: 42, port: "text" },
      { id: "e", label: "Извл", x: 106, y: 42, port: "rows" },
      { id: "b", label: "Ветв", x: 152, y: 42, port: "rows" },
      { id: "x", label: "Эксп", x: 204, y: 20, port: "rows" },
      { id: "r", label: "Пров", x: 204, y: 64, port: "rows" },
    ],
    previewEdges: [["i", "p"], ["p", "e"], ["e", "b"], ["b", "x"], ["b", "r"]],
  },
  {
    id: "builtin-combine-extract",
    name: "Объединение двух правил извлечения",
    description: "Параллельно ищет реквизиты по двум наборам подписей для разных шаблонов договоров и объединяет строки в общую схему.",
    category: "extraction",
    categoryLabel: "Извлечение реквизитов",
    formats: "PDF и DOCX",
    outputType: "Сводная таблица реквизитов",
    nodeCount: 7,
    requirements: ["PDF с текстовым слоем или DOCX", "Одинаковые ключи и типы полей в обеих ветвях"],
    buildGraph: multiTemplateCombineGraph,
    previewNodes: [
      { id: "i", label: "Док", x: 10, y: 42, port: "document" },
      { id: "p", label: "Разб", x: 52, y: 42, port: "text" },
      { id: "e1", label: "Извл 1", x: 96, y: 20, port: "rows" },
      { id: "e2", label: "Извл 2", x: 96, y: 64, port: "rows" },
      { id: "c", label: "Объед", x: 142, y: 42, port: "rows" },
      { id: "v", label: "Пров", x: 182, y: 42, port: "rows" },
      { id: "x", label: "Эксп", x: 218, y: 42, port: "rows" },
    ],
    previewEdges: [["i", "p"], ["p", "e1"], ["p", "e2"], ["e1", "c"], ["e2", "c"], ["c", "v"], ["v", "x"]],
  },
];

export function buildTemplateList(
  publishedWorkflows: { id: string; version_id: string; version?: number; name: string; published?: boolean; draft?: boolean }[],
): WorkflowTemplate[] {
  const published = publishedWorkflows
    .filter(item => item.published && !item.draft)
    .map<WorkflowTemplate>(item => ({
      id: `published-${item.version_id}`,
      name: item.name,
      description: `Опубликованная общая схема организации (версия ${item.version ?? 1}). Создаст независимую копию для редактирования.`,
      category: "published",
      categoryLabel: "Опубликованные схемы",
      formats: "PDF и DOCX",
      outputType: "По схеме организации",
      nodeCount: 0,
      requirements: ["Опубликованная версия схемы", "Не изменяет исходную общую схему"],
      publishedVersionId: item.version_id,
      previewNodes: [
        { id: "a", label: "Вход", x: 22, y: 42, port: "document" },
        { id: "b", label: "Граф", x: 112, y: 42, port: "text" },
        { id: "c", label: "Выход", x: 202, y: 42, port: "rows" },
      ],
      previewEdges: [["a", "b"], ["b", "c"]],
    }));
  return [...BUILTIN_TEMPLATES, ...published];
}
