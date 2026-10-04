/**
 * The prototype's currency-symbol switch (curStart / curStop): with the symbol
 * off, "₹" and "(₹)" are removed from every text and from title, placeholder
 * and aria-label, as the page changes — except inside [data-keepcur].
 */
import { curFix } from './format';

const ATTR = ['title', 'placeholder', 'aria-label'];
const wm = new WeakMap<Text, { orig: string; out: string | null }>();
let obs: MutationObserver | null = null;

function curText(n: Text) {
  const d = n.data;
  if (d.indexOf('₹') < 0) return;
  const p = n.parentElement;
  if (p && p.closest('[data-keepcur]')) return;
  if (!wm.has(n) || wm.get(n)!.out !== d) wm.set(n, { orig: d, out: null });
  let o = curFix(d);
  if (!o.trim() && p && p.matches('.pre3>i') && p.parentElement?.parentElement && /%/.test(p.parentElement.parentElement.textContent ?? '')) o = 'Amt';
  wm.get(n)!.out = o;
  n.data = o;
  if (p && !o.trim() && p.matches('.pre2>span')) p.parentElement!.classList.add('ncur');
}
function curAttr(el: Element) {
  if (el.closest?.('[data-keepcur]')) return;
  for (const a of ATTR) {
    const v = el.getAttribute?.(a);
    if (v && v.indexOf('₹') >= 0) {
      el.setAttribute('data-cur-' + a, v);
      el.setAttribute(a, curFix(v));
    }
  }
}
function curScan(root: Node) {
  if (root.nodeType === 3) return curText(root as Text);
  if (root.nodeType !== 1) return;
  const el = root as Element;
  if (el.closest('script,style')) return;
  curAttr(el);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (x) => (x.nodeType === 1 ? ((x as Element).tagName === 'SCRIPT' || (x as Element).tagName === 'STYLE' ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP) : (x as Text).data.indexOf('₹') >= 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
  });
  const L: Text[] = [];
  while (w.nextNode()) L.push(w.currentNode as Text);
  L.forEach(curText);
  el.querySelectorAll('[title*="₹"],[placeholder*="₹"],[aria-label*="₹"]').forEach(curAttr);
}

export function curStart() {
  if (obs) return;
  curScan(document.body);
  obs = new MutationObserver((ms) => {
    for (const m of ms) {
      if (m.type === 'characterData') curText(m.target as Text);
      else if (m.type === 'attributes') curAttr(m.target as Element);
      else m.addedNodes.forEach(curScan);
    }
  });
  obs.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTR });
}

export function curStop() {
  if (!obs) return;
  obs.disconnect();
  obs = null;
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) {
    const n = w.currentNode as Text;
    const r = wm.get(n);
    if (r && r.out === n.data) n.data = r.orig;
  }
  for (const a of ATTR) document.querySelectorAll(`[data-cur-${a}]`).forEach((el) => { el.setAttribute(a, el.getAttribute(`data-cur-${a}`)!); el.removeAttribute(`data-cur-${a}`); });
}
