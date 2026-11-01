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
});
