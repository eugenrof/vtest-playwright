#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { DEFAULT_CONFIG_FILE, loadConfig, parseBrowsers, slug } from "./config.js";
import { approve, runBaseline, runCompare, runTest } from "./runner.js";
import type { Config, RunSummary } from "./types.js";

interface CliOpts {
  config?: string;
  url?: string;
  filter?: string;
  browsers?: string;
  headed?: boolean;
  concurrency?: string;
  createMissing?: boolean;
  all?: boolean;
  force?: boolean;
}

const program = new Command();
program
  .name("vtest")
  .description("URL-driven visual regression testing built on Playwright")
  .version("0.1.0");

function common(cmd: Command): Command {
  return cmd
    .option("-c, --config <file>", `config file (default: ${DEFAULT_CONFIG_FILE})`)
    .option("-u, --url <url>", "test a single URL without a config file")
    .option("-f, --filter <text>", "only run captures whose id contains this text")
    .option("-b, --browsers <list>", "override browsers, e.g. chromium,firefox")
    .option("--headed", "show the browser window")
    .option("--concurrency <n>", "parallel pages per browser context", "4");
}

function buildConfig(opts: CliOpts, configRequired = true): Config {
  const cfg = loadConfig(opts.config, configRequired && !opts.url);
  if (opts.url) {
    cfg.pages = [{ name: slug(opts.url), url: opts.url }];
    cfg.baseUrl = undefined;
  }
  if (opts.browsers) cfg.browsers = parseBrowsers(opts.browsers);
  return cfg;
}

function captureOpts(opts: CliOpts) {
  return {
    filter: opts.filter,
    headed: opts.headed,
    concurrency: Math.max(1, parseInt(opts.concurrency ?? "4", 10) || 4),
  };
}

function printSummary(summary: RunSummary, outDir: string): number {
  const c = summary.counts;
  console.log(
    `\n${c.passed} passed, ${c.failed} failed, ${c.new} new, ${c.error} errors  (${(summary.durationMs / 1000).toFixed(1)}s)`,
  );
  for (const r of summary.results) {
    if (r.status === "failed") {
      const pct = ((r.ratio ?? 0) * 100).toFixed(3);
      console.log(`  FAILED  ${r.id}  ${pct}% changed${r.sizeMismatch ? " (size changed)" : ""}`);
    } else if (r.status === "new") {
      console.log(`  NEW     ${r.id}  (no baseline)`);
    } else if (r.status === "error") {
      console.log(`  ERROR   ${r.id}  ${r.error?.split("\n")[0]}`);
    }
  }
  console.log(`\nReport: ${path.join(outDir, "report.html")}`);
  return c.failed + c.new + c.error > 0 ? 1 : 0;
}

function run(fn: () => Promise<number | void>): void {
  fn()
    .then((code) => process.exit(code ?? 0))
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\nError: ${message}`);
      if (/Executable doesn't exist|browserType\.launch/i.test(message)) {
        console.error('Hint: install browsers with "npx playwright install chromium".');
      }
      process.exit(2);
    });
}

program
  .command("init")
  .description(`create a starter ${DEFAULT_CONFIG_FILE}`)
  .option("--force", "overwrite an existing file")
  .action((opts: CliOpts) =>
    run(async () => {
      const file = path.resolve(DEFAULT_CONFIG_FILE);
      if (fs.existsSync(file) && !opts.force) {
        throw new Error(`${DEFAULT_CONFIG_FILE} already exists (use --force to overwrite).`);
      }
      const template = {
        baseUrl: "https://example.com",
        pages: [{ name: "home", url: "/" }],
        browsers: ["chromium"],
        viewports: [
          { name: "desktop", width: 1280, height: 800 },
          { name: "mobile", width: 390, height: 844 },
        ],
        threshold: 0.1,
        maxDiffRatio: 0.001,
        fullPage: true,
      };
      fs.writeFileSync(file, JSON.stringify(template, null, 2) + "\n");
      console.log(`Created ${DEFAULT_CONFIG_FILE}. Next: vtest baseline`);
    }),
  );

common(program.command("baseline").description("capture screenshots and save them as the baselines")).action(
  (opts: CliOpts) =>
    run(async () => {
      const errors = await runBaseline(buildConfig(opts), captureOpts(opts));
      return errors > 0 ? 1 : 0;
    }),
);

common(program.command("test").description("capture screenshots and compare them to the baselines"))
  .option("--create-missing", "save captures that have no baseline as new baselines")
  .action((opts: CliOpts) =>
    run(async () => {
      const cfg = buildConfig(opts);
      const summary = await runTest(cfg, { ...captureOpts(opts), createMissing: opts.createMissing });
      return printSummary(summary, path.resolve(cfg.outputDir));
    }),
  );

common(
  program
    .command("compare <urlA> <urlB>")
    .description("diff two live environments (e.g. staging vs production)"),
).action((urlA: string, urlB: string, opts: CliOpts) =>
  run(async () => {
    const cfg = buildConfig({ ...opts, url: undefined }, false);
    const summary = await runCompare(cfg, urlA, urlB, captureOpts(opts));
    return printSummary(summary, path.join(path.resolve(cfg.outputDir), "compare"));
  }),
);

program
  .command("approve")
  .description("accept the latest failed/new captures as the new baselines")
  .option("-c, --config <file>", `config file (default: ${DEFAULT_CONFIG_FILE})`)
  .option("-f, --filter <text>", "only approve captures whose id contains this text")
  .option("--all", "approve every capture, including passing ones")
  .action((opts: CliOpts) =>
    run(async () => {
      const cfg = loadConfig(opts.config, false);
      const ids = approve(cfg, { all: opts.all, filter: opts.filter });
      if (ids.length === 0) console.log("Nothing to approve.");
      else {
        ids.forEach((id) => console.log(`  approved ${id}`));
        console.log(`\nUpdated ${ids.length} baseline(s) in ${cfg.baselineDir}. Commit them.`);
      }
    }),
  );

program.parse();
