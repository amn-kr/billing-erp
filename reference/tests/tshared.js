const {chromium}=require('playwright');
const STORE=new Map();
const mock=(uid,own)=>`(()=>{const call=(op,p,d)=>window.__db(op,p,d);
const snap=(id,x)=>({id,exists:!!x,data:()=>x?JSON.parse(JSON.stringify(x)):undefined,metadata:{fromCache:false,hasPendingWrites:false}});
const docRef=p=>({id:p.split('/').pop(),path:p,get:async()=>snap(p.split('/').pop(),await call('get',p)),set:async d=>{await call('set',p,d)},delete:async()=>{await call('del',p)},collection:c=>colRef(p+'/'+c)});
const colRef=p=>{const q={path:p,doc:id=>docRef(p+'/'+id),limit:()=>q,get:async()=>{const a=await call('list',p);const docs=a.map(([id,x])=>snap(id,x));return {docs,size:docs.length,empty:!docs.length,docChanges:()=>[],metadata:{fromCache:false,hasPendingWrites:false}}},
 onSnapshot:(next)=>{let on=true,last='';const t=async()=>{if(!on)return;const s=await q.get();const k=JSON.stringify(s.docs.map(d=>[d.id,d.data()]));if(k!==last){last=k;next(s)}setTimeout(t,400)};t();return()=>{on=false}}};return q};
const db={doc:docRef,collection:colRef};
window.claude={use:async n=>n==='db'?db:n==='user'?{id:async()=>'${uid}',isOwner:async()=>${own},profiles:async ids=>Object.fromEntries(ids.map(i=>[i,{name:{U1:'Aman',U2:'Ravi'}[i]||''}]))}:null};})()`;
(async()=>{const b=await chromium.launch();
 const mk=async(uid,own)=>{const c=await b.newContext({viewport:{width:1400,height:900}});
  await c.exposeFunction('__db',(op,p,d)=>{if(op==='get')return STORE.get(p)||null;if(op==='set'){STORE.set(p,d);return null}if(op==='del'){STORE.delete(p);return null}
   if(op==='list')return [...STORE].filter(([k])=>k.startsWith(p+'/')&&!k.slice(p.length+1).includes('/')).map(([k,v])=>[k.slice(p.length+1),v])});
  await c.addInitScript(mock(uid,own));const pg=await c.newPage();pg.on('pageerror',e=>console.log('ERR',uid,e.message));return pg};
 const url='file://'+require('path').resolve(__dirname,'../design/app.html')+'';
 // staff opens before owner: must not seed
 const C=await mk('U3',false);await C.goto(url);await C.waitForTimeout(2500);
 console.log('staff-first st',await C.evaluate(()=>SYNC.st),'shared docs',[...STORE.keys()].filter(k=>k.startsWith('biz/')).length);
 // owner had private cloud data from v156 containing a marker item
 STORE.set('data/users/U1/erp/kv/erp-items~0',{k:'erp-items',t:5,i:0,n:1,v:JSON.stringify([{id:'old1',name:'From private',cat:'Fans',purch:1,sale:2,gst:18,unit:'Pcs',isNew:true,tx:[]}])});
 const A=await mk('U1',true);await A.goto(url);await A.waitForTimeout(5000);
 console.log('owner st',await A.evaluate(()=>SYNC.st),'owner has old1',await A.evaluate(()=>IT.some(i=>i.id==='old1')),'shared docs',[...STORE.keys()].filter(k=>k.startsWith('biz/')).length);
 await C.waitForTimeout(4000);
 console.log('staff C now st',await C.evaluate(()=>SYNC.st),'has old1',await C.evaluate(()=>IT.some(i=>i.id==='old1')));
 const B=await mk('U2',false);await B.goto(url);await B.waitForTimeout(4500);
 console.log('staff B has old1',await B.evaluate(()=>IT.some(i=>i.id==='old1')));
 await B.evaluate(()=>{IT.push({id:'rv1',name:'Ravi item',cat:'Fans',purch:1,sale:2,gst:18,unit:'Pcs',isNew:true,tx:[]});saveNewItems()});
 await A.waitForTimeout(6000);
 await A.waitForTimeout(12000);console.log('A dbg',await A.evaluate(()=>[IT.some(i=>i.id==='rv1'),SYNC.st,SYNC.needReload,SYNC.firstLoad,[...SYNC.dirty].join(),(localStorage.getItem('erp-items')||'').includes('rv1'),sessionStorage.getItem('erp--rl')]));console.log('owner sees Ravi item',await A.evaluate(()=>IT.some(i=>i.id==='rv1')),'C sees',await C.evaluate(()=>IT.some(i=>i.id==='rv1')));
 await A.evaluate(()=>go('set'));await A.waitForTimeout(800);
 console.log('who',await A.evaluate(()=>document.getElementById('syncWho').innerText.replace(/\n/g,' | ')));
 await A.screenshot({path:'set.png'});
 await b.close()})();
