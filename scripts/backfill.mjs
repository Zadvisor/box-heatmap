#!/usr/bin/env node
// One-time history backfill from TCGCSV's daily price archive, so % changes work on day one.
//
//   node scripts/backfill.mjs 1 7 30        days ago to fetch (default: 1 7 30)
//
// Archives are 2-4 MB each and never change. TCGCSV asks that each one be downloaded
// only once, so every fetched date is recorded in data/backfilled.json and skipped after.
// Requires 7z on the PATH (preinstalled on GitHub's Ubuntu runners).

import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addDays } from './lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.TCGCSV_BASE || 'https://tcgcsv.com';
const UA = process.env.SYNC_USER_AGENT || 'BoxHeatmap/1.0';
const readJson = async (p, f) => (existsSync(p) ? JSON.parse(await readFile(p, 'utf8')) : f);

const catalog = await readJson(path.join(ROOT, 'data/catalog.json'), null);
if (!catalog?.syncedAt) throw new Error('Run scripts/sync.mjs once before backfilling.');
const history = await readJson(path.join(ROOT, 'data/history.json'), {});
const donePath = path.join(ROOT, 'data/backfilled.json');
const done = await readJson(donePath, []);
const today = catalog.syncedAt.slice(0, 10);
const offsets = process.argv.slice(2).map(Number).filter(n => n > 0);
const dates = (offsets.length ? offsets : [1, 7, 30]).map(n => addDays(today, -n));

for (const date of dates) {
  if (done.includes(date) || date < '2024-02-08') { console.log(`${date}: skipped`); continue; }
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'tcgcsv-'));
  try {
    const res = await fetch(`${BASE}/archive/tcgplayer/prices-${date}.ppmd.7z`, { headers: { 'User-Agent': UA } });
    if (!res.ok) { console.log(`${date}: archive unavailable (${res.status})`); continue; }
    const file = path.join(tmp, 'a.7z');
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
    // One pass over the archive, extracting only the three games' folders.
    const cats = [...new Set(Object.values(catalog.groups).map(g => g.cat))];
    execFileSync(process.env.SEVENZIP || '7z', ['x', '-y', `-o${tmp}`, file, ...cats.map(c => `${date}/${c}/*`)], { stdio: 'ignore' });
    let n = 0;
    for (const [gid, g] of Object.entries(catalog.groups)) {
      if (!g.boxes.length) continue;
      const p = path.join(tmp, date, String(g.cat), gid, 'prices');
      if (!existsSync(p)) continue;
      const want = new Set(g.boxes.map(b => b.id));
      for (const pr of JSON.parse(await readFile(p, 'utf8')).results ?? []) {
        if (!want.has(pr.productId)) continue;
        const prev = history[pr.productId]?.[date];
        if (prev && prev[0] != null && pr.marketPrice == null) continue;
        (history[pr.productId] ??= {})[date] = [pr.marketPrice ?? null, pr.lowPrice ?? null, pr.midPrice ?? null, pr.directLowPrice ?? null];
        n++;
      }
    }
    done.push(date);
    console.log(`${date}: ${n} box prices added`);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
  await new Promise(r => setTimeout(r, 2000));
}
await writeFile(path.join(ROOT, 'data/history.json'), JSON.stringify(history));
await writeFile(donePath, JSON.stringify(done));
