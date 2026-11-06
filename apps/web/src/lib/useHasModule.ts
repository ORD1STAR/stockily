import { useAuth } from './auth-context';
import { entitledModuleKeys } from './modules';

/**
 * `has('stock')` tells whether the organization currently has that module
 * (paid and running, or on trial). Screens that borrow something from another
 * module (a product picker, a partner, a lot...) use it to hide that part
 * when the module is not active, instead of offering a field that can only
 * stay empty or a request the server will refuse.
 */
export function useHasModule(): (key: string) => boolean {
  const { me } = useAuth();
  const set = entitledModuleKeys(me?.entitlements ?? []);
  return (key: string) => set.has(key);
}
