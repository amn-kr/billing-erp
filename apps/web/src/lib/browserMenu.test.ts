// @vitest-environment jsdom
/** The browser's own right-click menu never shows, except the copy / paste menu inside text fields. */
import { afterEach, describe, expect, it } from 'vitest';
import { blockBrowserMenu, inTextField } from './browserMenu';

const rightClick = (el: Element) => {
  const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
  el.dispatchEvent(e);
  return e.defaultPrevented;
};

let undo = () => {};
afterEach(() => { undo(); document.body.innerHTML = ''; });

describe('browser right-click menu', () => {
  it('is stopped on empty space, tables, headers, buttons and dialogs', () => {
    undo = blockBrowserMenu();
    document.body.innerHTML = '<main><table><thead><tr><th>Date</th></tr></thead><tbody><tr><td><b>INV-0001</b></td></tr></tbody></table><button>Save</button><div role="dialog"><p>Hi</p></div></main>';
    for (const sel of ['main', 'th', 'td b', 'button', 'div[role=dialog] p']) expect(rightClick(document.querySelector(sel)!), sel).toBe(true);
    expect(rightClick(document.body)).toBe(true);
  });

  it('is kept inside text boxes, text areas and editable areas (copy / paste)', () => {
    undo = blockBrowserMenu();
    document.body.innerHTML = '<input id="a"><input id="n" type="number"><input id="p" type="password"><textarea id="t"></textarea><div id="e" contenteditable="true"><span>x</span></div><input id="c" type="checkbox"><div id="f" contenteditable="false">x</div>';
    for (const id of ['a', 'n', 'p', 't']) expect(rightClick(document.getElementById(id)!), id).toBe(false);
    expect(rightClick(document.querySelector('#e span')!)).toBe(false);
    expect(rightClick(document.getElementById('c')!)).toBe(true);
    expect(rightClick(document.getElementById('f')!)).toBe(true);
  });

  it('the app’s own menu still opens first (its handler runs before the page-wide one)', () => {
    undo = blockBrowserMenu();
    document.body.innerHTML = '<table><tbody id="rows"><tr><td>INV-0001</td></tr></tbody></table>';
    let opened = false;
    document.getElementById('rows')!.addEventListener('contextmenu', (e) => { e.preventDefault(); opened = true; });
    expect(rightClick(document.querySelector('td')!)).toBe(true);
    expect(opened).toBe(true);
  });

  it('text nodes count as their element', () => {
    document.body.innerHTML = '<textarea>hello</textarea><p>hello</p>';
    expect(inTextField(document.querySelector('textarea')!.firstChild)).toBe(true);
    expect(inTextField(document.querySelector('p')!.firstChild)).toBe(false);
    expect(inTextField(null)).toBe(false);
  });
});
