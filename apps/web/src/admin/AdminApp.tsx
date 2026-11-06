import { Navigate, Route, Routes } from 'react-router-dom';
import { AdminAuthProvider, useAdminAuth } from './admin-auth-context';
import { AdminLoginPage } from './AdminLoginPage';
import { AdminDashboardPage } from './AdminDashboardPage';
import { AdminOrganizationsPage } from './AdminOrganizationsPage';
import { AdminOrgDetailPage } from './AdminOrgDetailPage';
import { AdminPricingPage } from './AdminPricingPage';
import { AdminPaymentsPage } from './AdminPaymentsPage';
import { AdminLogsPage } from './AdminLogsPage';
import { AdminSqlPage } from './AdminSqlPage';
import { AdminSuggestionsPage } from './AdminSuggestionsPage';

function AdminRoutes() {
  const { admin, accessToken, loading } = useAdminAuth();
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <span className="spinner" /> Chargement…
      </div>
    );
  }
  if (!admin && !accessToken) return <AdminLoginPage />;
  return (
    <Routes>
      <Route path="/" element={<AdminDashboardPage />} />
      <Route path="/organizations" element={<AdminOrganizationsPage />} />
      <Route path="/organizations/:id" element={<AdminOrgDetailPage />} />
      <Route path="/suggestions" element={<AdminSuggestionsPage />} />
      <Route path="/pricing" element={<AdminPricingPage />} />
      <Route path="/payments" element={<AdminPaymentsPage />} />
      <Route path="/logs" element={<AdminLogsPage />} />
      <Route path="/sql" element={<AdminSqlPage />} />
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  );
}

// Mounted at /admin/* — a self-contained console with its own session,
// separate from the tenant app. On the desktop build the /admin API returns
// 404, so login simply fails there; the console is effectively server-only.
export function AdminApp() {
  return (
    <AdminAuthProvider>
      <AdminRoutes />
    </AdminAuthProvider>
  );
}

export default AdminApp;
