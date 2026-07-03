import { useState } from 'react';
import { STATUSES } from '../../constants/media';
import { MediaCard } from './MediaCard';

/**
 * Kanban-style board: one column per status, HTML5 drag-and-drop between
 * columns. Cards keep their quick-action dropdown as the touch-friendly path.
 */
export function BoardView({ items, onSetStatus, onRemove }) {
  const [dragOver, setDragOver] = useState(null);

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {STATUSES.map((st) => {
        const columnItems = items.filter((it) => it.status === st.id);
        const isOver = dragOver === st.id;
        return (
          <section
            key={st.id}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setDragOver(st.id);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(null);
              const id = e.dataTransfer.getData('text/plain');
              if (id) onSetStatus(id, st.id);
            }}
            className={`rounded-2xl border p-3 transition-colors duration-200 ${
              isOver
                ? 'border-accent bg-accent-soft/60'
                : 'border-edge bg-surface/40'
            }`}
          >
            <header className="mb-3 flex items-center gap-2 px-1">
              <st.icon size={16} className="text-accent" />
              <h2 className="text-sm font-semibold text-ink">{st.label}</h2>
              <span className="ml-auto rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-ink-muted">
                {columnItems.length}
              </span>
            </header>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-2 xl:grid-cols-3">
              {columnItems.map((item) => (
                <MediaCard
                  key={item.id}
                  item={item}
                  draggable
                  onSetStatus={onSetStatus}
                  onRemove={onRemove}
                />
              ))}
            </div>
            {columnItems.length === 0 && (
              <p className="px-1 py-8 text-center text-sm text-ink-faint">
                {isOver ? 'Drop it here' : `Nothing ${st.hint.toLowerCase()} yet`}
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}
