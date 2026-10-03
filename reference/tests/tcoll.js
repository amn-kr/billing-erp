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
 const A=await mk('U1',true);await A.goto(url);await A.waitForTimeout(3500);
 const B=await mk('U2',false);await B.goto(url);await B.waitForTimeout(5000);
 console.log('A',await A.evaluate(()=>SYNC.st),'B',await B.evaluate(()=>SYNC.st));
 const mkInv=(pg,n)=>pg.evaluate(n=>{openInvoice({party:customers()[n].id});SI.lines=[lineFor(IT[n+1]),blankLine()];SI.chgOk=true;saveSI(false);return INVS[0].no+' '+INVS[0].total},n);
 const [a,bb]=await Promise.all([mkInv(A,0),mkInv(B,2)]);console.log('A saved',a,'| B saved',bb);
 await A.waitForTimeout(9000);await B.waitForTimeout(3000);
 const nos=pg=>pg.evaluate(()=>JSON.parse(localStorage.getItem('erp-invoices')||'[]').slice(0,4).map(v=>v.no+':'+v.total).join(' , '));
 console.log('A ls',await nos(A));console.log('B ls',await nos(B));
 const cloud=()=>{const d=[...STORE].filter(([k])=>k.startsWith('biz/main/kv/erp-invoices~'));const top=Math.max(...d.map(x=>x[1].t));return JSON.parse(d.filter(x=>x[1].t===top).sort((x,y)=>x[1].i-y[1].i).map(x=>x[1].v).join('')).slice(0,4).map(v=>v.no+':'+v.total).join(' , ')};
 console.log('cloud',cloud());
 console.log('A mem',await A.evaluate(()=>INVS.slice(0,3).map(v=>v.no).join()),'B mem',await B.evaluate(()=>INVS.slice(0,3).map(v=>v.no).join()));
 console.log('party tx A',await A.evaluate(()=>[customers()[0].name,customers()[0].tx.filter(t=>/INV-0413/.test(t.no)).map(t=>t.no).join()]),'party tx B side',await A.evaluate(()=>[customers()[2].name,customers()[2].tx.filter(t=>/INV-0413/.test(t.no)).map(t=>t.no).join()]));
 await b.close()})();
