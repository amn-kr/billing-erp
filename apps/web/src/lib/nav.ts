/** The sign-in page and the app are separate pages (see index.html); moving between them is a full page load. */
export const goToApp = () => window.location.replace('/');
export const goToLogin = (query = '') => window.location.replace('/login' + query);
