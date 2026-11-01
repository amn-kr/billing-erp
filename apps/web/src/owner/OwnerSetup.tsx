/**
 * One-time setup of the software owner's account (/login?setup), in the sign-in page's card.
 * Works only while OWNER_SETUP_CODE is set on the server and no owner account exists (owner-approved mock, 1 Nov 2026).
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { firstError, OWNER_PASSWORD_MIN, ownerSetupSchema } from '@billing/shared';
import { goToLogin } from '../lib/nav';
import { ownerApi, OwnerApiError } from './api';

type Step = 'load' | 'form' | 'done' | 'closed';

export function OwnerSetup() {
  const [step, setStep] = useState<Step>('load');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const code = useRef<HTMLInputElement>(null);
  const name = useRef<HTMLInputElement>(null);
  const email = useRef<HTMLInputElement>(null);
  const pw = useRef<HTMLInputElement>(null);
  const pw2 = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void ownerApi<{ open: boolean }>('/setup', {}, false)
      .then((r) => setStep(r.open ? 'form' : 'closed'))
      .catch(() => setStep('closed'));
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr('');
    const input = { code: code.current!.value, name: name.current!.value, email: email.current!.value, password: pw.current!.value, password2: pw2.current!.value };
    const v = ownerSetupSchema.safeParse(input);
    if (!v.success) return setErr(firstError(v.error));
    setBusy(true);
    try {
      await ownerApi('/setup', { body: input }, false);
      setStep('done');
    } catch (x) {
      if (x instanceof OwnerApiError && x.status === 404) setStep('closed');
      else setErr(x instanceof OwnerApiError ? x.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  if (step === 'load') return <><h2>Loading…</h2><p className="mu">Checking the setup page.</p></>;
  if (step === 'closed') {
    return (
      <>
        <h2>Setup is closed</h2><p className="mu">The owner account already exists, or setup isn’t switched on for this server.</p>
        <button className="btn p" type="button" style={{ marginTop: 14 }} onClick={() => goToLogin()}>Go to sign in</button>
      </>
    );
  }
  if (step === 'done') {
    return (
      <>
        <h2>Owner account created</h2><p className="mu">Sign in with this email and password on the normal sign-in page. The setup page is now closed.</p>
        <div className="note" style={{ marginTop: 14 }}>Next step for you: delete OWNER_SETUP_CODE in Render › Environment.</div>
        <button className="btn p" type="button" id="osDone" style={{ marginTop: 14 }} onClick={() => goToLogin()}>Go to sign in</button>
      </>
    );
  }
  return (
    <>
      <h2>Set up the owner panel</h2><p className="mu">One time only. Works while no software owner account exists.</p>
      <form id="fOwnerSetup" noValidate onSubmit={onSubmit}>
        <label>Setup code<input id="osCode" type="password" autoComplete="off" ref={code} /></label>
        <label>Your name<input id="osName" autoComplete="name" ref={name} /></label>
        <label>Email<input id="osEmail" type="email" autoComplete="email" ref={email} /></label>
        <div className="two"><label>Password<input id="osPass" type="password" autoComplete="new-password" minLength={OWNER_PASSWORD_MIN} ref={pw} /></label><label>Type it again<input id="osPass2" type="password" autoComplete="new-password" minLength={OWNER_PASSWORD_MIN} ref={pw2} /></label></div>
        <p className="mu" style={{ margin: '-4px 0 12px', fontSize: '12.5px' }}>At least {OWNER_PASSWORD_MIN} characters. Use an email that has no shop account.</p>
        <button className="btn p" id="osGo" type="submit" disabled={busy}>Create owner account</button>
        <div className="msg bad" id="osErr" role="alert">{err}</div>
      </form>
    </>
  );
}
