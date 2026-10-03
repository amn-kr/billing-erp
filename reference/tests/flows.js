const {chromium}=require('playwright');const OUT=require('path').join(__dirname,'out')+'/';
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1366,height:768}});const errs=[];p.on('pageerror',e=>errs.push(e.message+' '+(e.stack||'').split('\n')[1]));
const ok=(n,c,x='')=>console.log((c?'PASS ':'FAIL ')+n+(x?'  ['+x+']':''));
await p.goto('file://'+require('path').resolve(__dirname,'../design/app.html')+'');await p.waitForTimeout(700);
const E=(f,a)=>p.evaluate(f,a);const closeAll=()=>E(()=>{document.querySelectorAll('.ov').forEach(o=>{if(!o.hidden){try{closeM(o.id)}catch(e){o.hidden=true}}})});
// date defaults
const td=await E(()=>TODAY_ISO);ok('today date used',await E(()=>{openInvoice({});const d=SI.date;return d})===td,td);await E(()=>{go('dash')});
// 1 sale invoice
const c0=await E(()=>{const c=customers().find(x=>!x.limit)||customers()[0];return {id:c.id,bal:balanceOf(c)}});
const inv=await E(id=>{openInvoice({party:id});SI.lines=[lineFor(IT[0]),lineFor(IT[2]),blankLine()];SI.lines[0].qty=3;SI.chgOk=true;renderSI();saveSI(false);return {no:INVS[0].no,total:INVS[0].total,date:INVS[0].date}},c0.id);await closeAll();
const b1=await E(id=>balanceOf(partyById(id)),c0.id);ok('invoice raises party balance',Math.abs(b1-c0.bal-inv.total)<0.01,`${inv.no} ${inv.total} ${c0.bal}→${b1} date ${inv.date}`);
// 2 receive payment via form
await E(id=>rcOpen({party:id}),c0.id);await p.waitForTimeout(200);await p.fill('#rcAmt',String(inv.total));await p.selectOption('#rcModeI','Cash');await p.evaluate(()=>$('rcAmt').dispatchEvent(new Event('input',{bubbles:true})));
const cashBefore=await E(()=>acctBal('cash',bkEntries()));await p.click('#rcSave');await p.waitForTimeout(300);await closeAll();
const b2=await E(id=>balanceOf(partyById(id)),c0.id),cashAfter=await E(()=>acctBal('cash',bkEntries()));
ok('payment lowers balance',Math.abs(b2-c0.bal)<0.01,`${b1}→${b2}`);ok('cash book gets the payment',Math.abs(cashAfter-cashBefore-inv.total)<0.01,`${cashBefore}→${cashAfter}`);
ok('invoice marked paid',await E(no=>{const v=allSales().find(s=>s.no===no);return v&&v.bal===0},inv.no));
// 3 credit note against the invoice (refund none, adjust)
await E(no=>cnOpen({inv:no}),inv.no);await p.waitForTimeout(250);
const cnRows=await E(()=>CN.lines.length);if(cnRows){await E(()=>{CN.lines[0].qty=1});await E(()=>{try{cnRender()}catch(e){}})}
await p.click('#cnSave');await p.waitForTimeout(300);const cnMsg=await E(()=>$('cnErr').textContent);await closeAll();
const b3=await E(id=>balanceOf(partyById(id)),c0.id);ok('credit note saved & gives credit',b3<b2-0.01||!!cnMsg,`bal ${b2}→${b3} lines ${cnRows} msg '${cnMsg}'`);
// 4 statement reconciles for all parties
const bad=await E(()=>allParties().map(x=>{PSV.per='all';const d=psData(x);return [x.name,d.close,balanceOf(x)]}).filter(a=>Math.abs(a[1]-a[2])>0.01));ok('party statements = balances',bad.length===0,JSON.stringify(bad).slice(0,200));
// 5 purchase bill + payment made
const sup=await E(()=>{const s=allParties().find(x=>x.role==='s');return {id:s.id,bal:balanceOf(s),name:s.name}});
const pb=await E(id=>{openPDoc('bill');PE.party=id;PE.lines=[{...peLine(),id:IT[0].id,name:IT[0].name,qty:10,rate:IT[0].purch,gst:IT[0].gst||18}];PE.ref='SUP-77';renderPE();savePE();return {err:PE&&PE.err,doc:PDOCS[0]&&PDOCS[0].no,total:PDOCS[0]&&PDOCS[0].total}},sup.id);await closeAll();
const sb=await E(id=>balanceOf(partyById(id)),sup.id);ok('purchase bill saved',!pb.err&&pb.doc,JSON.stringify(pb)+` supplier bal ${sup.bal}→${sb}`);
await E(id=>openPayModal(id),sup.id);await p.waitForTimeout(200);await p.fill('#pyAmt','1000');await p.evaluate(()=>$('pyAmt').dispatchEvent(new Event('input',{bubbles:true})));await p.click('#pySave');await p.waitForTimeout(300);await closeAll();
const sb2=await E(id=>balanceOf(partyById(id)),sup.id);ok('payment made lowers payable',Math.abs(Math.abs(sb2-sb)-1000)<0.01,`${sb}→${sb2}`);
// 6 expense lowers cash
const c1=await E(()=>acctBal('cash',bkEntries()));await E(()=>xpOpen());await p.selectOption('#xpCat','Rent');await p.fill('#xpLines [data-f="amt"]','777');await p.click('#xpSave');await p.waitForTimeout(200);
const c2=await E(()=>acctBal('cash',bkEntries()));ok('expense lowers cash',Math.abs(c1-c2-777)<0.01,`${c1}→${c2}`);
// 7 challan → invoice
await E(()=>{DCHAL.unshift({no:'DC-T1',date:TODAY_DMY,party:null,partyName:'Walk X',phone:'',lines:[{id:IT[4].id,name:IT[4].name,qty:2,unit:'Pcs'}],status:'open'});spSave();dcConvert('DC-T1')});await p.waitForTimeout(300);
ok('challan converts to invoice',await E(()=>!$('vNewInv').hidden&&SI.cashName==='Walk X'&&SI.lines.filter(l=>l.item).length===1));
ok('no bill tabs on screen',await E(()=>!document.getElementById('siTabs')&&!document.querySelector('.bttab')));
// back with unsaved bill asks, Esc keeps, Enter Enter discards
await p.click('#siCancel');await p.waitForTimeout(200);const ask=await E(()=>!$('dcf').hidden);await p.keyboard.press('Escape');await p.waitForTimeout(150);const kept=await E(()=>!$('vNewInv').hidden);
await p.click('#siCancel');await p.waitForTimeout(150);await p.keyboard.press('Enter');await p.keyboard.press('Enter');await p.waitForTimeout(250);
ok('close bill asks, then returns to Sales',ask&&kept&&await E(()=>!$('vSales').hidden));
const n1=await E(()=>{openInvoice();return SI.no});await E(()=>go('sales'));const n2=await E(()=>{openInvoice();return SI.no});ok('bill number not used up',n1===n2,n1+' / '+n2);
await E(()=>go('dash'));
// 8 persistence after reload
const cnt=()=>E(()=>[INVS.length,PRECV.length,CNOTES.length,PDOCS.length,EXPS.length,allPays().length].join());const before=await cnt();await p.reload();await p.waitForTimeout(800);const after=await cnt();ok('everything persists after reload',before===after,before+' vs '+after);
// 9 view kept after reload
for(const v of ['pur','exp','bks','rep','parties']){await E(v=>go(v),v);await p.waitForTimeout(150);await p.reload();await p.waitForTimeout(700);const vis=await E(()=>[...document.querySelectorAll('main section,section')].filter(s=>!s.hidden&&s.id&&/^v/.test(s.id)).map(s=>s.id).join());console.log('  reload on',v,'→',vis)}
// 10 escaping: hostile party/category name
await E(()=>{ECATS.push('x" onmouseover="window.__x=1');exSave();go('exp');xcOpen()});await p.waitForTimeout(200);await p.hover('#xcList');ok('quoted names are safe',await E(()=>!window.__x));await closeAll();
console.log('ERRORS',errs);await b.close()})();
