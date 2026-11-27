import { useState } from "react";
import { ActionButton, FormField } from "./control-help";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./components/ui/dialog";
import { Input } from "./components/ui/input";
import type { ScriptDefinition, ScriptNode } from "./live-graph";

export function ScriptNodeEditor({ node, close, save }: {
  node?: ScriptNode; close: () => void; save: (definition: ScriptDefinition) => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const definition = node?.definition;
  return <Dialog open onOpenChange={open => { if (!open && !busy) close(); }}>
    <DialogContent className="script-dialog">
      <DialogHeader><DialogTitle>{node ? "Новая версия Starlark-узла" : "Создать Starlark-узел"}</DialogTitle>
        <DialogDescription>Объявите порты и параметры в JSON. Для проверки добавьте узел в граф и откройте предпросмотр на документе.</DialogDescription></DialogHeader>
      <form className="field-stack" onSubmit={async event => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setError("");
        let config;
        try { config = JSON.parse(String(form.get("contract"))); }
        catch { setError("Проверьте синтаксис JSON в контракте"); return; }
        setBusy(true);
        try {
          await save({ name: String(form.get("name")), description: String(form.get("description")),
            category: String(form.get("category")), inputs: config?.inputs, outputs: config?.outputs,
            parameters: config?.parameters, code: String(form.get("code")) });
        } catch (error) { setError(error instanceof Error ? error.message : "Не удалось сохранить узел"); }
        finally { setBusy(false); }
      }}>
        <FormField label="Название узла" help="Название в каталоге и на карточке графа"><Input name="name" maxLength={80} required defaultValue={definition?.name} /></FormField>
        <FormField label="Категория" help="Раздел личного каталога"><Input name="category" maxLength={80} required defaultValue={definition?.category ?? "Документы"} /></FormField>
        <FormField label="Описание" help="Кратко опишите, какие данные получает и возвращает узел"><Input name="description" maxLength={300} defaultValue={definition?.description} /></FormField>
        <FormField label="Контракт JSON" help="Входы text, region, scalar или table. Выходы region, record, scalar или table. Для record укажите fields, для table — columns">
          <textarea className="script-code" name="contract" rows={8} spellCheck={false} required defaultValue={JSON.stringify({
            inputs: definition?.inputs ?? { document: "text" }, outputs: definition?.outputs ?? { region: { type: "region" } },
            parameters: definition?.parameters ?? { boundary: "" },
          }, null, 2)} />
        </FormField>
        <FormField label="Код Starlark" help="Функция process получает inputs и params и возвращает outputs и diagnostics">
          <textarea className="script-code" name="code" rows={9} spellCheck={false} required maxLength={32768}
            defaultValue={definition?.code ?? 'def process(inputs, params):\n    return {"outputs": {"region": []}, "diagnostics": []}'} />
        </FormField>
        {error && <p role="alert" className="text-destructive">{error}</p>}
        <ActionButton type="submit" disabled={busy}>Сохранить версию Starlark-узла</ActionButton>
      </form>
    </DialogContent>
  </Dialog>;
}
