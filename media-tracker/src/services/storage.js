/**
 * Persistence adapter.
 *
 * The app only talks to the async interface exported here, so swapping
 * LocalStorage for Supabase/Firebase later means replacing this one file
 * (e.g. `loadLibrary` -> `supabase.from('media_items').select()`), with no
 * changes to hooks or components.
 */
const LIBRARY_KEY = 'mediatracker:library:v1';

export async function loadLibrary() {
  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function saveLibrary(items) {
  try {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(items));
  } catch {
    // Quota exceeded / private mode — the in-memory state still works.
  }
}
