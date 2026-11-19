#!/usr/bin/env node
// Nightly sync: pulls booster-box prices for Magic, Pokémon and One Piece from TCGCSV,
// appends them to data/history.json, and writes site/data.json for the heatmap.
//
// Follows TCGCSV's usage guidelines: checks last-updated.txt first, identifies itself,
// paces requests, and stores everything locally so the website never calls TCGCSV.
//
//   node scripts/sync.mjs            normal run (skips if TCGCSV has not updated)
//   node scripts/sync.mjs --force    run even if already synced today
//   node scripts/sync.mjs --build    rebuild site/data.json from stored data, no network

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GAMES, isBoosterBox, variantOf, tierOf, undatedGroupIds, addDays, pct } from './lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.TCGCSV_BASE || 'https://tcgcsv.com';
const UA = process.env.SYNC_USER_AGENT || 'BoxHeatmap/1.0';
const PACE_MS = Number(process.env.SYNC_PACE_MS ?? 150); // TCGCSV asks for at least 100 ms between requests
const KEEP_DAYS = 400;
const args = new Set(process.argv.slice(2));

const P = {
  state: path.join(ROOT, 'data/state.json'),
  catalog: path.join(ROOT, 'data/catalog.json'),
  history: path.join(ROOT, 'data/history.json'),
  overrides: path.join(ROOT, 'data/overrides.json'),
  volume: path.join(ROOT, 'data/volume.json'),
  out: path.join(ROOT, 'site/data.json'),
};

const readJson = async (p, fallback) => (existsSync(p) ? JSON.parse(await readFile(p, 'utf8')) : fallback);
const writeJson = async (p, v) => { await mkdir(path.dirname(p), { recursive: true }); await writeFile(p, JSON.stringify(v)); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

let requests = 0;
async function get(url, asText = false) {
  for (let attempt = 1; ; attempt++) {
    await sleep(PACE_MS);
    requests++;
    const res = await fetch(BASE + url, { headers: { 'User-Agent': UA } });
    if (res.ok) return asText ? (await res.text()).trim() : res.json();
    if (res.status === 404 && !asText) return { results: [] }; // TCGCSV omits empty groups
    if (attempt >= 3) throw new Error(`${res.status} for ${url}`);
    await sleep(attempt * 5000); // back off; TCGCSV throttles bursts for 10 minutes
  }
}

async function sync() {
  const state = await readJson(P.state, {});
  const lastUpdated = await get('/last-updated.txt', true);
  if (state.lastUpdated === lastUpdated && !args.has('--force')) {
    console.log(`TCGCSV unchanged since ${lastUpdated}; nothing to do.`);
    return false;
  }
  const day = lastUpdated.slice(0, 10);
  const catalog = await readJson(P.catalog, { groups: {} });
  const history = await readJson(P.history, {});
  const fullRefresh = args.has('--force') || new Date(day + 'T00:00:00Z').getUTCDay() === 0;
  const recentCut = addDays(day, -730);
  const subtypes = {};

  for (const cat of Object.keys(GAMES).map(Number)) {
    const groups = (await get(`/tcgplayer/${cat}/groups`)).results;
    const undated = undatedGroupIds(groups, day);
    for (const g of groups) {
      const published = g.publishedOn.slice(0, 10);
      const known = catalog.groups[g.groupId];
      // Product lists rarely change for old sets, so only re-read them weekly.
      const stale = !known || known.modifiedOn !== g.modifiedOn || published >= recentCut || fullRefresh;
      let boxes = known?.boxes ?? [], near = known?.near ?? [];
      if (stale) {
        const products = (await get(`/tcgplayer/${cat}/${g.groupId}/products`)).results ?? [];
        // Booster-ish sealed products the filter turned away, kept for the audit report.
        near = products.filter(p => /booster/i.test(p.name) && /\b(box|boxes|display)\b/i.test(p.name) && !isBoosterBox(p.name)).map(p => p.name);
        boxes = products.filter(p => isBoosterBox(p.name)).map(p => ({
          id: p.productId, name: p.name, url: p.url, image: p.imageUrl ?? null,
          presale: !!p.presaleInfo?.isPresale,
          releasedOn: p.presaleInfo?.releasedOn?.slice(0, 10) ?? null,
        }));
      }
      catalog.groups[g.groupId] = {
        cat, name: g.name, abbr: g.abbreviation, modifiedOn: g.modifiedOn,
        published: undated.has(g.groupId) ? null : published, boxes, near,
      };
      if (!boxes.length) continue;
      const prices = (await get(`/tcgplayer/${cat}/${g.groupId}/prices`)).results ?? [];
      const want = new Set(boxes.map(b => b.id));
      for (const pr of prices) {
        if (!want.has(pr.productId)) continue;
        const prev = history[pr.productId]?.[day];
        if (prev && prev[0] != null && pr.marketPrice == null) continue; // keep the priced sub-type
        // [market, lowest listing, median listing, lowest TCGplayer Direct listing]
        (history[pr.productId] ??= {})[day] = [pr.marketPrice ?? null, pr.lowPrice ?? null, pr.midPrice ?? null, pr.directLowPrice ?? null];
        (subtypes[pr.productId] ??= new Set()).add(pr.subTypeName);
      }
    }
    console.log(`${GAMES[cat].name}: ${groups.length} sets checked`);
  }

  const oldest = addDays(day, -KEEP_DAYS);
  for (const id of Object.keys(history)) for (const d of Object.keys(history[id])) if (d < oldest) delete history[id][d];

  catalog.syncedAt = lastUpdated;
  catalog.subtypes = Object.fromEntries(Object.entries(subtypes).map(([k, v]) => [k, [...v]]));
  await writeJson(P.catalog, catalog);
  await writeJson(P.history, history);
  await writeJson(P.state, { lastUpdated, requests });
  console.log(`Synced ${day} with ${requests} requests.`);
  return true;
}

// Most recent market price on or before `date`, looking back at most `maxGap` days.
function priceAt(series, date, maxGap) {
  for (let i = 0; i <= maxGap; i++) {
    const v = series[addDays(date, -i)]?.[0];
    if (v != null) return v;
  }
  return null;
}

async function build() {
  const catalog = await readJson(P.catalog, null);
  if (!catalog?.syncedAt) throw new Error('No catalog yet. Run a sync first.');
  const history = await readJson(P.history, {});
  const overrides = await readJson(P.overrides, {});
  const volume = await readJson(P.volume, {}); // optional: { productId: { "YYYY-MM-DD": unitsSold } }
  const day = catalog.syncedAt.slice(0, 10);
  const boxes = [];
  const skipped = [];

  for (const [gid, g] of Object.entries(catalog.groups)) {
    for (const b of g.boxes) {
      const released = overrides[gid] ?? g.published ?? b.releasedOn;
      const tier = tierOf(g.cat, released, day);
      const series = history[b.id] ?? {};
      const today = series[day] ?? [null, null];
      if (!tier) { skipped.push({ set: g.name, name: b.name, why: 'no release date' }); continue; }
      const price = today[0];
      const spark = [];
      for (let i = 29; i >= 0; i--) spark.push(series[addDays(day, -i)]?.[0] ?? null);
      const units = volume[b.id]?.[day] ?? null;
      boxes.push({
        id: b.id, game: GAMES[g.cat].key, set: g.name, abbr: g.abbr, name: b.name,
        variant: variantOf(b.name), released, tier,
        preorder: released > day || b.presale,
        price, low: today[1], mid: today[2] ?? null, direct: today[3] ?? null,
        image: b.image || `https://tcgplayer-cdn.tcgplayer.com/product/${b.id}_200w.jpg`,
        d1: pct(price, priceAt(series, addDays(day, -1), 0)),
        d7: pct(price, priceAt(series, addDays(day, -7), 2)),
        d30: pct(price, priceAt(series, addDays(day, -30), 4)),
        spark, units, dollars: units != null && price != null ? Math.round(units * price) : null,
        url: b.url,
      });
    }
  }
  boxes.sort((a, b) => a.game.localeCompare(b.game) || b.released.localeCompare(a.released) || a.name.localeCompare(b.name));
  const days = new Set();
  for (const s of Object.values(history)) for (const d of Object.keys(s)) days.add(d);
  await writeJson(P.out, {
    asOf: catalog.syncedAt, source: 'TCGplayer market prices via TCGCSV',
    historyDays: days.size, hasVolume: boxes.some(b => b.units != null),
    games: Object.values(GAMES).map(g => ({ key: g.key, name: g.name, vintageBefore: g.vintageBefore })),
    boxes, skipped,
  });
  // Audit: what the filter left out, and how complete each TCGplayer field is.
  const count = f => boxes.filter(f).length, groups = Object.values(catalog.groups);
  await writeJson(path.join(ROOT, 'data/audit.json'), {
    asOf: catalog.syncedAt, sets: groups.length, setsWithBoxes: groups.filter(g => g.boxes.length).length, boxes: boxes.length,
    fields: { marketPrice: count(b => b.price != null), lowPrice: count(b => b.low != null), midPrice: count(b => b.mid != null), directLowPrice: count(b => b.direct != null) },
    priceSubTypes: [...new Set(Object.values(catalog.subtypes ?? {}).flat())],
    boxesWithSeveralSubTypes: Object.entries(catalog.subtypes ?? {}).filter(([, v]) => v.length > 1).length,
    undatedSetsWithBoxes: skipped.length,
    excluded: groups.flatMap(g => (g.near ?? []).map(name => ({ game: GAMES[g.cat].key, set: g.name, name }))),
  });
  console.log(`Wrote ${boxes.length} boxes (${skipped.length} skipped), ${days.size} day(s) of history.`);
}

if (!args.has('--build')) await sync();
await build();
