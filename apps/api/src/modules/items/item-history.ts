/**
 * The item page's Transactions list without the lines an edit replaced. Editing a document writes
 * a reversing stock line (kind "cancel", note "Edited <number>") that puts back everything the
 * document had moved so far, then its new lines. On the list, that reversal and the lines it put
 * back are left out, so an edited document shows only its current lines. A real cancel keeps its
 * "cancelled" line. Only the list changes: the stock lines themselves stay as they are, and stock
 * on hand and stock value are worked out from all of them.
 */
export const isEditReversal = (m: { kind: string; note: string }) => m.kind === 'cancel' && m.note.startsWith('Edited ');

export function withoutEditedLines<M extends { kind: string; note: string; sourceType: string | null; sourceId: string | null; createdAt: Date }>(movements: M[]): M[] {
  // per document: when its latest edit was saved
  const lastEdit = new Map<string, number>();
  const key = (m: M) => (m.sourceId ? `${m.sourceType}:${m.sourceId}` : '');
  for (const m of movements) {
    const k = key(m);
    if (k && isEditReversal(m)) lastEdit.set(k, Math.max(lastEdit.get(k) ?? 0, m.createdAt.getTime()));
  }
  // the reversals go, and so does every line saved before the latest edit (those are exactly what it put back);
  // the lines written with that edit (same moment or later) are the document as it is now
  return movements.filter((m) => {
    const t = lastEdit.get(key(m));
    return t === undefined || (!isEditReversal(m) && m.createdAt.getTime() >= t);
  });
}
