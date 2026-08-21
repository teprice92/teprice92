# Timeblock

A month planner built around timed blocks, for ADHD brains. No accounts, no server, no
tracking — one HTML file, a stylesheet, and a script. Everything you enter stays in your
browser's local storage.

## Run it

```bash
cd adhd-planner
npx http-server -p 8080     # or: python3 -m http.server 8080
```

Then open <http://localhost:8080>.

Opening `index.html` directly from disk mostly works, but some browsers refuse
`localStorage` on `file://` URLs and your data will vanish on reload. Serve it over HTTP,
or install it to your home screen from a hosted copy.

Run `node build.js` to produce two bundles:

- `dist/timeblock.html` — the whole app inlined into one portable file you can email to
  yourself, drop on any static host, or open from a USB stick.
- `dist/timeblock.fragment.html` — the same page without the document wrapper, for hosts
  that supply their own (Claude Artifacts among them). This build omits the file-download
  path, since embedded viewers cannot save files; **Copy backup** works everywhere.

## What it does

**Now** — the block you are supposed to be in, as a depleting dial, with the remaining
minutes in the largest type on the screen. Your if-then plan is read back to you. Starting
only asks for two minutes.

**Day** — a timeline from your waking hour to your bedtime. Tap any empty strip to drop a
block there. Buffers are inserted automatically after long blocks.

**Month** — every day as a cell: one dot per block (hollow = planned, solid = done) and a
bar showing how full the day already is. Anchors are the two or three things that must
move this month; blocks tie to them, so progress is visible long before the deadline.

**Rewards** — XP, level, badges, unlockable themes, and repair tokens that absorb a missed
day without resetting your streak.

**Why** — every mechanic in the app, and the study it came from.

## Keyboard

| Key | Does |
|-----|------|
| `1`–`5` | Switch view |
| `n` | New block |
| `c` | Park a distraction |
| `space` | Start / pause the current block |

## Your data

Local storage only. Nothing leaves the browser. **Settings → Copy backup / Download
backup** gives you a JSON file; **Restore** takes it back. Clearing site data erases
everything, so take a backup before you do that or before switching devices.

## Files

```
index.html   markup and the three dialogs
styles.css   design tokens + eight themes
app.js       state, scheduling, XP, achievements, rendering
why.md       the research this is built on, with citations
build.js     inlines the above into dist/ (standalone + embeddable fragment)
```

## What this is not

Not a medical device, not a substitute for assessment, therapy or medication, and not
evidence-based in the sense of having been trialled — it is a planner whose design
decisions are each traceable to published work. `why.md` includes the caveats, including
where the underlying literature disagrees with itself.
