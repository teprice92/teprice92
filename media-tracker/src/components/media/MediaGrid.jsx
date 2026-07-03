import { MediaCard } from './MediaCard';
import { EmptyState } from '../ui/EmptyState';

export function MediaGrid({ items, onSetStatus, onRemove, onAdd }) {
  if (items.length === 0) return <EmptyState onAdd={onAdd} />;

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {items.map((item) => (
        <MediaCard
          key={item.id}
          item={item}
          onSetStatus={onSetStatus}
          onRemove={onRemove}
        />
      ))}
    </div>
  );
}
