import { Logo } from "@algorith-voice/ui";
import { AudioLines } from "./animate-ui/icons/audio-lines.js";
import { ChevronRight } from "./animate-ui/icons/chevron-right.js";
import { Clock } from "./animate-ui/icons/clock.js";
import { Cog } from "./animate-ui/icons/cog.js";
import { LayoutDashboard } from "./animate-ui/icons/layout-dashboard.js";
import { LogOut } from "./animate-ui/icons/log-out.js";
import { PanelLeft } from "./animate-ui/icons/panel-left.js";
import { UserRound } from "./animate-ui/icons/user-round.js";

// Motion per the instrument system: 150ms micro / 200ms panel,
// cubic-bezier(0.4, 0, 0.2, 1). Sidebar width 220px expanded.
const EASE = "cubic-bezier(0.4, 0, 0.2, 1)";
const DURATION = 200;
const EXPANDED = "220px";
const COLLAPSED = "3.3rem";

type View = "dashboard" | "dictate" | "history" | "settings";

type NavItem = {
  id: View;
  label: string;
  icon: React.ReactNode;
  shortcut?: string;
};

export function AppSidebar({
  active,
  onSelect,
  collapsed,
  onCollapsedChange,
  email,
  onLogout,
}: {
  active: View;
  onSelect: (v: View) => void;
  collapsed: boolean;
  onCollapsedChange: (v: boolean) => void;
  email?: string | null;
  onLogout?: () => void;
}) {
  const navItems: NavItem[] = [
    {
      label: "Dashboard",
      id: "dashboard",
      icon: <LayoutDashboard size={18} animateOnHover />,
    },
    {
      label: "Dictate",
      id: "dictate",
      icon: <AudioLines size={18} animateOnHover />,
      shortcut: "Ctrl+Space",
    },
    {
      label: "History",
      id: "history",
      icon: <Clock size={18} animateOnHover />,
    },
    {
      label: "Settings",
      id: "settings",
      icon: <Cog size={18} animateOnHover />,
    },
  ];

  return (
    <div
      className="sticky top-0 h-full shrink-0 overflow-hidden border-r border-gray-200 bg-white dark:border-white/10 dark:bg-black"
      style={{
        width: collapsed ? COLLAPSED : EXPANDED,
        transition: `width ${DURATION}ms ${EASE}`,
      }}
    >
      <div className="flex h-full min-h-[520px] w-full flex-col">
        {/* Header: wordmark + collapse */}
        <div className="relative flex h-12 shrink-0 items-center p-2">
          <div
            className={`h-8 items-center gap-1.5 overflow-hidden pl-2 ${collapsed ? "hidden" : "flex"}`}
          >
            <Logo className="h-4 w-auto shrink-0 text-black dark:text-white" />
            <span className="av-small truncate font-semibold tracking-tight text-black dark:text-white">
              Algorith Voice
            </span>
          </div>
          <button
            type="button"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand" : "Collapse"}
            onClick={() => onCollapsedChange(!collapsed)}
            className="absolute right-2 top-2 z-10 grid size-8 cursor-pointer place-items-center rounded-control text-gray-500 transition-colors duration-150 hover:bg-gray-200 hover:text-black dark:hover:bg-white/10 dark:hover:text-white"
          >
            <PanelLeft size={18} animateOnHover />
          </button>
        </div>

        {/* Primary nav */}
        <nav className="flex flex-col gap-px px-2 pt-2" aria-label="Primary">
          {navItems.map((it) => (
            <NavRow
              key={it.id}
              item={it}
              active={active === it.id}
              collapsed={collapsed}
              onClick={() => onSelect(it.id)}
            />
          ))}
        </nav>

        {/* Footer: user */}
        <div className="mt-auto border-t border-gray-200 dark:border-white/10">
          <button
            type="button"
            className={`group flex h-16 w-full items-center overflow-hidden transition-colors duration-150 hover:bg-black/5 dark:hover:bg-white/10 ${
              collapsed ? "justify-center px-0" : "gap-3 px-2"
            }`}
            aria-label="Account"
            title={collapsed ? (email ?? "Account") : undefined}
            onClick={() => onSelect("settings")}
          >
            <div
              className={`flex min-w-0 items-center ${
                collapsed ? "justify-center" : "w-full gap-3"
              }`}
            >
              <div className="grid size-9 shrink-0 place-items-center rounded-full bg-black text-sm font-semibold text-white dark:bg-white dark:text-black">
                {email ? (
                  (email[0] ?? "G").toUpperCase()
                ) : (
                  <UserRound size={18} />
                )}
              </div>
              {collapsed ? null : (
                <>
                  <div className="flex min-w-0 flex-1 flex-col items-start">
                    <span className="av-small w-full truncate text-left font-medium text-black dark:text-white">
                      {email ?? "Guest"}
                    </span>
                    <span className="av-small w-full truncate text-left text-[11px] text-gray-500">
                      {email ? "Signed in" : "Local only"}
                    </span>
                  </div>
                  <span className="grid size-7 shrink-0 place-items-center rounded-control text-gray-500 transition-colors duration-150 group-hover:bg-white group-hover:text-black dark:group-hover:bg-white/10 dark:group-hover:text-white">
                    <ChevronRight size={16} animateOnHover />
                  </span>
                </>
              )}
            </div>
          </button>
          {email && onLogout ? (
            <button
              type="button"
              onClick={onLogout}
              aria-label="Log out"
              title={collapsed ? "Log out" : undefined}
              className={`flex h-11 w-full items-center overflow-hidden text-sm text-gray-500 transition-colors duration-150 hover:bg-gray-100 hover:text-black dark:hover:bg-white/5 dark:hover:text-white ${
                collapsed ? "justify-center px-0" : "gap-3 px-2"
              }`}
            >
              <span className="grid size-9 shrink-0 place-items-center">
                <LogOut size={16} animateOnHover />
              </span>
              {collapsed ? null : (
                <span className="min-w-0 flex-1 truncate text-left">
                  Log out
                </span>
              )}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function NavRow({
  item,
  active,
  collapsed,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={item.label}
      aria-current={active ? "page" : undefined}
      title={collapsed ? item.label : undefined}
      className={`group relative flex h-10 w-full items-center overflow-hidden rounded-full text-sm transition-all duration-150 active:scale-[0.99] ${
        collapsed ? "justify-center px-0" : "px-4"
      } ${
        active
          ? "bg-black text-white dark:bg-white dark:text-black"
          : "text-gray-500 hover:bg-black/5 hover:text-black dark:hover:bg-white/10 dark:hover:text-white"
      }`}
    >
      <span
        className={`flex min-w-0 items-center ${
          collapsed ? "justify-center" : "w-full -translate-x-2 gap-3"
        }`}
      >
        <span className="grid size-5 shrink-0 place-items-center">
          {item.icon}
        </span>
        {collapsed ? null : (
          <>
            <span className="min-w-0 flex-1 truncate text-left">
              {item.label}
            </span>
            {item.shortcut ? (
              <span className="shrink-0 text-[12px] text-gray-500 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                {item.shortcut}
              </span>
            ) : null}
          </>
        )}
      </span>
    </button>
  );
}
