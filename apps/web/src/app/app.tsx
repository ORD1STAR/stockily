import { lazy, Suspense } from 'react';
import { Navigate, Route, BrowserRouter, Routes } from 'react-router-dom';
import { AuthProvider } from '../lib/auth-context';
import { ConfirmProvider } from '../lib/ConfirmDialog';
import { ProtectedRoute } from '../lib/ProtectedRoute';
import { ToastContainer } from '../lib/toast';
// The shared component layer is global, not per-page: otherwise a button
// or modal could look different depending on which route loaded first.
import '../lib/data-views.css';
import { installResponsiveTables } from '../lib/responsiveTables';

installResponsiveTables();

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
const InventoryPage = lazy(() => import('../pages/InventoryPage'));
const CountersPage = lazy(() => import('../pages/CountersPage'));
const StatsPage = lazy(() => import('../pages/StatsPage'));
const CashPage = lazy(() => import('../pages/CashPage'));
const DevicesPage = lazy(() => import('../pages/DevicesPage'));
const MembersPage = lazy(() => import('../pages/MembersPage'));
const AdminApp = lazy(() => import('../admin/AdminApp'));
const SyncPage = lazy(() => import('../pages/SyncPage'));

// A blank instant during a chunk fetch reads as broken more than a plain
// "Chargement…" would — on a fast connection this never even paints.
function RouteFallback() {
  return (
    <div className="page-loader full" role="status">
      <span className="spinner" /> Chargement…
    </div>
  );
}

export function App() {
  return (
    <AuthProvider>
      <ConfirmProvider>
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
            <Route
              path="/inventory"
              element={
                <ProtectedRoute>
                  <InventoryPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/counters"
              element={
                <ProtectedRoute>
                  <CountersPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/stats"
              element={
                <ProtectedRoute>
                  <StatsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/cash"
              element={
                <ProtectedRoute>
                  <CashPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/devices"
              element={
                <ProtectedRoute>
                  <DevicesPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/members"
              element={
                <ProtectedRoute>
                  <MembersPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/sync"
              element={
                <ProtectedRoute>
                  <SyncPage />
                </ProtectedRoute>
              }
            />
            {/* Platform-admin console — its own session/login, separate from the tenant app. */}
            <Route path="/admin/*" element={<AdminApp />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
      <ToastContainer />
      </ConfirmProvider>
    </AuthProvider>
  );
}

export default App;
