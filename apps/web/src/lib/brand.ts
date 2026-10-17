/** The app's name, from packages/shared/src/brand.ts (filled in by the brand plugin in vite.config.ts). */
declare const __APP_NAME__: string;

export const APP_NAME: string = __APP_NAME__;
/** the letter in the logo */
export const APP_LETTER = APP_NAME.charAt(0).toUpperCase();
