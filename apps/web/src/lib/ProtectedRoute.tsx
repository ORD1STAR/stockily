import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './auth-context';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  const location = useLocation();

  // Only shown during the initial silent-refresh attempt on page load —
  // brief, but real (a network round-trip), so worth a state rather than
  // flashing the login page first.
  if (loading) return null;
  // Back to where the visitor was heading once logged in (e.g. /compte).
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return <>{children}</>;
}
