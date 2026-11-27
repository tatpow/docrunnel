import { cloneElement, useId, type ComponentProps, type ReactElement } from "react";
import { Question } from "@phosphor-icons/react";
import { Button } from "./components/ui/button";
import { Label } from "./components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "./components/ui/tooltip";

export function Tip({ text, children, disabled }: { text: string; children: ReactElement; disabled?: boolean }) {
  return <Tooltip>
    <TooltipTrigger asChild>{disabled ? <span tabIndex={0} className="disabled-help">{children}</span> : children}</TooltipTrigger>
    <TooltipContent sideOffset={6}>{text}</TooltipContent>
  </Tooltip>;
}

export function ActionButton({ hint, ...props }: ComponentProps<typeof Button> & { hint?: string }) {
  if (!hint) return <Button {...props} />;
  return <Tip text={hint} disabled={props.disabled}><Button {...props} /></Tip>;
}

export function FormField({ label, help, className, children }: {
  label: string; help: string; className?: string; children: ReactElement<{ id?: string; "aria-describedby"?: string }>;
}) {
  const generated = useId();
  const id = children.props.id ?? generated;
  return <div className={className ? `form-field ${className}` : "form-field"}>
    <div className="field-heading"><Label htmlFor={id}>{label}</Label>
      <ActionButton type="button" variant="ghost" size="icon-xs" className="field-help" aria-label={`Справка: ${label}`} hint={help}><Question weight="regular" /></ActionButton>
    </div>
    <span id={`${id}-help`} className="sr-only">{help}</span>
    {cloneElement(children, { id, "aria-describedby": `${id}-help` })}
  </div>;
}
