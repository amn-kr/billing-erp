import app from './app.css?inline';
import palette from './palette.css?inline';
import expenses from './expenses.css?inline';
import extras from './extras.css?inline';
import sync from './sync.css?inline';
import auth from './auth.css?inline';

/** The app's stylesheets, in the order the prototype adds them to <head>. */
export const APP_STYLES = [app, palette, expenses, extras, sync];
/** The sign-in page (website version). */
export const AUTH_STYLES = [auth];
