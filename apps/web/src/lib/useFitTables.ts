import { useEffect } from 'react';

/**
 * The prototype's fitTables(): main tables get a max height so their header
 * stays frozen and the page itself does not scroll. Same rules and numbers.
 */
function fitTables() {
  const wide = innerWidth > 860;
  document.querySelectorAll<HTMLElement>('main section:not([hidden]) .tw').forEach((t) => {
    if (!t.querySelector(':scope>table>thead') || t.closest('#vNewInv,#vPls,#vPrices,#vQuo,#vPEd')) return;
    if (!wide || !t.offsetParent) {
      t.style.maxHeight = '';
      t.style.overflowY = '';
      return;
    }
    const r = t.getBoundingClientRect();
    const top = r.top + ((document.scrollingElement || document.documentElement).scrollTop || 0);
    const sibs = t.parentElement ? [...t.parentElement.children] : [];
    const after = sibs.slice(sibs.indexOf(t) + 1).reduce((a, x) => a + ((x as HTMLElement).offsetHeight || 0), 0);
    const av = innerHeight - top - after - 18;
    const h = av >= 200 ? av : innerHeight - 120;
    t.style.maxHeight = h + 'px';
    t.style.overflowY = 'auto';
    t.style.overscrollBehavior = 'contain';
  });
  document.querySelectorAll('.mdl .tw').forEach((t) => {
    if (t.querySelector(':scope>table>thead')) t.classList.add('stk');
  });
}

export function useFitTables() {
  useEffect(() => {
    let q = 0;
    const soon = () => {
      cancelAnimationFrame(q);
      q = requestAnimationFrame(fitTables);
    };
    const main = document.querySelector('main');
    const obs = new MutationObserver(soon);
    if (main) obs.observe(main, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
    addEventListener('resize', soon);
    soon();
    return () => {
      obs.disconnect();
      removeEventListener('resize', soon);
      cancelAnimationFrame(q);
    };
  }, []);
}
