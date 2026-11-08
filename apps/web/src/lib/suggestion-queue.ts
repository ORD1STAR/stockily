import { ApiError, SuggestionInput, suggestionsApi } from './api';

// Proposals written while offline (desktop app) wait here and are sent once the connection is back.
const KEY = 'stockily.pendingSuggestions';

function read(): SuggestionInput[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function write(items: SuggestionInput[]) {
  try {
    if (items.length) localStorage.setItem(KEY, JSON.stringify(items));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}

/** True when the request failed for lack of a connection (desktop offline, or no network at all). */
export function isOfflineError(err: unknown): boolean {
  return !(err instanceof ApiError) || err.status === 503 || err.status === 502 || err.status === 504;
}

/** Keeps the proposal for later. Returns false if it could not be stored. */
export function queueSuggestion(data: SuggestionInput): boolean {
  const items = read();
  items.push(data);
  write(items);
  return read().length === items.length;
}

let flushing = false;

/** Sends the waiting proposals, oldest first; stops at the first connection problem. */
export async function flushSuggestions(token: string | null) {
  if (flushing) return;
  flushing = true;
  try {
    for (let items = read(); items.length; items = read()) {
      try {
        await suggestionsApi.send(items[0], token);
      } catch (err) {
        // Offline again or rate limited: retry later. Rejected as invalid: drop it.
        if (isOfflineError(err) || (err instanceof ApiError && err.status === 429)) return;
      }
      write(read().slice(1));
    }
  } finally {
    flushing = false;
  }
}
