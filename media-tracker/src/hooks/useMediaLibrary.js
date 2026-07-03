import { useCallback, useEffect, useRef, useState } from 'react';
import { loadLibrary, saveLibrary } from '../services/storage';

/**
 * Owns the media library: loading, persistence, and all mutations.
 *
 * Item shape:
 * {
 *   id, type: 'game'|'movie'|'book', title, year, description, coverUrl,
 *   coverUrlFallback, status: 'purchased'|'started'|'completed',
 *   source, sourceId, addedAt, statusChangedAt
 * }
 */
export function useMediaLibrary() {
  const [items, setItems] = useState([]);
  const [ready, setReady] = useState(false);
  const loadedRef = useRef(false);

  useEffect(() => {
    loadLibrary().then((stored) => {
      setItems(stored);
      loadedRef.current = true;
      setReady(true);
    });
  }, []);

  // Persist after the initial load has hydrated state.
  useEffect(() => {
    if (loadedRef.current) saveLibrary(items);
  }, [items]);

  const addItem = useCallback((data, statusId = 'purchased') => {
    const now = new Date().toISOString();
    const item = {
      id: crypto.randomUUID(),
      status: statusId,
      addedAt: now,
      statusChangedAt: now,
      ...data,
    };
    setItems((prev) => [item, ...prev]);
    return item;
  }, []);

  const setStatus = useCallback((id, statusId) => {
    setItems((prev) =>
      prev.map((it) =>
        it.id === id && it.status !== statusId
          ? { ...it, status: statusId, statusChangedAt: new Date().toISOString() }
          : it,
      ),
    );
  }, []);

  const removeItem = useCallback((id) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  }, []);

  const hasItem = useCallback(
    (type, sourceId) =>
      sourceId != null &&
      items.some((it) => it.type === type && it.sourceId === sourceId),
    [items],
  );

  return { items, ready, addItem, setStatus, removeItem, hasItem };
}
