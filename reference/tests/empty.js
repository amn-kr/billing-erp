const {chromium}=require('playwright');const OUT=require('path').join(__dirname,'out')+'/';
const W=+process.argv[2]||1366;
(async()=>{const b=await chromium.launch();const c=await b.newContext({viewport:{width:W,height:768}});
await c.addInitScript(()=>{if(!localStorage.getItem('erp-biz'))localStorage.setItem('erp-biz',JSON.stringify({fresh:true,epoch:1,name:'Test Shop',owner:'Test Owner',city:'Kanpur',invNext:1}))});
const p=await c.newPage();const errs=[];let ctx='load';
p.on('pageerror',e=>errs.push(ctx+' :: '+e.message+' @ '+(e.stack||'').split('\n').slice(1,3).join(' < ').replace(/file:\/\/\/home\/claude\/billing-dashboard.html:/g,'L')));
await p.goto('file://'+require('path').resolve(__dirname,'../design/app.html')+'');await p.waitForTimeout(900);
const E=(f,a)=>p.evaluate(f,a);const closeAll=()=>E(()=>{document.querySelectorAll('.ov').forEach(o=>{if(!o.hidden){try{closeM(o.id)}catch(e){o.hidden=true}}});try{closePops()}catch(e){}});
console.log('counts',await E(()=>[allParties().length,IT.length,allSales().length,ACCTS.length].join()));
const views=await E(()=>[...new Set([...document.querySelectorAll('[data-view]')].map(a=>a.dataset.view))]);
for(const v of views){ctx='view '+v;try{await closeAll();await E(v=>go(v),v);await p.waitForTimeout(150);await p.screenshot({path:OUT+`e_${v}.png`});
 const n=await E(()=>[...document.querySelectorAll('section:not([hidden])>.pthd button')].filter(b=>b.offsetParent).length);
 for(let i=0;i<n;i++){await E(i=>{const s=[...document.querySelectorAll('section:not([hidden])>.pthd button')].filter(b=>b.offsetParent);window.__l=s[i]?s[i].textContent.trim().slice(0,24):'';s[i]&&s[i].click()},i);ctx=`view ${v} btn ${await E(()=>window.__l)}`;await p.waitForTimeout(150);await closeAll();await E(v=>{try{go(v)}catch(e){}},v)}
}catch(e){errs.push(ctx+' :: THROW '+e.message.split('\n')[0])}}
ctx='reports';await closeAll();await E(()=>go('rep'));const reps=await E(()=>REPS.flatMap(g=>g[2].map(r=>r[0])));
for(const r of reps){ctx='report '+r;try{await E(r=>{RPV.sel=r;renderRep()},r)}catch(e){errs.push(ctx+' :: THROW '+e.message.split('\n')[0])}}
for(const [k,f] of [['new invoice','openInvoice()'],['quick sale','openQuickSale()'],['receive pay','rcOpen()'],['pay made','openPayModal()'],['credit note','cnOpen()'],['challan','dcOpen()'],['purchase bill',"openPDoc('bill')"],['po',"openPDoc('po')"],['debit note',"openPDoc('dn')"],['expense','xpOpen()'],['move money',"bmmOpen('out')"],['add item','openItem()'],['add party','openParty()'],['statement','openPartyStatement()']]){ctx='open '+k;try{await closeAll();await E(f=>{eval(f)},f);await p.waitForTimeout(150)}catch(e){errs.push(ctx+' :: THROW '+e.message.split('\n')[0])}}
const u=[...new Set(errs)];console.log('ERRORS',u.length);u.forEach(e=>console.log(' -',e));await b.close()})();
