# Trivia Night Trainer

A practice app for pub quiz and trivia nights. Plain HTML, CSS and JavaScript with no build step.

## Run it

Open `index.html` in a browser. That's it.

## What it does

- **150 questions** across Pop Culture, Music, History, Geography, Science & Nature, Sports and Random Facts, each tagged easy, medium or hard, most with a short fact to help it stick.
- **Two formats**
  - *Multiple choice*: four options, optional 20-second timer. Keys A–D or 1–4 to answer, Enter for next.
  - *Pub rules*: no options. Say your answer, reveal it, and mark yourself (Y / N). This is how a real quiz night works.
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
| `app.js` | Round logic, timer, scoring, saved stats, the wheel |
| `questions.js` | The hand-written core question bank |
| `data/packs.js` | Generated questions from the updater (don't edit by hand) |
| `scripts/update-questions.mjs` | The question updater, with tests in `update-questions.test.mjs` |
