import { BarcodeFormat, BrowserMultiFormatReader } from '@zxing/browser';
import { DecodeHintType } from '@zxing/library';

// Shared by every camera-scanning surface (Scan's own Scanner/Vente rapide
// modes, StockPage's BarcodeScanButton) so a tuning change here doesn't
// need to be copy-pasted in step across files.

// Every format the app expects to actually meet in practice — a
// Stockily-generated QR label, or a manufacturer's own EAN/UPC/Code128/
// Code39 barcode. Kept to only these (not ZXing's full format list)
// because BrowserMultiFormatReader tries each possible format against
// every frame in turn — fewer formats means less work per attempt, which
// matters once attempts are firing several times a second (see
// SCAN_OPTIONS below).
const POSSIBLE_FORMATS = [
  BarcodeFormat.QR_CODE,
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
];

// ZXing's own default is 500ms between decode attempts, and again between
// a success and the next attempt — meaning, while just holding the camera
// up trying to line up a code, it only actually looks at a frame twice a
// second. That gap, not decode time itself (a few ms on a modern phone),
// is the real source of scanning feeling slow. Cut aggressively: 80ms is
// still light on CPU (one canvas draw + one decode attempt) but ~6x more
// attempts per second, so a code lines up and resolves almost as soon as
// it's actually in frame. delayBetweenScanSuccess stays a bit higher —
// it only matters for Vente rapide's continuous scanning between items,
// where firing immediately after a hit would just re-decode the same
// still-visible code (the app's own 1500ms same-code debounce in
// ScanPage.tsx is a second, coarser layer on top of this one).
const SCAN_OPTIONS = {
  delayBetweenScanAttempts: 80,
  delayBetweenScanSuccess: 250,
};

// Requesting the camera's native resolution (often 1080p or higher) means
// every decode attempt runs over a much bigger image than a barcode
// actually needs — decode time scales with pixel count. 720p is
// comfortably enough resolution to read a barcode/QR code held at a
// normal scanning distance, and meaningfully faster to process per frame
// than whatever the camera's own default would otherwise pick.
export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    facingMode: 'environment',
    width: { ideal: 1280 },
    height: { ideal: 720 },
  },
};

export function createBarcodeReader(): BrowserMultiFormatReader {
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, POSSIBLE_FORMATS);
  return new BrowserMultiFormatReader(hints, SCAN_OPTIONS);
}
