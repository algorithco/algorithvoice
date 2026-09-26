// Hand-built stroke icons for the dashboard shell (lucide-style geometry,
// this project's sizing). Inline SVGs on purpose: lucide-react is a declared
// but unused dependency, and pulling it into the client bundle for a dozen
// glyphs is not worth the weight or version risk.
function Base({
  children,
  className = "size-5",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      {children}
    </svg>
  );
}

export function MenuIcon({ className }: { className?: string }) {
  return (
    <Base className={className}>
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </Base>
  );
}

export function CloseIcon({ className }: { className?: string }) {
  return (
    <Base className={className}>
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </Base>
  );
}

export function CollapseIcon({ className }: { className?: string }) {
  return (
    <Base className={className}>
      <path d="m12 6-6 6 6 6" />
      <path d="m18 6-6 6 6 6" />
    </Base>
  );
}

export function ExpandIcon({ className }: { className?: string }) {
  return (
    <Base className={className}>
      <path d="m6 6 6 6-6 6" />
      <path d="m12 6 6 6-6 6" />
    </Base>
  );
}

export function OverviewIcon({ className }: { className?: string }) {
  return (
    <Base className={className}>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </Base>
  );
}

export function UsageIcon({ className }: { className?: string }) {
  return (
    <Base className={className}>
      <path d="M4 20h16" />
      <path d="M7 20v-6" />
      <path d="M12 20V9" />
      <path d="M17 20v-9" />
    </Base>
  );
}

export function ActivityIcon({ className }: { className?: string }) {
  return (
    <Base className={className}>
      <path d="M3 12h4l3 8 4-16 3 8h4" />
    </Base>
  );
}

export function DevicesIcon({ className }: { className?: string }) {
  return (
    <Base className={className}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M9 20h6" />
      <path d="M12 16v4" />
    </Base>
  );
}

export function BillingIcon({ className }: { className?: string }) {
  return (
    <Base className={className}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 10h18" />
      <path d="M7 15h4" />
    </Base>
  );
}

export function DownloadIcon({ className }: { className?: string }) {
  return (
    <Base className={className}>
      <path d="M12 4v10" />
      <path d="m8 10 4 4 4-4" />
      <path d="M4 19h16" />
    </Base>
  );
}

export function DocsIcon({ className }: { className?: string }) {
  return (
    <Base className={className}>
      <path d="M12 6C10 4.5 7 4 4 4v14c3 0 6 .5 8 2 2-1.5 5-2 8-2V4c-3 0-6 .5-8 2Z" />
      <path d="M12 6v14" />
    </Base>
  );
}

export function PricingIcon({ className }: { className?: string }) {
  return (
    <Base className={className}>
      <path d="M3 12V5a2 2 0 0 1 2-2h7l9 9-9 9-9-9Z" />
      <circle cx="8.5" cy="8.5" r="1.5" />
    </Base>
  );
}

export function SettingsIcon({ className }: { className?: string }) {
  return (
    <Base className={className}>
      <path d="M4 7h9" />
      <path d="M17 7h3" />
      <circle cx="15" cy="7" r="2" />
      <path d="M4 17h3" />
      <path d="M11 17h9" />
      <circle cx="9" cy="17" r="2" />
    </Base>
  );
}
