// @vitest-environment jsdom
// Selector granularity: a theme-only subscriber must not re-render when the
// session or an unrelated prefs field changes (and vice versa).
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_PREFS } from "./prefs.js";
import {
  appStore,
  isShallowEqual,
  usePrefs,
  useStoreSelector,
} from "./store.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const selectTheme = (s: { prefs: { theme: string } }) => s.prefs.theme;
const selectEmail = (s: { session: { email?: string | null } }) =>
  s.session.email ?? null;

function resetStore(): void {
  appStore.setPrefs(DEFAULT_PREFS);
  appStore.setSession({ loggedIn: false });
  appStore.setOnboarded(true);
}

afterEach(() => {
  document.body.innerHTML = "";
  resetStore();
});

describe("useStoreSelector granularity", () => {
  it("theme-only subscriber ignores session and hotkey updates", async () => {
    const renders = { theme: 0, email: 0, prefs: 0 };
    function ThemeReader() {
      renders.theme += 1;
      useStoreSelector(selectTheme);
      return null;
    }
    function EmailReader() {
      renders.email += 1;
      useStoreSelector(selectEmail);
      return null;
    }
    function PrefsReader() {
      renders.prefs += 1;
      usePrefs();
      return null;
    }

    const div = document.createElement("div");
    document.body.appendChild(div);
    const root = createRoot(div);
    await act(async () => {
      root.render(
        <>
          <ThemeReader />
          <EmailReader />
          <PrefsReader />
        </>,
      );
    });
    expect(renders).toEqual({ theme: 1, email: 1, prefs: 1 });

    // Session change: only the email subscriber re-renders.
    await act(async () => {
      appStore.setSession({ loggedIn: true, email: "a@b.c" });
    });
    expect(renders).toEqual({ theme: 1, email: 2, prefs: 1 });

    // Unrelated prefs field: theme subscriber stays put, whole-prefs
    // subscriber re-renders (slice identity changed — expected).
    await act(async () => {
      appStore.setPrefs({ ...appStore.get().prefs, hotkey: "Alt+Space" });
    });
    expect(renders).toEqual({ theme: 1, email: 2, prefs: 2 });

    // Theme change: only the theme subscriber (and whole-prefs) re-render.
    await act(async () => {
      appStore.setPrefs({ ...appStore.get().prefs, theme: "light" });
    });
    expect(renders).toEqual({ theme: 2, email: 2, prefs: 3 });

    await act(async () => {
      root.unmount();
    });
  });

  it("isShallowEqual bails out on equal flat objects", () => {
    expect(isShallowEqual({ a: 1 }, { a: 1 })).toBe(true);
    expect(isShallowEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(isShallowEqual([1, 2], [1, 2])).toBe(true);
    expect(isShallowEqual([1], [1, 2])).toBe(false);
    expect(isShallowEqual("x", "x")).toBe(true);
    expect(isShallowEqual("x", "y")).toBe(false);
  });
});
