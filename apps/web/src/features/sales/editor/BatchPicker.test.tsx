// @vitest-environment jsdom
/** What is typed in Choose batch must survive the sale behind it being drawn again (found on GitHub's slower machines). */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BatchRow } from '@billing/shared';
import { BatchPicker, type PickFor } from './BatchPicker';

const row = (id: string | null, no: string, expiry: string | null, qty: string): BatchRow => ({ id, no, mfg: null, expiry, qty, rate: '10', value: '10' });
const pick = (): PickFor => ({
  name: 'Paracetamol', qty: 2, unit: 'PCS', date: '2026-10-01',
  rows: [row('x', 'X100', '2020-01-31', '1.000'), row('b', 'B456', '2040-01-31', '4.000')],
  allocs: [{ batchId: 'b', qty: '2.000' }], auto: [{ batchId: 'b', qty: '2.000' }],
});
const box = (no: string) => screen.getByLabelText(`Take from ${no}`) as HTMLInputElement;
afterEach(cleanup);

describe('Choose batch', () => {
  it('keeps what is typed when the screen behind is drawn again, and saves it', () => {
    const onDone = vi.fn();
    const { rerender } = render(<BatchPicker pick={pick()} onClose={() => {}} onDone={onDone} />);
    expect(box('B456').value).toBe('2');
    fireEvent.change(box('B456'), { target: { value: '1' } });
    fireEvent.change(box('X100'), { target: { value: '1' } });
    // the sale draws again: a new object with the same contents
    rerender(<BatchPicker pick={pick()} onClose={() => {}} onDone={onDone} />);
    expect(box('B456').value).toBe('1');
    expect(box('X100').value).toBe('1');
    fireEvent.click(document.getElementById('bxDone')!);
    expect(onDone).toHaveBeenCalledWith([{ batchId: 'x', qty: '1.000' }, { batchId: 'b', qty: '1.000' }]);
  });

  it('starts again from the line’s batches each time it opens', () => {
    const { rerender } = render(<BatchPicker pick={pick()} onClose={() => {}} onDone={() => {}} />);
    fireEvent.change(box('B456'), { target: { value: '1' } });
    rerender(<BatchPicker pick={null} onClose={() => {}} onDone={() => {}} />);
    rerender(<BatchPicker pick={pick()} onClose={() => {}} onDone={() => {}} />);
    expect(box('B456').value).toBe('2');
  });

  it('shows the MRP each row is checked at: its own, else the item\'s', () => {
    const rows = [row(null, 'No batch', null, '1.000'), { ...row('a', 'A123', null, '1.000'), mrp: '120.00' }, row('b', 'B456', null, '1.000')];
    const mrpIn = (no: string) => document.querySelector(`[data-batch="${no}"] td:nth-child(4)`)!.textContent;
    const { rerender } = render(<BatchPicker pick={{ ...pick(), rows, showMrp: true, itemMrp: 100 }} onClose={() => {}} onDone={() => {}} />);
    expect(mrpIn('No batch')).toBe('100.00');
    expect(mrpIn('A123')).toBe('120.00');
    expect(mrpIn('B456')).toBe('100.00');
    // the No batch row the window adds by itself, and an item with no MRP
    rerender(<BatchPicker pick={{ ...pick(), showMrp: true, itemMrp: 100 }} onClose={() => {}} onDone={() => {}} />);
    expect(mrpIn('No batch')).toBe('100.00');
    rerender(<BatchPicker pick={{ ...pick(), rows, showMrp: true, itemMrp: 0 }} onClose={() => {}} onDone={() => {}} />);
    expect(mrpIn('No batch')).toBe('—');
    expect(mrpIn('A123')).toBe('120.00');
  });
});
