const {chromium}=require('playwright');const OUT=require('path').join(__dirname,'out')+'/';const fs=require('fs');
(async()=>{const b=await chromium.launch();const c=await b.newContext({viewport:{width:1366,height:850},acceptDownloads:true});const p=await c.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message+' '+(e.stack||'').split('\n')[1]));
const E=(f,a)=>p.evaluate(f,a);const ok=(n,x,d='')=>console.log((x?'PASS ':'FAIL ')+n+(d?'  ['+d+']':''));const closeAll=()=>E(()=>document.querySelectorAll('.ov').forEach(o=>{if(!o.hidden)closeM(o.id)}));
await p.goto('file://'+require('path').resolve(__dirname,'../design/app.html')+'');await p.waitForTimeout(800);
ok('bell reminds to back up (no data yet → none)',!(await E(()=>$('bellPop').innerHTML.includes('Take a backup'))));
await E(()=>{openInvoice({party:customers()[0].id});SI.lines=[lineFor(IT[0]),blankLine()];SI.chgOk=true;saveSI(false)});await closeAll();
await E(()=>{EXPS.unshift({no:'EXP-0099',date:TODAY_DMY,cat:'Rent',payee:'Landlord',lines:[{name:'Rent',qty:1,rate:9999,gst:0,amt:9999}],mode:'Cash',acct:'cash',ref:'',note:''});exSave();renderBell()});
ok('bell reminds to back up',await E(()=>$('bellPop').innerHTML.includes('Take a backup')));
await E(()=>{go('set');setTab('gen')});await p.waitForTimeout(300);await p.evaluate(()=>$('bkpCard').scrollIntoView());await p.screenshot({path:OUT+'bkp1.png'});
const [dl]=await Promise.all([p.waitForEvent('download'),p.click('#bkpDlBtn')]);const file=OUT+'backup-test.json';await dl.saveAs(file);
const d=JSON.parse(fs.readFileSync(file,'utf8'));ok('backup file has books',d.app==='billing-erp'&&JSON.parse(d.keys['erp-invoices']).length===1&&JSON.parse(d.keys['erp-exps']).some(x=>x.no==='EXP-0099'),dl.suggestedFilename()+' '+Object.keys(d.keys).length+' keys');
ok('last backup recorded',await E(()=>!$('bellPop').innerHTML.includes('Take a backup')&&/Last downloaded/.test($('bkpLastTxt').textContent)));
// start fresh
await E(()=>{go('dash');bzOpen()});await p.fill('#bzfName','Wipe Test');await p.check('#bzfOk');await Promise.all([p.waitForNavigation({timeout:15000}).catch(()=>{}),p.click('#bzmGo')]);await p.waitForTimeout(1200);
ok('books wiped',await E(()=>FRESH&&INVS.length===0&&EXPS.length===0));
// restore from file
await E(()=>{go('set');setTab('gen')});await p.waitForTimeout(300);await p.setInputFiles('#bkpFile',file);await p.waitForTimeout(400);
ok('restore summary shown',await E(()=>!$('rsm').hidden&&/Invoices\s*1/.test($('rsmBody').innerText)),await E(()=>$('rsmBody').innerText.replace(/\n/g,' ').slice(0,140)));
await p.screenshot({path:OUT+'bkp2.png'});
ok('restore locked until confirm',await E(()=>$('rsmGo').disabled));
await p.uncheck('#rsmSafe');await p.check('#rsmOk');await Promise.all([p.waitForNavigation({timeout:15000}).catch(()=>{}),p.click('#rsmGo')]);await p.waitForTimeout(1500);
const st=await E(()=>({fresh:FRESH,name:bzName(),inv:INVS.length,exp:EXPS.some(x=>x.no==='EXP-0099'),parties:allParties().length}));
ok('books restored',!st.fresh&&st.inv===1&&st.exp&&st.parties>5,JSON.stringify(st));
// bad file
fs.writeFileSync(OUT+'bad.json','{"hello":1}');await E(()=>{go('set');setTab('gen')});await p.setInputFiles('#bkpFile',OUT+'bad.json');await p.waitForTimeout(300);
ok('wrong file refused',await E(()=>$('rsm').hidden&&/isn’t a backup/.test($('toast').textContent)));
// storage full alert
await E(()=>{try{const big='x'.repeat(1e6);for(let i=0;i<20;i++)localStorage.setItem('junk'+i,big)}catch(e){}});
await E(()=>{try{localStorage.setItem('erp-invoices',JSON.stringify(INVS.concat(Array(500).fill(INVS[0]))))}catch(e){}});await p.waitForTimeout(300);
ok('storage-full alert shown',await E(()=>!$('slm').hidden&&/out of storage/.test($('slmT').textContent)));
await E(()=>{for(let i=0;i<20;i++)localStorage.removeItem('junk'+i)});
console.log('ERRORS',errs);await b.close()})();
