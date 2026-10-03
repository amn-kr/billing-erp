import { useLayoutEffect } from 'react';

/** Puts the given CSS into <head> while the calling page is mounted (before first paint). */
export function useStyles(sheets: string[], key: string): void {
  useLayoutEffect(() => {
    const els = sheets.map((css, i) => {
      const el = document.createElement('style');
      el.dataset.sheet = `${key}-${i}`;
      el.textContent = css;
      document.head.appendChild(el);
      return el;
    });
    return () => els.forEach((el) => el.remove());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
