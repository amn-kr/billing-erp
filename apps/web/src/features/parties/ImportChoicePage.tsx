/**
 * Parties › ⋮ › Import Parties (#vPImport): choose how to add many parties at once — from an
 * Excel / CSV file, or by typing or pasting them into a table. Not in the prototype — built only
 * from its classes (lnk, pthd, ptkind, card, ptempty pue, btn), like Import products.
 */
import type { ReactNode } from 'react';
import { go } from '../../lib/go';
import { RawIcon } from '../../components/Icon';
import { PARTY_IMPORT_MAX_ROWS } from '@billing/shared';

const XLS = '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M9 12l4 5M13 12l-4 5"/>';
const GRID = '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 9h18M3 14h18M9 4v16M15 4v16"/>';
const n = PARTY_IMPORT_MAX_ROWS.toLocaleString('en-IN');

/** "← Parties" and the page heading, shared by the three Import Parties screens */
export function ImportHead({ back, children }: { back: 'parties' | 'choice'; children?: ReactNode }) {
  return (
    <>
      {back === 'parties'
        ? <button className="lnk" id="piBack" style={{ fontSize: 12, padding: 0 }} onClick={() => go('/parties')}>← Parties</button>
        : <button className="lnk" id="piBack" style={{ fontSize: 12, padding: 0 }} onClick={() => go('/parties/import')}>← Import Parties</button>}
      <div className="pthd">{children}</div>
    </>
  );
}

export function ImportChoicePage() {
  const card = (id: string, icon: string, title: string, text: string, btn: string, to: string) => (
    <div className="card" id={id}>
      <div className="ptempty pue" style={{ padding: '28px 20px' }}>
        <RawIcon d={icon} />
        <b>{title}</b>
        <span>{text}</span>
        <button className="btn p sm" data-go={to} onClick={() => go(to)}>{btn}</button>
      </div>
    </div>
  );
  return (
    <section id="vPImport">
      <ImportHead back="parties"><h1 className="ptkind" style={{ cursor: 'default' }}>Import Parties</h1></ImportHead>
      <p className="hint" style={{ margin: '0 0 14px' }}>Add up to {n} parties at once. Choose one way:</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, maxWidth: 900 }}>
        {card('piExcel', XLS, 'Import from Excel', 'Download the sample file, fill in your parties, and upload it (.xlsx or .csv). You see every row checked before anything is saved.', 'Import from Excel', '/parties/import/excel')}
        {card('piBulk', GRID, 'Bulk entry (type or paste)', 'Type parties into a table, or copy rows from Excel or Google Sheets and paste them in. Wrong cells turn red so you can fix them.', 'Bulk entry', '/parties/import/bulk')}
      </div>
    </section>
  );
}
