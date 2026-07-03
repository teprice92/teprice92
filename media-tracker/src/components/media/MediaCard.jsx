import { MoreVertical, Trash2, Check } from 'lucide-react';
import { STATUSES, mediaType, status } from '../../constants/media';
import { ArtworkImage } from './ArtworkImage';
import { Dropdown } from '../ui/Dropdown';

export function MediaCard({ item, onSetStatus, onRemove, draggable = false }) {
  const type = mediaType(item.type);
  const st = status(item.status);
  const TypeIcon = type.icon;
  const StatusIcon = st.icon;

  return (
    <article
      draggable={draggable}
      onDragStart={
        draggable
          ? (e) => {
              e.dataTransfer.setData('text/plain', item.id);
              e.dataTransfer.effectAllowed = 'move';
            }
          : undefined
      }
      className="group glass card-shadow relative flex flex-col overflow-hidden rounded-2xl border border-edge transition-all duration-300 hover:scale-[1.03] hover:border-edge-strong hover:card-shadow-lg"
    >
      <div className="relative aspect-[2/3] w-full overflow-hidden bg-surface-2">
        <ArtworkImage item={item} />

        {/* Status pill */}
        <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/55 px-2 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
          <StatusIcon size={12} />
          {st.label}
        </span>

        {/* Card actions */}
        <div className="absolute right-2 top-2 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
          <Dropdown
            trigger={({ toggle }) => (
              <button
                onClick={toggle}
                aria-label={`Actions for ${item.title}`}
                className="rounded-full bg-black/55 p-1.5 text-white backdrop-blur-sm transition-colors hover:bg-black/75"
              >
                <MoreVertical size={16} />
              </button>
            )}
          >
            {({ close }) => (
              <>
                <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                  Move to
                </p>
                {STATUSES.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      onSetStatus(item.id, s.id);
                      close();
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-surface-2"
                  >
                    <s.icon size={15} className="text-ink-muted" />
                    <span className="flex-1">{s.label}</span>
                    {item.status === s.id && (
                      <Check size={15} className="text-accent" />
                    )}
                  </button>
                ))}
                <div className="my-1 border-t border-edge" />
                <button
                  onClick={() => {
                    onRemove(item.id);
                    close();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-500 transition-colors hover:bg-surface-2"
                >
                  <Trash2 size={15} />
                  Remove
                </button>
              </>
            )}
          </Dropdown>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-0.5 p-3">
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-ink">
          {item.title}
        </h3>
        <p className="flex items-center gap-1.5 text-xs text-ink-muted">
          <TypeIcon size={12} />
          {type.singular}
          {item.year ? ` · ${item.year}` : ''}
        </p>
      </div>
    </article>
  );
}
