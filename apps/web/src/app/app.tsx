import { Navigate, Route, BrowserRouter, Routes } from 'react-router-dom';
import { AuthProvider } from '../lib/auth-context';
import { ProtectedRoute } from '../lib/ProtectedRoute';
import { LoginPage } from '../pages/LoginPage';
import { SignupPage } from '../pages/SignupPage';
import { DashboardPage } from '../pages/DashboardPage';
import { StockPage } from '../pages/StockPage';
import { SitesPage } from '../pages/SitesPage';

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/stock"
            element={
              <ProtectedRoute>
                <StockPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/sites"
            element={
              <ProtectedRoute>
                <SitesPage />
              </ProtectedRoute>
            }
          />
          {/* Quality/Invoicing/Scan routes land in Milestones 3-4 — AppShell
              already greys these nav items out based on real entitlements. */}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
