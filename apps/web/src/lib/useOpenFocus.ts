import { useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * The prototype's openM/closeM focus handling: opening a dialog focuses its first
 * button, input or select; closing it gives focus back to what had it before.
 */
export function useOpenFocus(open: boolean, ref: RefObject<HTMLElement | null>) {
  const before = useRef<Element | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    before.current = document.activeElement;
    ref.current?.querySelector<HTMLElement>('button,input,select')?.focus();
    return () => {
      (before.current as HTMLElement | null)?.focus?.();
    };
  }, [open, ref]);
}
