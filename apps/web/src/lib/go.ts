/** Open another screen from anywhere (the app frame hands in the router's navigate). */
let nav: ((to: string) => void) | null = null;
export const setGo = (n: (to: string) => void) => { nav = n; };
export const go = (to: string) => nav?.(to);
