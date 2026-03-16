import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import {
  resolveTheme,
  readStoredPreference,
  CYCLE_ORDER,
  type ThemePreference,
} from "./ThemeContext";

function stubWindow(opts: { prefersDark?: boolean } = {}) {
  const store: Record<string, string> = {};
  vi.stubGlobal("window", {
    matchMedia: (query: string) => ({
      matches: (opts.prefersDark ?? false) && query === "(prefers-color-scheme: dark)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
    localStorage: {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = value; },
      clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    },
  });
  vi.stubGlobal("localStorage", (globalThis as Record<string, unknown>).window.localStorage);
}

describe("ThemeContext helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("resolveTheme", () => {
    it("returns 'dark' for dark preference", () => {
      expect(resolveTheme("dark")).toBe("dark");
    });

    it("returns 'light' for light preference", () => {
      expect(resolveTheme("light")).toBe("light");
    });

    it("returns light when system prefers light", () => {
      stubWindow({ prefersDark: false });
      expect(resolveTheme("system")).toBe("light");
    });

    it("returns dark when system prefers dark", () => {
      stubWindow({ prefersDark: true });
      expect(resolveTheme("system")).toBe("dark");
    });

    it("falls back to dark when window is undefined", () => {
      expect(resolveTheme("system")).toBe("dark");
    });
  });

  describe("readStoredPreference", () => {
    beforeEach(() => {
      stubWindow();
    });

    it("defaults to dark when nothing is stored", () => {
      expect(readStoredPreference()).toBe("dark");
    });

    it("reads 'light' from localStorage", () => {
      localStorage.setItem("paperclip.theme", "light");
      expect(readStoredPreference()).toBe("light");
    });

    it("reads 'system' from localStorage", () => {
      localStorage.setItem("paperclip.theme", "system");
      expect(readStoredPreference()).toBe("system");
    });

    it("reads 'dark' from localStorage", () => {
      localStorage.setItem("paperclip.theme", "dark");
      expect(readStoredPreference()).toBe("dark");
    });

    it("defaults to dark for invalid stored value", () => {
      localStorage.setItem("paperclip.theme", "banana");
      expect(readStoredPreference()).toBe("dark");
    });

    it("falls back to dark when window is undefined", () => {
      vi.unstubAllGlobals();
      expect(readStoredPreference()).toBe("dark");
    });
  });

  describe("CYCLE_ORDER", () => {
    it("cycles dark → system → light → dark", () => {
      const cycle = (pref: ThemePreference): ThemePreference => {
        const idx = CYCLE_ORDER.indexOf(pref);
        return CYCLE_ORDER[(idx + 1) % CYCLE_ORDER.length]!;
      };

      expect(cycle("dark")).toBe("system");
      expect(cycle("system")).toBe("light");
      expect(cycle("light")).toBe("dark");
    });
  });
});
