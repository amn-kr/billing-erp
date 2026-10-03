
/* In-browser stand-in for the Firebase compat SDK (app/auth/firestore subset). Data lives in the test runner via window.__fb(op,...). */
(function(){
if(window.firebase)return;
const call=(op,a)=>window.__fb(op,JSON.stringify(a||{})).then(r=>{const o=JSON.parse(r);if(o.err){const e=new Error(o.err);e.code=o.err;throw e}return o.v});
const TS=ms=>({__ts:ms,toMillis(){return ms},seconds:Math.floor(ms/1000)});
const rehy=v=>{if(v&&typeof v==='object'){if('__ts' in v)return TS(v.__ts);if(Array.isArray(v))return v.map(rehy);const o={};for(const k in v)o[k]=rehy(v[k]);return o}return v};
const dehy=v=>{if(v&&typeof v==='object'){if(v.__sv)return {__sv:1};if(typeof v.toMillis==='function')return {__ts:v.toMillis()};if(Array.isArray(v))return v.map(dehy);const o={};for(const k in v)o[k]=dehy(v[k]);return o}return v};
let user=null;const listeners=[];
try{const u=JSON.parse(localStorage.getItem('__mockUser')||'null');if(u)user=u}catch(e){}
const mkUser=u=>u&&({...u,updateProfile:async p=>{await call('updProfile',{uid:u.uid,...p});user.displayName=p.displayName;save()}});
const save=()=>{if(user)localStorage.setItem('__mockUser',JSON.stringify({uid:user.uid,email:user.email,displayName:user.displayName||''}));else localStorage.removeItem('__mockUser')};
const fire=()=>listeners.slice().forEach(f=>f(mkUser(user)));
const auth={get currentUser(){return mkUser(user)},
 onAuthStateChanged(cb){listeners.push(cb);setTimeout(()=>cb(mkUser(user)),30);return()=>{const i=listeners.indexOf(cb);if(i>=0)listeners.splice(i,1)}},
 async createUserWithEmailAndPassword(email,pw){const u=await call('signup',{email,pw});user=u;save();fire();return {user:mkUser(user)}},
 async signInWithEmailAndPassword(email,pw){const u=await call('signin',{email,pw});user=u;save();fire();return {user:mkUser(user)}},
 async signInWithPopup(){const em=window.__googleEmail;if(!em){const e=new Error('closed');e.code='auth/popup-closed-by-user';throw e}const u=await call('google',{email:em});user=u;save();fire();return {user:mkUser(user)}},
 async signOut(){user=null;save();fire()},async sendPasswordResetEmail(){return true}};
const tok=()=>user?{uid:user.uid,email:(user.email||'').toLowerCase()}:null;
const snapDoc=(path,r)=>({id:path.split('/').pop(),ref:null,exists:!!r,data:()=>r?rehy(JSON.parse(JSON.stringify(r))):undefined,metadata:{hasPendingWrites:false,fromCache:false}});
function docRef(path){return {id:path.split('/').pop(),path,
 get:async()=>snapDoc(path,await call('get',{path,auth:tok()})),
 set:async d=>{await call('set',{path,data:dehy(d),auth:tok()})},update:async d=>{await call('update',{path,data:dehy(d),auth:tok()})},delete:async()=>{await call('delete',{path,auth:tok()})},
 collection:c=>colRef(path+'/'+c),
 onSnapshot(a,b,c){const next=typeof a==='function'?a:b,err=typeof a==='function'?b:c;let on=true,last=null;const t=async()=>{if(!on)return;try{const r=await call('get',{path,auth:tok()});const k=JSON.stringify(r);if(k!==last){last=k;next(snapDoc(path,r))}}catch(e){on=false;err&&err(e);return}setTimeout(t,350)};t();return()=>{on=false}}}}
function query(path,f){const q={path,
 where:(fld,op,v)=>query(path,{...f,w:[...(f.w||[]),[fld,op,v]]}),orderBy:()=>q,limit:n=>query(path,{...f,n}),
 get:async()=>{const a=await call('list',{path,f,auth:tok()});const docs=a.map(([id,r])=>snapDoc(path+'/'+id,r));return {docs,size:docs.length,empty:!docs.length,docChanges:()=>[],metadata:{hasPendingWrites:false,fromCache:false}}},
 onSnapshot(next,err){let on=true,last=null;const t=async()=>{if(!on)return;try{const s=await q.get();const k=JSON.stringify(s.docs.map(d=>[d.id,d.data()]));if(k!==last){last=k;next(s)}}catch(e){on=false;err&&err(e);return}setTimeout(t,350)};t();return()=>{on=false}}};return q}
function colRef(path){const q=query(path,{});return {...q,path,doc:id=>docRef(path+'/'+(id||Math.random().toString(36).slice(2,12))),add:async d=>{const r=docRef(path+'/'+Math.random().toString(36).slice(2,12));await r.set(d);return r}}}
const fsInst={doc:p=>docRef(p),collection:p=>colRef(p)};
const firestore=()=>fsInst;firestore.FieldValue={serverTimestamp:()=>({__sv:1})};firestore.Timestamp={fromMillis:ms=>TS(ms),now:()=>TS(Date.now())};
const authFn=()=>auth;authFn.GoogleAuthProvider=function(){};
window.firebase={initializeApp:()=>({}),auth:authFn,firestore};
})();
