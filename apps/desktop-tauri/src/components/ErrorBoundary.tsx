import { Component, type ReactNode } from "react";
import { reportFrontendError } from "../lib/error-report.js";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }): void {
    void reportFrontendError({
      kind: "react-boundary",
      message: error.message,
      stack: `${error.stack ?? ""}\n${info.componentStack ?? ""}`.slice(
        0,
        8000,
      ),
      url: typeof window !== "undefined" ? window.location.href : undefined,
    });
  }

  private handleReload = () => {
    this.setState({ error: null });
    try {
      window.location.reload();
    } catch {
      // ignore
    }
  };

  private handleReset = () => {
    this.setState({ error: null });
    try {
      localStorage.removeItem("algorith-voice-prefs");
    } catch {
      // ignore
    }
    try {
      window.location.reload();
    } catch {
      // ignore
    }
  };

  render(): ReactNode {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-white p-8 text-center text-black dark:bg-black dark:text-white">
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p className="max-w-[480px] text-sm opacity-70">
            Algorith Voice hit an unexpected error. Your transcripts and models
            are safe — reloading usually fixes it.
          </p>
          <p className="max-w-[480px] font-mono text-xs opacity-50">
            {this.state.error.message}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={this.handleReload}
              className="rounded-lg bg-black px-4 py-2 text-sm text-white dark:bg-white dark:text-black"
            >
              Reload
            </button>
            <button
              type="button"
              onClick={this.handleReset}
              className="rounded-lg border px-4 py-2 text-sm"
            >
              Reset prefs & reload
            </button>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}
