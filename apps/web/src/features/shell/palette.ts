/** Colour combinations — same list as the prototype's PAL (the CSS itself is in styles/palette.css). */
export const PAL = [
  { id: 'ledger', name: 'Ledger teal', why: 'Calm and money-like. Reads as trustworthy accounting.', rec: true, ac: '#0f766e', ac3: '#f59e0b', bg: '#f2f6f5', bd: '#e1e9e7' },
  { id: 'navy', name: 'Navy & gold', why: 'Bank-like and premium. Good for distributors and CAs.', ac: '#1e3a8a', ac3: '#d4a017', bg: '#f3f5f9', bd: '#e2e7f0' },
  { id: 'saffron', name: 'Saffron bazaar', why: 'Warm and energetic. Feels like Indian retail and kirana.', ac: '#c2410c', ac3: '#0f766e', bg: '#f8f5f2', bd: '#ece5df' },
  { id: 'royal', name: 'Royal blue', why: 'Clean and familiar, like most business software.', ac: '#2563eb', ac3: '#f97316', bg: '#f3f6fb', bd: '#e2e8f2' },
  { id: 'indigo', name: 'SchoolOS indigo', why: 'The original. Same as your SchoolOS pages.', ac: '#4f46e5', ac3: '#f59e0b', bg: '#f4f5fa', bd: '#e8eaf2' },
] as const;
export type PalId = (typeof PAL)[number]['id'];
