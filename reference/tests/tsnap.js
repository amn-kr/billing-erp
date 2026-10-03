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
 const A=await mk('U1',true);await A.goto(url);await A.waitForTimeout(3000);
 // give the books something before the first daily copy
 await A.evaluate(()=>{EXPS.unshift({no:'EXP-0077',date:TODAY_DMY,cat:'Rent',payee:'Base',lines:[{name:'Rent',qty:1,rate:100,gst:0,amt:100}],mode:'Cash',acct:'cash',ref:'',note:''});exSave()});
 await A.waitForTimeout(14000);
 const snaps=()=>[...new Set([...STORE.keys()].filter(k=>k.startsWith('biz/main/snaps/')).map(k=>STORE.get(k).id))];
 console.log('daily copy saved',snaps().length===1,snaps());
 const B=await mk('U2',false);await B.goto(url);await B.waitForTimeout(5000);
 // A adds an invoice after the copy
 await A.evaluate(()=>{openInvoice({party:customers()[0].id});SI.lines=[lineFor(IT[0]),blankLine()];SI.chgOk=true;saveSI(false);document.querySelectorAll('.ov').forEach(o=>{if(!o.hidden)closeM(o.id)})});await A.waitForTimeout(5000);
 console.log('B has invoice',await B.evaluate(()=>INVS.length));
 await B.evaluate(()=>{go('set');setTab('gen')});await B.waitForTimeout(1500);console.log('B sees copies, no restore button',await B.evaluate(()=>[$('bkpCloudList').children.length,document.querySelectorAll('[data-snap]').length]));
 await A.evaluate(()=>{go('set');setTab('gen')});await A.waitForTimeout(1500);console.log('A restore buttons',await A.evaluate(()=>document.querySelectorAll('[data-snap]').length));
 await A.click('[data-snap]');await A.waitForTimeout(600);await A.uncheck('#rsmSafe');await A.check('#rsmOk');
 await Promise.all([A.waitForNavigation({timeout:20000}).catch(()=>{}),A.click('#rsmGo')]);await A.waitForTimeout(5000);
 console.log('A after restore: invoices',await A.evaluate(()=>INVS.length),'exp kept',await A.evaluate(()=>EXPS.some(x=>x.no==='EXP-0077')));
 await B.waitForTimeout(9000);console.log('B after restore: invoices',await B.evaluate(()=>INVS.length),'exp',await B.evaluate(()=>EXPS.some(x=>x.no==='EXP-0077')),'snaps now',snaps().length);
 await b.close()})();
