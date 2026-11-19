# Booster Box Heatmap

A static website showing sealed booster box prices for Magic: The Gathering, Pokémon and
One Piece, grouped into Newly Released, Modern and Vintage, colored by price change.

## How it works

1. **Once a day** a GitHub Actions job runs `scripts/sync.mjs`. It reads TCGplayer market
   prices from [TCGCSV](https://tcgcsv.com/), keeps only booster boxes, and appends the
   day's prices to `data/history.json`.
2. It writes **one file**, `site/data.json`, and publishes the `site/` folder to GitHub Pages.
3. **The website** (`site/index.html`) loads that one file on every visit. It never calls
   TCGCSV or TCGplayer itself.

TCGCSV updates exactly once a day, so the site is as fresh as its source.

## Set up

1. Create a GitHub repository and push this folder to it.
2. In the repository: **Settings → Pages → Source: GitHub Actions**.
3. **Actions → Nightly price sync → Run workflow** for the first run. It syncs, backfills
   three days of history (yesterday, 7 and 30 days ago) so the colors work at once, and deploys.

After that it runs by itself every day at 21:17 UTC.

To run it on your own computer instead (Node 22+):

    npm run sync       # pull today's prices and rebuild site/data.json
    npm run backfill   # one time, needs 7z installed
    npm run preview    # open the site locally

## Rules

| Tier | Rule |
|---|---|
| Newly Released | Released in the past 365 days, plus preorders |
| Vintage | Magic before 28 Jul 2003 (8th Edition); Pokémon before 25 Apr 2011 (Black & White); One Piece has none |
| Modern | Everything else |

A booster box is any product named "Booster Box" or "Booster Display". Cases, half boxes,
bundles, single packs and code cards are excluded. Collector, Play, Set, Draft and 1st Edition
boxes are separate tiles. The rules live in `scripts/lib.mjs`.

Sets in TCGplayer's catch-all groups (promos, "Box Sets") have no real release date and are
listed under `skipped` in `site/data.json`. To place one, add its group id and date to
`data/overrides.json`, for example `{ "19": "2010-01-01" }`.

## Sales volume

TCGCSV carries prices only. Volume is a slot waiting for a permitted source. To fill it,
write `data/volume.json` before the build step:

    { "712094": { "2026-11-18": 145 } }     // productId → date → boxes sold

When that file has data for the current day, tiles are sized by dollar volume (units × market
price) and the busiest boxes lead each group.

TCGplayer's terms of service prohibit crawling or scraping their site without permission, so
this project does not collect volume from their pages.

## Being a good neighbor to TCGCSV

TCGCSV is a free one-person project. This sync follows its usage guidelines: it checks
`last-updated.txt` first, sends an identifying User-Agent, waits 150 ms between requests,
re-reads old sets' product lists only weekly, and downloads each archive day at most once.
A normal day should be a few hundred requests (estimated; the sync prints the exact count); the limit is 10,000.
