import { useState } from "react";
import { ActionButton, FormField } from "./control-help";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./components/ui/dialog";
import { Input } from "./components/ui/input";
import type { PersonalDefinition, PersonalNode } from "./live-graph";

export function PersonalNodeEditor({ node, close, preview, save }: {
  node?: PersonalNode;
  close: () => void;
  preview: (expression: string, value: string) => Promise<string>;
  save: (definition: PersonalDefinition) => Promise<void>;
}) {
  const [expression, setExpression] = useState(node?.definition.expression ?? "trim(value)");
  const [sample, setSample] = useState("");
  const [result, setResult] = useState<string>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>) {
    setBusy(true); setError(""); setResult(undefined);
    try { await action(); } catch (error) {
      setError(error instanceof Error ? error.message : "Операция не выполнена");
    } finally { setBusy(false); }
  }

  return <Dialog open onOpenChange={open => { if (!open && !busy) close(); }}>
    <DialogContent>
      <DialogHeader><DialogTitle>{node ? "Новая версия узла" : "Создать личный узел"}</DialogTitle>
        <DialogDescription>Вход и выход узла передают строки таблицы. Выражение преобразует одно текстовое поле.</DialogDescription>
      </DialogHeader>
      <form className="field-stack" onSubmit={event => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        void run(() => save({ name: String(data.get("name")), input_field: String(data.get("input")),
          output_field: String(data.get("output")), expression }));
      }}>
        <FormField label="Название узла" help="Имя в личной библиотеке"><Input name="name" required maxLength={80} defaultValue={node?.definition.name} /></FormField>
        <FormField label="Входное поле" help="Например number для номера договора, date для даты или inn для ИНН">
          <Input name="input" required maxLength={48} pattern="[A-Za-z0-9_\-]+" defaultValue={node?.definition.input_field} />
        </FormField>
        <FormField label="Выходное поле" help="Укажите новый ключ или повторите входной, чтобы заменить значение">
          <Input name="output" required maxLength={48} pattern="[A-Za-z0-9_\-]+" defaultValue={node?.definition.output_field} />
        </FormField>
        <FormField label="Выражение" help="value — входное значение. Можно вложить trim, lower и upper друг в друга">
          <Input className="font-mono" required maxLength={256} value={expression} onChange={event => { setExpression(event.target.value); setResult(undefined); }} />
        </FormField>
        <FormField label="Пробное значение" help="Текст, на котором можно проверить выражение">
          <Input maxLength={2048} value={sample} onChange={event => { setSample(event.target.value); setResult(undefined); }} />
        </FormField>
        {result !== undefined && <output aria-label="Результат выражения">{JSON.stringify(result)}</output>}
        {error && <p role="alert" className="text-destructive">{error}</p>}
        <div className="toolbar">
          <ActionButton type="button" variant="outline" disabled={busy || !expression.trim()} onClick={() => void run(async () => {
            setResult(await preview(expression, sample));
          })}>Проверить выражение</ActionButton>
          <ActionButton type="submit" disabled={busy}>Сохранить версию узла</ActionButton>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}
