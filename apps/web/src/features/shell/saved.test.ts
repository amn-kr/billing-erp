import { describe, expect, it } from 'vitest';
import { savedText, type SavedDoc } from './saved';

describe('savedText', () => {
  it('gives the short message for every document type', () => {
    const want: Record<SavedDoc, string> = {
      invoice: 'Invoice saved successfully',
      quotation: 'Quotation saved successfully',
      receipt: 'Payment In saved successfully',
      credit_note: 'Credit Note saved successfully',
      challan: 'Delivery Challan saved successfully',
      bill: 'Purchase Bill saved successfully',
      order: 'Purchase Order saved successfully',
      payment: 'Payment Out saved successfully',
      debit_note: 'Debit Note saved successfully',
      expense: 'Expense saved successfully',
    };
    for (const [k, v] of Object.entries(want)) expect(savedText(k as SavedDoc)).toBe(v);
  });
});
