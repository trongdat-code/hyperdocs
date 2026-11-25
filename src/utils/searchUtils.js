/**
 * Diacritic-friendly & case-insensitive search helpers for Vietnamese and English
 * documents, folders, and labels/tags.
 */

export function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .trim();
}

export function getSearchTokens(query) {
  const normalized = normalizeSearchText(query);
  if (!normalized) return [];
  return normalized.split(/\s+/).filter(Boolean);
}

/**
 * Returns true if a single tag/label matches the current search query
 * (used both for filtering and for highlighting matched tag pills).
 */
export function doesTagMatchQuery(tag, query) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return false;
  const normalizedTag = normalizeSearchText(tag);
  if (!normalizedTag) return false;

  if (normalizedTag.includes(normalizedQuery)) return true;

  const tokens = getSearchTokens(normalizedQuery);
  if (tokens.length > 1) {
    return tokens.some((tok) => tok.length >= 2 && normalizedTag.includes(tok));
  }
  return false;
}

/**
 * Returns true if a document matches the search query by title or any tag/label
 * (case-insensitive, diacritic-friendly, supports multi-word queries across title & tags).
 */
export function doesDocMatchQuery(doc, query) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;

  const normalizedTitle = normalizeSearchText(doc?.title);
  const normalizedTags = (doc?.tags || []).map(normalizeSearchText);

  if (normalizedTitle.includes(normalizedQuery)) return true;
  if (normalizedTags.some((t) => t.includes(normalizedQuery))) return true;

  const tokens = getSearchTokens(normalizedQuery);
  if (tokens.length > 1) {
    const combined = `${normalizedTitle} ${normalizedTags.join(' ')}`;
    return tokens.every((tok) => combined.includes(tok));
  }

  return false;
}

/**
 * Returns true if a folder matches the query via its name, folder tags, or any child document.
 */
export function doesFolderMatchQuery(folder, folderDocs, query) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;

  const normalizedName = normalizeSearchText(folder?.name);
  const normalizedTags = (folder?.tags || []).map(normalizeSearchText);

  if (normalizedName.includes(normalizedQuery)) return true;
  if (normalizedTags.some((t) => t.includes(normalizedQuery))) return true;

  return (folderDocs || []).some((doc) => doesDocMatchQuery(doc, normalizedQuery));
}
