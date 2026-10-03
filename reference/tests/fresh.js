const {chromium}=require('playwright');const OUT=require('path').join(__dirname,'out')+'/';
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1366,height:768}});const errs=[];p.on('pageerror',e=>errs.push(e.message+' '+(e.stack||'').split('\n')[1]));
const E=(f,a)=>p.evaluate(f,a);const ok=(n,c,x='')=>console.log((c?'PASS ':'FAIL ')+n+(x?'  ['+x+']':''));
await p.goto('file://'+require('path').resolve(__dirname,'../design/app.html')+'');await p.waitForTimeout(800);
ok('sample tag shown',await E(()=>!!$('bzSampleTag')));
// make some data first
await E(()=>{openInvoice({party:customers()[0].id});SI.lines=[lineFor(IT[0]),blankLine()];SI.chgOk=true;saveSI(false);document.querySelectorAll('.ov').forEach(o=>{if(!o.hidden)closeM(o.id)})});
await E(()=>go('dash'));await p.waitForTimeout(200);await p.click('#bzSampleTag');await p.waitForTimeout(250);await p.screenshot({path:OUT+'fresh1.png'});
await p.fill('#bzfName','Gupta Electricals & Hardware');await p.fill('#bzfOwner','Rakesh Gupta');await p.fill('#bzfPhone','+91 99887 76655');await p.fill('#bzfAddr','12 Station Road');await p.fill('#bzfCity','Kanpur');await p.fill('#bzfPin','208001');
await p.fill('#bzfGstin','09ABCDE1234F1Z5');await p.fill('#bzfInv','415');await p.fill('#bzfCash','5000');
ok('button locked until confirm',await E(()=>$('bzmGo').disabled));await p.check('#bzfOk');
await Promise.all([p.waitForNavigation({timeout:15000}).catch(()=>{}),p.click('#bzmGo')]);await p.waitForTimeout(1500);
const st=await E(()=>({fresh:FRESH,parties:allParties().length,items:IT.length,sales:allSales().length,bills:allBills().length,pays:allPays().length,rc:PRECV.length,exps:allExpenses().length,accts:ACCTS.map(a=>a.name+':'+acctBal(a.id,bkEntries())).join(),elec:ELEC.length,gd:GD.length,next:nextInvNo(),org:$('orgName').textContent,hero:document.querySelector('#vDash .hero h1').textContent,keys:Object.keys(localStorage).filter(k=>k.startsWith('erp-')).join()}));
console.log(JSON.stringify(st,null,1));
ok('books empty',st.parties===0&&st.items===0&&st.sales===0&&st.bills===0&&st.pays===0&&st.exps===0&&st.elec===0);
ok('cash opening 5000',/Cash in hand:5000/.test(st.accts));ok('next invoice 415',st.next==='INV-0415',st.next);ok('header shows business',/Gupta Electricals/.test(st.org),st.org);
await p.screenshot({path:OUT+'fresh2.png'});
// crawl every view for errors in empty mode
const views=await E(()=>[...new Set([...document.querySelectorAll('[data-view]')].map(a=>a.dataset.view))]);
for(const v of views){await E(v=>{document.querySelectorAll('.ov').forEach(o=>{if(!o.hidden)closeM(o.id)});go(v)},v);await p.waitForTimeout(120)}
const reps=await E(()=>REPS.flatMap(g=>g[2].map(r=>r[0])));await E(()=>go('rep'));for(const r of reps){await E(r=>{RPV.sel=r;renderRep()},r)}
ok('all pages & reports open with empty books',errs.length===0,errs.slice(0,3).join(' || '));
// first real entries
await E(()=>{go('parties')});await E(()=>{try{openParty()}catch(e){}});await p.waitForTimeout(250);
const apOpen=await E(()=>!$('ap').hidden);
if(apOpen){await p.fill('#apName','Verma Traders');await E(()=>{const b=[...document.querySelectorAll('#ap button')].find(x=>/^Save$/i.test(x.textContent.trim())||/save party/i.test(x.textContent));b&&b.click()});await p.waitForTimeout(300)}
ok('add first party',await E(()=>allParties().some(x=>x.name==='Verma Traders')));
await E(()=>{document.querySelectorAll('.ov').forEach(o=>{if(!o.hidden)closeM(o.id)});openItem()});await p.waitForTimeout(250);await p.screenshot({path:OUT+'fresh3.png'});
// add item programmatically through form fields if possible
const itemAdded=await E(()=>{try{IT.push({id:'n1',name:'Test MCB 16A',code:'MCB16',hsn:'8536',unit:'PCS',cat:'Switches & MCBs',gst:18,sale:250,purch:180,min:5,loc:'',tx:[{type:'Opening stock',ref:'—',party:'',date:TODAY_DMY,qty:20,price:180}],isNew:1});saveNewItems();return true}catch(e){return e.message}});
await E(()=>{document.querySelectorAll('.ov').forEach(o=>{if(!o.hidden)closeM(o.id)})});
const inv=await E(()=>{const c=allParties().find(x=>x.name==='Verma Traders');openInvoice({party:c.id});SI.lines=[lineFor(IT.find(i=>i.id==='n1')),blankLine()];SI.lines[0].qty=2;SI.chgOk=true;renderSI();saveSI(false);return INVS[0]&&INVS[0].no+' '+INVS[0].total});
ok('first invoice numbered 415',/^INV-0415/.test(inv||''),inv);
await p.waitForTimeout(300);await p.screenshot({path:OUT+'fresh4.png'});
const sheet=await E(()=>$('ipvSheet').innerText.slice(0,300));ok('invoice shows real business',/Gupta Electricals/.test(sheet)&&/Station Road/.test(sheet)&&!/Sharma/.test(sheet),sheet.replace(/\n/g,' ').slice(0,160));
await E(()=>{document.querySelectorAll('.ov').forEach(o=>{if(!o.hidden)closeM(o.id)});go('dash')});await p.waitForTimeout(300);await p.screenshot({path:OUT+'fresh5.png'});
console.log('page has Sharma?',await E(()=>/Sharma|Naka Hindola|Aman Kumar/.test(document.body.innerText)));
console.log('ERRORS',errs);await b.close()})();
