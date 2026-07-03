import { useState, useEffect } from 'react';

/** useState persisted to LocalStorage under `key`. */
export function useLocalStorage(key, initialValue) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw !== null ? JSON.parse(raw) : initialValue;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Ignore write failures (private mode, quota).
    }
  }, [key, value]);

  return [value, setValue];
}
