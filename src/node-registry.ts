import { Code, type Icon } from "@phosphor-icons/react";
import { branchLabels, builtInSteps, portLabels, type BranchPort, type CatalogItem, type NodeKind, type PortType } from "./graph";
import type { InsertLink, PersonalNode, ScriptNode } from "./live-graph";

export type NodeOrigin = "builtin" | "personal" | "script";

export type BuiltInCategoryId =
  | "cat:input"
  | "cat:parse"
  | "cat:extract"
  | "cat:validate"
  | "cat:logic"
  | "cat:combine"
  | "cat:export";

export type BuiltInCategoryMeta = {
  id: BuiltInCategoryId;
  label: string;
  types: readonly NodeKind[];
};

export const BUILTIN_CATEGORIES: readonly BuiltInCategoryMeta[] = [
  { id: "cat:input", label: "Входные данные", types: ["input"] },
  { id: "cat:parse", label: "Разбор документов", types: ["parse"] },
  { id: "cat:extract", label: "Извлечение данных", types: ["extract", "assemble", "table"] },
  { id: "cat:validate", label: "Проверка и валидация", types: ["validate", "review"] },
  { id: "cat:logic", label: "Логика и ветвление", types: ["branch"] },
  { id: "cat:combine", label: "Объединение данных", types: ["combine"] },
  { id: "cat:export", label: "Экспорт", types: ["export"] },
];

export const BUILTIN_DESCRIPTIONS: Record<string, string> = {
  input: "Принимает выбранные PDF с текстовым слоем и DOCX для передачи на разбор.",
  parse: "Разбирает структуру PDF и DOCX на упорядоченные текстовые блоки с координатами и локаторами.",
  extract: "Извлекает именованные реквизиты и поля по подписям, типам значений и правилам очистки текста.",
  validate: "Сверяет форматы значений, выявляет пропуски и отмечает неоднозначные совпадения.",
  export: "Формирует итоговую таблицу выгрузки в CSV и JSON, задаёт порядок столбцов и поиск дублей.",
  branch: "Направляет строки в ветвь «Годные» или «На проверку» по правилам обязательности, формата и диапазона.",
  review: "Собирает проблемные строки и повторы с причинами и исходными цитатами для ручной проверки.",
  combine: "Объединяет строки таблиц из нескольких ветвей с совпадающими ключами и типами столбцов.",
  assemble: "Собирает отдельные именованные поля типа «Поля записи» из программируемых узлов в единую строку.",
  table: "Связывает извлечённую структурированную таблицу с метаданными документа для проверки и экспорта.",
};

export type NodePortDescriptor = {
  name?: string;
  label: string;
  type: PortType;
};

export type RegistryNodeItem = {
  key: string;
  kind: NodeKind;
  name: string;
  shortDetail: string;
  description: string;
  origin: NodeOrigin;
  originLabel: string;
  categoryId: string;
  categoryLabel: string;
  roleTag?: "Входной узел" | "Выходной узел";
  version?: number;
  Icon: Icon;
  inputs: NodePortDescriptor[];
  outputs: NodePortDescriptor[];
  parameters: string[];
  multipleInputs: boolean;
  personal?: PersonalNode;
  script?: ScriptNode;
};

export function buildNodeRegistry(
  catalog: CatalogItem[],
  personal: PersonalNode[],
  scripts: ScriptNode[],
  canAuthor: boolean,
): RegistryNodeItem[] {
  const byType = new Map(catalog.map(item => [item.type, item]));
  const items: RegistryNodeItem[] = [];

  for (const step of builtInSteps) {
    const spec = byType.get(step.type);
    if (!spec) continue;
    const cat = BUILTIN_CATEGORIES.find(entry => entry.types.includes(step.type)) ?? BUILTIN_CATEGORIES[2];
    const roleTag = !spec.input && spec.output ? "Входной узел" : spec.input && !spec.output ? "Выходной узел" : undefined;
    const inputs: NodePortDescriptor[] = spec.input
      ? [{ label: portLabels[spec.input], type: spec.input }]
      : [];
    const outputs: NodePortDescriptor[] = spec.output
      ? (spec.outputs
          ? spec.outputs.map(port => ({ name: port, label: branchLabels[port], type: spec.output! }))
          : [{ label: portLabels[spec.output], type: spec.output }])
      : [];
    const parameters: string[] =
      step.type === "extract"
        ? ["Поля извлечения", "Подписи поиска", "Типы и очистка"]
        : step.type === "branch"
          ? ["Условия маршрутизации"]
          : step.type === "export"
            ? ["Столбцы выгрузки", "Ключ дублей"]
            : [];

    items.push({
      key: `builtin:${step.type}`,
      kind: step.type,
      name: step.label,
      shortDetail: roleTag ? `${roleTag} · ${step.detail}` : step.detail,
      description: BUILTIN_DESCRIPTIONS[step.type] ?? step.detail,
      origin: "builtin",
      originLabel: "Встроенный",
      categoryId: cat.id,
      categoryLabel: cat.label,
      roleTag,
      Icon: step.Icon,
      inputs,
      outputs,
      parameters,
      multipleInputs: spec.multiple_inputs,
    });
  }

  if (canAuthor) {
    for (const item of personal) {
      items.push({
        key: `personal:${item.node_id}`,
        kind: "personal",
        name: item.definition.name,
        shortDetail: `${item.definition.input_field} → ${item.definition.output_field}`,
        description: `Преобразование текстового поля: ${item.definition.expression}`,
        origin: "personal",
        originLabel: "Личный",
        categoryId: "personal",
        categoryLabel: "Мои узлы",
        version: item.version,
        Icon: Code,
        inputs: [{ label: portLabels.rows, type: "rows" }],
        outputs: [{ label: portLabels.rows, type: "rows" }],
        parameters: [`Вход: ${item.definition.input_field}`, `Выход: ${item.definition.output_field}`, item.definition.expression],
        multipleInputs: false,
        personal: item,
      });
    }

    for (const item of scripts) {
      items.push({
        key: `script:${item.node_id}`,
        kind: "script",
        name: item.definition.name,
        shortDetail: `${item.definition.category} · версия ${item.version}`,
        description: item.definition.description || "Программируемый Starlark-узел для обработки блоков документа.",
        origin: "script",
        originLabel: "Starlark",
        categoryId: `script:${item.definition.category || "Прочие"}`,
        categoryLabel: item.definition.category || "Прочие",
        version: item.version,
        Icon: Code,
        inputs: Object.entries(item.definition.inputs).map(([port, type]) => ({
          name: port,
          label: port,
          type,
        })),
        outputs: Object.entries(item.definition.outputs).map(([port, spec]) => ({
          name: port,
          label: port,
          type: spec.type,
        })),
        parameters: Object.keys(item.definition.parameters),
        multipleInputs: false,
        script: item,
      });
    }
  }

  return items;
}

export type CompatibleChoice = {
  item: RegistryNodeItem;
  port?: string;
  portLabel?: string;
};

export function filterCompatibleChoices(
  items: RegistryNodeItem[],
  link: InsertLink | undefined,
  portKind: PortType | undefined,
  originKind: NodeKind | undefined,
): CompatibleChoice[] {
  if (!link || !portKind) {
    return items.map(item => ({ item }));
  }
  return items.flatMap(item => {
    const ports = link.fromOutput ? item.inputs : item.outputs;
    return ports
      .filter(port => {
        if (port.type !== portKind) return false;
        if (link.fromOutput) {
          const originIsReview = originKind === "branch" && link.handle === "review";
          const targetIsReview = item.kind === "review";
          return originIsReview === targetIsReview;
        }
        const candidateIsReview = item.kind === "branch" && port.name === "review";
        const originIsReviewTarget = originKind === "review";
        return candidateIsReview === originIsReviewTarget;
      })
      .map(port => ({
        item,
        port: port.name,
        portLabel: port.name ? (item.kind === "branch" ? branchLabels[port.name as BranchPort] : port.name) : undefined,
      }));
  });
}

export const PORT_TYPE_LIST: PortType[] = ["document", "text", "rows", "region", "record", "scalar", "table"];
