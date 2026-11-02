import fs from "node:fs";
import path from "node:path";
import {
  buildJobs,
  filterJobs,
  runCaptures,
  type CaptureJob,
  type CaptureOptions,
  type CaptureOutput,
} from "./capture.js";
import { diffImages } from "./diff.js";
import { generateReport } from "./report.js";
import type { Config, RunResult, RunSummary, Status } from "./types.js";

export interface RunOptions extends CaptureOptions {
  filter?: string;
  /** `test` only: save captures with no baseline as the new baseline. */
  createMissing?: boolean;
}

interface Pair {
  job: CaptureJob;
  baseline?: Buffer;
  current?: Buffer;
  error?: string;
}

/** `vtest baseline` - capture everything and (over)write the baseline images. */
export async function runBaseline(
  cfg: Config,
  opts: RunOptions,
): Promise<number> {
  const jobs = filterJobs(buildJobs(cfg, cfg.baseUrl), opts.filter);
  console.log(`Capturing ${jobs.length} baseline image(s)...`);
  const outputs = await runCaptures(jobs, cfg, opts);

  const dir = path.resolve(cfg.baselineDir);
  fs.mkdirSync(dir, { recursive: true });
  let errors = 0;
  for (const o of outputs) {
    if (o.png) fs.writeFileSync(path.join(dir, `${o.job.id}.png`), o.png);
    else errors++;
  }
  console.log(
    `\nSaved ${outputs.length - errors} baseline(s) to ${cfg.baselineDir}`,
  );
  return errors;
}

/** `vtest test` - capture, diff against stored baselines, write report. */
export async function runTest(
  cfg: Config,
  opts: RunOptions,
): Promise<RunSummary> {
  const started = Date.now();
  const jobs = filterJobs(buildJobs(cfg, cfg.baseUrl), opts.filter);
  console.log(`Capturing ${jobs.length} screenshot(s)...`);
  const outputs = await runCaptures(jobs, cfg, opts);

  const baselineDir = path.resolve(cfg.baselineDir);
  const pairs: Pair[] = outputs.map((o: CaptureOutput) => {
    const file = path.join(baselineDir, `${o.job.id}.png`);
    let baseline: Buffer | undefined = fs.existsSync(file)
      ? fs.readFileSync(file)
      : undefined;
    if (!baseline && o.png && opts.createMissing) {
      fs.mkdirSync(baselineDir, { recursive: true });
      fs.writeFileSync(file, o.png);
      baseline = o.png;
      console.log(`  + created baseline for ${o.job.id}`);
    }
    return { job: o.job, baseline, current: o.png, error: o.error };
  });

  return finish("test", cfg, pairs, path.resolve(cfg.outputDir), started, {
    baseline: "Baseline",
    current: "Current",
  });
}

/** `vtest compare` - diff two live environments (e.g. staging vs production). */
export async function runCompare(
  cfg: Config,
  urlA: string,
  urlB: string,
  opts: RunOptions,
): Promise<RunSummary> {
  const started = Date.now();
  const jobsA = filterJobs(buildJobs(cfg, urlA, true), opts.filter);
  const jobsB = filterJobs(buildJobs(cfg, urlB, true), opts.filter);

  console.log(`Capturing A: ${urlA}`);
  const outA = await runCaptures(jobsA, cfg, opts);
  console.log(`Capturing B: ${urlB}`);
  const outB = await runCaptures(jobsB, cfg, opts);

  const pairs: Pair[] = outB.map((b, i) => {
    const a = outA[i];
    return {
      job: b.job,
      baseline: a.png,
      current: b.png,
      error: a.error ?? b.error,
    };
  });

  const outDir = path.join(path.resolve(cfg.outputDir), "compare");
  return finish("compare", cfg, pairs, outDir, started, {
    baseline: `A: ${urlA}`,
    current: `B: ${urlB}`,
  });
}

function finish(
  mode: RunSummary["mode"],
  cfg: Config,
  pairs: Pair[],
  outDir: string,
  started: number,
  labels: RunSummary["labels"],
): RunSummary {
  fs.rmSync(outDir, { recursive: true, force: true });
  const results = evaluatePairs(cfg, pairs, outDir);

  const counts: Record<Status, number> = {
    passed: 0,
    failed: 0,
    new: 0,
    error: 0,
  };
  for (const r of results) counts[r.status]++;

  const summary: RunSummary = {
    mode,
    startedAt: new Date(started).toISOString(),
    durationMs: Date.now() - started,
    counts,
    results,
    labels,
  };

  fs.writeFileSync(
    path.join(outDir, "results.json"),
    JSON.stringify(summary, null, 2),
  );
  fs.writeFileSync(path.join(outDir, "report.html"), generateReport(summary));
  return summary;
}

function evaluatePairs(
  cfg: Config,
  pairs: Pair[],
  outDir: string,
): RunResult[] {
  for (const d of ["baseline", "current", "diff"]) {
    fs.mkdirSync(path.join(outDir, d), { recursive: true });
  }

  return pairs.map((pair): RunResult => {
    const { job } = pair;
    const base: RunResult = {
      id: job.id,
      pageName: job.page.name,
      url: job.url,
      browser: job.browser,
      viewport: job.viewport.name,
      status: "error",
    };

    if (pair.error || !pair.current) {
      return { ...base, error: pair.error ?? "Capture failed" };
    }

    const rel = (dir: string): string => `${dir}/${job.id}.png`;
    fs.writeFileSync(path.join(outDir, rel("current")), pair.current);

    if (!pair.baseline) {
      return { ...base, status: "new", current: rel("current") };
    }
    fs.writeFileSync(path.join(outDir, rel("baseline")), pair.baseline);

    const d = diffImages(
      pair.baseline,
      pair.current,
      job.page.threshold ?? cfg.threshold,
    );
    const limit = job.page.maxDiffRatio ?? cfg.maxDiffRatio;
    const failed = d.sizeMismatch || d.ratio > limit;

    const result: RunResult = {
      ...base,
      status: failed ? "failed" : "passed",
      ratio: d.ratio,
      changedPixels: d.changedPixels,
      sizeMismatch: d.sizeMismatch,
      baseline: rel("baseline"),
      current: rel("current"),
    };
    if (failed) {
      fs.writeFileSync(path.join(outDir, rel("diff")), d.diffPng);
      result.diff = rel("diff");
    }
    return result;
  });
}

/** `vtest approve` - promote the latest captures to baselines. */
export function approve(
  cfg: Config,
  opts: { all?: boolean; filter?: string },
): string[] {
  const outDir = path.resolve(cfg.outputDir);
  const file = path.join(outDir, "results.json");
  if (!fs.existsSync(file)) {
    throw new Error(`No results found at ${file}. Run "vtest test" first.`);
  }
  const summary = JSON.parse(fs.readFileSync(file, "utf8")) as RunSummary;
  const baselineDir = path.resolve(cfg.baselineDir);
  fs.mkdirSync(baselineDir, { recursive: true });

  const approved: string[] = [];
  for (const r of summary.results) {
    if (!r.current) continue;
    if (opts.filter && !r.id.includes(opts.filter)) continue;
    const eligible = opts.all || r.status === "failed" || r.status === "new";
    if (!eligible) continue;
    fs.copyFileSync(
      path.join(outDir, r.current),
      path.join(baselineDir, `${r.id}.png`),
    );
    approved.push(r.id);
  }
  return approved;
}
