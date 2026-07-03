import { useEffect, useState } from 'react';
import { searchMedia } from '../services/metadata';
import { useDebouncedValue } from './useDebouncedValue';

/** Debounced, abortable metadata search for the add-media modal. */
export function useMediaSearch(type, query) {
  const debouncedQuery = useDebouncedValue(query, 400);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const q = debouncedQuery.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    searchMedia(type, q, controller.signal)
      .then((r) => {
        setResults(r);
        setLoading(false);
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setError('Search failed — check your connection and try again.');
        setResults([]);
        setLoading(false);
      });

    return () => controller.abort();
  }, [type, debouncedQuery]);

  const isTyping = query.trim().length >= 2 && query !== debouncedQuery;
  return { results, loading: loading || isTyping, error };
}
