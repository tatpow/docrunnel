import { ArrowDown, ArrowUp, Trash } from "@phosphor-icons/react";
import { ActionButton, FormField } from "./control-help";
import { Input } from "./components/ui/input";
import { NativeSelect, NativeSelectOption } from "./components/ui/native-select";
import { fields, type BranchRule, type ExtractionField } from "./live-graph";

export function BranchSettings({ rules, columns, hasTable = false, change }: {
  rules: BranchRule[]; columns: { id: string; name: string }[]; hasTable?: boolean; change: (rules: BranchRule[]) => void;
}) {
  const update = (index: number, patch: Partial<BranchRule>) =>
    change(rules.map((rule, current) => index === current ? { ...rule, ...patch } : rule));
  return <div className="field-stack">
    <h3>Условия для годных строк</h3>
    {rules.map((rule, index) => {
      const tableRule = rule.kind === "table_required" || rule.kind === "table_complete";
      return <div className="field-stack extraction-field" key={index}>
        {!tableRule && <FormField label="Поле правила" help="Поле во входящей строке"><NativeSelect value={rule.field} onChange={event => update(index, { field: event.target.value })}>
          {!columns.some(column => column.id === rule.field) && <NativeSelectOption value={rule.field}>{rule.field || "Выберите поле"}</NativeSelectOption>}
          {columns.map(column => <NativeSelectOption key={column.id} value={column.id}>{column.name}</NativeSelectOption>)}
        </NativeSelect></FormField>}
        <FormField label="Условие" help="Если условие нарушено, строка уйдёт на ручную проверку"><NativeSelect value={rule.kind}
          onChange={event => {
            const nextKind = event.target.value as BranchRule["kind"];
            const isTable = nextKind === "table_required" || nextKind === "table_complete";
            update(index, { kind: nextKind, field: isTable ? "table" : (columns[0]?.id ?? rule.field), minimum: undefined, maximum: undefined });
          }}>
          <NativeSelectOption value="required">Обязательное значение</NativeSelectOption>
          <NativeSelectOption value="format">Корректный формат и одно значение</NativeSelectOption>
          <NativeSelectOption value="range">Числовой диапазон</NativeSelectOption>
          {(hasTable || tableRule) && <>
            <NativeSelectOption value="table_required">Таблица найдена</NativeSelectOption>
            <NativeSelectOption value="table_complete">Все строки таблицы заполнены</NativeSelectOption>
          </>}
        </NativeSelect></FormField>
        {rule.kind === "range" && <>
          <FormField label="Минимум" help="Включительная граница. Пустое поле оставляет диапазон открытым">
            <Input inputMode="decimal" value={rule.minimum ?? ""} onChange={event => update(index, { minimum: event.target.value.replace(",", ".") || undefined })} />
          </FormField>
          <FormField label="Максимум" help="Включительная граница. Пустое поле оставляет диапазон открытым">
            <Input inputMode="decimal" value={rule.maximum ?? ""} onChange={event => update(index, { maximum: event.target.value.replace(",", ".") || undefined })} />
          </FormField>
        </>}
        <ActionButton variant="ghost" size="sm" onClick={() => change(rules.filter((_, current) => index !== current))}>Удалить условие</ActionButton>
      </div>;
    })}
    <ActionButton variant="outline" size="sm" disabled={(!columns.length && !hasTable) || rules.length >= 20}
      onClick={() => change([...rules, columns.length ? { field: columns[0].id, kind: "required" } : { field: "table", kind: "table_required" }])}>Добавить условие</ActionButton>
  </div>;
}

export function ExtractionSettings({ value, change }: { value: ExtractionField[]; change: (fields: ExtractionField[]) => void }) {
  function update(index: number, patch: Partial<ExtractionField>) {
    change(value.map((field, current) => current === index ? { ...field, ...patch } : field));
  }

  return <div className="field-stack">
    {value.map((field, index) => {
      const title = field.name || fields.find(item => item.id === field.id)?.name || field.id || "Новое поле";
      return <div key={index} className="extraction-field">
        <FormField label={title} help={`Какие подписи искать для поля «${title}». Разделяйте варианты запятыми`}>
          <Input value={field.labelDraft ?? field.labels.join(", ")} onChange={event => update(index, { labelDraft: event.target.value })} />
        </FormField>
        <details>
          <summary>Настройки поля «{title}»</summary>
          <div className="field-stack">
            <FormField label="Имя столбца" help="Отображаемое название в результатах">
              <Input maxLength={80} value={field.name ?? ""} placeholder={title} onChange={event => update(index, { name: event.target.value })} />
            </FormField>
            <FormField label="Ключ поля" help="Используется в CSV, JSON и настройках других узлов. Разрешены латинские буквы, цифры, дефис и подчёркивание">
              <Input maxLength={48} value={field.id} onChange={event => update(index, { id: event.target.value })} />
            </FormField>
            <FormField label="Тип значения" help="Определяет проверку и нормализацию найденного значения">
              <NativeSelect value={field.type} onChange={event => update(index, { type: event.target.value as ExtractionField["type"] })}>
                <NativeSelectOption value="text">Текст</NativeSelectOption><NativeSelectOption value="number">Номер или код</NativeSelectOption>
                <NativeSelectOption value="date">Дата</NativeSelectOption><NativeSelectOption value="money">Сумма</NativeSelectOption>
                <NativeSelectOption value="inn">ИНН</NativeSelectOption>
              </NativeSelect>
            </FormField>
            <FormField label="Источник значения" help="Подпись может стоять в одной строке со значением или в соседней ячейке DOCX">
              <NativeSelect value={field.source_mode ?? "any"} onChange={event => update(index, { source_mode: event.target.value as ExtractionField["source_mode"] })}>
                <NativeSelectOption value="any">Строка или таблица</NativeSelectOption><NativeSelectOption value="inline">После подписи в строке</NativeSelectOption>
                <NativeSelectOption value="table">В соседней ячейке DOCX</NativeSelectOption>
              </NativeSelect>
            </FormField>
            {field.type === "text" && <FormField label="Очистка текста" help="Меняет извлечённое значение с сохранением исходной цитаты">
              <NativeSelect value={field.cleanup ?? "collapse"} onChange={event => update(index, { cleanup: event.target.value as ExtractionField["cleanup"] })}>
                <NativeSelectOption value="collapse">Сжать пробелы</NativeSelectOption><NativeSelectOption value="trim">Пробелы только по краям</NativeSelectOption>
                <NativeSelectOption value="lower">Сжать пробелы и понизить регистр</NativeSelectOption>
                <NativeSelectOption value="upper">Сжать пробелы и повысить регистр</NativeSelectOption>
              </NativeSelect>
            </FormField>}
            <ActionButton variant="ghost" size="sm" disabled={value.length <= 1} onClick={() => change(value.filter((_, current) => index !== current))}>
              <Trash size={16} />Удалить поле
            </ActionButton>
          </div>
        </details>
      </div>;
    })}
    <ActionButton variant="outline" size="sm" disabled={value.length >= 20} onClick={() => {
      let suffix = 1;
      while (value.some(field => field.id === `field_${suffix}`)) suffix++;
      change([...value, { id: `field_${suffix}`, name: "Новое поле", type: "text", labels: [] }]);
    }}>Добавить поле</ActionButton>
  </div>;
}

export function ColumnSettings({ available, selected, change, title = "Столбцы выгрузки", emptyText = "Подключите источник строк к экспорту." }: {
  available: { id: string; name: string }[]; selected?: string[]; change: (columns?: string[]) => void; title?: string; emptyText?: string;
}) {
  const columns = selected ?? available.map(field => field.id);
  const [included, excluded] = [
    columns.map(id => available.find(field => field.id === id) ?? { id, name: `${id} (нет на входе)` }),
    available.filter(field => !columns.includes(field.id)),
  ];
  function move(index: number, delta: number) {
    const next = [...columns];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    change(next);
  }
  return <div className="field-stack">
    <h3>{title}</h3>
    {!included.length && <p className="muted">{emptyText}</p>}
    <ol className="export-columns">{included.map(({ id, name }, index) => <li key={id}>
      <span title={id}>{name}</span>
      <ActionButton size="icon-xs" variant="ghost" disabled={!index} aria-label={`Поднять «${name}»`} onClick={() => move(index, -1)}><ArrowUp /></ActionButton>
      <ActionButton size="icon-xs" variant="ghost" disabled={index === columns.length - 1} aria-label={`Опустить «${name}»`} onClick={() => move(index, 1)}><ArrowDown /></ActionButton>
      <ActionButton size="icon-xs" variant="ghost" disabled={columns.length <= 1} aria-label={`Исключить «${name}»`} onClick={() => change(columns.filter(column => column !== id))}><Trash /></ActionButton>
    </li>)}</ol>
    {excluded.length > 0 && <FormField label="Вернуть столбец" help="Возвращает столбец в конец списка">
      <NativeSelect value="" onChange={event => change([...columns, event.target.value])}>
        <NativeSelectOption value="" disabled>Выберите столбец</NativeSelectOption>
        {excluded.map(field => <NativeSelectOption key={field.id} value={field.id}>{field.name}</NativeSelectOption>)}
      </NativeSelect>
    </FormField>}
    {selected && <ActionButton size="sm" variant="outline" onClick={() => change(undefined)}>Все столбцы по умолчанию</ActionButton>}
  </div>;
}
