import './PageSkeleton.css';

// Shown inside the app shell while a module's code or data loads: the sidebar stays,
// and the content area shows the rough outline of a module page (title, filters, table).
export function PageSkeleton({ rows = 7 }: { rows?: number }) {
  return (
    <div className="skel-page" role="status" aria-label="Chargement…" aria-busy="true">
      <div className="skel-head">
        <div>
          <div className="skel skel-title" />
          <div className="skel skel-sub" />
        </div>
        <div className="skel skel-btn" />
      </div>
      <div className="skel-cards">
        {[0, 1, 2, 3].map((i) => (
          <div className="skel-card" key={i}>
            <div className="skel skel-line short" />
            <div className="skel skel-num" />
          </div>
        ))}
      </div>
      <div className="skel-tabs">
        {[0, 1, 2].map((i) => (
          <div className="skel skel-tab" key={i} />
        ))}
        <div className="skel skel-search" />
      </div>
      <div className="skel-table">
        <div className="skel-row skel-row-head">
          {[0, 1, 2, 3].map((i) => (
            <div className="skel skel-line" key={i} />
          ))}
        </div>
        {Array.from({ length: rows }, (_, r) => (
          <div className="skel-row" key={r}>
            <div className="skel skel-line wide" />
            <div className="skel skel-line" />
            <div className="skel skel-line short" />
            <div className="skel skel-line short" />
          </div>
        ))}
      </div>
      <span className="sr-only">Chargement…</span>
    </div>
  );
}
