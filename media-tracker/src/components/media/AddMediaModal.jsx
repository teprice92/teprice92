import { useState } from 'react';
import { Search, Loader2, Check, Plus, PencilLine } from 'lucide-react';
import { MEDIA_TYPES, STATUSES } from '../../constants/media';
import { useMediaSearch } from '../../hooks/useMediaSearch';
import { Modal } from '../ui/Modal';
import { ArtworkImage } from './ArtworkImage';

export function AddMediaModal({ onClose, onAdd, hasItem, initialType = 'game' }) {
  const [type, setType] = useState(initialType);
  const [statusId, setStatusId] = useState('purchased');
  const [query, setQuery] = useState('');
  const [justAdded, setJustAdded] = useState(new Set());
  const { results, loading, error } = useMediaSearch(type, query);

  const add = (result) => {
    onAdd(result, statusId);
    setJustAdded((prev) => new Set(prev).add(result.sourceId));
  };

  const addManual = () => {
    const title = query.trim();
    if (!title) return;
    onAdd(
      { type, source: 'manual', sourceId: null, title, year: null, description: '', coverUrl: null, coverUrlFallback: null },
      statusId,
    );
    onClose();
  };

  return (
    <Modal title="Add to your shelf" onClose={onClose}>
      <div className="flex flex-col gap-4">
        {/* Media type */}
        <div className="flex gap-2">
          {MEDIA_TYPES.map((t) => (
            <button
              key={t.id}
              onClick={() => setType(t.id)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
                type === t.id
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-edge text-ink-muted hover:border-edge-strong hover:text-ink'
              }`}
            >
              <t.icon size={16} />
              {t.label}
            </button>
          ))}
        </div>

        {/* Target status for added items */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wider text-ink-faint">
            Add as
          </span>
          <div className="flex gap-1.5">
            {STATUSES.map((s) => (
              <button
                key={s.id}
                onClick={() => setStatusId(s.id)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  statusId === s.id
                    ? 'bg-accent text-accent-ink'
                    : 'bg-surface-2 text-ink-muted hover:text-ink'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search
            size={16}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint"
          />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${MEDIA_TYPES.find((t) => t.id === type).label.toLowerCase()}…`}
            className="w-full rounded-xl border border-edge bg-surface py-2.5 pl-10 pr-4 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
          />
          {loading && (
            <Loader2
              size={16}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 animate-spin text-accent"
            />
          )}
        </div>

        {/* Results */}
        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex flex-col gap-2">
          {results.map((r) => {
            const added = justAdded.has(r.sourceId) || hasItem(r.type, r.sourceId);
            return (
              <div
                key={`${r.source}:${r.sourceId}`}
                className="flex items-center gap-3 rounded-xl border border-edge bg-surface/60 p-2 transition-colors hover:border-edge-strong"
              >
                <div className="h-20 w-14 shrink-0 overflow-hidden rounded-lg bg-surface-2">
                  <ArtworkImage item={r} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">
                    {r.title}
                    {r.year && (
                      <span className="ml-1.5 font-normal text-ink-muted">({r.year})</span>
                    )}
                  </p>
                  {r.description && (
                    <p className="mt-0.5 line-clamp-2 text-xs text-ink-muted">
                      {r.description}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => !added && add(r)}
                  disabled={added}
                  className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
                    added
                      ? 'bg-surface-2 text-ink-faint'
                      : 'bg-accent text-accent-ink hover:scale-105'
                  }`}
                >
                  {added ? <Check size={14} /> : <Plus size={14} />}
                  {added ? 'Added' : 'Add'}
                </button>
              </div>
            );
          })}

          {!loading && !error && query.trim().length >= 2 && results.length === 0 && (
            <p className="py-4 text-center text-sm text-ink-muted">
              No matches found.
            </p>
          )}

          {query.trim().length >= 2 && !loading && (
            <button
              onClick={addManual}
              className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-edge-strong px-3 py-2.5 text-sm font-medium text-ink-muted transition-colors hover:border-accent hover:text-accent"
            >
              <PencilLine size={15} />
              Add “{query.trim()}” manually
            </button>
          )}

          {query.trim().length < 2 && (
            <p className="py-6 text-center text-sm text-ink-faint">
              Start typing to search — cover art, year and description are
              fetched automatically.
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
