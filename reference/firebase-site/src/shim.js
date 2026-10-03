
/* ===================== Web version: Firebase login + shop data (runs before the app) ===================== */
(function(){
const Q=new URLSearchParams(location.search),DEMO=Q.has('demo');
const clearLocal=()=>{const ks=[];for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k&&k.startsWith('erp'))ks.push(k)}ks.forEach(k=>localStorage.removeItem(k));try{sessionStorage.clear()}catch(e){}};
window.SAAS={demo:DEMO,clearLocal,ctx:null};
if(DEMO){/* demo: sample shop, nothing leaves this browser */
 if(localStorage.getItem('erp--shop')!=='demo'){clearLocal();localStorage.setItem('erp--shop','demo')}
 window.claude={use:async()=>null};return}
const cur=localStorage.getItem('erp--shop');
if(!cur||cur==='demo'){location.replace('index.html');return}
/* keep the page hidden until we know who is signed in */
document.documentElement.style.visibility='hidden';
firebase.initializeApp(window.FIREBASE_CONFIG);
const auth=firebase.auth(),fs=firebase.firestore();
const ready=new Promise(res=>{const off=auth.onAuthStateChanged(async u=>{off();
 if(!u){location.replace('index.html');return}
 try{const ud=await fs.doc('users/'+u.uid).get();const shopId=ud.exists?ud.data().shopId:null;
  if(!shopId||shopId!==cur){location.replace('index.html');return}
  const [md,sd]=await Promise.all([fs.doc(`shops/${shopId}/members/${u.uid}`).get(),fs.doc('shops/'+shopId).get()]);
  if(!md.exists){location.replace('index.html?removed=1');return}
  const ctx={uid:u.uid,email:u.email||'',shopId,role:md.data().role,me:md.data(),shop:sd.exists?sd.data():{},fs,auth};
  window.SAAS.ctx=ctx;document.documentElement.style.visibility='';res(ctx)}
 catch(e){console.error(e);document.documentElement.style.visibility='';res(null)}})});
window.SAAS.ready=ready;
/* the app's storage paths, placed inside this shop */
const mapPath=(p,c)=>p==='biz/main'?`shops/${c.shopId}/meta/main`:p.replace(/^data\/users\/([^/]+)\/erp/,`shops/${c.shopId}/priv/$1`).replace(/^biz\/main\//,`shops/${c.shopId}/`);
const ERR={'permission-denied':'invalid_argument','resource-exhausted':'resource_exhausted','unavailable':'unavailable','unauthenticated':'revoked','invalid-argument':'invalid_argument'};
const wrapErr=e=>{const x=new Error(e&&e.message||'error');x.code=ERR[e&&e.code]||e&&e.code||'error';return x};
const W=fn=>async(...a)=>{try{return await fn(...a)}catch(e){throw wrapErr(e)}};
function wDoc(r){return {id:r.id,path:r.path,get:W(()=>r.get()),set:W(d=>r.set(d)),update:W(d=>r.update(d)),delete:W(()=>r.delete()),
 onSnapshot:(n,er)=>r.onSnapshot({includeMetadataChanges:false},n,e=>er&&er(wrapErr(e))),collection:c=>wCol(r.collection(c))}}
function wQ(q){return {where:(...a)=>wQ(q.where(...a)),orderBy:(...a)=>wQ(q.orderBy(...a)),limit:n=>wQ(q.limit(n)),get:W(()=>q.get()),onSnapshot:(n,er)=>q.onSnapshot(n,e=>er&&er(wrapErr(e)))}}
function wCol(c){return {...wQ(c),path:c.path,doc:id=>wDoc(id?c.doc(id):c.doc()),add:W(async d=>wDoc(await c.add(d)))}}
const dbFor=c=>({doc:p=>wDoc(fs.doc(mapPath(p,c))),collection:p=>wCol(fs.collection(mapPath(p,c)))});
const userFor=c=>({id:async()=>c.uid,isOwner:async()=>c.role==='owner',canEdit:async()=>c.role==='owner',can:async()=>true,
 me:async()=>({id:c.uid,name:c.me.name||'',email:c.email}),
 profiles:async ids=>{const o={};try{const s=await fs.collection(`shops/${c.shopId}/members`).get();s.docs.forEach(d=>{if(ids.includes(d.id))o[d.id]={id:d.id,name:d.data().name||d.data().email||''}})}catch(e){}return o}});
window.claude={use:async n=>{const c=await ready;if(!c)return null;if(n==='db')return dbFor(c);if(n==='user')return userFor(c);return null}};
})();
