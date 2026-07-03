/**
 * Movies — TMDB when a key is configured (VITE_TMDB_API_KEY in .env.local),
 * otherwise the keyless iTunes Search API so the app works out of the box.
 */
const TMDB_KEY = import.meta.env.VITE_TMDB_API_KEY;

export async function searchMovies(query, signal) {
  return TMDB_KEY
    ? searchTmdb(query, signal)
    : searchItunes(query, signal);
}

async function searchTmdb(query, signal) {
  const url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_KEY}&query=${encodeURIComponent(query)}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`TMDB error ${res.status}`);
  const data = await res.json();

  return (data.results ?? []).slice(0, 8).map((m) => ({
    type: 'movie',
    source: 'tmdb',
    sourceId: String(m.id),
    title: m.title,
    year: m.release_date ? Number(m.release_date.slice(0, 4)) : null,
    description: m.overview ?? '',
    coverUrl: m.poster_path
      ? `https://image.tmdb.org/t/p/w500${m.poster_path}`
      : null,
    coverUrlFallback: m.poster_path
      ? `https://image.tmdb.org/t/p/w185${m.poster_path}`
      : null,
  }));
}

async function searchItunes(query, signal) {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=movie&limit=8`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`iTunes error ${res.status}`);
  const data = await res.json();

  return (data.results ?? []).map((m) => ({
    type: 'movie',
    source: 'itunes',
    sourceId: String(m.trackId),
    title: m.trackName,
    year: m.releaseDate ? Number(m.releaseDate.slice(0, 4)) : null,
    description: m.longDescription ?? m.shortDescription ?? '',
    // artworkUrl100 is 100x100; the CDN serves larger sizes at the same path.
    coverUrl: m.artworkUrl100?.replace('100x100', '600x600') ?? null,
    coverUrlFallback: m.artworkUrl100 ?? null,
  }));
}
