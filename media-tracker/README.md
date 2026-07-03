# Shelf — Media Tracker

A modern, responsive tracker for **Video Games, Movies, and Books** across three
statuses: **Purchased** (backlog) → **Started** (in progress) → **Completed**.

Built with React 19 + Vite + Tailwind CSS v4 + Lucide icons. Data persists in
LocalStorage behind a swappable adapter, so moving to Supabase/Firebase later is
a one-file change.

## Getting started

```bash
cd media-tracker
npm install
npm run dev      # http://localhost:5173
```

That's it — no API keys required. Metadata search works out of the box:

| Type   | Default (keyless)             | Optional upgrade (add key to `.env.local`) |
| ------ | ----------------------------- | ------------------------------------------ |
| Books  | Open Library                  | —                                          |
| Movies | iTunes Search API             | TMDB (`VITE_TMDB_API_KEY`)                 |
| Games  | CheapShark (+ Steam art)      | RAWG (`VITE_RAWG_API_KEY`)                 |

Copy `.env.example` to `.env.local` to configure keys.

## Features

- **Dashboard** with a quick-stats panel (totals, backlog, in progress, completed this month) that adapts to the active media-type filter.
- **Grid view** with status filters, and a **Board view** with drag-and-drop between status columns. Every card also has a quick-action menu (touch-friendly) to move or remove items.
- **Automatic metadata**: search fetches cover art, release year, and description; items can also be added manually.
- **Artwork fallback chain**: high-res cover → lower-res cover → a gradient fallback card with the media-type icon and title. Images that load but are tiny (e.g. 1×1 "missing cover" pixels) are treated as missing.
- **4 persisted themes**: Light, Dark, Cyberpunk, Forest — pure CSS variables, applied before first paint (no flash of wrong theme).
- Mobile-first responsive layout, glassmorphism surfaces, subtle hover scale/opacity transitions.

## Architecture

```
media-tracker/
├── index.html                       # Pre-paint theme bootstrap
├── src/
│   ├── main.jsx / App.jsx           # Entry + dashboard shell
│   ├── index.css                    # THEME TOKENS (4 themes as CSS vars → Tailwind)
│   ├── config/themes.js             # Theme registry (id, name, icon, swatch)
│   ├── constants/media.js           # Media types & statuses (single source of truth)
│   ├── context/ThemeContext.jsx     # Theme state + persistence
│   ├── hooks/
│   │   ├── useMediaLibrary.js       # Library state + mutations
│   │   ├── useMediaSearch.js        # Debounced, abortable metadata search
│   │   ├── useLocalStorage.js       # Generic persisted state
│   │   └── useDebouncedValue.js
│   ├── services/
│   │   ├── storage.js               # Persistence adapter — swap for Supabase/Firebase here
│   │   └── metadata/                # One provider per media type, normalized output
│   │       ├── index.js · games.js · movies.js · books.js
│   └── components/
│       ├── layout/                  # Header, StatsPanel, FilterBar
│       ├── media/                   # MediaCard, MediaGrid, BoardView, AddMediaModal, ArtworkImage
│       ├── theme/ThemeSwitcher.jsx
│       └── ui/                      # Modal, Dropdown, EmptyState
```

### Adding a theme

1. Add a `[data-theme='yourtheme'] { ... }` variable block in `src/index.css`.
2. Register it in `src/config/themes.js`.

### Swapping LocalStorage for a database

`src/services/storage.js` exposes `loadLibrary()` / `saveLibrary(items)` as
async functions. Replace their bodies with Supabase/Firebase calls — hooks and
components are already written against the async interface.
