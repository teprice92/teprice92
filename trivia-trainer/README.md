# Trivia Night Trainer

A practice app for pub quiz and trivia nights. Plain HTML, CSS and JavaScript with no build step.

## Run it

Open `index.html` in a browser. That's it.

## What it does

- **150 questions** across Pop Culture, Music, History, Geography, Science & Nature, Sports and Random Facts, each tagged easy, medium or hard, most with a short fact to help it stick.
- **Two formats**
  - *Multiple choice*: four options, optional 20-second timer. Keys A–D or 1–4 to answer, Enter for next.
  - *Pub rules*: no options. Say your answer, reveal it, and mark yourself (Y / N). This is how a real quiz night works.
- **Listening round**: 5 to 15 second music and movie clips. Add a clip by choosing an audio or video file, pick the moment on its waveform, and the app saves only that short piece. Clips with three wrong answers can be played multiple choice; the rest are played pub rules.
- **Drill my misses**: every question you get wrong goes on a list until you get it right.
- **Your wheel**: one wedge per category that grows with your accuracy, so you can see your weak spots.
- Questions you've seen least are served first, so repeat rounds stay fresh.

Progress is saved in your browser's `localStorage`, so each friend keeps their own stats.

## Keeping questions fresh

`scripts/update-questions.mjs` adds new questions to `data/packs.js`. The app merges them in automatically, and anything added in the last 21 days is tagged "fresh" (there's an "Only fresh" option under the rules).

It has two sources:

- **Open Trivia DB** (free, no key): about 90 questions per run from [opentdb.com](https://opentdb.com), licensed CC BY-SA 4.0. The app credits it in the footer.
- **Claude** (optional): writes 3 current-events questions per category, using web search to check recent facts. Needs an `ANTHROPIC_API_KEY`.

Every question is checked before it's saved: the category is valid, there are exactly three distinct wrong answers, and it doesn't duplicate an existing question.

```sh
cd trivia-trainer
npm install                          # only needed for the Claude source
npm run update                       # Open Trivia DB
ANTHROPIC_API_KEY=... npm run update:claude   # both sources
npm test
```

**Automatic weekly refresh:** `.github/workflows/refresh-trivia.yml` runs every Monday and commits any new questions. It only runs from the repository's default branch, so merge this branch first. To include Claude's questions, add an `ANTHROPIC_API_KEY` secret under *Settings → Secrets and variables → Actions*. You can also run it by hand from the Actions tab.

## Audio clips

On the shared Claude link, clips are stored with the page itself (its shared database plus uploaded files), so everyone it's shared with plays the same library. Only people who can edit the page can add or delete clips. Clips are cut and re-encoded in the browser (`audio.js`), which works in Chrome, Edge, Firefox and Safari.

Opened as a plain file or from GitHub Pages, there's no shared storage. You can still bundle clips by adding a `data/clips.js` file and a `<script src="data/clips.js">` tag before `app.js`:

```js
window.TRIVIA_CLIPS = [
  { kind: "music", answer: "Song by Artist", detail: "1984", wrong: ["…", "…", "…"], src: "clips/song.m4a", start: 30, end: 40 },
];
```

Keep clips short and the app private to your group: songs and films are copyrighted.

## Adding questions

Edit `questions.js`. Each entry is:

```js
[difficulty, "Question?", "Correct answer", ["Wrong 1", "Wrong 2", "Wrong 3"], "Optional note"]
```

Add new questions at the **end** of a category's list. Question IDs come from their position, so inserting in the middle would shift everyone's saved stats.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page structure for the three screens (setup, question, results) |
| `styles.css` | Light and dark themes, layout |
| `app.js` | Round logic, timer, scoring, saved stats, the wheel, the clip library |
| `audio.js` | Decoding, waveform drawing, clip cutting and playback |
| `questions.js` | The hand-written core question bank |
| `data/packs.js` | Generated questions from the updater (don't edit by hand) |
| `scripts/update-questions.mjs` | The question updater, with tests in `update-questions.test.mjs` |
