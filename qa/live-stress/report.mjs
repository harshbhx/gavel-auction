// Builds findings.md from findings.jsonl: duplicates across viewports are merged into one row.
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve(process.env.OUT || 'stress-out');
const file = path.join(OUT, 'findings.jsonl');
const rows = fs.existsSync(file)
  ? fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l))
  : [];
const order = { high: 0, medium: 1, low: 2, info: 3 };
const groups = new Map();
for (const r of rows) {
  const key = `${r.title}||${r.page}`;
  const g = groups.get(key) || { ...r, viewports: new Set(), evidences: [], ids: [] };
  g.viewports.add(`${r.project}:${r.viewport}`);
  if (r.evidence) g.evidences.push(r.evidence);
  g.ids.push(r.id);
  if (order[r.sev] < order[g.sev]) g.sev = r.sev;
  groups.set(key, g);
}
const list = [...groups.values()].sort(
  (a, b) => order[a.sev] - order[b.sev] || a.page.localeCompare(b.page),
);
const cell = (s) =>
  String(s ?? '')
    .replace(/\|/g, '/')
    .replace(/\n/g, ' ');
let md = `## Live stress findings\n\n${rows.length} raw findings, ${list.length} distinct (${['high', 'medium', 'low', 'info'].map((s) => `${list.filter((x) => x.sev === s).length} ${s}`).join(', ')}).\n\n`;
md +=
  '| # | Sev | Page | Viewports | Title | Steps | Expected | Actual | Evidence | Likely cause |\n|---|---|---|---|---|---|---|---|---|---|\n';
list.forEach((g, i) => {
  md += `| ${i + 1} | ${g.sev} | ${cell(g.page)} | ${cell([...g.viewports].join(', '))} | ${cell(g.title)} | ${cell(g.steps)} | ${cell(g.expected)} | ${cell(g.actual)} | ${cell(g.evidences.slice(0, 2).join(', ') || g.spec)} | ${cell(g.cause)} |\n`;
});
// test run summary
const resFile = path.join(OUT, 'results.json');
if (fs.existsSync(resFile)) {
  const res = JSON.parse(fs.readFileSync(resFile, 'utf8'));
  const st = res.stats || {};
  md += `\n### Test run\n\nexpected ${st.expected}, unexpected ${st.unexpected}, skipped ${st.skipped}, flaky ${st.flaky}, duration ${Math.round((st.duration || 0) / 1000)} s\n`;
  const notes = [];
  const walk = (suite) => {
    for (const s of suite.suites || []) walk(s);
    for (const sp of suite.specs || [])
      for (const t of sp.tests || [])
        for (const r of t.results || [])
          for (const a of r.annotations || t.annotations || [])
            if (['scripted-pacing', 'slow3g', 'offline-navigation'].includes(a.type))
              notes.push(`- ${t.projectName}: ${a.type}: ${a.description}`);
  };
  for (const s of res.suites || []) walk(s);
  if (notes.length) md += `\n### Measurements\n\n${[...new Set(notes)].join('\n')}\n`;
}
fs.writeFileSync(path.join(OUT, 'findings.md'), md);
fs.writeFileSync(
  path.join(OUT, 'findings-merged.json'),
  JSON.stringify(
    list.map((g) => ({ ...g, viewports: [...g.viewports] })),
    null,
    1,
  ),
);
console.log(md.slice(0, 4000));
// rerun marker
// run marker 2
