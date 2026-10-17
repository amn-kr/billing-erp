import { useShell } from './store';

/** Every kind of transaction the app saves. */
export type SavedDoc = 'invoice' | 'quotation' | 'receipt' | 'credit_note' | 'challan' | 'bill' | 'order' | 'payment' | 'debit_note' | 'expense';

const NAME: Record<SavedDoc, string> = {
  invoice: 'Invoice', quotation: 'Quotation', receipt: 'Payment In', credit_note: 'Credit Note', challan: 'Delivery Challan',
  bill: 'Purchase Bill', order: 'Purchase Order', payment: 'Payment Out', debit_note: 'Debit Note', expense: 'Expense',
};

/** The short message after a save, new or edited (the number and amounts are on the preview and the lists). */
export const savedText = (doc: SavedDoc): string => `${NAME[doc]} saved successfully`;

/** Green: the document was saved. */
export const toastSaved = (doc: SavedDoc): void => useShell.getState().showToast(savedText(doc), 'ok');
/** Red: the save didn't happen, and why (also still shown inside the window). */
export const toastSaveFailed = (why: string): void => useShell.getState().showToast(why, 'error');
