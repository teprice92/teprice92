import { Sun, Moon, Zap, Trees } from 'lucide-react';

/**
 * Theme registry. Adding a theme = one entry here + one `[data-theme='...']`
 * block of CSS variables in index.css. Nothing else changes.
 */
export const THEMES = [
  {
    id: 'light',
    name: 'Light',
    description: 'Clean & crisp with vibrant accents',
    icon: Sun,
    swatch: ['#f4f5f7', '#4f46e5', '#db2777'],
  },
  {
    id: 'dark',
    name: 'Dark',
    description: 'Sleek slate with neon accents',
    icon: Moon,
    swatch: ['#0b1220', '#22d3ee', '#a78bfa'],
  },
  {
    id: 'cyberpunk',
    name: 'Cyberpunk',
    description: 'Deep purple, neon pink & cyan',
    icon: Zap,
    swatch: ['#0d0221', '#ff2ec4', '#00f0ff'],
  },
  {
    id: 'forest',
    name: 'Forest',
    description: 'Muted sage, cream & earth tones',
    icon: Trees,
    swatch: ['#eee9dd', '#4e7358', '#a8703f'],
  },
];

export const DEFAULT_THEME = 'dark';
