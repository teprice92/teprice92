import { useState } from 'react';
import { mediaType } from '../../constants/media';

/**
 * Cover art with a graceful degradation chain:
 *   coverUrl -> coverUrlFallback -> gradient fallback card.
 * Images that load but are tiny (low-res capsule thumbs) are treated as
 * failures so the gradient card renders instead of a blurry stretch.
 */
export function ArtworkImage({ item, className = '' }) {
  const sources = [item.coverUrl, item.coverUrlFallback].filter(Boolean);
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);

  const advance = () => {
    setLoaded(false);
    setIndex((i) => i + 1);
  };

  if (index >= sources.length) {
    return <FallbackArtwork item={item} className={className} />;
  }

  return (
    <img
      src={sources[index]}
      alt={item.title}
      loading="lazy"
      draggable={false}
      onError={advance}
      onLoad={(e) => {
        // Open Library serves a 1x1 pixel for missing covers; Steam capsule
        // thumbs are ~120px wide. Both read as "no usable art".
        if (e.target.naturalWidth < 150) advance();
        else setLoaded(true);
      }}
      className={`h-full w-full object-cover transition-opacity duration-500 ${
        loaded ? 'opacity-100' : 'opacity-0'
      } ${className}`}
    />
  );
}

export function FallbackArtwork({ item, className = '' }) {
  const Icon = mediaType(item.type)?.icon;
  return (
    <div
      className={`flex h-full w-full flex-col items-center justify-center gap-3 bg-gradient-to-br from-accent via-accent/70 to-accent-2 p-4 text-center ${className}`}
    >
      {Icon && <Icon size={36} strokeWidth={1.5} className="text-accent-ink/80" />}
      <p className="line-clamp-4 text-sm font-semibold leading-snug tracking-wide text-accent-ink">
        {item.title}
      </p>
      {item.year && (
        <p className="text-xs font-medium text-accent-ink/70">{item.year}</p>
      )}
    </div>
  );
}
