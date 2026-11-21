#!/usr/bin/env node
// Daily units sold per booster box, from TCGplayer's price-history data (collected with TCGplayer's
// permission), plus an access check for eBay Marketplace Insights.
//
// Publishing is OFF unless the repository variable PUBLISH_VOLUME is "true". Until then this script
// only reports how many boxes it could collect and writes no sales numbers anywhere.
// When on, it writes data/volume.json: a single snapshot, replaced each day (no history is kept;
// TCGplayer returns the last 30 days on every request anyway).

import { readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addDays } from './lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = process.env.TCGP_HISTORY_BASE || 'https://infinite-api.tcgplayer.com';
const EBAY = process.env.EBAY_API_BASE || 'https://api.ebay.com';
const UA = process.env.SYNC_USER_AGENT || 'BoxHeatmap/1.0';
const PACE_MS = Number(process.env.VOLUME_PACE_MS ?? 1200);
const PUBLISH = process.env.PUBLISH_VOLUME === 'true';
const OUT = path.join(ROOT, 'data/volume.json'), STATE = path.join(ROOT, 'data/volume-state.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const readJson = async (p, f) => (existsSync(p) ? JSON.parse(await readFile(p, 'utf8')) : f);

const today = process.env.VOLUME_TODAY || new Date().toISOString().slice(0, 10);
const day = addDays(today, -1);                       // last complete UTC day
const state = await readJson(STATE, {});

if (!PUBLISH) await rm(OUT, { force: true });
if (state.day === day && state.published === PUBLISH && !process.argv.includes('--force')) {
  console.log(`Sales volume for ${day} already collected; skipping.`);
} else {
  const data = JSON.parse(await readFile(path.join(ROOT, 'site/data.json'), 'utf8'));
  const units = {}, d7 = {}, d30 = {}, statuses = {};
  let ok = 0, empty = 0, failed = 0, n = 0;
  for (const b of data.boxes) {
    n++;
    await sleep(PACE_MS);
    let res;
    try { res = await fetch(`${API}/price/history/${b.id}/detailed?range=month`, { headers: { 'User-Agent': UA, Accept: 'application/json' } }); }
    catch { failed++; continue; }
    statuses[res.status] = (statuses[res.status] || 0) + 1;
    if (!res.ok) {
      failed++;
      if (n >= 5 && ok === 0) { console.log('First requests all failed; stopping to avoid hammering the endpoint.'); break; }
      if (res.status === 429) await sleep(30000);
      continue;
    }
    const rows = ((await res.json()).result || []).filter(r => !r.condition || /unopened/i.test(r.condition));
    if (!rows.length) { empty++; continue; }
    const byDay = {};
    for (const r of rows) for (const k of r.buckets || []) byDay[k.bucketStartDate] = (byDay[k.bucketStartDate] || 0) + Number(k.quantitySold || 0);
    let s7 = 0, s30 = 0;
    for (const [d, q] of Object.entries(byDay)) { if (d <= day && d > addDays(day, -7)) s7 += q; if (d <= day && d > addDays(day, -30)) s30 += q; }
    units[b.id] = byDay[day] ?? 0; d7[b.id] = s7; d30[b.id] = s30;
    ok++;
  }
  const total = Object.values(units).reduce((a, b) => a + b, 0);
  console.log(`TCGplayer sales volume for ${day}: ${ok} of ${data.boxes.length} boxes collected, ${empty} with no sales data, ${failed} failed ` +
    `(HTTP ${Object.entries(statuses).map(([k, v]) => `${k}×${v}`).join(', ') || 'none'}). ${total.toLocaleString()} boxes sold in total.`);
  if (PUBLISH && ok) {
    await writeFile(OUT, JSON.stringify({ day, source: 'TCGplayer sales', units, d7, d30 }));
    console.log('Published to data/volume.json.');
  } else if (!PUBLISH) {
    console.log('Not published: set the repository variable PUBLISH_VOLUME to "true" once display is permitted.');
  }
  await writeFile(STATE, JSON.stringify({ day, published: PUBLISH, collected: ok }));
}

// eBay Marketplace Insights: report whether this app has access. No sales data is kept.
const id = (process.env.EBAY_CLIENT_ID || '').trim(), secret = (process.env.EBAY_CLIENT_SECRET || '').trim();
if (id && secret) {
  const tok = await fetch(`${EBAY}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64') },
    body: 'grant_type=client_credentials&scope=' + encodeURIComponent('https://api.ebay.com/oauth/api_scope/buy.marketplace.insights'),
  });
  const tb = await tok.json().catch(() => ({}));
  if (!tok.ok) console.log(`eBay Marketplace Insights: not enabled for this app (${tok.status} ${tb.error || ''}: ${tb.error_description || ''}).`);
  else {
    const s = await fetch(`${EBAY}/buy/marketplace_insights/v1_beta/item_sales/search?limit=5&q=${encodeURIComponent('pokemon booster box')}`,
      { headers: { Authorization: `Bearer ${tb.access_token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' } });
    const sb = await s.json().catch(() => ({}));
    console.log(`eBay Marketplace Insights: access granted; test search returned HTTP ${s.status}` +
      (sb.errors ? ` (${String(sb.errors[0]?.message || '').slice(0, 160)})` : `, ${sb.total ?? (sb.itemSales || []).length} matching sales`) + '.');
  }
}
