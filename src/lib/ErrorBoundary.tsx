import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

/**
 * Stops one bad render from blanking the panel.
 *
 * A single unexpected payload shape used to throw during render and, with no
 * boundary above it, React unmounted the whole tree — the screen went white
 * and reception lost the nav as well as the page. Now the failure is contained
 * to the page, says what broke, and offers a way out.
 */
type Props = { children: ReactNode; onReset?: () => void };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the detail in the console for whoever is debugging.
    console.error("Panel render error:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="mx-auto w-full max-w-[680px] py-10">
        <div className="rounded-(--radius-card) border border-err bg-err-bg px-5 py-5">
          <div className="text-[15px] font-extrabold text-err">This screen hit an error</div>
          <p className="mt-1.5 text-[12.5px] text-ink2">
            The rest of the panel is fine — you can go back or reload this page. If it keeps
            happening, the message below is the useful part.
          </p>
          <pre className="mt-3 overflow-auto rounded-lg bg-surface px-3 py-2 font-mono text-[11px] text-ink2">
            {error.message}
          </pre>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={() => {
                this.setState({ error: null });
                this.props.onReset?.();
              }}
              className="rounded-(--radius-btn) bg-primary px-4 py-2 text-[13px] font-semibold text-white hover:bg-primary-hover">
              Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              className="rounded-(--radius-btn) border border-border bg-surface px-4 py-2 text-[13px] font-semibold text-ink2 hover:bg-ivory">
              Reload the panel
            </button>
          </div>
        </div>
      </div>
    );
  }
}
