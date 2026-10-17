/**
 * Sign in · create account · join a shop · set up your shop.
 * Same markup and wording as reference/firebase-site/public/index.html, backed by our API.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { STATES, createBusinessSchema, firstError, type MeResponse } from '@billing/shared';
import { api, apiWithToken, ApiError, refreshSession, signOut } from '../../lib/api';
import { useSession } from '../../lib/session';
import { useStyles } from '../../lib/useStyles';
import { goToApp } from '../../lib/nav';
import { AUTH_STYLES } from '../../styles';
import { APP_LETTER, APP_NAME } from '../../lib/brand';

type View = 'vLoad' | 'vAuth' | 'vJoin' | 'vShop';
const APP = APP_NAME;
const TRIAL = Number(import.meta.env.VITE_TRIAL_DAYS ?? 14);
const msgOf = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong.');

const GOOGLE_SVG =
  '<path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 38.2 44 33 44 24c0-1.3-.1-2.4-.4-3.5z"/>';

export function LoginPage() {
  useStyles(AUTH_STYLES, 'auth');
  const qc = useQueryClient();
  const params = new URLSearchParams(window.location.search);
  const token = useSession((s) => s.accessToken);

  const [view, setView] = useState<View>('vLoad');
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [busy, setBusy] = useState(false);
  const [aErr, setAErr] = useState<{ text: string; ok?: boolean }>({ text: '' });
  const [jErr, setJErr] = useState('');
  const [sErr, setSErr] = useState('');
  const [invite, setInvite] = useState<MeResponse['invites'][number] | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passRef = useRef<HTMLInputElement>(null);
  const jNameRef = useRef<HTMLInputElement>(null);
  const sOwnerRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    document.title = APP + ' — sign in';
  }, []);

  /** Who is this, and which shop? (same decision order as the website) */
  async function route(newShop = params.has('new')) {
    setView('vLoad');
    try {
      const me = await api<MeResponse>('/me');
      qc.setQueryData(['me', useSession.getState().accessToken], me);
      if (me.business && !newShop) return goToApp();
      const inv = me.invites[0];
      if (inv && !newShop) {
        setInvite(inv);
        if (jNameRef.current) jNameRef.current.value = me.user.name;
        return setView('vJoin');
      }
      if (sOwnerRef.current) sOwnerRef.current.value = me.user.name || nameRef.current?.value.trim() || '';
      setView('vShop');
    } catch (e) {
      setView('vAuth');
      if (!(e instanceof ApiError && e.status === 401)) setAErr({ text: msgOf(e) });
    }
  }

  useEffect(() => {
    void (async () => {
      if (token || (await refreshSession())) await route();
      else setView('vAuth');
    })();
    // (this page loads on its own, so it resumes the session from the refresh cookie itself)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pickMode(m: 'in' | 'up') {
    setMode(m);
    setAErr({ text: '' });
  }

  async function onAuth(e: FormEvent) {
    e.preventDefault();
    const email = emailRef.current!.value.trim();
    const password = passRef.current!.value;
    setAErr({ text: '' });
    setBusy(true);
    try {
      if (mode === 'up') await apiWithToken('/auth/register', { email, password, name: nameRef.current!.value.trim() });
      else await apiWithToken('/auth/login', { email, password });
      await route();
    } catch (x) {
      setAErr({ text: msgOf(x) });
    } finally {
      setBusy(false);
    }
  }

  async function onForgot() {
    const email = emailRef.current!.value.trim();
    if (!email) return setAErr({ text: 'Type your email above first.' });
    try {
      await api('/auth/forgot', { body: { email } });
      // No email service is connected yet, so say so plainly instead of promising an email.
      setAErr({ text: 'Password reset by email isn’t switched on yet. Please contact support to reset your password.' });
    } catch (x) {
      setAErr({ text: msgOf(x) });
    }
  }

  async function onDemo(e: React.MouseEvent) {
    e.preventDefault();
    try {
      await apiWithToken('/auth/demo');
      await route(false);
    } catch (x) {
      setView('vAuth');
      setAErr({ text: msgOf(x) });
    }
  }

  async function out() {
    await signOut();
    qc.clear();
    setInvite(null);
    setView('vAuth');
  }

  async function onJoin() {
    const name = jNameRef.current!.value.trim();
    if (!name) return setJErr('Enter your name.');
    setBusy(true);
    setJErr('');
    try {
      await apiWithToken(`/invites/${invite!.id}/accept`, { name });
      goToApp();
    } catch (x) {
      setJErr(msgOf(x));
      setBusy(false);
    }
  }

  async function onShop(e: FormEvent) {
    e.preventDefault();
    const f = formRef.current!;
    const v = (id: string) => (f.querySelector<HTMLInputElement | HTMLSelectElement>('#' + id)?.value ?? '').trim();
    const o = { name: v('sName'), owner: v('sOwner'), phone: v('sPhone'), addr: v('sAddr'), city: v('sCity'), pin: v('sPin'), state: v('sState'), gstin: v('sGst').toUpperCase(), inv: v('sInv') || '1' };
    setSErr('');
    const ok = createBusinessSchema.safeParse(o);
    if (!ok.success) return setSErr(firstError(ok.error));
    setBusy(true);
    try {
      await apiWithToken('/businesses', o);
      goToApp();
    } catch (x) {
      setSErr(msgOf(x));
      setBusy(false);
    }
  }

  const up = mode === 'up';
  return (
    <div className="wrap">
      <section className="pitch">
        <div className="brand"><span className="logo" id="appLogo">{APP_LETTER}</span><span id="appName">{APP}</span></div>
        <h1>Billing, stock and accounts for your shop — in the browser.</h1>
        <p>GST invoices, purchases, payments, expenses, cash and bank, party statements and reports. Work from the counter, the godown or home; your staff see the same books.</p>
        <ul className="feat"><li>GST &amp; non-GST invoices</li><li>Quotations &amp; delivery challans</li><li>Purchase bills &amp; supplier payments</li><li>Stock with low-stock alerts</li><li>Cash book, bank &amp; cheques</li><li>Party statements on WhatsApp</li><li>Staff accounts, shared live</li><li>Daily cloud backup</li></ul>
        <p className="mu" id="legal" style={{ margin: '18px 0 0' }}><a className="lnk" href="/privacy.html">Privacy policy</a> · <a className="lnk" href="/terms.html">Terms of service</a></p>
      </section>
      <section className="card" id="box" aria-live="polite">
        <div id="vLoad" hidden={view !== 'vLoad'}><h2>Loading…</h2><p className="mu">Checking your account.</p></div>
        <div id="vAuth" hidden={view !== 'vAuth'}>
          <h2 id="authT">{up ? 'Create your account' : 'Sign in'}</h2><p className="mu" id="authS">{up ? 'Then set up your shop in one step.' : 'Welcome back.'}</p>
          <div className="tabs" role="tablist"><button type="button" className={up ? '' : 'on'} data-mode="in" role="tab" onClick={() => pickMode('in')}>Sign in</button><button type="button" className={up ? 'on' : ''} data-mode="up" role="tab" onClick={() => pickMode('up')}>Create account</button></div>
          <div id="removedNote" className="note" hidden={!params.has('removed')}>You no longer have access to that shop. Sign in with another account, or create your own shop.</div>
          <form id="fAuth" noValidate onSubmit={onAuth}>
            <label id="lName" hidden={!up}>Your name<input id="aName" autoComplete="name" ref={nameRef} /></label>
            <label>Email<input id="aEmail" type="email" autoComplete="email" required ref={emailRef} /></label>
            <label>Password<input id="aPass" type="password" autoComplete={up ? 'new-password' : 'current-password'} required minLength={up ? 8 : undefined} ref={passRef} /></label>
            <button className="btn p" id="aGo" type="submit" disabled={busy}>{up ? 'Create account' : 'Sign in'}</button>
            <div className={aErr.ok ? 'msg ok' : 'msg bad'} id="aErr" role="alert">{aErr.text}</div>
          </form>
          <div className="or">or</div>
          <button className="btn" type="button" id="aGoogle" onClick={() => setAErr({ text: 'Google sign-in isn’t set up yet. Use your email and password.' })}><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" dangerouslySetInnerHTML={{ __html: GOOGLE_SVG }} />Continue with Google</button>
          <p className="mu" style={{ margin: '12px 0 0', textAlign: 'center' }}><button className="lnk" type="button" id="aForgot" onClick={onForgot}>Forgot password?</button></p>
          <p className="demo mu">Just looking? <a className="lnk" href="/?demo=1" style={{ textDecoration: 'none' }} onClick={onDemo}>Open the demo shop</a></p>
        </div>
        <div id="vJoin" hidden={view !== 'vJoin'}>
          <h2>Join <span id="jShop">{invite?.businessName ?? 'the shop'}</span></h2><p className="mu">You were invited as staff. Your entries will go into this shop’s books.</p>
          <label style={{ marginTop: 16 }}>Your name<input id="jName" autoComplete="name" ref={jNameRef} /></label>
          <button className="btn p" type="button" id="jGo" disabled={busy} onClick={onJoin}>Join shop</button><div className="msg bad" id="jErr" role="alert">{jErr}</div>
          <p className="mu" style={{ margin: '14px 0 0', textAlign: 'center' }}><button className="lnk" type="button" id="jOwn" onClick={() => { if (sOwnerRef.current) sOwnerRef.current.value = jNameRef.current?.value ?? ''; setView('vShop'); }}>Create my own shop instead</button> · <button className="lnk" type="button" data-out onClick={out}>Sign out</button></p>
        </div>
        <div id="vShop" hidden={view !== 'vShop'}>
          <h2>Set up your shop</h2><p className="mu">This goes on your invoices. You can change it later in Settings.</p>
          <div className="note" style={{ marginTop: 14 }} id="trialNote">Free for {TRIAL} days. No card needed.</div>
          <form id="fShop" noValidate onSubmit={onShop} ref={formRef}>
            <label>Business name<input id="sName" placeholder="e.g. Gupta Electricals & Hardware" required /></label>
            <div className="two"><label>Your name<input id="sOwner" autoComplete="name" required ref={sOwnerRef} /></label><label>Phone<input id="sPhone" inputMode="tel" placeholder="+91 " /></label></div>
            <label>Address<input id="sAddr" placeholder="Shop no., street, area" /></label>
            <div className="two"><label>City<input id="sCity" /></label><label>PIN code<input id="sPin" inputMode="numeric" maxLength={6} /></label></div>
            <div className="two"><label>State<select id="sState" defaultValue="09">{STATES.map(([c, n]) => <option key={c} value={c}>{c} · {n}</option>)}</select></label><label>GSTIN <span style={{ fontWeight: 500 }}>(if registered)</span><input id="sGst" style={{ textTransform: 'uppercase' }} maxLength={15} placeholder="15 characters" /></label></div>
            <label>First invoice number<input id="sInv" inputMode="numeric" defaultValue="1" /></label>
            <button className="btn p" id="sGo" type="submit" disabled={busy}>Create shop &amp; open books</button><div className="msg bad" id="sErr" role="alert">{sErr}</div>
          </form>
          <p className="mu" style={{ margin: '14px 0 0', textAlign: 'center' }}><button className="lnk" type="button" data-out onClick={out}>Sign out</button></p>
        </div>
      </section>
    </div>
  );
}
