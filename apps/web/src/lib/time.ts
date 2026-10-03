import { todayIst } from '@billing/shared';

/** Today in India (the browser clock, read in Asia/Kolkata). */
export const today = () => todayIst(new Date());

/** Prototype greeting rule: before 12 morning, before 17 afternoon, else evening (browser's local hour). */
export function greeting(now = new Date()): string {
  const h = now.getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}
