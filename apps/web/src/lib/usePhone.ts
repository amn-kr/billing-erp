import { useSyncExternalStore } from 'react';

/** Phone layouts (owner's request, 6 Nov 2026): screens narrower than 600px get their own mobile screen. */
export const PHONE_QUERY = '(max-width:599px)';

const mq = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(PHONE_QUERY) : null);
const sub = (cb: () => void) => {
  const m = mq();
  m?.addEventListener('change', cb);
  return () => m?.removeEventListener('change', cb);
};

/** True on a phone-width screen; follows the window when it is resized or the phone is turned. */
export const usePhone = () => useSyncExternalStore(sub, () => !!mq()?.matches, () => false);
