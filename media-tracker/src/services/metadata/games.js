/**
 * Games — RAWG when a key is configured (VITE_RAWG_API_KEY in .env.local),
 * otherwise the keyless CheapShark API. CheapShark only returns tiny Steam
 * capsule thumbnails, so we rewrite them to Steam's high-res library art and
 * let <ArtworkImage> fall back down the chain if that art doesn't exist.
 */
const RAWG_KEY = import.meta.env.VITE_RAWG_API_KEY;

export async function searchGames(query, signal) {
  return RAWG_KEY ? searchRawg(query, signal) : searchCheapShark(query, signal);
}

async function searchRawg(query, signal) {
  const url = `https://api.rawg.io/api/games?key=${RAWG_KEY}&search=${encodeURIComponent(query)}&page_size=8`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`RAWG error ${res.status}`);
  const data = await res.json();

  return (data.results ?? []).map((g) => ({
    type: 'game',
    source: 'rawg',
    sourceId: String(g.id),
    title: g.name,
    year: g.released ? Number(g.released.slice(0, 4)) : null,
    description: (g.genres ?? []).map((x) => x.name).join(', '),
    coverUrl: g.background_image ?? null,
    coverUrlFallback: null,
  }));
}

async function searchCheapShark(query, signal) {
  const url = `https://www.cheapshark.com/api/1.0/games?title=${encodeURIComponent(query)}&limit=8`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`CheapShark error ${res.status}`);
  const data = await res.json();

  return (data ?? []).map((g) => {
    const steamLibraryArt = g.steamAppID
      ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.steamAppID}/library_600x900.jpg`
      : null;
    return {
      type: 'game',
      source: 'cheapshark',
      sourceId: String(g.gameID),
      title: g.external,
      year: null,
      description: '',
      coverUrl: steamLibraryArt ?? g.thumb ?? null,
      coverUrlFallback: g.thumb ?? null,
    };
  });
}
