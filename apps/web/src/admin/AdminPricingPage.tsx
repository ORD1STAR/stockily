import { useEffect, useState } from 'react';
import { AdminShell } from './AdminShell';
import { useAdminAuth } from './admin-auth-context';
import { AdminPrice, adminApi } from './admin-api';
import { toast } from '../lib/toast';
import { ApiError } from '../lib/api';
import '../lib/data-views.css';

export function AdminPricingPage() {
  const { accessToken } = useAdminAuth();
  const [rows, setRows] = useState<AdminPrice[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    adminApi.pricing(accessToken).then((r) => {
      setRows(r);
      setDraft(Object.fromEntries(r.map((x) => [x.moduleKey, x.monthlyPrice != null ? String(x.monthlyPrice) : ''])));
    }).finally(() => setLoading(false));
  }, [accessToken]);

  async function save(p: AdminPrice) {
    if (!accessToken) return;
    const value = Number(draft[p.moduleKey]);
    if (!Number.isFinite(value) || value < 0) {
      toast.error('Prix invalide.');
      return;
    }
    setSavingKey(p.moduleKey);
    try {
      const updated = await adminApi.setPrice(accessToken, p.moduleKey, value, p.isActive);
      setRows((rs) => rs.map((r) => (r.moduleKey === p.moduleKey ? updated : r)));
      toast.success('Tarif enregistré.');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Échec.');
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <AdminShell title="Tarifs des modules" subtitle="Prix mensuel par module (DZD). Sert de référence ; l'encaissement se fera via l'API de paiement plus tard.">
      {loading ? (
        <div className="page-loader"><span className="spinner" /> Chargement…</div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Module</th><th>Prix mensuel (DZD)</th><th /></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.moduleKey}>
                  <td>{p.name}</td>
                  <td>
                    <div className="price-input">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        placeholder="0"
                        value={draft[p.moduleKey] ?? ''}
                        onChange={(e) => setDraft((d) => ({ ...d, [p.moduleKey]: e.target.value }))}
                      />
                      <span className="suffix">DZD / mois</span>
                    </div>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      className="btn-secondary"
                      disabled={savingKey === p.moduleKey || draft[p.moduleKey] === (p.monthlyPrice != null ? String(p.monthlyPrice) : '')}
                      onClick={() => save(p)}
                    >
                      {savingKey === p.moduleKey ? 'Enregistrement…' : 'Enregistrer'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminShell>
  );
}
