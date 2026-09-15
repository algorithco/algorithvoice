import { Logo } from "@algorith-voice/ui";

const EASE = "cubic-bezier(0.165,0.85,0.45,1)";
const DURATION = 300;
const EXPANDED = "18rem";
const COLLAPSED = "3.3rem";

// Demo data — real history lands here when SQLite wires up.
const starred = ["Refactor auth middleware"];
const recents = [
  "Add a database index on usage_records",
  "Draft release notes for v0.2.0",
  "The quick brown fox jumps over the lazy dog",
];

type View = "dictate" | "history" | "settings";

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
}: {
  active: View;
  onSelect: (v: View) => void;
  collapsed: boolean;
  onCollapsedChange: (v: boolean) => void;
  email?: string | null;
}) {
  const navItems: NavItem[] = [
    { label: "Dictate", id: "dictate", icon: <MicIcon />, shortcut: "⌥ Space" },
    { label: "History", id: "history", icon: <HistoryIcon /> },
    { label: "Settings", id: "settings", icon: <SettingsIcon /> },
  ];

  return (
    <div
      className="shrink-0 overflow-hidden border-r border-gray-200 bg-white dark:border-gray-800 dark:bg-black"
      style={{
        width: collapsed ? COLLAPSED : EXPANDED,
        transition: `width ${DURATION}ms ${EASE}`,
      }}
    >
      <div className="flex h-full min-h-[520px] w-full flex-col">
        {/* Header: wordmark + collapse */}
        <div className="relative flex h-12 shrink-0 items-center p-2">
          <div
            className="flex h-8 items-center gap-1.5 overflow-hidden pl-2"
            style={{
              transition: `opacity 150ms ${EASE}`,
              opacity: collapsed ? 0 : 1,
              pointerEvents: collapsed ? "none" : "auto",
            }}
          >
            <Logo className="h-4 w-auto text-black dark:text-white" />
            <span className="av-small font-semibold tracking-tight text-black dark:text-white">
              Algorith Voice
            </span>
          </div>
          <button
            type="button"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand" : "Collapse"}
            onClick={() => onCollapsedChange(!collapsed)}
            className="absolute right-2 top-2 z-10 grid size-8 cursor-pointer place-items-center rounded-control text-gray-500 transition-colors duration-150 hover:bg-gray-200 hover:text-black dark:hover:bg-gray-900 dark:hover:text-white"
          >
            <PanelIcon />
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

        {/* Starred / Recents — hidden when collapsed, flat monochrome */}
        <div
          className="overflow-x-hidden pt-4"
          style={{
            transition: `opacity 150ms ${EASE}`,
            opacity: collapsed ? 0 : 1,
            pointerEvents: collapsed ? "none" : "auto",
          }}
          aria-hidden={collapsed}
          // @ts-expect-error — inert is valid but TS lib hasn't caught up for div
          inert={collapsed ? "" : undefined}
        >
          <div className="px-2">
            <Section title="Starred">
              {starred.map((t) => (
                <ChatRow key={t} title={t} />
              ))}
            </Section>
            <Section title="Recents">
              {recents.map((t) => (
                <ChatRow key={t} title={t} />
              ))}
            </Section>
          </div>
        </div>

        {/* Footer: user */}
        <div className="mt-auto border-t border-gray-200 dark:border-gray-800">
          <button
            type="button"
            className="group flex h-16 w-full items-center gap-3 overflow-hidden px-2 transition-colors duration-150 hover:bg-gray-200/60 dark:hover:bg-gray-900/60"
            aria-label="Account"
            onClick={() => onSelect("settings")}
          >
            <div className="flex w-full items-center gap-3">
              <div className="grid size-9 shrink-0 place-items-center rounded-full bg-black text-sm font-semibold text-white dark:bg-white dark:text-black">
                {(email?.[0] ?? "G").toUpperCase()}
              </div>
              <div
                className="flex min-w-0 flex-1 flex-col items-start"
                style={{
                  transition: `opacity 150ms ${EASE}`,
                  opacity: collapsed ? 0 : 1,
                }}
              >
                <span className="av-small truncate font-medium text-black dark:text-white">
                  {email ?? "Guest"}
                </span>
                <span className="av-small truncate text-[11px] text-gray-500">
                  {email ? "Signed in" : "Local only"}
                </span>
              </div>
              <span
                className="grid size-7 place-items-center rounded-control text-gray-500 transition-colors duration-150 group-hover:bg-white group-hover:text-black dark:group-hover:bg-gray-800 dark:group-hover:text-white"
                style={{
                  transition: `opacity 150ms ${EASE}`,
                  opacity: collapsed ? 0 : 1,
                }}
              >
                <ChevronRightIcon />
              </span>
            </div>
          </button>
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
      className={`group relative flex h-9 w-full items-center overflow-hidden rounded-control px-4 text-sm transition-colors duration-75 active:scale-[0.99] ${
        active
          ? "bg-gray-200 text-black dark:bg-gray-900 dark:text-white"
          : "text-gray-500 hover:bg-gray-200 hover:text-black dark:hover:bg-gray-900 dark:hover:text-white"
      }`}
    >
      <span className="flex w-full -translate-x-2 items-center gap-3">
        <span className="grid size-5 shrink-0 place-items-center">
          {item.icon}
        </span>
        <span
          className="flex-1 truncate text-left"
          style={{
            transition: `opacity 150ms ${EASE}`,
            opacity: collapsed ? 0 : 1,
          }}
        >
          {item.label}
        </span>
        {item.shortcut ? (
          <span
            className="text-[11px] text-gray-500 opacity-0 transition-opacity duration-75 group-hover:opacity-100"
            style={{ display: collapsed ? "none" : undefined }}
          >
            {item.shortcut}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <h3 className="select-none px-2 pb-1 text-[11px] font-medium tracking-wide text-gray-500">
        {title}
      </h3>
      <ul className="flex flex-col gap-px">{children}</ul>
    </div>
  );
}

function ChatRow({ title }: { title: string }) {
  return (
    <li className="list-none">
      <span className="group relative flex h-8 items-center rounded-control px-3 text-[13px] text-gray-500 transition-colors duration-75 hover:bg-gray-200 hover:text-black dark:hover:bg-gray-900 dark:hover:text-white">
        <span className="flex-1 truncate">{title}</span>
        <span className="absolute right-1 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-control text-gray-500 opacity-0 transition-opacity duration-150 group-hover:opacity-100 hover:bg-white dark:hover:bg-gray-800">
          <DotsIcon />
        </span>
      </span>
    </li>
  );
}

// ——— Icons: flat monochrome, no fill gradients ———

function MicIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M10 3a3 3 0 0 0-3 3v4a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3m-1 9a1 1 0 0 1 2 0 4.002 4.002 0 0 1-3.874 4H7a.5.5 0 0 0 0 1h6a.5.5 0 0 0 0-1h-.126A4.002 4.002 0 0 1 9 12m-1-6a1 1 0 0 1 2 0v4a1 1 0 0 1-2 0z" />
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16m0 1a7 7 0 1 1 0 14 7 7 0 0 1 0-14m1 3a.5.5 0 0 1 .5.5v3.793l2.146 2.147a.5.5 0 0 1-.708.708l-2.5-2.5A.5.5 0 0 1 10 10V6.5A.5.5 0 0 1 11 6" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M9.25 2a.75.75 0 0 1 .75.75v1.128a5.7 5.7 0 0 1 1.43.84l.8-.8a.75.75 0 1 1 1.06 1.06l-.8.8c.32.43.59.91.84 1.43H14.5a.75.75 0 0 1 0 1.5h-1.172a5.7 5.7 0 0 1-.84 1.43l.8.8a.75.75 0 1 1-1.06 1.06l-.8-.8a5.7 5.7 0 0 1-1.43.84V17.5a.75.75 0 0 1-1.5 0v-1.128a5.7 5.7 0 0 1-1.43-.84l-.8.8a.75.75 0 1 1-1.06-1.06l.8-.8a5.7 5.7 0 0 1-.84-1.43H5.5a.75.75 0 0 1 0-1.5h1.172c.25-.52.52-1 .84-1.43l-.8-.8a.75.75 0 1 1 1.06-1.06l.8.8c.43-.32.91-.59 1.43-.84V2.75A.75.75 0 0 1 9.25 2m0 5.5A2.5 2.5 0 1 0 14 10a2.5 2.5 0 0 0-4.75-2.5" />
    </svg>
  );
}

function PanelIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M16.5 4A1.5 1.5 0 0 1 18 5.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 2 14.5v-9A1.5 1.5 0 0 1 3.5 4zM7 15h9.5a.5.5 0 0 0 .5-.5v-9a.5.5 0 0 0-.5-.5H7zM3.5 5a.5.5 0 0 0-.5.5v9a.5.5 0 0 0 .5.5H6V5z" />
    </svg>
  );
}

function DotsIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M4.5 8.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3m5.5 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3m5.5 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M7.2 4.2a.5.5 0 0 1 .7 0l5 5a.5.5 0 0 1 0 .7l-5 5a.5.5 0 0 1-.7-.7L11.79 10 7.2 5.41a.5.5 0 0 1 0-.71" />
    </svg>
  );
}
