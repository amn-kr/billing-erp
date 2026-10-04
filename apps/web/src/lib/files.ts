/**
 * Files the prototype makes with its FileLib: .xlsx sheets (same styles — bold
 * header with a green fill, #,##0.00 money, a big bold title, grey section
 * rows — widths and frozen top rows), reading .xlsx / .csv for imports, and
 * saving a file. The libraries load only when a file is made or read.
 */
export interface Sheet {
  name: string;
  rows: (string | number | null | undefined)[][];
  widths?: number[];
  /** rows kept on screen at the top */
  freeze?: number;
  /** row index → 1 header, 3 title, 4 section */
  styles?: Record<number, 1 | 3 | 4>;
  /** column indexes shown as money (numbers only, rows without a style) */
  money?: number[];
}

export async function xlsxBlob(sheets: Sheet[]): Promise<Blob> {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '), s.freeze ? { views: [{ state: 'frozen', ySplit: s.freeze }] } : {});
    if (s.widths) ws.columns = s.widths.map((width) => ({ width }));
    s.rows.forEach((r, ri) => {
      const row = ws.getRow(ri + 1);
      const st = s.styles?.[ri];
      r.forEach((v, ci) => {
        if (v === null || v === undefined || v === '') return;
        const c = row.getCell(ci + 1);
        c.value = typeof v === 'number' && Number.isFinite(v) ? v : String(v);
        if (st === 1) { c.font = { bold: true, size: 11, name: 'Calibri' }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3F3F0' } }; }
        else if (st === 3) c.font = { bold: true, size: 14, name: 'Calibri' };
        else if (st === 4) { c.font = { bold: true, size: 11, name: 'Calibri' }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F4F8' } }; }
        else if (typeof v === 'number' && s.money?.includes(ci)) c.numFmt = '#,##0.00';
      });
    });
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/** Rows of the first sheet of an .xlsx file, as text. */
export async function readXlsx(data: ArrayBuffer): Promise<string[][]> {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data);
  const ws = wb.worksheets[0];
  const out: string[][] = [];
  ws?.eachRow({ includeEmpty: true }, (row, n) => {
    const vals: string[] = [];
    row.eachCell({ includeEmpty: true }, (c, k) => {
      const v = c.value as unknown;
      vals[k - 1] = v === null || v === undefined ? '' : typeof v === 'object' && v && 'result' in v ? String((v as { result: unknown }).result ?? '') : typeof v === 'object' && v && 'text' in v ? String((v as { text: unknown }).text) : String(v);
    });
    out[n - 1] = Array.from(vals, (x) => x ?? '');
  });
  return Array.from(out, (r) => r ?? []);
}

/** CSV with quotes ("a, b"), doubled quotes and CRLF. */
export function readCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export function saveFile(name: string, blob: Blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
