import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BrowserMultiFormatReader, IScannerControls } from '@zxing/browser';
import { AppShell } from '../lib/AppShell';
import { useAuth } from '../lib/auth-context';
import { CAMERA_CONSTRAINTS, createBarcodeReader } from '../lib/barcodeScanner';
import { useIsMobile } from '../lib/useIsMobile';
import {
  ApiError,
  Batch,
  BarcodeLabelView,
  Partner,
  ScanResolution,
  Site,
  StockRow,
  TaxRate,
  invoicingApi,
  qualityApi,
  scanApi,
  sitesApi,
  stockApi,
} from '../lib/api';
import { SearchableSelect } from '../lib/SearchableSelect';
import '../lib/data-views.css';
import './DashboardPage.css';
import './ScanPage.css';

type Step = 'scan' | 'action' | 'in' | 'out' | 'transfer' | 'confirm';

interface CartLine {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
  availableQuantity: number | null;
}

// Mobile-first, deliberately not sharing the desktop Stock/Quality/Factures
// layout — this is genuinely a separate surface (Action Plan §4/§6: "Scan
// is an input-method concern", meant to run full-screen on a phone, no
// desktop sidebar chrome in the real PWA). Kept inside AppShell here only
// so the demo/dev environment has one consistent auth+nav wrapper; a real
// Capacitor-wrapped build would drop AppShell entirely for this route.
export function ScanPage() {
  const { accessToken, logout } = useAuth();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [mode, setMode] = useState<'scan' | 'labels' | 'checkout'>('scan');
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState('');
  const [code, setCode] = useState('');
  const [resolution, setResolution] = useState<ScanResolution | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [step, setStep] = useState<Step>('scan');
  const [error, setError] = useState<string | null>(null);
  const [confirmMessage, setConfirmMessage] = useState('');

  // Entrée (new lot) fields
  const [lotMode, setLotMode] = useState<'existing' | 'new'>('existing');
  const [existingBatches, setExistingBatches] = useState<Batch[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState('');
  const [newLotNumber, setNewLotNumber] = useState('');
  const [newExpiryDate, setNewExpiryDate] = useState('');
  const [newLotResult, setNewLotResult] = useState<'conforme' | 'non_conforme'>('conforme');
  const [unitCost, setUnitCost] = useState('');

  // Transfert field
  const [toSiteId, setToSiteId] = useState('');

  // Fournisseur (entrée) / client (sortie) — optional, defaults to
  // "non spécifié" (partnerId stays '').
  const [partners, setPartners] = useState<Partner[]>([]);
  const [partnerId, setPartnerId] = useState('');
  const [taxRates, setTaxRates] = useState<TaxRate[]>([]);

  // "Vente rapide" (checkout) — a retail till mode: each scan appends a
  // line instead of walking through the entrée/sortie/transfert steps, a
  // running cart accumulates across scans, and "Terminer la vente" cuts
  // that session into one CUSTOMER invoice (finalized immediately, so
  // stock is deducted the same way any other finalized invoice deducts
  // it) for the chosen client — or none, the walk-in default.
  const [cart, setCart] = useState<CartLine[]>([]);
  const [checkoutPartnerId, setCheckoutPartnerId] = useState('');
  // A retail till sale is paid at the counter, on the spot — the operator
  // has already taken the cash/card before hitting "Terminer la vente",
  // unlike a wholesale invoice which is routinely settled later. Paid is
  // the default so every normal sale doesn't also need a second trip to
  // Factures just to mark it paid; the toggle exists for the exception
  // (a tab, a delivery invoiced now but collected later).
  const [checkoutPaid, setCheckoutPaid] = useState(true);
  const [checkoutSubmitting, setCheckoutSubmitting] = useState(false);
  const [checkoutConfirm, setCheckoutConfirm] = useState<{ number: string | null; total: number; paid: boolean } | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraActive, setCameraActive] = useState(false);
  // ZXing instead of the native BarcodeDetector (Shape Detection API) —
  // BarcodeDetector is Chrome-only and never shipped in Safari at all (iOS
  // or macOS), so gating "Activer la caméra" on its presence meant the
  // button silently never rendered on any iPhone: no error, just no way to
  // ever open the camera. ZXing decodes from a plain <video> + canvas loop
  // it manages itself via getUserMedia, so it works the same everywhere.
  const codeReaderRef = useRef<BrowserMultiFormatReader | null>(null);
  // The camera *stream* (hardware access, the permission grant) and the
  // *decode loop* (ZXing reading frames off it) are deliberately two
  // separate lifecycles now. They used to be one: stopping decoding after
  // a single-shot scan also always tore down getUserMedia's stream (that's
  // what the library's own decodeFromConstraints/.stop() does internally —
  // see IScannerControls.stop()), so returning to the scan step after
  // finishing an entrée/sortie/transfert meant requesting the camera all
  // over again — a fresh permission-grant round trip, and a re-tap on
  // "Activer la caméra" every single time. streamRef holds the raw
  // MediaStream, acquired once per page visit and kept alive until this
  // component unmounts (navigating away from Scan, a refresh, or
  // logging out — exactly the cases where the user does expect a fresh
  // start). scanControlsRef is ZXing's *own* decode-loop handle, called via
  // the lower-level `.scan()` (not `.decodeFromConstraints`/`.decodeFromStream`)
  // specifically because `.scan()` without a finalizeCallback stops the
  // decode loop on `.stop()` without touching the stream — the primitive
  // neither of the higher-level methods expose.
  const streamRef = useRef<MediaStream | null>(null);
  const scanControlsRef = useRef<IScannerControls | null>(null);
  // Debounces continuous scanning in "Vente rapide" (checkout mode keeps
  // decoding after a hit — see startDecoding's mode check below — so the
  // same still-visible barcode would otherwise re-trigger on every
  // subsequent frame and keep bumping the cart line's quantity before the
  // operator has a chance to move the product away).
  const lastCheckoutScanRef = useRef<{ code: string; time: number } | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    sitesApi.list(accessToken).then((rows) => {
      setSites(rows);
      if (rows[0]) setSiteId(rows[0].id);
    });
    // Same trade-off as StockPage: if Invoicing isn't entitled for this org,
    // the fournisseur/client picker just stays empty rather than blocking
    // the whole Scan page.
    invoicingApi.listPartners(accessToken).then(setPartners).catch(() => setPartners([]));
    invoicingApi.listTaxRates(accessToken).then(setTaxRates).catch(() => setTaxRates([]));
  }, [accessToken]);

  // Pauses the decode loop only — leaves the stream (and hardware access)
  // alone, so resuming later this same session is instant, no permission
  // prompt, no getUserMedia round trip.
  const pauseDecoding = useCallback(() => {
    scanControlsRef.current?.stop();
    scanControlsRef.current = null;
  }, []);

  // Fully releases the camera. Only ever called on unmount (see the effect
  // right below) — every other "leave the scan view" path now just pauses
  // decoding instead, per the user's own request: once activated, stay on
  // for the rest of the session, only really turn off on a refresh or a
  // logout/login (both of which unmount this component).
  const releaseCamera = useCallback(() => {
    pauseDecoding();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraActive(false);
  }, [pauseDecoding]);

  useEffect(() => releaseCamera, [releaseCamera]);

  // True whenever the current mode/step has a viewfinder to show at all —
  // Scanner mode's single-decisive-scan step, or Vente rapide's continuous
  // scanning. The <video> element itself (below, in the JSX) is always
  // mounted regardless of this value — only CSS visibility depends on it —
  // specifically so switching away from a scan-capable view (finishing an
  // entrée, opening Vente rapide's cart) never unmounts the element the
  // stream is bound to.
  const showViewfinder = (mode === 'scan' && step === 'scan') || mode === 'checkout';

  const startDecoding = useCallback(() => {
    if (!videoRef.current || !streamRef.current) return;
    // Always (re)start clean: a loop already running has a callback closed
    // over whatever `mode` was current when *it* started, so switching
    // Scanner <-> Vente rapide needs a fresh one with the right
    // single-shot-vs-continuous behavior, not the stale loop left running.
    // Safe to call unconditionally even when nothing was running — pausing
    // an already-paused loop is a no-op (see pauseDecoding's own comment).
    scanControlsRef.current?.stop();
    if (!codeReaderRef.current) codeReaderRef.current = createBarcodeReader();
    const continuous = mode === 'checkout';
    // No finalizeCallback passed here — that's what makes `.stop()` on the
    // returned controls pause decoding without disposing streamRef.current
    // (see the comment on scanControlsRef's declaration above).
    scanControlsRef.current = codeReaderRef.current.scan(videoRef.current, (result) => {
      // Fires on every scanned frame, including misses (result undefined)
      // — those aren't errors, just "nothing decoded yet".
      if (!result) return;
      const text = result.getText();
      if (continuous) {
        // Vente rapide: keep decoding so the next item can be scanned
        // right away, but ignore an immediate repeat of the same code —
        // the product is still sitting in front of the camera for several
        // frames after a real scan.
        const now = Date.now();
        const last = lastCheckoutScanRef.current;
        if (last && last.code === text && now - last.time < 1500) return;
        lastCheckoutScanRef.current = { code: text, time: now };
        void resolve(text);
        return;
      }
      // Single-shot (Scanner mode): pause decoding — not the stream — and
      // let resolve() advance to the action step.
      pauseDecoding();
      void resolve(text);
    });
  }, [mode, pauseDecoding]);

  // The actual "Activer la caméra" tap — acquires the stream itself the
  // very first time (or reuses it, if some earlier tap this session
  // already did), then starts decoding.
  async function activateCamera() {
    setError(null);
    try {
      if (!streamRef.current) {
        streamRef.current = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
      }
      if (videoRef.current) {
        videoRef.current.srcObject = streamRef.current;
        await videoRef.current.play();
      }
      setCameraActive(true);
      startDecoding();
    } catch {
      setCameraActive(false);
      setError("Impossible d'accéder à la caméra — utilisez la saisie manuelle ou une douchette.");
    }
  }

  // Auto-resumes decoding whenever a scan-capable view comes back into
  // view, as long as the camera was already activated this session — this
  // is the "stays open for the rest of the session" behavior itself: no
  // re-tap on "Activer la caméra" needed just because the user finished an
  // entrée/sortie/transfert and landed back on the scan step, or switched
  // between Scanner and Vente rapide. Leaving a scan-capable view pauses
  // decoding (not the stream) so it isn't spending CPU decoding frames
  // nobody's looking at, e.g. while a form is on screen.
  useEffect(() => {
    if (showViewfinder && cameraActive && streamRef.current) {
      startDecoding();
    } else if (!showViewfinder) {
      pauseDecoding();
    }
  }, [showViewfinder, cameraActive, startDecoding, pauseDecoding]);

  async function resolve(rawCode: string) {
    if (!accessToken || !rawCode.trim()) return;
    setError(null);
    try {
      const r = await scanApi.resolveCode(accessToken, rawCode.trim(), siteId);
      if (mode === 'checkout') {
        addToCart(r);
        setCode('');
        return;
      }
      setResolution(r);
      setCode(rawCode.trim());
      setQuantity(1);
      setSelectedBatchId(r.suggestedBatch?.id ?? '');
      setStep('action');
      if (r.product.isLotTracked) {
        const batches = await qualityApi.listBatches(accessToken, r.product.id);
        setExistingBatches(batches.filter((b) => b.status === 'active'));
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Code non reconnu.');
    }
  }

  // Scanning the same product twice bumps its existing line's quantity
  // (like a real till) instead of adding a duplicate row — capped at the
  // site's available quantity, same rule Sortie already enforces one scan
  // at a time, just applied across the whole running cart now.
  function addToCart(r: ScanResolution) {
    setCheckoutConfirm(null);
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.productId === r.product.id);
      if (idx === -1) {
        return [
          ...prev,
          {
            productId: r.product.id,
            sku: r.product.sku,
            name: r.product.name,
            quantity: 1,
            unitPrice: r.product.sellPrice ?? 0,
            availableQuantity: r.availableQuantity,
          },
        ];
      }
      const existing = prev[idx];
      if (r.availableQuantity != null && existing.quantity >= r.availableQuantity) {
        setError(`Stock insuffisant pour ${r.product.name} — ${r.availableQuantity} disponible(s).`);
        return prev;
      }
      const next = [...prev];
      next[idx] = { ...existing, quantity: existing.quantity + 1, availableQuantity: r.availableQuantity };
      return next;
    });
  }

  function updateCartLine(productId: string, patch: Partial<Pick<CartLine, 'quantity' | 'unitPrice'>>) {
    setCart((prev) =>
      prev.map((l) => {
        if (l.productId !== productId) return l;
        if (patch.quantity != null) {
          const capped = l.availableQuantity != null ? Math.min(patch.quantity, l.availableQuantity) : patch.quantity;
          return { ...l, quantity: Math.max(1, Math.round(capped) || 1) };
        }
        return { ...l, ...patch };
      }),
    );
  }

  function removeCartLine(productId: string) {
    setCart((prev) => prev.filter((l) => l.productId !== productId));
  }

  const cartTotal = cart.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);

  async function finalizeSale() {
    if (!accessToken || cart.length === 0) return;
    setCheckoutSubmitting(true);
    setError(null);
    try {
      const defaultTax = taxRates.find((t) => t.isDefault);
      const created = await invoicingApi.createInvoice(accessToken, {
        type: 'CUSTOMER',
        siteId,
        partnerId: checkoutPartnerId || undefined,
        lines: cart.map((l) => ({
          productId: l.productId,
          description: `${l.sku} — ${l.name}`,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          taxRateId: defaultTax?.id,
        })),
      });
      const finalized = await invoicingApi.finalizeInvoice(accessToken, created.id);
      if (checkoutPaid) {
        await invoicingApi.recordPayment(accessToken, finalized.id, { amount: finalized.totals.totalTtc });
      }
      setCheckoutConfirm({ number: finalized.number, total: finalized.totals.totalTtc, paid: checkoutPaid });
      setCart([]);
      setCheckoutPartnerId('');
      setCheckoutPaid(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec de la vente.');
    } finally {
      setCheckoutSubmitting(false);
    }
  }

  function reset() {
    setStep('scan');
    setCode('');
    setResolution(null);
    setError(null);
    setLotMode('existing');
    setNewLotNumber('');
    setNewExpiryDate('');
    setUnitCost('');
    setToSiteId('');
    setQuantity(1);
    setPartnerId('');
  }

  async function submitIn() {
    if (!accessToken || !resolution) return;
    setError(null);
    try {
      let batchId: string | undefined;
      if (resolution.product.isLotTracked) {
        if (lotMode === 'existing') {
          if (!selectedBatchId) throw new Error('Sélectionnez un lot.');
          batchId = selectedBatchId;
        } else {
          const batch = await qualityApi.createBatch(accessToken, {
            productId: resolution.product.id,
            lotNumber: newLotNumber,
            expiryDate: newExpiryDate || undefined,
            quantityReceived: quantity,
          });
          batchId = batch.id;
        }
      }
      // The IN movement posts BEFORE the quality check below — quality's
      // quarantine-target computation derives "how much of this batch is
      // on hand" from the stock_movements ledger itself
      // (getBatchQuantityBySite), so a non-conforme result recorded before
      // this batch has any ledger history at all always came back with
      // zero quarantine targets: the batch's `status` showed "Quarantaine"
      // on the Quality page, but the actual stock stayed fully available —
      // a real quarantine that never quarantined anything. Found by
      // receiving a deliberately-bad lot and comparing the Stock page's
      // quarantine column (0) against what Quality showed (quarantined).
      await stockApi.recordMovement(accessToken, {
        productId: resolution.product.id,
        siteId,
        type: 'IN',
        quantity,
        batchId,
        unitCost: unitCost ? Number(unitCost) : undefined,
        partnerId: partnerId || undefined,
      });
      if (resolution.product.isLotTracked && lotMode === 'new' && batchId) {
        await qualityApi.recordCheck(accessToken, { productId: resolution.product.id, batchId, result: newLotResult });
      }
      setConfirmMessage(`Entrée enregistrée — ${quantity} unité(s) de ${resolution.product.name}.`);
      setStep('confirm');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Échec de l'entrée.");
    }
  }

  async function submitOut() {
    if (!accessToken || !resolution) return;
    setError(null);
    try {
      await stockApi.recordMovement(accessToken, {
        productId: resolution.product.id,
        siteId,
        type: 'OUT',
        quantity,
        batchId: resolution.suggestedBatch?.id,
        partnerId: partnerId || undefined,
      });
      setConfirmMessage(`Sortie enregistrée — ${quantity} unité(s) de ${resolution.product.name}.`);
      setStep('confirm');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec de la sortie.');
    }
  }

  async function submitTransfer() {
    if (!accessToken || !resolution || !toSiteId) return;
    setError(null);
    try {
      await stockApi.recordMovement(accessToken, {
        productId: resolution.product.id,
        siteId,
        type: 'TRANSFER',
        quantity,
        toSiteId,
        batchId: resolution.suggestedBatch?.id,
      });
      const dest = sites.find((s) => s.id === toSiteId);
      setConfirmMessage(`Transfert créé vers ${dest?.name ?? 'site sélectionné'}.`);
      setStep('confirm');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec du transfert.');
    }
  }

  const body = (
    <>
      <div className="scan-page">
        <div className="panel-head">
          <div>
            <h2>Scan</h2>
            <div className="sub">
              Site :{' '}
              <select className="site-select" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="toggle-row">
          <button className={`toggle-btn${mode === 'scan' ? ' on' : ''}`} onClick={() => setMode('scan')}>
            Scanner
          </button>
          <button className={`toggle-btn${mode === 'checkout' ? ' on' : ''}`} onClick={() => setMode('checkout')}>
            Vente rapide
          </button>
          <button className={`toggle-btn${mode === 'labels' ? ' on' : ''}`} onClick={() => setMode('labels')}>
            Étiquettes
          </button>
        </div>

        {error && <div className="error-banner">{error}</div>}

        {/* Always mounted — CSS-only visibility (`showViewfinder`) — so the
            <video> element this is bound to never unmounts just because the
            user finished an entrée/sortie/transfert or switched between
            Scanner and Vente rapide. That persistence is the whole point:
            see streamRef's own comment above for why the camera used to
            drop every single time. */}
        <div className="scan-card" style={{ display: showViewfinder ? 'flex' : 'none' }}>
          <div className="viewfinder">
            <video ref={videoRef} muted playsInline style={{ display: cameraActive ? 'block' : 'none' }} />
            {!cameraActive && <div className="vf-placeholder">Caméra prête</div>}
          </div>
          {!cameraActive && (
            <button className="btn-primary" onClick={activateCamera}>
              Activer la caméra
            </button>
          )}
          {cameraActive && mode === 'checkout' && (
            <p className="sub" style={{ textAlign: 'center' }}>
              Scan continu — présentez chaque article devant la caméra.
            </p>
          )}
        </div>

        {mode === 'labels' && <LabelsPanel />}

        {mode === 'checkout' && (
          <CheckoutPanel
            code={code}
            setCode={setCode}
            onScan={resolve}
            cart={cart}
            cartTotal={cartTotal}
            onUpdateLine={updateCartLine}
            onRemoveLine={removeCartLine}
            partners={partners}
            checkoutPartnerId={checkoutPartnerId}
            setCheckoutPartnerId={setCheckoutPartnerId}
            checkoutPaid={checkoutPaid}
            setCheckoutPaid={setCheckoutPaid}
            checkoutSubmitting={checkoutSubmitting}
            checkoutConfirm={checkoutConfirm}
            onFinalize={finalizeSale}
            onClearCart={() => {
              setCart([]);
              setCheckoutConfirm(null);
            }}
          />
        )}

        {mode === 'scan' && step === 'scan' && (
          <div className="scan-card">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                resolve(code);
              }}
              className="scan-entry-row"
            >
              <input
                className="mono"
                placeholder="Saisie manuelle / douchette USB"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoFocus
              />
              <button type="submit" className="btn-primary">
                Rechercher
              </button>
            </form>
          </div>
        )}

        {mode === 'scan' && step === 'action' && resolution && (
          <div className="scan-card">
            <div className="scan-product">
              <div className="name">{resolution.product.name}</div>
              <div className="meta mono">
                {resolution.product.sku}
                {resolution.matchedBatch && <> · {resolution.matchedBatch.lotNumber}</>}
              </div>
            </div>
            <div className="qty-stepper">
              <button onClick={() => setQuantity((q) => Math.max(1, q - 1))}>−</button>
              <input
                className="mono qty-input"
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, Math.round(Number(e.target.value)) || 1))}
              />
              <button onClick={() => setQuantity((q) => q + 1)}>+</button>
            </div>
            {resolution.availableQuantity != null && (
              <div className="sub" style={{ textAlign: 'center' }}>
                Disponible sur ce site : {resolution.availableQuantity}
              </div>
            )}
            <div className="action-row">
              <button className="btn-secondary" onClick={() => setStep('in')}>
                Entrée
              </button>
              <button
                className="btn-primary"
                disabled={resolution.availableQuantity === 0}
                onClick={() => {
                  // Sortie/Transfert can never exceed what's actually on
                  // hand at this site — quantityOnHand already excludes
                  // quarantined stock. Entrée has no such cap (receiving
                  // more than currently on hand is the normal case).
                  if (resolution.availableQuantity != null) setQuantity((q) => Math.min(q, resolution.availableQuantity as number));
                  setStep('out');
                }}
              >
                Sortie
              </button>
              <button
                className="btn-secondary"
                disabled={resolution.availableQuantity === 0}
                onClick={() => {
                  if (resolution.availableQuantity != null) setQuantity((q) => Math.min(q, resolution.availableQuantity as number));
                  setStep('transfer');
                }}
              >
                Transfert
              </button>
            </div>
            <button className="btn-link" onClick={reset}>
              ← Nouveau scan
            </button>
          </div>
        )}

        {mode === 'scan' && step === 'in' && resolution && (
          <div className="scan-card">
            <h3>Entrée de stock</h3>
            {resolution.product.isLotTracked ? (
              <>
                <div className="toggle-row">
                  <button className={`toggle-btn${lotMode === 'existing' ? ' on' : ''}`} onClick={() => setLotMode('existing')}>
                    Lot existant
                  </button>
                  <button className={`toggle-btn${lotMode === 'new' ? ' on' : ''}`} onClick={() => setLotMode('new')}>
                    Nouveau lot
                  </button>
                </div>
                {lotMode === 'existing' ? (
                  <div className="field-row">
                    <label>Lot</label>
                    <select value={selectedBatchId} onChange={(e) => setSelectedBatchId(e.target.value)}>
                      <option value="">— choisir —</option>
                      {existingBatches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.lotNumber} {b.expiryDate ? `— ${new Date(b.expiryDate).toLocaleDateString('fr-FR')}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <>
                    <div className="field-row">
                      <label>N° de lot</label>
                      <input value={newLotNumber} onChange={(e) => setNewLotNumber(e.target.value)} required />
                    </div>
                    <div className="field-row">
                      <label>Date de péremption</label>
                      <input type="date" value={newExpiryDate} onChange={(e) => setNewExpiryDate(e.target.value)} />
                    </div>
                    <div className="field-row">
                      <label>Contrôle qualité à réception</label>
                      <div className="toggle-row">
                        <button className={`toggle-btn${newLotResult === 'conforme' ? ' on' : ''}`} onClick={() => setNewLotResult('conforme')}>
                          Conforme
                        </button>
                        <button className={`toggle-btn${newLotResult === 'non_conforme' ? ' on' : ''}`} onClick={() => setNewLotResult('non_conforme')}>
                          Non conforme
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </>
            ) : (
              <p className="sub">Produit non suivi par lot.</p>
            )}
            <div className="field-row">
              <label>Coût unitaire (optionnel)</label>
              <input type="number" min="0" step="0.01" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
            </div>
            <div className="field-row">
              <label>Fournisseur (optionnel)</label>
              <SearchableSelect
                value={partnerId}
                onChange={setPartnerId}
                placeholder="Rechercher un fournisseur…"
                emptyLabel="— non spécifié —"
                options={partners.filter((p) => p.isSupplier).map((p) => ({ value: p.id, label: p.name, sublabel: p.nif }))}
              />
            </div>
            <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
              <button className="btn-secondary" onClick={() => setStep('action')}>
                ← Retour
              </button>
              <button className="btn-primary" onClick={submitIn}>
                Valider l'entrée
              </button>
            </div>
          </div>
        )}

        {mode === 'scan' && step === 'out' && resolution && (
          <div className="scan-card">
            <h3>Sortie de stock</h3>
            <div className="qty-stepper">
              <button onClick={() => setQuantity((q) => Math.max(1, q - 1))}>−</button>
              <input
                className="mono qty-input"
                type="number"
                min={1}
                max={resolution.availableQuantity ?? undefined}
                value={quantity}
                onChange={(e) => {
                  const next = Math.max(1, Math.round(Number(e.target.value)) || 1);
                  setQuantity(resolution.availableQuantity != null ? Math.min(next, resolution.availableQuantity) : next);
                }}
              />
              <button
                onClick={() =>
                  setQuantity((q) => (resolution.availableQuantity != null ? Math.min(q + 1, resolution.availableQuantity) : q + 1))
                }
              >
                +
              </button>
            </div>
            {resolution.availableQuantity != null && (
              <div className="sub" style={{ textAlign: 'center' }}>
                Disponible sur ce site : {resolution.availableQuantity}
              </div>
            )}
            {resolution.suggestedBatch && (
              <div className="note-box">
                Lot suggéré (FEFO) : <b className="mono">{resolution.suggestedBatch.lotNumber}</b>
                {resolution.suggestedBatch.expiryDate && ` — expire le ${new Date(resolution.suggestedBatch.expiryDate).toLocaleDateString('fr-FR')}`}
              </div>
            )}
            <div className="field-row">
              <label>Client (optionnel)</label>
              <SearchableSelect
                value={partnerId}
                onChange={setPartnerId}
                placeholder="Rechercher un client…"
                emptyLabel="— non spécifié —"
                options={partners.filter((p) => p.isCustomer).map((p) => ({ value: p.id, label: p.name, sublabel: p.nif }))}
              />
            </div>
            <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
              <button className="btn-secondary" onClick={() => setStep('action')}>
                ← Retour
              </button>
              <button className="btn-primary" onClick={submitOut}>
                Valider la sortie
              </button>
            </div>
          </div>
        )}

        {mode === 'scan' && step === 'transfer' && resolution && (
          <div className="scan-card">
            <h3>Transfert inter-site</h3>
            <div className="qty-stepper">
              <button onClick={() => setQuantity((q) => Math.max(1, q - 1))}>−</button>
              <input
                className="mono qty-input"
                type="number"
                min={1}
                max={resolution.availableQuantity ?? undefined}
                value={quantity}
                onChange={(e) => {
                  const next = Math.max(1, Math.round(Number(e.target.value)) || 1);
                  setQuantity(resolution.availableQuantity != null ? Math.min(next, resolution.availableQuantity) : next);
                }}
              />
              <button
                onClick={() =>
                  setQuantity((q) => (resolution.availableQuantity != null ? Math.min(q + 1, resolution.availableQuantity) : q + 1))
                }
              >
                +
              </button>
            </div>
            {resolution.availableQuantity != null && (
              <div className="sub" style={{ textAlign: 'center' }}>
                Disponible sur ce site : {resolution.availableQuantity}
              </div>
            )}
            <div className="field-row">
              <label>Site de destination</label>
              <select value={toSiteId} onChange={(e) => setToSiteId(e.target.value)}>
                <option value="">— choisir —</option>
                {sites
                  .filter((s) => s.id !== siteId)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </div>
            <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
              <button className="btn-secondary" onClick={() => setStep('action')}>
                ← Retour
              </button>
              <button className="btn-primary" disabled={!toSiteId} onClick={submitTransfer}>
                Valider le transfert
              </button>
            </div>
          </div>
        )}

        {mode === 'scan' && step === 'confirm' && (
          <div className="scan-card scan-confirm">
            <div className="check">✓</div>
            <div className="line">{confirmMessage}</div>
            <button className="btn-primary" onClick={reset}>
              Nouveau scan
            </button>
          </div>
        )}
      </div>
    </>
  );

  // On a phone, this route drops AppShell's desktop sidebar entirely (its
  // own header comment already anticipated this: "a real Capacitor-wrapped
  // build would drop AppShell entirely for this route") — a fixed 232px
  // dark column has no room on a 375px screen, and Scan is the one module
  // meant to run genuinely full-screen. The header reuses MobileHome's own
  // established pattern (DashboardPage.css/.tsx's `.mobile-home-header` —
  // same "← Accueil" back-link + wordmark + "Se déconnecter" pill button
  // AppsListPage already uses) rather than inventing a new one — this is
  // the one mobile chrome style the app already has, not a second one.
  if (isMobile) {
    return (
      <div className="mobile-home scan-mobile-home">
        <div className="mobile-home-header">
          <div className="mobile-home-header-left">
            <button className="mobile-home-back" onClick={() => navigate('/dashboard')} aria-label="Accueil">
              ←
            </button>
            <div className="dashboard-wordmark">
              Stock<span className="ily">ily</span>
            </div>
          </div>
          <button className="btn-secondary" onClick={() => logout()}>
            Se déconnecter
          </button>
        </div>
        {body}
      </div>
    );
  }

  return <AppShell>{body}</AppShell>;
}

// The retail-till mode: no entrée/sortie/transfert choice per scan, just a
// running cart. "Terminer la vente" is the "cut" — it turns everything
// scanned so far into one finalized CUSTOMER invoice (stock deduction and
// all, via the same createInvoice + finalizeInvoice pair the desktop
// Invoicing page uses) and the cart resets, ready for the next customer.
function CheckoutPanel({
  code,
  setCode,
  onScan,
  cart,
  cartTotal,
  onUpdateLine,
  onRemoveLine,
  partners,
  checkoutPartnerId,
  setCheckoutPartnerId,
  checkoutPaid,
  setCheckoutPaid,
  checkoutSubmitting,
  checkoutConfirm,
  onFinalize,
  onClearCart,
}: {
  code: string;
  setCode: (v: string) => void;
  onScan: (code: string) => void;
  cart: CartLine[];
  cartTotal: number;
  onUpdateLine: (productId: string, patch: Partial<Pick<CartLine, 'quantity' | 'unitPrice'>>) => void;
  onRemoveLine: (productId: string) => void;
  partners: Partner[];
  checkoutPartnerId: string;
  setCheckoutPartnerId: (v: string) => void;
  checkoutPaid: boolean;
  setCheckoutPaid: (v: boolean) => void;
  checkoutSubmitting: boolean;
  checkoutConfirm: { number: string | null; total: number; paid: boolean } | null;
  onFinalize: () => void;
  onClearCart: () => void;
}) {
  const customers = partners.filter((p) => p.isCustomer);

  return (
    <div className="scan-card">
      <h3>Vente rapide</h3>
      {checkoutConfirm && (
        <div className="note-box">
          Vente enregistrée{checkoutConfirm.number ? ` — facture ${checkoutConfirm.number}` : ''} — {checkoutConfirm.total.toFixed(2)} DZD
          TTC — {checkoutConfirm.paid ? 'payée.' : 'non payée (à encaisser plus tard).'}
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onScan(code);
        }}
        className="scan-entry-row"
      >
        <input className="mono" placeholder="Saisie manuelle / douchette USB" value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
        <button type="submit" className="btn-primary">
          Ajouter
        </button>
      </form>

      {cart.length > 0 && (
        <div className="cart">
          {cart.map((l) => (
            <div className="cart-line" key={l.productId}>
              <div className="cart-line-top">
                <span className="cart-line-name">{l.name}</span>
                <button type="button" className="cart-line-remove" onClick={() => onRemoveLine(l.productId)} aria-label="Retirer">
                  ✕
                </button>
              </div>
              <div className="cart-line-sku mono muted">{l.sku}</div>
              <div className="cart-line-controls">
                <div className="cart-qty-stepper">
                  <button type="button" onClick={() => onUpdateLine(l.productId, { quantity: l.quantity - 1 })}>
                    −
                  </button>
                  <input
                    type="number"
                    min={1}
                    max={l.availableQuantity ?? undefined}
                    value={l.quantity}
                    onChange={(e) => onUpdateLine(l.productId, { quantity: Number(e.target.value) })}
                  />
                  <button type="button" onClick={() => onUpdateLine(l.productId, { quantity: l.quantity + 1 })}>
                    +
                  </button>
                </div>
                <div className="cart-line-price">
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={l.unitPrice}
                    onChange={(e) => onUpdateLine(l.productId, { unitPrice: Number(e.target.value) })}
                  />
                  <span className="unit">DZD</span>
                </div>
                <div className="cart-line-subtotal mono">{(l.quantity * l.unitPrice).toFixed(2)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      {cart.length === 0 && <p className="cart-empty">Le panier est vide — scannez un article pour commencer une vente.</p>}

      {cart.length > 0 && (
        <>
          <div className="field-row">
            <label>Client (optionnel)</label>
            <SearchableSelect
              value={checkoutPartnerId}
              onChange={setCheckoutPartnerId}
              placeholder="Rechercher un client…"
              emptyLabel="— non spécifié —"
              options={customers.map((p) => ({ value: p.id, label: p.name, sublabel: p.nif }))}
            />
          </div>
          <div className="field-row">
            <label>Paiement</label>
            <div className="toggle-row">
              <button type="button" className={`toggle-btn${checkoutPaid ? ' on' : ''}`} onClick={() => setCheckoutPaid(true)}>
                Payée
              </button>
              <button type="button" className={`toggle-btn${!checkoutPaid ? ' on' : ''}`} onClick={() => setCheckoutPaid(false)}>
                Non payée
              </button>
            </div>
          </div>
          <div className="cart-total">
            <span>Total</span>
            <span className="amount">{cartTotal.toFixed(2)} DZD</span>
          </div>
          <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
            <button type="button" className="btn-secondary" onClick={onClearCart} disabled={checkoutSubmitting}>
              Vider le panier
            </button>
            <button type="button" className="btn-primary" onClick={onFinalize} disabled={checkoutSubmitting}>
              {checkoutSubmitting ? 'Enregistrement…' : 'Terminer la vente'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// Label generation/printing — the wireframe's "Impression d'étiquettes",
// a distinct desktop-style admin task (batch-print labels ahead of time)
// from the mobile scan-in-the-moment flow above, but kept as a mode toggle
// on this same page rather than a separate route/nav item since it's a
// small, closely-related surface, not its own module.
function LabelsPanel() {
  const { accessToken } = useAuth();
  const [products, setProducts] = useState<StockRow[]>([]);
  const [labels, setLabels] = useState<BarcodeLabelView[]>([]);
  const [productId, setProductId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const [productRows, labelRows] = await Promise.all([stockApi.listProducts(accessToken, 'all'), scanApi.listLabels(accessToken)]);
      const unique = Array.from(new Map(productRows.map((p) => [p.productId, p])).values());
      setProducts(unique);
      setLabels(labelRows);
      // Functional update, not `if (!productId) ...` — `load` is memoized
      // with `productId` excluded from its deps (intentionally: it should
      // only seed a default once, not re-run every time the selector
      // changes), which means its closure over `productId` is permanently
      // stale at the component's very first render (always ''). Every
      // subsequent call — e.g. the one `generate()` triggers right after a
      // label is created — read that stale '' and silently reset the
      // dropdown back to the first product. Found by generating a label
      // for a product other than the first one and watching the selector
      // snap back, which looked exactly like "generation failed" even
      // though the label had, in fact, just been created correctly.
      setProductId((prev) => prev || (unique[0]?.productId ?? ''));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur de chargement.');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    load();
  }, [load]);

  async function generate() {
    if (!accessToken || !productId) return;
    setError(null);
    try {
      await scanApi.generateLabel(accessToken, { productId, symbology: 'QR' });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec de la génération.');
    }
  }

  async function print(id: string) {
    if (!accessToken) return;
    setError(null);
    try {
      const blob = await scanApi.fetchLabelPdf(accessToken, id);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      await scanApi.recordPrint(accessToken, id);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Échec de la génération de l'étiquette.");
    }
  }

  return (
    <div className="scan-card">
      <h3>Étiquettes</h3>
      <div className="field-row">
        <label>Produit</label>
        <select value={productId} onChange={(e) => setProductId(e.target.value)}>
          {products.map((p) => (
            <option key={p.productId} value={p.productId}>
              {p.sku} — {p.name}
            </option>
          ))}
        </select>
      </div>
      <button className="btn-primary" onClick={generate} disabled={!productId}>
        + Générer une étiquette
      </button>
      {error && <div className="error-banner">{error}</div>}
      {loading ? (
        <p className="sub">Chargement…</p>
      ) : (
        <table className="lot-mini-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Produit / Lot</th>
              <th>Imprimée</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {labels.map((l) => (
              <tr key={l.id}>
                <td className="mono">{l.codeValue}</td>
                <td className="muted">{l.product ? l.product.name : l.batch ? `Lot ${l.batch.lotNumber}` : '—'}</td>
                <td className="mono">{l.printedCount}×</td>
                <td>
                  <button className="btn-link" onClick={() => print(l.id)}>
                    Imprimer
                  </button>
                </td>
              </tr>
            ))}
            {labels.length === 0 && (
              <tr>
                <td colSpan={4} className="muted" style={{ textAlign: 'center', padding: '16px 0' }}>
                  Aucune étiquette générée pour le moment.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default ScanPage;
