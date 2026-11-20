// What counts as a "verified" eBay listing for a given box, and how to search for it.
// Deliberately strict: a wrong match is worse than no match.

const squash = s => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');
const norm = s => ' ' + s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
const has = (title, name) => norm(title).includes(norm(name)) || (squash(name).length >= 10 && squash(title).includes(squash(name)));

const STOP = new Set(['the', 'and', 'for', 'set', 'base', 'edition', 'booster', 'box', 'display', 'universes', 'beyond']);
const LANGS = /\b(japanese|japan|jpn?|korean|chinese|s-chinese|t-chinese|german|deutsch|french|italian|spanish|portuguese|russian|thai|indonesian|dutch|nederlands)\b/i;
const JUNK = /\b(empty|no cards|box only|display only|wrappers?|opened|open box|resealed|re-?sealed|re-?pack(ed)?|repack|custom|proxy|replica|fake|reprint|art (set|print)|break|live rip|rip|pick|choose|you pick|from (a )?(booster )?box|pack fresh|single packs?|loose packs?|1 pack|one pack|half|case|elite trainer|etb|bundle|blister|tin|theme deck|starter deck|prerelease|sleeves?|playmat|binder|poster|lots?|bulk|damaged|display case|acrylic|protector|topper|guaranteed|mystery|slim|jumbo)\b/i;
const MULTI = /\b([2-9]|two|three|four|five|six)\s*x?\s*(booster\s*)?box(es)?\b|\bx\s*[2-9]\b/i;
const GAME = { pokemon: / pokemon /, magic: / (mtg|magic) /, onepiece: / (one piece|optcg) / };
const OTHER_GAMES = / (sorcery|lorcana|yugioh|yu gi oh|digimon|flesh and blood|star wars unlimited|weiss|dragon ball|riftbound|union arena|gundam) /;
// Booster types that are separate products; listing and box must agree.
const TYPES = ['collector', 'set', 'play', 'jumpstart', 'premium foil', 'enhanced', 'vip', 'omega', 'compleat'];
// Pokemon era names double as base-set names and appear in titles of other sets of the era.
const SERIES = new Set(['base set', 'black and white', 'heartgold soulsilver', 'diamond and pearl', 'platinum', 'xy',
  'sun and moon', 'sword and shield', 'scarlet and violet base set', 'scarlet and violet', 'mega evolution'].map(s => norm(s)));

// "SV01: Scarlet & Violet Base Set" -> "Scarlet & Violet Base Set"
export const setName = box => box.set.replace(/^[A-Z]{2,4}\d{0,2}: /, '');

export function queryFor(box) {
  const game = box.game === 'pokemon' ? 'pokemon' : box.game === 'magic' ? 'mtg' : 'one piece';
  const n = norm(box.name).replace(/ base set booster /g, ' base booster ');
  const extra = TYPES.filter(x => n.includes(` ${x} booster `)).concat(/1st edition/i.test(box.name) ? ['1st edition'] : []);
  return `${game} ${setName(box)} ${extra.join(' ')} booster box sealed`.replace(/[^\w\s&'-]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Other set names of the same game that a title must not mention (e.g. "Commander Legends" for the
// "Legends" box). Names contained in this box's own set name, and Pokemon era names, are ignored.
export function conflictsFor(box, allSetNames) {
  const own = norm(setName(box));
  return [...new Set(allSetNames)].map(s => s.replace(/^[A-Z]{2,4}\d{0,2}: /, ''))
    .filter(s => norm(s) !== own && !own.includes(norm(s)) && !(box.game === 'pokemon' && SERIES.has(norm(s))) && squash(s).length >= 4);
}

export function verifyListing(box, listing, conflicts = []) {
  const title = listing.title || '', t = norm(title), sq = squash(title), n = norm(box.name);
  if (!/ booster (box|display) /.test(t)) return false;
  if (JUNK.test(title) || MULTI.test(title)) return false;
  if (!GAME[box.game].test(t) || OTHER_GAMES.test(t)) return false;
  if (LANGS.test(title) && !LANGS.test(box.name)) return false;
  // the set itself must be named ("HeartGold SoulSilver" matches "Heart Gold Soul Silver")
  const words = norm(setName(box)).trim().split(' ').filter(w => w.length >= 3 && !STOP.has(w));
  if (!has(title, setName(box)) && !(words.length && words.every(w => sq.includes(w)))) return false;
  if (!words.length && / (base set|set) \d /.test(t)) return false;            // "Base Set 2"
  if (conflicts.some(c => has(title, c))) return false;
  // a title year well after release means a different product
  const year = Number((box.released || '').slice(0, 4));
  if (year && (title.match(/\b(199\d|20[0-3]\d)\b/g) || []).some(y => Number(y) > year + 1)) return false;
  // edition and booster type must agree with the box
  if (/\b(1st|first) ed/i.test(title) !== /1st edition/i.test(box.name)) return false;
  if (/shadowless/i.test(title) !== /shadowless/i.test(box.name)) return false;
  const baseSet = s => s.replace(/ base set booster /g, ' base booster ');
  for (const x of TYPES) if (baseSet(t).includes(` ${x} booster `) !== baseSet(n).includes(` ${x} booster `)) return false;
  // established seller
  const s = listing.seller || {};
  if (!(Number(s.feedbackPercentage) >= 98 && Number(s.feedbackScore) >= 50)) return false;
  return Number(listing.price?.value) > 0;
}
