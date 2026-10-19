import { useEffect } from 'react';

// Pages like Achats/Ventes/Stock each fetch their own copy of `sites` and
// `partners` on mount and cache it in local state — there's no shared store.
// Creating a fournisseur or a site happens either from a global overlay
// (PartnersModal, opened from the sidebar on top of whatever page is
// showing) or from SitesPage, and in the overlay case the page underneath
// never remounts, so its stale local list — and any button disabled by its
// length — was stuck until a manual refresh. This is a tiny pub/sub so the
// place that creates the resource can say "this changed" and every page
// showing it can re-run its own loader.
export type DataResource = 'partners' | 'sites';

const listeners: Record<DataResource, Set<() => void>> = {
  partners: new Set(),
  sites: new Set(),
};

export function notifyDataChanged(resource: DataResource) {
  listeners[resource].forEach((fn) => fn());
}

export function useDataChangeListener(resource: DataResource, callback: () => void) {
  useEffect(() => {
    listeners[resource].add(callback);
    return () => {
      listeners[resource].delete(callback);
    };
  }, [resource, callback]);
}
