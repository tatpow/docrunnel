import { useEffect, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { CaretUpDown, ClockCounterClockwise, Files, FolderOpen, Plugs, ShieldCheck, UserCircle, LockKey, Moon, SignOut, Sun } from "@phosphor-icons/react";
import { Badge } from "./components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./components/ui/dropdown-menu";
import { Separator } from "./components/ui/separator";
import { ActionButton, FormField } from "./control-help";
import { Input } from "./components/ui/input";
import type { LeftPanelId } from "./workspace-state";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider,
  SidebarTrigger, useSidebar,
} from "./components/ui/sidebar";

const workspaceLinks = [
  ["documents", "Документы", Files], ["nodes", "Узлы", Plugs],
  ["schemes", "Схемы", FolderOpen], ["runs", "Запуски", ClockCounterClockwise],
] as const;
export type WorkspaceSection = typeof workspaceLinks[number][0];

type ShellProps = {
  admin: boolean;
  canAdmin: boolean;
  changeView: (admin: boolean) => void;
  account?: string;
  demo?: boolean;
  leftPanel?: LeftPanelId;
  resultsOpen?: boolean;
  topBarContent?: ReactNode;
  onSection?: (section: WorkspaceSection) => void;
  signOut?: () => void;
  changePassword?: (current: string, password: string) => Promise<void>;
  children: ReactNode;
};

const themeEvent = "docrunnel-theme-change";
function subscribeTheme(change: () => void) {
  window.addEventListener(themeEvent, change);
  return () => window.removeEventListener(themeEvent, change);
}

export function ThemeButton() {
  const dark = useSyncExternalStore(subscribeTheme, () => localStorage.getItem("docrunnel-theme") === "dark");
  useEffect(() => { document.documentElement.classList.toggle("dark", dark); }, [dark]);
  const next = dark ? "Светлая тема" : "Тёмная тема";
  return <ActionButton type="button" variant="ghost" size="icon" aria-label={next} onClick={() => {
    localStorage.setItem("docrunnel-theme", dark ? "light" : "dark");
    window.dispatchEvent(new Event(themeEvent));
  }}>
    {dark ? <Sun /> : <Moon />}
  </ActionButton>;
}

function PasswordDialog({ open, onOpenChange, name, changePassword }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  changePassword: (current: string, password: string) => Promise<void>;
}) {
  const [passwordStatus, setPasswordStatus] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setPasswordError(""); setPasswordStatus(""); }
  }, [open]);

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent showCloseButton={false}><DialogHeader><DialogTitle>Смена пароля</DialogTitle>
      <DialogDescription>{name}</DialogDescription></DialogHeader>
      <form className="field-stack" onSubmit={async event => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        setPasswordError(""); setPasswordStatus("");
        if (data.get("password") !== data.get("repeat")) { setPasswordError("Пароли не совпадают"); return; }
        setSaving(true);
        try { await changePassword(String(data.get("current")), String(data.get("password"))); form.reset(); setPasswordStatus("Пароль изменён"); }
        catch (error) { setPasswordError(error instanceof Error ? error.message : "Не удалось изменить пароль"); }
        finally { setSaving(false); }
      }}>
        <FormField label="Текущий пароль" help="Пароль, с которым вы вошли в DocRunnel"><Input name="current" required type="password" autoComplete="current-password" maxLength={256} /></FormField>
        <FormField label="Новый пароль" help="Минимум 12 символов"><Input name="password" required type="password" autoComplete="new-password" minLength={12} maxLength={256} /></FormField>
        <FormField label="Повторите новый пароль" help="Введите тот же новый пароль ещё раз"><Input name="repeat" required type="password" autoComplete="new-password" minLength={12} maxLength={256} /></FormField>
        {passwordError && <p role="alert" className="text-destructive">{passwordError}</p>}
        {passwordStatus && <p role="status">{passwordStatus}</p>}
        <ActionButton type="submit" disabled={saving}>Изменить пароль</ActionButton>
      </form>
      <ActionButton variant="outline" onClick={() => onOpenChange(false)}>Готово</ActionButton>
    </DialogContent>
  </Dialog>;
}

function WorkspaceSidebar({ admin, canAdmin, changeView, signOut, account, changePassword, leftPanel, resultsOpen = false, onSection }: Omit<ShellProps, "children">) {
  const { setOpenMobile } = useSidebar();
  const [passwordOpen, setPasswordOpen] = useState(false);
  const name = account ?? "Демо-пользователь";
  function navigate(next: boolean) {
    changeView(next);
    setOpenMobile(false);
  }
  return <Sidebar side="left" collapsible={onSection ? "icon" : "offcanvas"}>
    {!onSection && <SidebarHeader><div className="brand"><img src={`${import.meta.env.BASE_URL}brand.png`} alt="DocRunnel" /></div></SidebarHeader>}
    <SidebarContent>
      <SidebarGroup>
        <SidebarGroupLabel>DocRunnel</SidebarGroupLabel>
        <SidebarGroupContent>
          <nav aria-label="Навигация">
            <SidebarMenu>
              {onSection ? workspaceLinks.map(([id, label, Icon]) => {
                const active = !admin && (id === "runs" ? resultsOpen : id === leftPanel);
                return <SidebarMenuItem key={id}>
                  <SidebarMenuButton isActive={active} aria-label={label} aria-pressed={active} title={id === "nodes" ? "Каталог узлов" : label}
                    onClick={() => { navigate(false); onSection(id); }}><Icon weight={active ? "fill" : "regular"} aria-hidden="true" /><span>{id === "nodes" ? "Каталог узлов" : label}</span></SidebarMenuButton>
                </SidebarMenuItem>;
              }) : <SidebarMenuItem><SidebarMenuButton isActive={!admin} aria-current={!admin ? "page" : undefined} aria-label="Рабочее место"
                onClick={() => navigate(false)}><span>Рабочее место</span></SidebarMenuButton></SidebarMenuItem>}
              {canAdmin && <SidebarMenuItem><SidebarMenuButton isActive={admin} aria-current={admin ? "page" : undefined} aria-label="Админ-панель"
                onClick={() => navigate(true)}>{onSection && <ShieldCheck weight={admin ? "fill" : "regular"} aria-hidden="true" />}<span>Админ-панель</span></SidebarMenuButton></SidebarMenuItem>}
            </SidebarMenu>
          </nav>
        </SidebarGroupContent>
      </SidebarGroup>
    </SidebarContent>
    <SidebarFooter>{signOut || changePassword ? <SidebarMenu><SidebarMenuItem><DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton size="lg" className="account-tile" aria-label="Меню аккаунта">{onSection && <UserCircle aria-hidden="true" />}<span>{name}</span><CaretUpDown className="ml-auto" /></SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" sideOffset={6}>
        {changePassword && <DropdownMenuItem onSelect={() => setPasswordOpen(true)}><LockKey /> Сменить пароль</DropdownMenuItem>}
        {signOut && <DropdownMenuItem onSelect={signOut}><SignOut /> Выйти</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu></SidebarMenuItem></SidebarMenu> : <div className="account-tile account-label"><strong>{name}</strong><span className="muted">Демо без входа</span></div>}</SidebarFooter>
    {changePassword && <PasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} name={name} changePassword={changePassword} />}
  </Sidebar>;
}

export function WorkspaceShell({ children, account, demo, topBarContent, ...props }: ShellProps) {
  return <SidebarProvider className={props.onSection ? "docrunnel-shell editor-shell" : "docrunnel-shell"} defaultOpen={false} style={{ "--sidebar-width": "13rem", "--sidebar-width-icon": "3.75rem" } as CSSProperties}><WorkspaceSidebar {...props} account={account} />
    <SidebarInset className="workspace-inset">
      <header className="workspace-header">
        <SidebarTrigger aria-label="Боковая панель" />
        {props.onSection && <div className="brand editor-brand"><img src={`${import.meta.env.BASE_URL}brand.png`} alt="DocRunnel" /></div>}
        <Separator orientation="vertical" />
        {!props.admin && topBarContent ? <div className="studio-topbar-center">{topBarContent}</div> : <span>{props.admin ? "Управление" : "Рабочее место"}</span>}
        <div className="workspace-actions">
          {demo && <Badge variant="secondary">Демо</Badge>}
          <ThemeButton />
        </div>
      </header>
      <div key={props.admin ? "admin" : "workspace"} className="workspace-view">{children}</div>
    </SidebarInset>
  </SidebarProvider>;
}
