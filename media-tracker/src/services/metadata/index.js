import { searchGames } from './games';
import { searchMovies } from './movies';
import { searchBooks } from './books';

const providers = {
  game: searchGames,
  movie: searchMovies,
  book: searchBooks,
};

/**
 * Search external metadata for a media type. Returns a normalized list:
 * { type, source, sourceId, title, year, description, coverUrl, coverUrlFallback }
 */
export function searchMedia(type, query, signal) {
  const provider = providers[type];
  if (!provider) return Promise.resolve([]);
  return provider(query.trim(), signal);
}
