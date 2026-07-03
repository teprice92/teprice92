import { useMemo } from 'react';
import { Layers, Play, ShoppingBag, CalendarCheck } from 'lucide-react';
import { COMPLETED_VERB, mediaType } from '../../constants/media';

function completedThisMonth(items) {
  const now = new Date();
  return items.filter((it) => {
    if (it.status !== 'completed') return false;
    const d = new Date(it.statusChangedAt);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }).length;
}

/**
 * Quick stats for the current type filter. Values wear ink tokens (not accent
 * colors) per stat-tile conventions; the icon carries the accent quietly.
 */
export function StatsPanel({ items, typeFilter }) {
  const stats = useMemo(() => {
    const scoped =
      typeFilter === 'all' ? items : items.filter((it) => it.type === typeFilter);
    const label = typeFilter === 'all' ? 'items' : mediaType(typeFilter).label.toLowerCase();
    const doneVerb = typeFilter === 'all' ? 'completed' : COMPLETED_VERB[typeFilter];

    return [
      {
        icon: Layers,
        label: `Total ${label}`,
        value: scoped.length,
      },
      {
        icon: ShoppingBag,
        label: `${capitalize(label)} in backlog`,
        value: scoped.filter((it) => it.status === 'purchased').length,
      },
      {
        icon: Play,
        label: `${capitalize(label)} in progress`,
        value: scoped.filter((it) => it.status === 'started').length,
      },
      {
        icon: CalendarCheck,
        label: `${capitalize(doneVerb)} this month`,
        value: completedThisMonth(scoped),
      },
    ];
  }, [items, typeFilter]);

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {stats.map((s) => (
        <div
          key={s.label}
          className="glass card-shadow flex items-center gap-3 rounded-2xl border border-edge px-4 py-3.5"
        >
          <div className="rounded-xl bg-accent-soft p-2.5 text-accent">
            <s.icon size={18} />
          </div>
          <div className="min-w-0">
            <p className="truncate text-xs text-ink-muted">{s.label}</p>
            <p className="text-xl font-semibold text-ink">{s.value}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
