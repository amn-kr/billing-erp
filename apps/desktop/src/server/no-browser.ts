/**
 * Single-PC mode has no separate browser for reading the old app's backup files (packages/importer
 * uses one). This stands in for playwright-core in the server bundle (build-server.mjs): the server
 * starts normally, and only that import says it is not available here yet.
 */
const notHere = () => {
  throw new Error('Reading a backup from the old app is not available in the Windows app yet. Restore it in the web app, then use the Windows app.');
};
export const chromium = { launch: notHere };
export type Browser = never;
