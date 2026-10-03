const {chromium}=require('playwright');(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1366,height:768}});const er=[];p.on('pageerror',e=>er.push(e.message));p.on('console',m=>{if(m.type()==='error'&&!/fonts|net::/.test(m.text()))er.push(m.text())});await p.goto('file://'+require('path').resolve(__dirname,'../design/app.html')+'');await p.waitForTimeout(800);
console.log(await p.evaluate(()=>[...document.querySelectorAll('#stats .stat')].map(s=>s.innerText.replace(/\n/g,' | '))));
await p.evaluate(()=>{openInvoice({party:customers()[0].id});SI.lines=[lineFor(IT[0]),blankLine()];SI.chgOk=true;saveSI(false);document.querySelectorAll('.ov').forEach(o=>{if(!o.hidden)closeM(o.id)});go('dash')});await p.waitForTimeout(300);
console.log(await p.evaluate(()=>$('stats').querySelector('.stat').innerText.replace(/\n/g,' | ')));
await p.screenshot({path:'./out/home.png'});
await p.click('#inv tr');await p.waitForTimeout(300);console.log('open',await p.evaluate(()=>[...document.querySelectorAll('.ov')].filter(o=>!o.hidden).map(o=>o.id).join()));
await p.evaluate(()=>{document.querySelectorAll('.ov').forEach(o=>{if(!o.hidden)closeM(o.id)});go('parties')});console.log(await p.evaluate(()=>[...document.querySelectorAll('#vParties th')].map(t=>t.textContent).join('|')));
console.log('errs',er);await b.close()})();
