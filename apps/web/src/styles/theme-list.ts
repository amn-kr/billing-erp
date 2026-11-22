/**
 * THE THEME'S COLOURS AND FONTS (owner, 22 Nov 2026; CLAUDE.md "The one hard rule").
 *
 * These are every colour and font the web app and the Windows app use today. look-guard.test.ts fails if a
 * stylesheet, screen, printed layout, PDF / Excel file or Windows page uses anything that is not on this list.
 * Adding a colour or font here is a change to the look: it needs the owner's OK first.
 *
 * Colours are written one way: lower case, #rrggbb (not #rgb), no spaces, .4 not 0.4.
 */
export const THEME_COLOURS: Record<string, readonly string[]> = {
  /** The app's stylesheets (copied from the prototype): app.css, palette.css, expenses.css, extras.css, sync.css */
  "app": [
    '#0b1020', '#0b1120', '#0b1312', '#0c111f', '#0d101b', '#0d9488',
    '#0e1120', '#0f766e', '#0f9d6b', '#10b981', '#111111', '#113532',
    '#121624', '#121c1b', '#131b2d', '#14100d', '#141a2c', '#14b8a6',
    '#151b2e', '#15803d', '#161a2b', '#16a34a', '#172422', '#172a4a',
    '#181c2a', '#192236', '#1a2136', '#1c2135', '#1d1814', '#1d2852',
    '#1e3a8a', '#1f2435', '#222222', '#241e19', '#243532', '#2563eb',
    '#26244f', '#263250', '#283150', '#2a3049', '#2dd4bf', '#382e26',
    '#3a2214', '#3b5bdb', '#3b82f6', '#4f46e5', '#555555', '#5b6478',
    '#60a5fa', '#66708a', '#6d8cff', '#777777', '#7b74f5', '#7c3aed',
    '#8b5cf6', '#8b93a9', '#8fa8ff', '#94a3b8', '#999999', '#9aa1b2',
    '#9aa2bb', '#9b6cf7', '#b91c1c', '#c2410c', '#d4a017', '#d5dae6',
    '#d97706', '#dc2626', '#ddccff', '#dddddd', '#e0b43a', '#e1e9e7',
    '#e2e7f0', '#e2e8f0', '#e2e8f2', '#e3e6ee', '#e3f3f0', '#e8eaf2',
    '#e8edf9', '#e8effd', '#e9ebf4', '#ea580c', '#ec4899', '#ece5df',
    '#eeedfd', '#ef4444', '#f2f4f8', '#f2f6f5', '#f3f5f9', '#f3f6fb',
    '#f4f5fa', '#f59e0b', '#f6faf9', '#f7f9fc', '#f7f9fd', '#f8f5f2',
    '#f8f9fc', '#f97316', '#fb923c', '#fbbf24', '#fbf8f6', '#fca5a5',
    '#fdba74', '#fdeee4', '#ffffff', 'rgba(0,0,0,.04)', 'rgba(0,0,0,.25)', 'rgba(0,0,0,.3)',
    'rgba(0,0,0,.35)', 'rgba(0,0,0,.6)', 'rgba(10,14,25,.08)', 'rgba(10,14,25,.12)', 'rgba(10,14,25,.15)', 'rgba(10,14,25,.2)',
    'rgba(10,14,25,.22)', 'rgba(10,14,25,.25)', 'rgba(10,14,25,.28)', 'rgba(10,14,25,.35)', 'rgba(10,14,25,.55)', 'rgba(15,23,42,.18)',
    'rgba(15,23,42,.2)', 'rgba(20,27,46,.04)', 'rgba(255,255,255,.06)', 'rgba(255,255,255,.08)', 'rgba(255,255,255,.18)', 'rgba(255,255,255,.22)',
    'rgba(5,8,18,.38)',
  ],
  /** The sign-in page (auth.css) */
  "signin": [
    '#0b5f58', '#0e1513', '#13201c', '#151f1c', '#173a36', '#26332f',
    '#2bb3a6', '#3fc7ba', '#5d6b66', '#93a39e', '#b45309', '#e3e8e6',
    '#e6f4f2', '#e8efed', '#f3f5f4', '#f87171', 'rgba(0,0,0,.08)', 'rgba(15,40,35,.07)',
  ],
  /** The software owner's panel (owner/owner.css) */
  "owner": [
    '#06201d', '#97a6a8', '#e9eff0', 'rgba(255,255,255,.12)',
  ],
  /** Printed invoice: layout and the colour choices in Settings › Print & invoice */
  "print": [
    '#047857', '#1d4ed8', '#6b7280', '#6d28d9', '#9aa1b1', '#9f1239',
  ],
  /** PDF and Excel files (rate list, quotation, reports, import sample files) */
  "files": [
    '#d9f2ee',
  ],
  /** The Windows app's own pages: welcome, starting, offline, title bar, recovery key */
  "windows": [
    '#000000', '#11151d', '#1a2030', '#1c2333', '#1d2142', '#2a3245',
    '#2f5bea', '#34d399', '#5d6679', '#6f8fff', '#818cf8', '#9aa3b5',
    '#e3e7ef', '#e8ecf4', '#eef0ff', '#f4f6fa', '#fef2f2', 'rgba(21,27,46,.06)',
    'rgba(233,235,244,.08)',
  ],
  /** Screens (inline styles) */
  "screens": [
    'rgba(255,255,255,.4)',
  ],
};

/** Font lists, written without quotes and without spaces after commas. */
export const THEME_FONTS: Record<string, string> = {
  'Segoe UI,system-ui,-apple-system,sans-serif': 'the Windows app’s own pages (welcome, starting, offline, title bar, recovery key)',
  'inherit': 'uses the font around it',
  'Consolas,Courier New,monospace': 'recovery key on the Windows app’s printout page',
  'var(--font)': 'uses the app’s font',
  'ui-monospace,Menlo,Consolas,monospace': 'fixed-width letters (codes)',
  'excel:Calibri': 'Excel files',
  'pdf:helvetica': 'PDF files (jsPDF’s built-in font)',
  'ui-monospace,monospace': 'fixed-width letters (recovery key)',
  'Inter,system-ui,-apple-system,Segoe UI,sans-serif': 'the app’s font (--font): Inter',
  'Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif': 'sign-in page: Inter',
};
