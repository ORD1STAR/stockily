import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './auth-context';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();

  // Only shown during the initial silent-refresh attempt on page load —
  // brief, but real (a network round-trip), so worth a state rather than
  // flashing the login page first.
  if (loading) return null;
  if (!me) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
