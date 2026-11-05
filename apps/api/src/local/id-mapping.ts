const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

const isIdKey = (k: string) => k === 'id' || k.endsWith('Id');
const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/**
 * The device and the server run the same code, so a replayed request's
 * server response has exactly the shape of the response the device got
 * offline. Walking both in parallel pairs every id the device generated
 * with the id the server generated for the same row (the invoice, each of
 * its lines, …).
 */
export function pairIds(local: unknown, remote: unknown, out = new Map<string, string>()): Map<string, string> {
  if (Array.isArray(local) && Array.isArray(remote)) {
    for (let i = 0; i < Math.min(local.length, remote.length); i++) pairIds(local[i], remote[i], out);
  } else if (local && remote && typeof local === 'object' && typeof remote === 'object') {
    for (const [k, lv] of Object.entries(local as Record<string, unknown>)) {
      const rv = (remote as Record<string, unknown>)[k];
      if (isIdKey(k) && isUuid(lv) && isUuid(rv)) {
        if (lv !== rv) out.set(lv, rv);
      } else {
        pairIds(lv, rv, out);
      }
    }
  }
  return out;
}

export function uuidsIn(text: string): string[] {
  return [...new Set(text.match(UUID) ?? [])];
}

/** Rewrites every mapped local id in a path or a JSON body. UUIDs are unique, so plain textual replacement is exact. */
export function rewriteIds(text: string, map: Map<string, string>): string {
  return map.size === 0 ? text : text.replace(UUID, (id) => map.get(id) ?? map.get(id.toLowerCase()) ?? id);
}
