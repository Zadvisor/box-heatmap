#!/usr/bin/env node
// "On eBay now": lowest verified asking price for boxes that have no TCGplayer market price.
//
// Uses eBay's official Browse API (no scraping). To stay inside eBay's API License Agreement:
//   - results are written to site/ebay.json only, never committed, and fully replaced each run
//     (no price history is kept);
//   - the site shows them in their own section, apart from TCGplayer data, with the fetch time,
//     and hides them once they are more than six hours old.
//
// Needs EBAY_CLIENT_ID and EBAY_CLIENT_SECRET (a production keyset from developer.ebay.com).
// Without them the script does nothing.

import { readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyListing, queryFor, conflictsFor } from './ebay-rules.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = process.env.EBAY_API_BASE || 'https://api.ebay.com';
const OUT = path.join(ROOT, 'site/ebay.json');
const PACE_MS = Number(process.env.EBAY_PACE_MS ?? 250);
const MIN_PRICE = 60;        // below this it is packs, empty boxes or accessories
const sleep = ms => new Promise(r => setTimeout(r, ms));

const id = (process.env.EBAY_CLIENT_ID || '').trim(), secret = (process.env.EBAY_CLIENT_SECRET || '').trim();
if (!id || !secret) {
  await rm(OUT, { force: true });
  console.log('No eBay keys set; skipping eBay asking prices.');
  process.exit(0);
}
if (!existsSync(path.join(ROOT, 'site/data.json'))) throw new Error('Run scripts/sync.mjs first.');
const data = JSON.parse(await readFile(path.join(ROOT, 'site/data.json'), 'utf8'));
const targets = data.boxes.filter(b => b.price == null && !b.preorder);
const setsByGame = {};
for (const b of data.boxes) (setsByGame[b.game] ??= []).push(b.set);

const tokenRes = await fetch(`${API}/identity/v1/oauth2/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64') },
  body: 'grant_type=client_credentials&scope=' + encodeURIComponent('https://api.ebay.com/oauth/api_scope'),
});
if (!tokenRes.ok) {
  // Format checks only; no part of either key is printed.
  console.log(`Key format check: client ID is a production key: ${/-PRD-/.test(id)}; secret starts with PRD-: ${secret.startsWith('PRD-')}; secret length: ${secret.length}; secret looks like a Dev ID: ${/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(secret)}`);
  throw new Error(`eBay token request failed: ${tokenRes.status} ${(await tokenRes.text()).slice(0, 200)}`);
}
const { access_token } = await tokenRes.json();

const items = [];
let calls = 0, failed = 0;
for (const box of targets) {
  await sleep(PACE_MS);
  const params = new URLSearchParams({
    q: queryFor(box), limit: '50', sort: 'price',
    filter: `buyingOptions:{FIXED_PRICE},conditions:{NEW},price:[${MIN_PRICE}..],priceCurrency:USD`,
  });
  const res = await fetch(`${API}/buy/browse/v1/item_summary/search?${params}`, {
    headers: { Authorization: `Bearer ${access_token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' },
  });
  calls++;
  const conflicts = conflictsFor(box, setsByGame[box.game]);
  if (!res.ok) { failed++; if (res.status === 429 || failed > 10) throw new Error(`eBay search failed: ${res.status}`); continue; }
  const found = (await res.json()).itemSummaries ?? [];
  const ok = found.map(l => {
    const price = Number(l.price?.value), ship = l.shippingOptions?.[0];
    const shipping = ship?.shippingCostType === 'FIXED' ? Number(ship.shippingCost?.value ?? 0) : null;
    return { l, price, shipping, total: price + (shipping ?? 0) };
  }).filter(x => x.l.price?.currency === 'USD' && verifyListing(box, x.l, conflicts)).sort((a, b) => a.total - b.total);
  if (!ok.length) continue;
  // Drop stragglers far below the pack: a "box" at a third of the typical ask is almost never a sealed box.
  const mid = ok[Math.floor(ok.length / 2)].total;
  const kept = ok.filter(x => x.total >= mid * 0.35);
  const best = kept[0];
  items.push({
    id: box.id, game: box.game, tier: box.tier, set: box.set, name: box.name, variant: box.variant,
    ask: best.price, shipping: best.shipping, total: best.total, listings: kept.length,
    title: best.l.title, url: best.l.itemAffiliateWebUrl || best.l.itemWebUrl,
    seller: best.l.seller?.username ?? null, feedback: best.l.seller?.feedbackPercentage ?? null,
  });
}

await writeFile(OUT, JSON.stringify({ fetchedAt: new Date().toISOString(), searched: targets.length, items }));
console.log(`eBay: ${items.length} of ${targets.length} unpriced boxes have a verified listing (${calls} calls, ${failed} failed).`);
