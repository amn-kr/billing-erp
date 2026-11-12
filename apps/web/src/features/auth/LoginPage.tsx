/**
 * Sign in · create account · join a shop · set up your shop.
 * Same markup and wording as reference/firebase-site/public/index.html, backed by our API.
 * "Choose a new password" (vPass) uses the same card after a temporary password from the shop owner.
 * "Forgot password?" opens "Use a recovery code" (vRec): the email, one recovery code and a new password.
 * The software owner signs in here too and goes to the owner panel (/owner); /login?setup is the panel's one-time setup.
 * Windows app, single-PC mode: an email with no account on this PC says so, and offers "Bring my online books to
 * this PC" (vBring, Phase 6 step 7b) or Create account.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { flushSync } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { STATES, createBusinessSchema, firstError, type AuthTokens, type MeResponse, type OwnerSignIn } from '@billing/shared';
import { api, apiWithToken, ApiError, refreshSession, signOut } from '../../lib/api';
import { useSession } from '../../lib/session';
import { meKey } from '../../lib/me';
import { useStyles } from '../../lib/useStyles';
import { goToApp } from '../../lib/nav';
import { AUTH_STYLES } from '../../styles';
import { APP_LETTER, APP_NAME } from '../../lib/brand';
import { ui } from '../../styles/uiSize';
import { OwnerSetup } from '../../owner/OwnerSetup';
import { desktop } from '../../lib/desktop';

type View = 'vLoad' | 'vAuth' | 'vPass' | 'vRec' | 'vJoin' | 'vShop' | 'vSetup' | 'vBring';
/** Bring my online books to this PC: the online account's shops, and what came down */
type OwnedShop = { id: string; code: string; name: string; city: string; movedToPcOn: string | null };
type Counts = { invoices: number; parties: number; items: number; purchaseBills: number; paymentsReceived: number; salesTotalThisYear: string };
type Brought = AuthTokens & { code: string; name: string; matches: boolean; here: Counts; online: Counts };
const countsText = (c: Counts) => `${c.invoices} invoices, ${c.parties} parties, ${c.items} items, ${c.purchaseBills} purchase bills, ${c.paymentsReceived} payments`;
const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
const APP = APP_NAME;
const TRIAL = Number(import.meta.env.VITE_TRIAL_DAYS ?? 14);
/** the Windows app in single-PC mode: the books are on this computer, which has no demo shop */
const ON_THIS_PC = !!desktop()?.local;
const msgOf = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong.');

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
  const [pErr, setPErr] = useState('');
  const [rErr, setRErr] = useState('');
  /** single-PC mode: the email typed has no account on this PC */
  const [notHere, setNotHere] = useState('');
  const [bErr, setBErr] = useState('');
  const [bShops, setBShops] = useState<OwnedShop[] | null>(null);
  const [bPick, setBPick] = useState<string | null>(null);
  const [bDone, setBDone] = useState<Brought | null>(null);
  const bEmailRef = useRef<HTMLInputElement>(null);
  const bPassRef = useRef<HTMLInputElement>(null);
  const rEmailRef = useRef<HTMLInputElement>(null);
  const rCodeRef = useRef<HTMLInputElement>(null);
  const rNewRef = useRef<HTMLInputElement>(null);
  const rNew2Ref = useRef<HTMLInputElement>(null);
  /** the password just typed to sign in, so the temporary one isn't asked again (kept only in memory) */
  const signedWith = useRef('');
  const [askCurrent, setAskCurrent] = useState(true);
  const pCurRef = useRef<HTMLInputElement>(null);
  const pNewRef = useRef<HTMLInputElement>(null);
  const pNew2Ref = useRef<HTMLInputElement>(null);
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
      qc.setQueryData(meKey(useSession.getState().accessToken), me);
      if (me.user.mustChangePassword) {
        setAskCurrent(!signedWith.current);
        // drawn first, then focused at once: a delayed focus could move typing into another box
        flushSync(() => setView('vPass'));
        return (signedWith.current ? pNewRef : pCurRef).current?.focus();
      }
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
      if (params.has('setup')) return setView('vSetup');
      if (token || (await refreshSession())) await route();
      else setView('vAuth');
    })();
    // (this page loads on its own, so it resumes the session from the refresh cookie itself)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pickMode(m: 'in' | 'up') {
    setMode(m);
    setAErr({ text: '' });
    setNotHere('');
  }

  async function onAuth(e: FormEvent) {
    e.preventDefault();
    const email = emailRef.current!.value.trim();
    const password = passRef.current!.value;
    setAErr({ text: '' });
    setNotHere('');
    setBusy(true);
    try {
      if (mode === 'up') await apiWithToken('/auth/register', { email, password, name: nameRef.current!.value.trim() });
      else {
        const r = await apiWithToken<AuthTokens & Partial<OwnerSignIn>>('/auth/login', { email, password });
        // the software owner: the panel signs itself in from its own cookie; this page keeps no token
        if (r.owner) {
          useSession.getState().setToken(null);
          return window.location.replace('/owner');
        }
      }
      signedWith.current = password;
      await route();
    } catch (x) {
      if (ON_THIS_PC && x instanceof ApiError && x.code === 'not_on_pc') setNotHere(x.message);
      else setAErr({ text: msgOf(x) });
    } finally {
      setBusy(false);
    }
  }

  /** No email service is connected yet: "Forgot password?" uses a recovery code (or support). */
  function onForgot() {
    setAErr({ text: '' });
    setRErr('');
    for (const r of [rCodeRef, rNewRef, rNew2Ref]) if (r.current) r.current.value = '';
    if (rEmailRef.current) rEmailRef.current.value = emailRef.current!.value.trim();
    flushSync(() => setView('vRec'));
    (rEmailRef.current?.value ? rCodeRef : rEmailRef).current?.focus();
  }

  /** Bring my online books to this PC: the email and password typed so far come along. */
  function onBring() {
    setBErr('');
    setBShops(null);
    setBPick(null);
    setBDone(null);
    if (bEmailRef.current) bEmailRef.current.value = emailRef.current!.value.trim();
    if (bPassRef.current) bPassRef.current.value = passRef.current!.value;
    flushSync(() => setView('vBring'));
    (bEmailRef.current?.value ? bPassRef : bEmailRef).current?.focus();
  }

  const bWho = () => ({ email: bEmailRef.current!.value.trim(), password: bPassRef.current!.value });

  async function onBringFind(e: FormEvent) {
    e.preventDefault();
    const who = bWho();
    setBErr('');
    if (!who.email) return setBErr('Enter the email of your online account.');
    if (!who.password) return setBErr('Enter the password of your online account.');
    setBusy(true);
    try {
      const { shops } = await api<{ shops: OwnedShop[] }>('/cloud/bring/shops', { body: who });
      setBShops(shops);
      const free = shops.filter((x) => !x.movedToPcOn);
      setBPick(free.length === 1 ? free[0]!.id : null);
    } catch (x) {
      setBErr(msgOf(x));
    } finally {
      setBusy(false);
    }
  }

  async function onBringGo() {
    if (!bPick) return setBErr('Choose the shop to bring to this PC.');
    setBErr('');
    setBusy(true);
    try {
      const r = await apiWithToken<Brought>('/cloud/bring', { ...bWho(), businessId: bPick, confirm: true });
      setBDone(r);
    } catch (x) {
      setBErr(msgOf(x));
    } finally {
      setBusy(false);
    }
  }

  async function onRecover(e: FormEvent) {
    e.preventDefault();
    const email = rEmailRef.current!.value.trim();
    const code = rCodeRef.current!.value.trim();
    const password = rNewRef.current!.value;
    setRErr('');
    if (!email) return setRErr('Enter your email.');
    if (!code) return setRErr('Enter one of your recovery codes.');
    if (password.length < 8) return setRErr('Use at least 8 characters for the password.');
    if (password !== rNew2Ref.current!.value) return setRErr('The two passwords don’t match.');
    setBusy(true);
    try {
      await apiWithToken('/auth/recover', { email, code, password });
      await route();
    } catch (x) {
      setRErr(msgOf(x));
    } finally {
      setBusy(false);
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

  async function onPass(e: FormEvent) {
    e.preventDefault();
    const current = askCurrent ? pCurRef.current!.value : signedWith.current;
    const password = pNewRef.current!.value;
    setPErr('');
    if (!current) return setPErr('Enter the temporary password.');
    if (password.length < 8) return setPErr('Use at least 8 characters for the password.');
    if (password !== pNew2Ref.current!.value) return setPErr('The two passwords don’t match.');
    setBusy(true);
    try {
      await api('/auth/change-password', { body: { current, password } });
      signedWith.current = '';
      await route();
    } catch (x) {
      setPErr(msgOf(x));
      // a wrong temporary password: ask for it instead of the one remembered from sign-in
      if (x instanceof ApiError && x.status === 400 && /current password/i.test(x.message)) setAskCurrent(true);
    } finally {
      setBusy(false);
    }
  }

  async function out() {
    signedWith.current = '';
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
        <p className="mu" id="legal" style={{ margin: ui.sp('18px 0 0') }}><a className="lnk" href="/privacy.html">Privacy policy</a> · <a className="lnk" href="/terms.html">Terms of service</a></p>
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
          {notHere && (
            <div className="note" id="aNotHere" role="alert" style={{ marginTop: ui.sp(12) }}>
              {notHere}<br />
              <button className="lnk" type="button" id="aBring" onClick={onBring}>Bring my online books to this PC</button> · <button className="lnk" type="button" id="aUp" onClick={() => pickMode('up')}>Create account</button>
            </div>
          )}
          <p className="mu" style={{ margin: ui.sp('12px 0 0'), textAlign: 'center' }}><button className="lnk" type="button" id="aForgot" onClick={onForgot}>Forgot password?</button></p>
          {!ON_THIS_PC && <p className="demo mu">Just looking? <a className="lnk" href="/?demo=1" style={{ textDecoration: 'none' }} onClick={onDemo}>Open the demo shop</a></p>}
        </div>
        <div id="vPass" hidden={view !== 'vPass'}>
          <h2>Choose a new password</h2><p className="mu">You signed in with a temporary password from the shop owner. Choose your own to continue.</p>
          <form id="fPass" noValidate onSubmit={onPass}>
            <label hidden={!askCurrent}>Temporary password<input id="pCur" type="password" autoComplete="current-password" ref={pCurRef} /></label>
            <label>New password<input id="pNew" type="password" autoComplete="new-password" minLength={8} ref={pNewRef} /></label>
            <label>Type it again<input id="pNew2" type="password" autoComplete="new-password" minLength={8} ref={pNew2Ref} /></label>
            <button className="btn p" id="pGo" type="submit" disabled={busy}>Save and continue</button>
            <div className="msg bad" id="pErr" role="alert">{pErr}</div>
          </form>
          <p className="mu" style={{ margin: ui.sp('14px 0 0'), textAlign: 'center' }}><button className="lnk" type="button" data-out onClick={out}>Sign out</button></p>
        </div>
        <div id="vRec" hidden={view !== 'vRec'}>
          <h2>Use a recovery code</h2><p className="mu">Type your email, one of your recovery codes and a new password. Each code works once.</p>
          <form id="fRec" noValidate onSubmit={onRecover}>
            <label>Email<input id="rEmail" type="email" autoComplete="email" ref={rEmailRef} /></label>
            <label>Recovery code<input id="rCode" style={{ fontFamily: 'ui-monospace,Menlo,Consolas,monospace', letterSpacing: '.08em', fontWeight: 600, textTransform: 'uppercase' }} autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} placeholder="XXXX-XXXX" ref={rCodeRef} /></label>
            <label>New password<input id="rNew" type="password" autoComplete="new-password" minLength={8} ref={rNewRef} /></label>
            <label>Type it again<input id="rNew2" type="password" autoComplete="new-password" minLength={8} ref={rNew2Ref} /></label>
            <button className="btn p" id="rGo" type="submit" disabled={busy}>Save and sign in</button>
            <div className="msg bad" id="rErr" role="alert">{rErr}</div>
          </form>
          <div className="note" style={{ marginTop: ui.sp(14) }} id="rNote">No recovery codes? Please contact support to reset your password.</div>
          <p className="mu" style={{ margin: ui.sp('14px 0 0'), textAlign: 'center' }}><button className="lnk" type="button" id="rBack" onClick={() => setView('vAuth')}>Back to sign in</button></p>
        </div>
        <div id="vBring" hidden={view !== 'vBring'}>
          {!bDone ? (
            <>
              <h2>Bring your online books to this PC</h2><p className="mu">Sign in with your online account. This needs internet once; after that this PC works without it.</p>
              <form id="fBring" noValidate onSubmit={onBringFind} style={{ marginTop: ui.sp(16) }}>
                <label>Email<input id="bEmail" type="email" autoComplete="email" ref={bEmailRef} disabled={!!bShops} /></label>
                <label>Password<input id="bPass" type="password" autoComplete="current-password" ref={bPassRef} disabled={!!bShops} /></label>
                {!bShops && <button className="btn p" id="bFind" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Find my shops'}</button>}
              </form>
              {bShops && (
                <div id="bShops">
                  {bShops.length === 0 ? (
                    <div className="note" id="bNone">This account doesn’t own a shop online. Only a shop’s owner can bring its books to a PC.</div>
                  ) : (
                    <>
                      <p className="mu" style={{ margin: ui.sp('0 0 8px') }}>Choose the shop to bring to this PC:</p>
                      {bShops.map((x) => (
                        <button key={x.id} type="button" className="btn" data-shop={x.code} disabled={busy || !!x.movedToPcOn} aria-pressed={bPick === x.id} style={{ marginBottom: ui.sp(8), ...(bPick === x.id ? { borderColor: 'var(--ac)', background: 'var(--acs)', color: 'var(--ac)' } : {}) }} onClick={() => setBPick(x.id)}>
                          {x.movedToPcOn ? `${x.name} (${x.code}) · on a PC since ${dayOf(x.movedToPcOn)}` : `${x.name}${x.city ? `, ${x.city}` : ''} (${x.code})`}
                        </button>
                      ))}
                      <div className="note" id="bNote" style={{ marginTop: ui.sp(6) }}>The whole books are copied to this PC, and the same email and password work here. <b>Online, this shop then becomes view-only:</b> you and your staff can look and print there, but billing happens on this PC.</div>
                      <button className="btn p" id="bGo" type="button" disabled={busy || !bPick} onClick={onBringGo}>{busy ? 'Bringing the books… (this can take a minute)' : 'I understand, bring the books to this PC'}</button>
                    </>
                  )}
                </div>
              )}
              <div className="msg bad" id="bErr" role="alert">{bErr}</div>
              <p className="mu" style={{ margin: ui.sp('14px 0 0'), textAlign: 'center' }}><button className="lnk" type="button" id="bBack" disabled={busy} onClick={() => setView('vAuth')}>Back to sign in</button></p>
            </>
          ) : (
            <div id="bDone">
              <h2>Your books are on this PC</h2>
              <p className="mu">{bDone.name} ({bDone.code}) is now on this computer, with the same counts as online: {countsText(bDone.here)}. Online, the shop is view-only from now on.</p>
              <div className="note" style={{ marginTop: ui.sp(14) }}>Next: in Settings › General › Backup &amp; restore, choose a pen drive or Google Drive for backups, and print the recovery key. Staff can be added again in Settings › Team.</div>
              <button className="btn p" id="bOpen" type="button" onClick={() => goToApp()}>Open my books</button>
            </div>
          )}
        </div>
        {view === 'vSetup' && <div id="vSetup"><OwnerSetup /></div>}
        <div id="vJoin" hidden={view !== 'vJoin'}>
          <h2>Join <span id="jShop">{invite?.businessName ?? 'the shop'}</span></h2><p className="mu">You were invited as staff. Your entries will go into this shop’s books.</p>
          <label style={{ marginTop: ui.sp(16) }}>Your name<input id="jName" autoComplete="name" ref={jNameRef} /></label>
          <button className="btn p" type="button" id="jGo" disabled={busy} onClick={onJoin}>Join shop</button><div className="msg bad" id="jErr" role="alert">{jErr}</div>
          <p className="mu" style={{ margin: ui.sp('14px 0 0'), textAlign: 'center' }}><button className="lnk" type="button" id="jOwn" onClick={() => { if (sOwnerRef.current) sOwnerRef.current.value = jNameRef.current?.value ?? ''; setView('vShop'); }}>Create my own shop instead</button> · <button className="lnk" type="button" data-out onClick={out}>Sign out</button></p>
        </div>
        <div id="vShop" hidden={view !== 'vShop'}>
          <h2>Set up your shop</h2><p className="mu">This goes on your invoices. You can change it later in Settings.</p>
          <div className="note" style={{ marginTop: ui.sp(14) }} id="trialNote">Free for {TRIAL} days. No card needed.</div>
          <form id="fShop" noValidate onSubmit={onShop} ref={formRef}>
            <label>Business name<input id="sName" placeholder="e.g. Gupta Electricals & Hardware" required /></label>
            <div className="two"><label>Your name<input id="sOwner" autoComplete="name" required ref={sOwnerRef} /></label><label>Phone<input id="sPhone" inputMode="tel" placeholder="+91 " /></label></div>
            <label>Address<input id="sAddr" placeholder="Shop no., street, area" /></label>
            <div className="two"><label>City<input id="sCity" /></label><label>PIN code<input id="sPin" inputMode="numeric" maxLength={6} /></label></div>
            <div className="two"><label>State<select id="sState" defaultValue="09">{STATES.map(([c, n]) => <option key={c} value={c}>{c} · {n}</option>)}</select></label><label>GSTIN <span style={{ fontWeight: 500 }}>(if registered)</span><input id="sGst" style={{ textTransform: 'uppercase' }} maxLength={15} placeholder="15 characters" /></label></div>
            <label>First invoice number<input id="sInv" inputMode="numeric" defaultValue="1" /></label>
            <button className="btn p" id="sGo" type="submit" disabled={busy}>Create shop &amp; open books</button><div className="msg bad" id="sErr" role="alert">{sErr}</div>
          </form>
          <p className="mu" style={{ margin: ui.sp('14px 0 0'), textAlign: 'center' }}><button className="lnk" type="button" data-out onClick={out}>Sign out</button></p>
        </div>
      </section>
    </div>
  );
}
