import { useEffect, useState } from 'react';
import { AdminShell } from './AdminShell';
import { useAdminAuth } from './admin-auth-context';
import { AdminPayment, adminApi } from './admin-api';
import '../lib/data-views.css';

const STATUS: Record<string, string> = { pending: 'info', paid: 'success', failed: 'danger', refunded: 'warning' };

export function AdminPaymentsPage() {
  const { accessToken } = useAdminAuth();
  const [rows, setRows] = useState<AdminPayment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accessToken) return;
    adminApi.payments(accessToken).then(setRows).finally(() => setLoading(false));
  }, [accessToken]);

  return (
    <AdminShell title="Paiements" subtitle="Paiements d'abonnement des organisations. L'intégration de l'API de paiement viendra plus tard — cette liste se remplira alors.">
      {loading ? (
        <div className="page-loader"><span className="spinner" /> Chargement…</div>
      ) : rows.length === 0 ? (
        <div className="empty-state">Aucun paiement enregistré pour le moment.</div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Date</th><th>Organisation</th><th>Montant</th><th>Méthode</th><th>Référence</th><th>Statut</th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>{new Date(p.createdAt).toLocaleString('fr-FR')}</td>
                  <td>{p.org}</td>
                  <td>{p.amount.toLocaleString('fr-FR')} {p.currency}</td>
                  <td>{p.method ?? '—'}</td>
                  <td>{p.reference ?? '—'}</td>
                  <td><span className={`pill ${STATUS[p.status] ?? 'info'}`}>{p.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminShell>
  );
}
