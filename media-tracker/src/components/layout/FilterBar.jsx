import { LayoutGrid, Columns3, Sparkles } from 'lucide-react';
import { MEDIA_TYPES, STATUSES } from '../../constants/media';

function Segmented({ options, value, onChange, ariaLabel }) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="glass flex items-center gap-1 rounded-xl border border-edge p-1"
    >
      {options.map((opt) => {
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.id)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all duration-200 ${
              active
                ? 'bg-accent text-accent-ink shadow-sm'
                : 'text-ink-muted hover:bg-surface-2 hover:text-ink'
            }`}
          >
            {opt.icon && <opt.icon size={15} />}
            <span className={opt.icon ? 'hidden sm:inline' : ''}>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function FilterBar({
  typeFilter,
  onTypeFilter,
  statusFilter,
  onStatusFilter,
  view,
  onView,
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented
        ariaLabel="Media type"
        value={typeFilter}
        onChange={onTypeFilter}
        options={[{ id: 'all', label: 'All', icon: Sparkles }, ...MEDIA_TYPES]}
      />

      {view === 'grid' && (
        <Segmented
          ariaLabel="Status"
          value={statusFilter}
          onChange={onStatusFilter}
          options={[
            { id: 'all', label: 'All statuses' },
            ...STATUSES.map(({ id, label }) => ({ id, label })),
          ]}
        />
      )}

      <div className="ml-auto">
        <Segmented
          ariaLabel="View"
          value={view}
          onChange={onView}
          options={[
            { id: 'grid', label: 'Grid', icon: LayoutGrid },
            { id: 'board', label: 'Board', icon: Columns3 },
          ]}
        />
      </div>
    </div>
  );
}
