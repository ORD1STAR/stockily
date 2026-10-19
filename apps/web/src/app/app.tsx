import { lazy, Suspense } from 'react';
import { Navigate, Route, BrowserRouter, Routes } from 'react-router-dom';
import { AuthProvider } from '../lib/auth-context';
import { ProtectedRoute } from '../lib/ProtectedRoute';
import { ToastContainer } from '../lib/toast';

// Route-level code splitting — every page becomes its own chunk, fetched
// only when actually visited, instead of one ~850KB bundle every visitor
// downloaded just to see the login screen. Stock and Scan in particular
// each pull in @zxing/browser (barcode/QR scanning) on top of their own
// code; nobody who never opens those two pages should have to fetch that.
const LoginPage = lazy(() => import('../pages/LoginPage'));
const SignupPage = lazy(() => import('../pages/SignupPage'));
const DashboardPage = lazy(() => import('../pages/DashboardPage'));
const AppsListPage = lazy(() => import('../pages/AppsListPage'));
const StockPage = lazy(() => import('../pages/StockPage'));
const SitesPage = lazy(() => import('../pages/SitesPage'));
const QualityPage = lazy(() => import('../pages/QualityPage'));
const InvoicingPage = lazy(() => import('../pages/InvoicingPage'));
const ScanPage = lazy(() => import('../pages/ScanPage'));
const PurchasingPage = lazy(() => import('../pages/PurchasingPage'));
const SalesPage = lazy(() => import('../pages/SalesPage'));

// A blank instant during a chunk fetch reads as broken more than a plain
// "Chargement…" would — on a fast connection this never even paints.
function RouteFallback() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', color: 'var(--text-muted)', fontSize: '0.86rem' }}>
      Chargement…
    </div>
  );
}

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<RouteFallback />}>
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
              path="/apps"
              element={
                <ProtectedRoute>
                  <AppsListPage />
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
            <Route
              path="/quality"
              element={
                <ProtectedRoute>
                  <QualityPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/invoicing"
              element={
                <ProtectedRoute>
                  <InvoicingPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/scan"
              element={
                <ProtectedRoute>
                  <ScanPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/purchasing"
              element={
                <ProtectedRoute>
                  <PurchasingPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/sales"
              element={
                <ProtectedRoute>
                  <SalesPage />
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
      <ToastContainer />
    </AuthProvider>
  );
}

export default App;
