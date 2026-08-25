import { StrictMode } from 'react';
import * as ReactDOM from 'react-dom/client';
import App from './app/app';

// Suppresses Safari/iOS's edge-swipe "go back" gesture, which recognizes a
// horizontal drag starting near the screen edge at the OS/browser-chrome
// level, below the page's own DOM — no CSS property turns it off. The
// established mitigation: watch for a touch that starts within
// EDGE_THRESHOLD px of an edge and then moves mostly horizontally, and
// call preventDefault() on that touchmove early enough that WebKit's
// gesture recognizer defers to the page instead of claiming the gesture
// for its own back-navigation. `touchstart` itself is left alone (passive)
// — anything near the edge that's a plain tap (a hamburger button, a "←
// Accueil" link) never generates a meaningful touchmove delta, so it's
// unaffected; only an actual drag gets intercepted. Not a page-content
// concern, so it lives here at the app entry point rather than any one
// component — and it's a mitigation, not a guarantee: WebKit's gesture
// recognizer is outside what a page can fully control, so this needs
// verifying on a real device, not just code review.
const EDGE_SWIPE_THRESHOLD_PX = 24;
let edgeSwipeStartX: number | null = null;
let edgeSwipeStartY: number | null = null;

document.addEventListener(
  'touchstart',
  (e) => {
    const touch = e.touches[0];
    if (!touch) return;
    const nearEdge = touch.clientX < EDGE_SWIPE_THRESHOLD_PX || touch.clientX > window.innerWidth - EDGE_SWIPE_THRESHOLD_PX;
    edgeSwipeStartX = nearEdge ? touch.clientX : null;
    edgeSwipeStartY = nearEdge ? touch.clientY : null;
  },
  { passive: true },
);

document.addEventListener(
  'touchmove',
  (e) => {
    if (edgeSwipeStartX == null || edgeSwipeStartY == null) return;
    const touch = e.touches[0];
    if (!touch) return;
    const dx = touch.clientX - edgeSwipeStartX;
    const dy = touch.clientY - edgeSwipeStartY;
    if (Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy)) {
      e.preventDefault();
    }
  },
  { passive: false },
);

document.addEventListener('touchend', () => {
  edgeSwipeStartX = null;
  edgeSwipeStartY = null;
});

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement,
);

root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
