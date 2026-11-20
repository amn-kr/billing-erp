import { filter, interval, map, merge, Subject, type Observable } from 'rxjs';

/**
 * Live news for open screens (owner, 18 Nov 2026): when a document gets its number, every open
 * screen of the same shop learns that the next number of that type has moved on, so an open bill
 * shows the right number without anyone tapping. Only the shop's id and the document type travel;
 * the screens then ask for the next number themselves, through the usual checked endpoint.
 *
 * One server process keeps the news in memory (the free plan runs one). A second process would
 * need a shared channel (Redis is planned for later).
 */
export interface LiveNews {
  businessId: string;
  type: 'numbers';
  docType: string;
}

const news = new Subject<LiveNews>();

/** The next number of `docType` in this shop has changed. */
export function numbersChanged(businessId: string, docType: string): void {
  news.next({ businessId, type: 'numbers', docType });
}

/** A short "still here" message keeps proxies from closing a quiet connection. */
const PING_MS = 25_000;

/** One shop's news as server-sent events, with a ping now and then. */
export function newsFor(businessId: string): Observable<{ type: string; data: Record<string, string> }> {
  return merge(
    news.pipe(
      filter((n) => n.businessId === businessId),
      map((n) => ({ type: n.type, data: { docType: n.docType } })),
    ),
    interval(PING_MS).pipe(map(() => ({ type: 'ping', data: {} }))),
  );
}
