/**
 * Home (#vDash). Phase 1 shows the greeting and the three hero actions; the
 * tiles, recent invoices, ageing and the rest come in Phase 4 (Reports + Home).
 */
import { useOutletContext } from 'react-router-dom';
import type { MeResponse } from '@billing/shared';
import { Icon } from '../../components/Icon';
import { greeting } from '../../lib/time';
import { soon } from '../shell/store';

export function HomePage() {
  const me = useOutletContext<MeResponse>();
  const first = (me.user.name || '').trim().split(/\s+/)[0];
  return (
    <section id="vDash">
      <div className="hero">
        <div>
          <h1>{greeting()}{first ? ', ' + first : ''}</h1>
        </div>
        <div className="acts" id="heroActs">
          <button className="btn" data-soon="Purchases" onClick={() => soon('Purchases')}><Icon name="cart" />Add purchase</button>
          <button className="btn" data-soon="Payments" onClick={() => soon('Payments')}><Icon name="dn" />Receive payment</button>
          <button className="btn p" data-soon="New invoice" onClick={() => soon('New invoice')}><Icon name="plus" />New invoice</button>
        </div>
      </div>
    </section>
  );
}
