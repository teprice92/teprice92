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
| `questions.js` | The question bank |
