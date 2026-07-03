import {
  Gamepad2,
  Film,
  BookOpen,
  ShoppingBag,
  Play,
  CheckCircle2,
} from 'lucide-react';

export const MEDIA_TYPES = [
  { id: 'game', label: 'Games', singular: 'Game', icon: Gamepad2 },
  { id: 'movie', label: 'Movies', singular: 'Movie', icon: Film },
  { id: 'book', label: 'Books', singular: 'Book', icon: BookOpen },
];

export const STATUSES = [
  {
    id: 'purchased',
    label: 'Purchased',
    hint: 'Backlog',
    icon: ShoppingBag,
  },
  {
    id: 'started',
    label: 'Started',
    hint: 'In progress',
    icon: Play,
  },
  {
    id: 'completed',
    label: 'Completed',
    hint: 'Done',
    icon: CheckCircle2,
  },
];

export const mediaType = (id) => MEDIA_TYPES.find((t) => t.id === id);
export const status = (id) => STATUSES.find((s) => s.id === id);

/** Verb used for "completed" per media type, e.g. "Movies watched this month". */
export const COMPLETED_VERB = {
  game: 'beaten',
  movie: 'watched',
  book: 'read',
};
