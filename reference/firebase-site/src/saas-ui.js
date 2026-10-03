
/* ===================== Web version: team, sign out, plan status ===================== */
(function(){
const S_=window.SAAS;if(!S_)return;
const SELLER=window.SELLER||{};
const contact=()=>[SELLER.phone&&('call '+SELLER.phone),SELLER.email&&('email '+SELLER.email)].filter(Boolean).join(' or ');
/* demo: a clear band and a way to start for real */
if(S_.demo){const b=$('subBar');if(b){b.hidden=false;b.innerHTML=`<span><b>Demo shop</b> — sample data, saved only in this browser.</span><a class="btn sm p" href="index.html" style="margin-left:auto;text-decoration:none">Create your free account</a>`}
 $('miOut').onclick=()=>{S_.clearLocal();location.href='index.html'};return}
const fmt=ms=>new Date(ms).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});
const tsMs=t=>t&&typeof t.toMillis==='function'?t.toMillis():+t||0;
S_.ready.then(c=>{if(!c)return;window.SAAS_CTX=c;
 /* account menu */
 const h=document.querySelector('#avPop .avh');if(h){const nm=c.me.name||c.email;h.querySelector('b').textContent=nm;h.querySelector('small').textContent=c.email;const st=h.querySelector('.st');if(st)st.textContent=(c.role==='owner'?'Owner':'Staff')+' · '+(c.shop.name||'')}
 document.querySelectorAll('.av').forEach(a=>{a.textContent=((c.me.name||c.email||'U').trim()[0]||'U').toUpperCase()});
 $('miOut').onclick=()=>{try{closePops()}catch(e){}slModal({title:'Sign out?',sub:c.email,body:'<p style="margin:0">Your books stay safe in the cloud. This browser’s copy is cleared, so the next person using this computer can’t see them.</p>',ok:'Sign out',onOk:async()=>{closeM('slm');try{if(window.SYNC&&SYNC.flush)await Promise.race([SYNC.flush(),new Promise(r=>setTimeout(r,6000))])}catch(e){}S_.clearLocal();await c.auth.signOut();S_.clearLocal();location.replace('index.html')}})};
 /* plan */
 const plan=()=>{const s=c.shop||{},now=Date.now(),paid=s.plan==='paid'&&tsMs(s.paidUntil)>now,trial=tsMs(s.trialEnds)>now;
  return {paid,trial,active:paid||trial,days:Math.max(0,Math.ceil(((paid?tsMs(s.paidUntil):tsMs(s.trialEnds))-now)/864e5)),until:paid?tsMs(s.paidUntil):tsMs(s.trialEnds)}};
 const showPlan=()=>{const p=plan(),sub=$('miLicSub');if(sub)sub.textContent=p.paid?`Active till ${fmt(p.until)}`:p.trial?`Free trial · ${p.days} day${p.days===1?'':'s'} left`:'Expired';
  const b=$('subBar');if(!b)return;
  if(!p.active){b.hidden=false;b.innerHTML=`<span><b>${c.shop.plan==='paid'?'Your plan has ended':'Your free trial has ended'}.</b> Your books are safe and you can still view, print and download them. To keep adding entries, renew${contact()?' — '+esc2(contact()):''}.</span>`}
  else if(p.days<=3){b.hidden=false;b.innerHTML=`<span><b>${p.paid?'Plan':'Free trial'} ends in ${p.days} day${p.days===1?'':'s'}</b> (${fmt(p.until)}).${contact()?' To continue, '+esc2(contact())+'.':''}</span>`}
  else b.hidden=true};
 showPlan();c.fs.doc('shops/'+c.shopId).onSnapshot(d=>{if(d.exists){c.shop=d.data();showPlan()}},()=>{});
 /* wording that fits the web version */
 const fix=()=>{const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);const L=[];while(w.nextNode())L.push(w.currentNode);
  L.forEach(n=>{if(n.data.includes('Only people you share the app with as Contributor or Editor can see or change the data.'))n.data=n.data.replace('Only people you share the app with as Contributor or Editor can see or change the data.','Only people in your team can see or change the data.')})};
 fix();
 /* business name follows the shop */
 document.addEventListener('click',e=>{if(e.target.closest('#bzSaveBtn')&&c.role==='owner')setTimeout(()=>{if(BZ.name&&BZ.name!==c.shop.name)c.fs.doc('shops/'+c.shopId).update({name:BZ.name}).catch(()=>{})},200)});
 /* ---------- Team (Settings › General) ---------- */
 function teamSection(){const g=$('cGen');if(!g)return;fix();if($('tmCard'))return tmRender();
  const at=$('bkpCard')||$('bzFresh');const html=`<div id="tmCard"><h3 style="margin:26px 0 4px;font-size:16px">Team</h3><p class="mu" style="margin:0 0 12px;font-size:13px">People who can open these books. Each person signs in with their own email.</p>
  ${c.role==='owner'?`<div class="synccard"><div class="sx"><b>Invite staff</b><span>They sign in at this website with the same email and join your shop.</span><div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap"><input class="fi" id="tmEmail" type="email" placeholder="staff@email.com" autocomplete="off" style="margin:0;flex:1;min-width:200px"><button class="btn p" type="button" id="tmInvite">Send invite</button></div><div class="msg bad" id="tmErr" role="alert"></div></div></div>`:''}
  <div class="synccard"><div class="sx"><b>Members</b><div id="tmList" style="margin-top:6px"></div></div></div></div>`;
  if(at)at.insertAdjacentHTML('beforebegin',html);else g.insertAdjacentHTML('beforeend',html);tmRender()}
 const row=(l,r)=>`<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-top:1px solid var(--bd,#e2e8f0);font-size:13px"><span style="flex:1;min-width:0">${l}</span>${r||''}</div>`;
 async function tmRender(){const el=$('tmList');if(!el)return;
  try{const [m,inv]=await Promise.all([c.fs.collection(`shops/${c.shopId}/members`).get(),c.role==='owner'?c.fs.collection('invites').where('shopId','==',c.shopId).get():Promise.resolve({docs:[]})]);
   el.innerHTML=m.docs.map(d=>{const x=d.data();return row(`<b>${esc2(x.name||x.email)}</b> <small class="mu">${esc2(x.email||'')}${d.id===c.uid?' · you':''}</small>`,`<span class="st ${x.role==='owner'?'g':'b'}">${x.role==='owner'?'Owner':'Staff'}</span>${c.role==='owner'&&x.role!=='owner'?`<button class="btn sm dz" type="button" data-tmrm="${esc2(d.id)}" data-tmn="${esc2(x.name||x.email)}">Remove</button>`:''}`)}).join('')
    +inv.docs.map(d=>row(`<b>${esc2(d.id)}</b> <small class="mu">invited · not joined yet</small>`,`<button class="btn sm" type="button" data-tmcx="${esc2(d.id)}">Cancel invite</button>`)).join('')}
  catch(e){el.textContent='Couldn’t load the team right now.'}}
 document.addEventListener('click',async e=>{
  if(e.target.closest('#tmInvite')){const em=($('tmEmail').value||'').trim().toLowerCase(),er=$('tmErr');er.textContent='';
   if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)){er.textContent='Enter a valid email address.';return}
   if(em===c.email.toLowerCase()){er.textContent='That’s your own email.';return}
   try{await c.fs.doc('invites/'+em).set({shopId:c.shopId,shopName:c.shop.name||BZ.name||'',role:'staff',by:c.uid,at:firebase.firestore.FieldValue.serverTimestamp()});
    $('tmEmail').value='';toast(`Invite sent to ${em}. Ask them to sign in at ${location.host} with this email.`);tmRender()}
   catch(x){er.textContent=x.code==='permission-denied'?'This email already has a pending invite from another shop.':'Couldn’t send the invite ('+(x.code||'error')+').'}return}
  const cx=e.target.closest('[data-tmcx]');if(cx){try{await c.fs.doc('invites/'+cx.dataset.tmcx).delete();toast('Invite cancelled');tmRender()}catch(x){toast('Couldn’t cancel the invite')}return}
  const rm=e.target.closest('[data-tmrm]');if(rm){const id=rm.dataset.tmrm,n=rm.dataset.tmn;
   slModal({title:`Remove ${n}?`,sub:'They lose access to these books straight away.',body:'<p style="margin:0">Their past entries stay in the books.</p>',ok:'Remove',danger:1,onOk:async()=>{closeM('slm');try{await c.fs.doc(`shops/${c.shopId}/members/${id}`).delete();toast(`${n} removed`);tmRender()}catch(x){toast('Couldn’t remove ('+(x.code||'error')+')')}}})}});
 if(typeof renderGen==='function'){const _rg=renderGen;renderGen=function(){_rg.apply(this,arguments);teamSection()}}
 teamSection();
 /* a removed member is signed out at once */
 const gone=()=>{S_.clearLocal();c.auth.signOut().finally(()=>{S_.clearLocal();location.replace('index.html?removed=1')})};
 c.fs.doc(`shops/${c.shopId}/members/${c.uid}`).onSnapshot(d=>{if(!d.exists)gone()},e=>{if(e&&e.code==='permission-denied')gone()});
});
})();
