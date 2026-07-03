import { Plus, Library } from 'lucide-react';

export function EmptyState({ onAdd }) {
  return (
    <div className="glass card-shadow flex flex-col items-center gap-4 rounded-2xl border border-edge px-6 py-16 text-center">
      <div className="rounded-2xl bg-accent-soft p-4">
        <Library size={32} className="text-accent" />
      </div>
      <div>
        <h2 className="text-lg font-semibold text-ink">Nothing here yet</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Search for a game, movie, or book to start your collection.
        </p>
      </div>
      <button
        onClick={onAdd}
        className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink transition-transform hover:scale-105"
      >
        <Plus size={16} />
        Add your first item
      </button>
    </div>
  );
}
