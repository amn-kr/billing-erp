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
 await B.evaluate(()=>{openInvoice({party:customers()[0].id});SI.lines=[lineFor(IT[0]),blankLine()];SI.chgOk=true;saveSI(false)});await B.waitForTimeout(4000);
 console.log('before: B invs',await B.evaluate(()=>INVS.length),'A invs',await A.evaluate(()=>JSON.parse(localStorage.getItem('erp-invoices')||'[]').length));
 // B tries to start fresh -> refused
 await B.evaluate(()=>{go('dash');bzOpen()});console.log('staff blocked',await B.evaluate(()=>$('bzm').hidden));
 await A.evaluate(()=>{document.querySelectorAll('.ov').forEach(o=>{if(!o.hidden)closeM(o.id)});go('dash');bzOpen()});await A.waitForTimeout(200);
 await A.fill('#bzfName','Gupta Electricals & Hardware');await A.fill('#bzfOwner','Rakesh Gupta');await A.fill('#bzfInv','415');await A.check('#bzfOk');
 await Promise.all([A.waitForNavigation({timeout:20000}).catch(()=>{}),A.click('#bzmGo')]);await A.waitForTimeout(6000);
 const st=pg=>pg.evaluate(()=>({fresh:FRESH,name:BZ.name,parties:allParties().length,items:IT.length,invs:INVS.length,sales:allSales().length,next:nextInvNo(),org:$('orgName').textContent,sync:SYNC.st}));
 console.log('A',JSON.stringify(await st(A)));
 await B.waitForTimeout(8000);console.log('B',JSON.stringify(await st(B)));
 // B adds a sale in fresh books; A should see it
 const r=await B.evaluate(()=>{PARTIES.push({id:newPid(),name:'Verma Traders',obType:'receive',group:'General'});localStorage.setItem('erp-parties',JSON.stringify(PARTIES));return 1});await B.waitForTimeout(5000);
 console.log('A sees new party',await A.evaluate(()=>JSON.parse(localStorage.getItem('erp-parties')||'[]').map(p=>p.name).join()));
 await b.close()})();
