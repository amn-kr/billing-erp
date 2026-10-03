const {chromium}=require('playwright');const fs=require('fs');const {spawn}=require('child_process');
const Q=require('path').join(__dirname,'out')+'/';const ST=require(Q+'fbstore.js');
const MOCK=fs.readFileSync(Q+'fbmock-browser.js','utf8');
const CFG=`window.FIREBASE_CONFIG={apiKey:"test",authDomain:"t",projectId:"t",appId:"t"};window.APP_NAME="Billing ERP";window.TRIAL_DAYS=14;window.SELLER={phone:"+91 90000 00000",email:"sales@example.com"};`;
const ok=(n,c,x='')=>console.log((c?'PASS ':'FAIL ')+n+(x?'  ['+x+']':''));
(async()=>{const srv=spawn('python3',['-m','http.server','8765','--bind','127.0.0.1'],{cwd:''+require('path').resolve(__dirname,'../firebase-site/public')+'',stdio:'ignore'});await new Promise(r=>setTimeout(r,800));
const B='http://127.0.0.1:8765/';const b=await chromium.launch();const errs=[];
const mk=async name=>{const c=await b.newContext({viewport:{width:1366,height:820}});
 await c.exposeFunction('__fb',(op,a)=>JSON.stringify(ST.handle(op,a)));
 await c.route(/gstatic\.com\/firebasejs\/.*app-compat\.js/,r=>r.fulfill({contentType:'application/javascript',body:MOCK}));
 await c.route(/gstatic\.com\/firebasejs\/.*(auth|firestore)-compat\.js/,r=>r.fulfill({contentType:'application/javascript',body:'/*mock*/'}));
 await c.route(/firebase-config\.js$/,r=>r.fulfill({contentType:'application/javascript',body:CFG}));
 await c.route(/fonts\.(googleapis|gstatic)\.com/,r=>r.fulfill({body:''}));
 const p=await c.newPage();p.on('pageerror',e=>errs.push(name+': '+e.message+' '+(e.stack||'').split('\n')[1]));p.on('dialog',d=>d.dismiss());p.__n=name;return p};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const shopOf=em=>{for(const [k,v] of ST.DB)if(k.startsWith('users/')&&ST.USERS.get(em)&&k==='users/'+ST.USERS.get(em).uid)return v.shopId};
// ---------- 1. owner signs up and creates a shop
const A=await mk('owner');await A.goto(B+'index.html');await wait(500);
ok('sign-in screen shows',await A.isVisible('#vAuth'));
await A.click('[data-mode="up"]');await A.fill('#aName','Asha Gupta');await A.fill('#aEmail','asha@shop.in');await A.fill('#aPass','secret123');await A.click('#aGo');await wait(700);
ok('shop setup after sign-up',await A.isVisible('#vShop'),await A.inputValue('#sOwner'));
await A.fill('#sName','Gupta Electricals & Hardware');await A.fill('#sCity','Kanpur');await A.fill('#sPin','208001');await A.fill('#sGst','09ABCDE1234F1Z5');await A.fill('#sInv','101');
await Promise.all([A.waitForURL(/app\.html/,{timeout:10000}),A.click('#sGo')]);await wait(4500);
const sa=await A.evaluate(()=>({fresh:FRESH,name:BZ.name,org:$('orgName').textContent,sync:SYNC.st,owner:SYNC.owner,inv:INVS.length,parties:allParties().length,items:IT.length,next:nextInvNo(),gst:S.gst,gstin:S.gstin,lic:$('miLicSub').textContent,av:document.querySelector('#avPop .avh small').textContent}));
ok('owner lands in empty books of new shop',sa.fresh&&sa.inv===0&&sa.parties===0&&sa.items===0&&sa.next==='INV-0101'&&sa.gst&&sa.gstin==='09ABCDE1234F1Z5',JSON.stringify(sa));
ok('synced to cloud as owner',sa.sync==='ok'&&sa.owner===true);
const SA=shopOf('asha@shop.in');ok('shop data stored under the shop',[...ST.DB.keys()].some(k=>k.startsWith(`shops/${SA}/meta/main/kv/erp-biz`)),SA);
// owner adds item + cash sale
await A.evaluate(()=>{IT.push({id:'n1',name:'MCB 16A',code:'M16',hsn:'8536',unit:'PCS',cat:'Switches & MCBs',gst:18,sale:250,purch:180,min:5,loc:'',isNew:1,tx:[{type:'Opening stock',ref:'—',party:'',date:TODAY_DMY,qty:20,price:180}]});saveNewItems();
 openInvoice();SI.mode='cash';SI.cashName='Walk-in';SI.lines=[lineFor(IT[0]),blankLine()];SI.chgOk=true;renderSI();saveSI(false);document.querySelectorAll('.ov').forEach(o=>{if(!o.hidden)closeM(o.id)})});
await wait(3500);ok('invoice reaches the cloud',[...ST.DB.keys()].some(k=>k.startsWith(`shops/${SA}/meta/main/kv/erp-invoices`)));
// ---------- 2. invite staff
await A.evaluate(()=>{go('set');setTab('gen')});await wait(800);ok('team section for owner',await A.isVisible('#tmInvite'));
await A.fill('#tmEmail','ravi@shop.in');await A.click('#tmInvite');await wait(800);
ok('invite stored',!!ST.DB.get('invites/ravi@shop.in'),JSON.stringify(ST.DB.get('invites/ravi@shop.in')||{}).slice(0,80));
await A.screenshot({path:Q+'saas_team.png'});
// ---------- 3. staff joins
const R=await mk('staff');await R.goto(B+'index.html');await wait(400);
await R.click('[data-mode="up"]');await R.fill('#aEmail','ravi@shop.in');await R.fill('#aPass','ravi1234');await R.click('#aGo');await wait(700);
ok('staff sees join screen',await R.isVisible('#vJoin'),await R.textContent('#jShop'));
await R.fill('#jName','Ravi');await Promise.all([R.waitForURL(/app\.html/,{timeout:10000}),R.click('#jGo')]);await wait(6000);
const sr=await R.evaluate(()=>({inv:INVS.length,name:BZ.name,owner:SYNC.owner,sync:SYNC.st,items:IT.length}));
ok('staff sees the shop books',sr.inv===1&&sr.name==='Gupta Electricals & Hardware'&&sr.owner===false&&sr.items===1,JSON.stringify(sr));
ok('invite used up',!ST.DB.get('invites/ravi@shop.in'));
await R.evaluate(()=>{EXPS.unshift({no:'EXP-0001',date:TODAY_DMY,cat:'Rent',payee:'Landlord',lines:[{name:'Rent',qty:1,rate:5000,gst:0,amt:5000}],mode:'Cash',acct:'cash',ref:'',note:''});exSave()});
await wait(6000);ok('owner sees staff expense',await A.evaluate(()=>(JSON.parse(localStorage.getItem('erp-exps')||'[]')).some(x=>x.no==='EXP-0001')));
ok('staff cannot start fresh',await R.evaluate(()=>{bzOpen();return $('bzm').hidden}));
// ---------- 4. a second shop is fully separate
const C=await mk('other');await C.goto(B+'index.html');await wait(400);
await C.click('[data-mode="up"]');await C.fill('#aEmail','bina@other.in');await C.fill('#aPass','bina1234');await C.click('#aGo');await wait(600);
await C.fill('#sName','Bina Traders');await C.fill('#sOwner','Bina');await Promise.all([C.waitForURL(/app\.html/,{timeout:10000}),C.click('#sGo')]);await wait(4000);
ok('second shop starts empty',await C.evaluate(()=>INVS.length===0&&EXPS.length===0&&BZ.name==='Bina Traders'));
const peek=await C.evaluate(async sa=>{try{await firebase.firestore().doc(`shops/${sa}/meta/main/kv/erp-invoices~0`).get();return 'READ OK'}catch(e){return e.code}},SA);
ok('other shop cannot read Gupta books',peek==='permission-denied',peek);
const poke=await C.evaluate(async sa=>{try{await firebase.firestore().doc(`shops/${sa}/meta/main/kv/erp-invoices~0`).set({k:'erp-invoices',v:'[]'});return 'WRITE OK'}catch(e){return e.code}},SA);
ok('other shop cannot change Gupta books',poke==='permission-denied',poke);
const cheat=await C.evaluate(async()=>{const s=SAAS_CTX.shopId;try{await firebase.firestore().doc('shops/'+s).update({plan:'paid',paidUntil:firebase.firestore.Timestamp.fromMillis(Date.now()+365*864e5)});return 'UPGRADED'}catch(e){return e.code}});
ok('shop cannot give itself a paid plan',cheat==='permission-denied',cheat);
// ---------- 5. sign out on a shared computer, then a different account
await C.click('#avBtn');await wait(200);await C.click('#miOut');await wait(200);await Promise.all([C.waitForURL(/index\.html/,{timeout:10000}),C.click('#slmOk')]);await wait(500);
{const left=await C.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('erp')));ok('sign out clears this browser',left.length===0,left.join())}
await C.fill('#aEmail','asha@shop.in');await C.fill('#aPass','secret123');await Promise.all([C.waitForURL(/app\.html/,{timeout:10000}),C.click('#aGo')]);await wait(6000);
ok('next account sees only its own shop',await C.evaluate(()=>BZ.name==='Gupta Electricals & Hardware'&&INVS.length===1&&!EXPS.some(x=>/Bina/.test(JSON.stringify(x)))));
// ---------- 6. trial ends
ST.DB.set('shops/'+SA,{...ST.DB.get('shops/'+SA),trialEnds:{__ts:Date.now()-1000}});await wait(1500);
const ex=await A.evaluate(()=>({bar:!$('subBar').hidden&&$('subBar').textContent,lic:$('miLicSub').textContent}));
ok('trial-ended banner',/free trial has ended/i.test(ex.bar||'')&&/sales@example\.com/.test(ex.bar)&&ex.lic==='Expired',JSON.stringify(ex).slice(0,160));
await A.evaluate(()=>{go('exp');EXPS.unshift({no:'EXP-0002',date:TODAY_DMY,cat:'Rent',payee:'X',lines:[{name:'x',qty:1,rate:1,gst:0,amt:1}],mode:'Cash',acct:'cash',ref:'',note:''});exSave()});await wait(4000);
ok('expired shop cannot add entries to the cloud',!JSON.stringify([...ST.DB].filter(([k])=>k.startsWith(`shops/${SA}/meta/main/kv/erp-exps`))).includes('EXP-0002')&&await A.evaluate(()=>SYNC.st==='ro'),await A.evaluate(()=>SYNC.st));
ST.DB.set('shops/'+SA,{...ST.DB.get('shops/'+SA),plan:'paid',paidUntil:{__ts:Date.now()+30*864e5}});await wait(1500);
ok('paid plan removes banner',await A.evaluate(()=>$('subBar').hidden&&/Active till/.test($('miLicSub').textContent)));
// ---------- 7. owner removes staff
await A.evaluate(()=>{go('set');setTab('gen')});await wait(1000);await A.click('[data-tmrm]');await wait(200);await A.click('#slmOk');
await R.waitForURL(/index\.html/,{timeout:10000}).catch(()=>{});await wait(800);
ok('removed staff is signed out',/index\.html/.test(R.url())&&await R.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('erp')).length===0),R.url());
// ---------- 8. demo
const D=await mk('demo');await D.goto(B+'app.html?demo=1');await wait(1500);
ok('demo opens without login with sample data',await D.evaluate(()=>!FRESH&&allParties().length>5&&!$('subBar').hidden&&SYNC.st==='local'));
await D.screenshot({path:Q+'saas_demo.png'});
const N=await mk('nologin');await N.goto(B+'app.html');await wait(800);ok('app without login goes to sign-in',/index\.html/.test(N.url()));
await A.screenshot({path:Q+'saas_owner.png'});
console.log('DENIED (expected only from the checks above):',ST.LOG.length);console.log('ERRORS',errs);
await b.close();srv.kill()})();
