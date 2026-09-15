import type * as React from "react";

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-[480px] flex-col justify-center px-6 py-24">
      <p className="t-cap text-faint">{subtitle}</p>
      <h1 className="t-h1 mt-4">{title}</h1>
      <div className="mt-8 rounded-lg border border-line bg-surface p-8">
        {children}
      </div>
      <p className="t-body mx-auto mt-6 w-fit rounded-full border border-line/60 bg-canvas/65 px-4 py-2 text-center text-sub backdrop-blur-md">
        {footer}
      </p>
    </div>
  );
}

export function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="block">
      <span className="t-cap text-faint">{label}</span>
      <div className="mt-2">{children}</div>
      {error ? (
        <span className="t-cap mt-2 block normal-case text-red-400">
          {error}
        </span>
      ) : null}
    </div>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="w-full rounded-md border border-line bg-canvas px-4 py-3 text-[15px] leading-6 text-ink placeholder:text-faint focus:border-ink focus:outline-none"
    />
  );
}
