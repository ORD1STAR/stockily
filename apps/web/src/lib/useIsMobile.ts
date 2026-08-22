import { useEffect, useState } from 'react';

// Matches docs/Wireframes.html's own breakpoint (`@media (max-width: 800px)`,
// where the wireframe already collapses its sidebar) — a real viewport-width
// check, not a user-agent sniff, so resizing a desktop window narrow (or
// rotating a tablet) reacts live instead of only ever reading true once at
// load.
const MOBILE_BREAKPOINT = 800;

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= MOBILE_BREAKPOINT);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= MOBILE_BREAKPOINT);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return isMobile;
}
