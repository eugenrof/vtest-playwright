import fs from "node:fs";
import path from "node:path";
import { chromium, firefox, webkit } from "playwright";
import type { BrowserContext, Page } from "playwright";
import { slug } from "./config.js";
import type { BrowserName, Config, PageConfig, Step, ViewportConfig } from "./types.js";

const launchers = { chromium, firefox, webkit };

export interface CaptureJob {
  /** Stable identifier: <page>__<browser>__<viewport> */
  id: string;
  url: string;
  page: PageConfig;
  browser: BrowserName;
  viewport: ViewportConfig;
}

export interface CaptureOutput {
  job: CaptureJob;
  png?: Buffer;
  error?: string;
}

export interface CaptureOptions {
  headed?: boolean;
  concurrency?: number;
}

export function resolveUrl(url: string, base?: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  if (!base) {
    throw new Error(`Page URL "${url}" is relative but no "baseUrl" is set.`);
  }
  return new URL(url, base).toString();
}

/** Expand pages x browsers x viewports into individual capture jobs. */
export function buildJobs(cfg: Config, base?: string, requireRelative = false): CaptureJob[] {
  const jobs: CaptureJob[] = [];
  for (const page of cfg.pages) {
    if (requireRelative && /^https?:\/\//i.test(page.url)) {
      throw new Error(
        `Page "${page.name}" uses an absolute URL. "compare" needs relative paths (e.g. "/pricing").`,
      );
    }
    for (const browser of cfg.browsers) {
      for (const viewport of cfg.viewports) {
        jobs.push({
          id: `${slug(page.name)}__${browser}__${slug(viewport.name)}`,
          url: resolveUrl(page.url, base),
          page,
          browser,
          viewport,
        });
      }
    }
  }
  return jobs;
}

export function filterJobs(jobs: CaptureJob[], filter?: string): CaptureJob[] {
  if (!filter) return jobs;
  const out = jobs.filter((j) => j.id.includes(filter));
  if (out.length === 0) throw new Error(`No captures match --filter "${filter}".`);
  return out;
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function runCaptures(
  jobs: CaptureJob[],
  cfg: Config,
  opts: CaptureOptions = {},
): Promise<CaptureOutput[]> {
  const results: CaptureOutput[] = new Array(jobs.length);

  let storageState: string | undefined;
  if (cfg.storageState) {
    storageState = path.resolve(cfg.storageState);
    if (!fs.existsSync(storageState)) {
      throw new Error(`storageState file not found: ${storageState}`);
    }
  }

  const browserNames = [...new Set(jobs.map((j) => j.browser))];
  for (const name of browserNames) {
    const browser = await launchers[name].launch({ headless: !opts.headed });
    try {
      const viewports = new Map<string, ViewportConfig>();
      for (const j of jobs) if (j.browser === name) viewports.set(j.viewport.name, j.viewport);

      for (const vp of viewports.values()) {
        const context = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
          deviceScaleFactor: 1,
          reducedMotion: "reduce",
          colorScheme: cfg.colorScheme,
          locale: "en-US",
          timezoneId: "UTC",
          storageState,
          extraHTTPHeaders: cfg.headers,
        });
        try {
          const indices = jobs
            .map((j, i) => (j.browser === name && j.viewport.name === vp.name ? i : -1))
            .filter((i) => i >= 0);

          await mapPool(indices, opts.concurrency ?? 4, async (i) => {
            const job = jobs[i];
            try {
              const png = await capturePage(context, job, cfg);
              results[i] = { job, png };
              console.log(`  ✓ ${job.id}`);
            } catch (e) {
              const message = e instanceof Error ? e.message : String(e);
              results[i] = { job, error: message };
              console.log(`  ✗ ${job.id}: ${message.split("\n")[0]}`);
            }
          });
        } finally {
          await context.close();
        }
      }
    } finally {
      await browser.close();
    }
  }
  return results;
}

async function capturePage(context: BrowserContext, job: CaptureJob, cfg: Config): Promise<Buffer> {
  const page = await context.newPage();
  try {
    page.setDefaultTimeout(cfg.timeoutMs);
    if (cfg.freezeTime) await page.clock.setFixedTime(new Date(cfg.freezeTime));

    await page.goto(job.url, { waitUntil: "load", timeout: cfg.timeoutMs });
    // Some sites never reach network idle (analytics, websockets) - don't fail on that.
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);

    const hide = [...cfg.hide, ...(job.page.hide ?? [])];
    const css = [
      hide.length ? `${hide.join(",")} { visibility: hidden !important; }` : "",
      cfg.extraCss ?? "",
    ]
      .filter(Boolean)
      .join("\n");
    if (css) await page.addStyleTag({ content: css });

    if (job.page.steps?.length) await runSteps(page, job.page.steps);
    if (job.page.waitForSelector) await page.waitForSelector(job.page.waitForSelector);

    await settle(page, cfg.settleMs);

    const fullPage = job.page.fullPage ?? cfg.fullPage;
    const mask = (job.page.mask ?? []).map((s) => page.locator(s));

    return await page.screenshot({
      fullPage,
      animations: "disabled",
      caret: "hide",
      mask,
      maskColor: "#FF00FF",
      timeout: cfg.timeoutMs,
    });
  } finally {
    await page.close();
  }
}

async function runSteps(page: Page, steps: Step[]): Promise<void> {
  for (const step of steps) {
    switch (step.type) {
      case "click":
        await page.click(step.selector);
        break;
      case "hover":
        await page.hover(step.selector);
        break;
      case "fill":
        await page.fill(step.selector, step.value);
        break;
      case "press":
        await page.keyboard.press(step.key);
        break;
      case "waitForSelector":
        await page.waitForSelector(step.selector);
        break;
      case "wait":
        await page.waitForTimeout(step.ms);
        break;
    }
  }
}

/** Trigger lazy loading, wait for fonts and images, then let the page settle. */
async function settle(page: Page, settleMs: number): Promise<void> {
  await page.evaluate(async () => {
    const step = Math.max(window.innerHeight / 2, 300);
    let y = 0;
    // Cap iterations so infinite-scroll pages don't hang the run.
    for (let i = 0; i < 40 && y < document.documentElement.scrollHeight; i++) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 80));
      y += step;
    }
    window.scrollTo(0, 0);
    await document.fonts.ready;
    await Promise.all(
      Array.from(document.images)
        .filter((img) => !img.complete)
        .map(
          (img) =>
            new Promise<void>((resolve) => {
              img.addEventListener("load", () => resolve());
              img.addEventListener("error", () => resolve());
            }),
        ),
    );
  });
  if (settleMs > 0) await page.waitForTimeout(settleMs);
}
