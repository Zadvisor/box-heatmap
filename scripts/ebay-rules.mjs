// What counts as a "verified" eBay listing for a given box, and how to search for it.
// Deliberately strict: a wrong match is worse than no match.

const squash = s => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');
const STOP = new Set(['the', 'and', 'for', 'set', 'base', 'edition', 'booster', 'box', 'display', 'universes', 'beyond']);
const LANGS = /\b(japanese|japan|jpn?|korean|chinese|s-chinese|t-chinese|german|deutsch|french|italian|spanish|portuguese|russian|thai|indonesian)\b/i;
const JUNK = /\b(empty|no cards|box only|display only|wrappers?|opened|open box|resealed|re-?sealed|re-?pack(ed)?|custom|proxy|replica|fake|reprint|art (set|print)|break|live rip|rip|pick|choose|you pick|from (a )?(booster )?box|pack fresh|single packs?|loose packs?|1 pack|one pack|half|case|elite trainer|etb|bundle|blister|tin|theme deck|starter deck|prerelease|sleeves?|playmat|binder|poster|lot of|bulk|damaged|display case|acrylic|protector|topper)\b/i;
const VARIANTS = ['collector', 'draft', 'set', 'play', 'theme', 'jumpstart'];

// "SV01: Scarlet & Violet Base Set" -> "Scarlet & Violet Base Set"
export const setName = box => box.set.replace(/^[A-Z]{2,4}\d{0,2}: /, '');

export function queryFor(box) {
  const game = box.game === 'pokemon' ? 'pokemon' : box.game === 'magic' ? 'mtg' : 'one piece';
  const v = box.variant.toLowerCase();
  const extra = VARIANTS.filter(x => v.includes(x)).concat(/1st edition/.test(v) ? ['1st edition'] : []);
  return `${game} ${setName(box)} ${extra.join(' ')} booster box sealed`.replace(/[^\w\s&'-]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function verifyListing(box, listing) {
  const title = listing.title || '', t = title.toLowerCase(), sq = squash(title);
  if (!/\bbooster\b/.test(t) || !/\b(box|display)\b/.test(t)) return false;
  if (JUNK.test(t)) return false;
  const v = box.variant.toLowerCase();
  if (LANGS.test(t) && !LANGS.test(v)) return false;
  // every meaningful word of the set name must appear ("HeartGold SoulSilver" matches "Heart Gold Soul Silver")
  const words = setName(box).toLowerCase().normalize('NFD').split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !STOP.has(w));
  if (words.length ? !words.every(w => sq.includes(w))
    // names made only of common words ("Base Set") must appear as a phrase, and not as "Base Set 2"
    : !new RegExp(`\\b${setName(box).toLowerCase().replace(/[^a-z0-9 ]/g, '')}\\b(?!\\s*\\d\\b)`).test(t)) return false;
  // edition and booster type must agree with the box
  const first = /\b(1st|first) ed/.test(t);
  if (first !== /1st edition/.test(v)) return false;
  if (/shadowless/.test(t) !== /shadowless/.test(v)) return false;
  for (const x of VARIANTS) if (x !== 'set' && new RegExp(`\\b${x}\\b`).test(t) !== v.includes(x)) return false;
  // established seller
  const s = listing.seller || {};
  if (!(Number(s.feedbackPercentage) >= 98 && Number(s.feedbackScore) >= 50)) return false;
  return Number(listing.price?.value) > 0;
}
