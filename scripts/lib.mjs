// Shared rules: which products count as a booster box, and which tier a set belongs to.

export const GAMES = {
  1:  { key: 'magic',    name: 'Magic: The Gathering', vintageBefore: '2003-07-28' }, // 8th Edition (start of the Modern card frame)
  3:  { key: 'pokemon',  name: 'Pokémon',              vintageBefore: '2011-04-25' }, // Black & White base set
  68: { key: 'onepiece', name: 'One Piece',            vintageBefore: null },         // game launched 2022: no vintage tier
};

const INCLUDE = /booster\s+(box|display)/i;
// Not a single sealed booster box: cases, multi-box lots, bundles, loose packs, promos, toppers.
const EXCLUDE = /\bcase\b|\bbundle\b|\blot\b|\bset of\b|box topper|\bempty\b|\bpack\b(?!s)|half booster|code card|digital|\[set of|display case|costco|sam's club/i;

export function isBoosterBox(name) {
  return INCLUDE.test(name) && !EXCLUDE.test(name);
}

// Label for boxes that are separate products within one set (Collector, 1st Edition, Japanese...).
export function variantOf(name) {
  const tags = [];
  const m = name.match(/\b(collector|play|draft|set|jumpstart|enhanced|omega|sleeved)\s+booster/i);
  if (m && !(m[1].toLowerCase() === 'set' && /base set booster/i.test(name))) tags.push(m[1][0].toUpperCase() + m[1].slice(1).toLowerCase());
  for (const b of name.matchAll(/[\[\(]([^\]\)]+)[\]\)]/g)) tags.push(b[1].trim());
  if (/1st edition/i.test(name) && !tags.some(t => /1st edition/i.test(t))) tags.push('1st Edition');
  return tags.join(' · ') || 'Standard';
}

export function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// tier: 'new' (released within 365 days, or not yet released), 'vintage', 'modern'
export function tierOf(categoryId, released, today) {
  if (!released) return null;
  if (released >= addDays(today, -365)) return 'new';
  const cut = GAMES[categoryId].vintageBefore;
  if (cut && released < cut) return 'vintage';
  return 'modern';
}

// TCGplayer stamps catch-all groups (promos, "Box Sets", league kits) with the current
// date as their publish date. If several groups in a game share the sync date, none of
// those dates are real, so those groups are treated as undated.
export function undatedGroupIds(groups, syncDate) {
  const same = groups.filter(g => g.publishedOn.slice(0, 10) === syncDate);
  return new Set(same.length >= 4 ? same.map(g => g.groupId) : []);
}

export function pct(now, then) {
  if (now == null || then == null || then === 0) return null;
  return Math.round(((now - then) / then) * 10000) / 100;
}
