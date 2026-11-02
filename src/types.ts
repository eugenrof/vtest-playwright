export type BrowserName = "chromium" | "firefox" | "webkit";

/** Interaction executed after navigation and before the screenshot. */
export type Step =
  | { type: "click"; selector: string }
  | { type: "hover"; selector: string }
  | { type: "fill"; selector: string; value: string }
  | { type: "press"; key: string }
  | { type: "waitForSelector"; selector: string }
  | { type: "wait"; ms: number };

export interface ViewportConfig {
  name: string;
  width: number;
  height: number;
}

export interface PageConfig {
  /** Unique, human-friendly name. Used in file names and the report. */
  name: string;
  /** Absolute URL, or a path resolved against `baseUrl`. */
  url: string;
  steps?: Step[];
  waitForSelector?: string;
  /** Selectors painted over with a solid colour (dynamic content). */
  mask?: string[];
  /** Selectors hidden with `visibility: hidden` (cookie banners, chat widgets...). */
  hide?: string[];
  fullPage?: boolean;
  /** Per-pixel colour tolerance (0 = exact, 1 = anything). Overrides global. */
  threshold?: number;
  /** Max share of changed pixels (0..1) before the page fails. Overrides global. */
  maxDiffRatio?: number;
}

export interface Config {
  baseUrl?: string;
  pages: PageConfig[];
  browsers: BrowserName[];
  viewports: ViewportConfig[];
  threshold: number;
  maxDiffRatio: number;
  fullPage: boolean;
  baselineDir: string;
  outputDir: string;
  /** Path to a Playwright storageState JSON (logged-in session). */
  storageState?: string;
  headers?: Record<string, string>;
  /** Selectors hidden on every page. */
  hide: string[];
  extraCss?: string;
  /** ISO date; `Date.now()` / `new Date()` are fixed to this value in the page. */
  freezeTime?: string;
  timeoutMs: number;
  settleMs: number;
  colorScheme: "light" | "dark";
}

export type Status = "passed" | "failed" | "new" | "error";

export interface RunResult {
  id: string;
  pageName: string;
  url: string;
  browser: BrowserName;
  viewport: string;
  status: Status;
  ratio?: number;
  changedPixels?: number;
  sizeMismatch?: boolean;
  error?: string;
  /** Paths relative to the output directory. */
  baseline?: string;
  current?: string;
  diff?: string;
}

export interface RunSummary {
  mode: "test" | "compare";
  startedAt: string;
  durationMs: number;
  counts: Record<Status, number>;
  results: RunResult[];
  labels: { baseline: string; current: string };
}
