/**
 * Books — Open Library (https://openlibrary.org/dev/docs/api/search).
 * Free, no API key required.
 */
export async function searchBooks(query, signal) {
  const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=8&fields=key,title,first_publish_year,cover_i,author_name,first_sentence`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Open Library error ${res.status}`);
  const data = await res.json();

  return (data.docs ?? []).map((doc) => ({
    type: 'book',
    source: 'openlibrary',
    sourceId: doc.key,
    title: doc.title,
    year: doc.first_publish_year ?? null,
    description: [
      doc.author_name?.slice(0, 2).join(', '),
      doc.first_sentence?.[0],
    ]
      .filter(Boolean)
      .join(' — '),
    coverUrl: doc.cover_i
      ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`
      : null,
    coverUrlFallback: doc.cover_i
      ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`
      : null,
  }));
}
