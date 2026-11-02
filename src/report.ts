import type { RunResult, RunSummary, Status } from "./types.js";

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const ORDER: Record<Status, number> = { error: 0, failed: 1, new: 2, passed: 3 };

function img(src: string, label: string): string {
  return `<figure><figcaption>${esc(label)}</figcaption><a href="${esc(src)}" target="_blank"><img src="${esc(src)}" loading="lazy" alt="${esc(label)}"></a></figure>`;
}

function card(r: RunResult, labels: RunSummary["labels"]): string {
  const open = r.status === "passed" ? "" : " open";
  const pct = r.ratio !== undefined ? ` · ${(r.ratio * 100).toFixed(3)}% changed` : "";
  const size = r.sizeMismatch ? " · size changed" : "";

  let body: string;
  if (r.error) {
    body = `<pre class="err">${esc(r.error)}</pre>`;
  } else if (r.status === "new" && r.current) {
    body = `<p>No baseline yet. Run <code>vtest approve</code> to accept this capture.</p>${img(r.current, "Current")}`;
  } else {
    const parts = [
      r.baseline ? img(r.baseline, labels.baseline) : "",
      r.current ? img(r.current, labels.current) : "",
      r.diff ? img(r.diff, "Diff") : "",
    ].join("");
    const overlay =
      r.baseline && r.current
        ? `<details class="ov"><summary>Overlay slider</summary>
<div class="overlay" style="--pos:50%">
  <img src="${esc(r.baseline)}" alt="">
  <img class="top" src="${esc(r.current)}" alt="">
  <input type="range" min="0" max="100" value="50" aria-label="Slider"
    oninput="this.parentElement.style.setProperty('--pos', this.value + '%')">
</div></details>`
        : "";
    body = `<div class="grid">${parts}</div>${overlay}`;
  }

  return `<details class="card ${r.status}"${open}>
<summary><span class="badge ${r.status}">${r.status}</span> <strong>${esc(r.pageName)}</strong>
<span class="meta">${esc(r.browser)} · ${esc(r.viewport)}${pct}${size}</span></summary>
<p class="url">${esc(r.url)}</p>${body}</details>`;
}

export function generateReport(summary: RunSummary): string {
  const sorted = [...summary.results].sort(
    (a, b) => ORDER[a.status] - ORDER[b.status] || a.id.localeCompare(b.id),
  );
  const c = summary.counts;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>vtest report</title>
<style>
:root{--bg:#fff;--fg:#1a1a1a;--muted:#666;--line:#ddd;--pass:#1a7f37;--fail:#cf222e;--new:#9a6700;--err:#8250df}
@media (prefers-color-scheme:dark){:root{--bg:#111;--fg:#eee;--muted:#999;--line:#333}}
body{font:15px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--fg);margin:0;padding:24px;max-width:1500px;margin-inline:auto}
h1{margin:0 0 4px}.sub{color:var(--muted);margin:0 0 16px}
.stats{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px}
.stat{border:1px solid var(--line);border-radius:8px;padding:8px 16px}
.stat b{font-size:22px;display:block}
.card{border:1px solid var(--line);border-radius:8px;margin-bottom:10px;padding:8px 14px}
.card summary{cursor:pointer;padding:4px 0}
.meta{color:var(--muted);margin-left:8px}.url{color:var(--muted);font-size:13px;word-break:break-all}
.badge{display:inline-block;min-width:56px;text-align:center;border-radius:12px;color:#fff;font-size:12px;padding:1px 8px;text-transform:uppercase}
.badge.passed{background:var(--pass)}.badge.failed{background:var(--fail)}.badge.new{background:var(--new)}.badge.error{background:var(--err)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;align-items:start}
figure{margin:0}figcaption{font-weight:600;margin-bottom:4px}
img{max-width:100%;border:1px solid var(--line);display:block}
.err{white-space:pre-wrap;color:var(--err)}
.ov{margin-top:12px}
.overlay{position:relative;max-width:900px}
.overlay img.top{position:absolute;inset:0;clip-path:inset(0 calc(100% - var(--pos)) 0 0)}
.overlay input{width:100%;margin-top:6px;position:relative;z-index:1}
.overlay{padding-bottom:28px}.overlay input{position:absolute;bottom:0;left:0}
</style></head><body>
<h1>Visual test report</h1>
<p class="sub">${esc(summary.mode)} · ${esc(summary.startedAt)} · ${(summary.durationMs / 1000).toFixed(1)}s</p>
<div class="stats">
<div class="stat"><b>${c.passed}</b>passed</div>
<div class="stat"><b>${c.failed}</b>failed</div>
<div class="stat"><b>${c.new}</b>new</div>
<div class="stat"><b>${c.error}</b>errors</div>
</div>
${sorted.map((r) => card(r, summary.labels)).join("\n")}
</body></html>`;
}
