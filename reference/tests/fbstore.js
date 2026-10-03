
/* Test-side Firestore + Auth with the same access rules as firestore.rules */
const DB=new Map(),USERS=new Map();let NOW=()=>Date.now();const LOG=[];
const ts=v=>v&&typeof v==='object'&&'__ts' in v?v.__ts:v;
const res=v=>{if(v&&typeof v==='object'){if(v.__sv)return {__ts:NOW()};if(Array.isArray(v))return v.map(res);const o={};for(const k in v)o[k]=res(v[k]);return o}return v};
const get=p=>DB.get(p)||null,exists=p=>DB.has(p);
const shop=id=>get('shops/'+id)||{};
const isMember=(id,a)=>!!a&&exists(`shops/${id}/members/${a.uid}`);
const isOwner=(id,a)=>!!a&&shop(id).owner===a.uid;
const isActive=id=>{const s=shop(id);return (s.plan==='paid'&&ts(s.paidUntil)>NOW())||ts(s.trialEnds)>NOW()};
function allow(op,path,data,a){const P=path.split('/');const old=get(path);const write=op!=='read';
 if(P[0]==='users'&&P.length===2){const uid=P[1];if(!a||a.uid!==uid)return false;if(op==='read'||op==='delete')return true;return !!data&&exists(`shops/${data.shopId}/members/${uid}`)}
 if(P[0]==='invites'&&P.length===2){const em=P[1];if(!a)return false;
  if(op==='read')return a.email===em||(old&&isOwner(old.shopId,a));if(op==='delete')return a.email===em||(old&&isOwner(old.shopId,a));
  if(old&&!isOwner(old.shopId,a))return false;return !!data&&isOwner(data.shopId,a)&&data.role==='staff'}
 if(P[0]==='shops'){const id=P[1];
  if(P.length===2){if(op==='read')return isMember(id,a);
   if(op==='set'&&!old)return !!a&&data.owner===a.uid&&data.plan==='trial'&&ts(data.trialEnds)<=NOW()+15*864e5&&!('paidUntil' in data);
   if(op==='set'||op==='update'){if(!isOwner(id,a))return false;const keys=new Set([...Object.keys(data),...Object.keys(old||{})]);for(const k of keys){if(k==='name')continue;if(JSON.stringify(data[k])!==JSON.stringify((old||{})[k]))return false}return true}
   return false}
  if(P[2]==='members'&&P.length===4){const uid=P[3];if(op==='read')return isMember(id,a);if(!a)return false;
   if(op==='set'&&!old){if(a.uid!==uid)return false;if(isOwner(id,a)&&data.role==='owner')return true;const iv=get('invites/'+a.email);return data.role==='staff'&&!!iv&&iv.shopId===id}
   if(op==='set'||op==='update')return a.uid===uid&&data.role===old.role;
   if(op==='delete')return isOwner(id,a)&&uid!==a.uid;return false}
  if(P[2]==='members')return false;
  if(op==='read')return isMember(id,a);return isMember(id,a)&&isActive(id)}
 return false}
const deny=()=>({err:'permission-denied'});
function handle(op,a){a=JSON.parse(a);
 if(op==='signup'){const em=a.email.toLowerCase();if(USERS.has(em))return {err:'auth/email-already-in-use'};if((a.pw||'').length<6)return {err:'auth/weak-password'};const u={uid:'u_'+Math.random().toString(36).slice(2,9),email:em,displayName:''};USERS.set(em,{...u,pw:a.pw});return {v:u}}
 if(op==='signin'){const r=USERS.get(a.email.toLowerCase());if(!r||r.pw!==a.pw)return {err:'auth/invalid-credential'};return {v:{uid:r.uid,email:r.email,displayName:r.displayName}}}
 if(op==='google'){const em=a.email.toLowerCase();let r=USERS.get(em);if(!r){r={uid:'g_'+Math.random().toString(36).slice(2,9),email:em,displayName:em.split('@')[0],pw:null};USERS.set(em,r)}return {v:{uid:r.uid,email:r.email,displayName:r.displayName}}}
 if(op==='updProfile'){for(const r of USERS.values())if(r.uid===a.uid)r.displayName=a.displayName;return {v:1}}
 if(op==='get'){if(!allow('read',a.path,null,a.auth)){LOG.push(['DENY read',a.path]);return deny()}return {v:get(a.path)}}
 if(op==='list'){const pre=a.path+'/';let rows=[...DB].filter(([k])=>k.startsWith(pre)&&!k.slice(pre.length).includes('/'));
  (a.f.w||[]).forEach(([f,o,v])=>{rows=rows.filter(([,d])=>o==='=='?d[f]===v:true)});
  if(rows.some(([k])=>!allow('read',k,null,a.auth))||(!rows.length&&!allow('read',pre+'__probe',null,a.auth)&&!a.path.startsWith('invites'))){LOG.push(['DENY list',a.path]);return deny()}
  if(a.f.n)rows=rows.slice(0,a.f.n);return {v:rows.map(([k,d])=>[k.slice(pre.length),d])}}
 if(op==='set'||op==='update'){const d=res(a.data);const full=op==='update'?{...(get(a.path)||{}),...d}:d;if(op==='update'&&!get(a.path))return {err:'not-found'};
  if(!allow(op==='update'?'update':'set',a.path,full,a.auth)){LOG.push(['DENY '+op,a.path]);return deny()}DB.set(a.path,full);return {v:1}}
 if(op==='delete'){if(!allow('delete',a.path,null,a.auth)){LOG.push(['DENY delete',a.path]);return deny()}DB.delete(a.path);return {v:1}}
 return {err:'unknown-op'}}
module.exports={handle,DB,USERS,LOG,setNow:f=>{NOW=f}};
