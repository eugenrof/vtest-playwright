import fs from "node:fs";
import path from "node:path";
import type { BrowserName, Config } from "./types.js";

const BROWSERS: BrowserName[] = ["chromium", "firefox", "webkit"];

export const DEFAULT_CONFIG_FILE = "vtest.config.json";

/** Turn any string into a safe file-name fragment. */
export function slug(input: string): string {
  const s = input
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return s || "page";
}

export function parseBrowsers(input: string | string[]): BrowserName[] {
  const list = (typeof input === "string" ? input.split(",") : input)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const b of list) {
    if (!BROWSERS.includes(b as BrowserName)) {
      throw new Error(`Unknown browser "${b}". Use one of: ${BROWSERS.join(", ")}`);
    }
  }
  return list as BrowserName[];
}

export function loadConfig(file: string | undefined, required: boolean): Config {
  const configPath = path.resolve(file ?? DEFAULT_CONFIG_FILE);
  let raw: Partial<Config> = {};
  if (fs.existsSync(configPath)) {
    try {
      raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch (e) {
      throw new Error(`Could not parse ${configPath}: ${(e as Error).message}`);
    }
  } else if (required) {
    throw new Error(
      `Config not found: ${configPath}\nRun "vtest init" to create one, or pass --url <url>.`,
    );
  }
  return normalize(raw);
}

export function normalize(raw: Partial<Config>): Config {
  const cfg: Config = {
    baseUrl: raw.baseUrl,
    pages: raw.pages?.length ? raw.pages : [{ name: "home", url: "/" }],
    browsers: parseBrowsers(raw.browsers ?? ["chromium"]),
    viewports: raw.viewports?.length
      ? raw.viewports
      : [{ name: "desktop", width: 1280, height: 800 }],
    threshold: raw.threshold ?? 0.1,
    maxDiffRatio: raw.maxDiffRatio ?? 0.001,
    fullPage: raw.fullPage ?? true,
    baselineDir: raw.baselineDir ?? ".vtest/baselines",
    outputDir: raw.outputDir ?? ".vtest/output",
    storageState: raw.storageState,
    headers: raw.headers,
    hide: raw.hide ?? [],
    extraCss: raw.extraCss,
    freezeTime: raw.freezeTime,
    timeoutMs: raw.timeoutMs ?? 30_000,
    settleMs: raw.settleMs ?? 300,
    colorScheme: raw.colorScheme ?? "light",
  };

  const pageNames = new Set<string>();
  for (const p of cfg.pages) {
    if (!p.name || !p.url) throw new Error('Every page needs a "name" and a "url".');
    const key = slug(p.name);
    if (pageNames.has(key)) throw new Error(`Duplicate page name: "${p.name}"`);
    pageNames.add(key);
  }

  const vpNames = new Set<string>();
  for (const v of cfg.viewports) {
    if (!v.name || !(v.width > 0) || !(v.height > 0)) {
      throw new Error('Every viewport needs a "name", a positive "width" and "height".');
    }
    const key = slug(v.name);
    if (vpNames.has(key)) throw new Error(`Duplicate viewport name: "${v.name}"`);
    vpNames.add(key);
  }

  if (cfg.threshold < 0 || cfg.threshold > 1) throw new Error('"threshold" must be 0..1');
  if (cfg.maxDiffRatio < 0 || cfg.maxDiffRatio > 1) throw new Error('"maxDiffRatio" must be 0..1');

  return cfg;
}
