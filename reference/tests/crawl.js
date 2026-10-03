const {chromium}=require('playwright');const OUT=require('path').join(__dirname,'out')+'/';
const W=+process.argv[2]||1366,H=+process.argv[3]||768;
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:W,height:H}});const errs=[];let ctx='load';
p.on('pageerror',e=>errs.push(ctx+' :: '+e.message+' @ '+(e.stack||'').split('\n')[1]));
p.on('console',m=>{if(m.type()==='error'&&!/fonts|ERR_|net::/.test(m.text()))errs.push(ctx+' :: console '+m.text())});
p.on('dialog',d=>{errs.push(ctx+' :: DIALOG '+d.message());d.dismiss()});
await p.goto('file://'+require('path').resolve(__dirname,'../design/app.html')+'');await p.waitForTimeout(800);
const closeAll=()=>p.evaluate(()=>{document.querySelectorAll('.ov').forEach(o=>{if(!o.hidden){try{closeM(o.id)}catch(e){o.hidden=true}}});try{closePops()}catch(e){};try{if(!$('ov').hidden)closeInv()}catch(e){}});
const views=await p.evaluate(()=>[...new Set([...document.querySelectorAll('[data-view]')].map(a=>a.dataset.view))]);
console.log('views',views.join(','));
const over=[];
for(const v of views){ctx='view '+v;try{await closeAll();await p.evaluate(v=>go(v),v);await p.waitForTimeout(250);
  const o=await p.evaluate(()=>{const de=document.documentElement;const r=[];if(de.scrollWidth>de.clientWidth+2)r.push('page scrollX '+de.scrollWidth);return r});if(o.length)over.push(v+': '+o.join(';'));
  await p.screenshot({path:OUT+`v_${v}_${W}.png`});
  // click header buttons
  const n=await p.evaluate(()=>{const s=[...document.querySelectorAll('main section:not([hidden]) .pthd button, section:not([hidden])>.pthd button')].filter(b=>b.offsetParent);return s.length});
  for(let i=0;i<n;i++){ctx=`view ${v} btn#${i}`;await p.evaluate(i=>{const s=[...document.querySelectorAll('main section:not([hidden]) .pthd button, section:not([hidden])>.pthd button')].filter(b=>b.offsetParent);const bt=s[i];if(bt){window.__lbl=bt.textContent.trim().slice(0,30);bt.click()}},i);await p.waitForTimeout(200);
    const lbl=await p.evaluate(()=>window.__lbl);ctx+=' ['+lbl+']';await closeAll();await p.waitForTimeout(80);await p.evaluate(v=>{try{go(v)}catch(e){}},v);await p.waitForTimeout(80)}
 }catch(e){errs.push(ctx+' :: THROW '+e.message.split('\n')[0])}}
// reports
const reps=await p.evaluate(()=>REPS.flatMap(g=>g[2].map(r=>r[0])));ctx='rep';await closeAll();await p.evaluate(()=>go('rep'));
const soon=[];for(const r of reps){ctx='report '+r;await p.evaluate(r=>{RPV.sel=r;renderRep()},r);await p.waitForTimeout(60);if(await p.evaluate(()=>!!document.querySelector('#rpMain .rpsoon')))soon.push(r);
 else{for(const f of ['rpPer']){} const rows=await p.evaluate(()=>document.querySelectorAll('#rpMain tbody tr').length);
  // try period change + exports
  await p.evaluate(()=>{const s=$('rpPer');if(s){s.value='all'in PS_PER?'all':s.options[s.options.length-2].value;s.dispatchEvent(new Event('change',{bubbles:true}))}});await p.waitForTimeout(60);
  await p.evaluate(()=>{try{rpXls&&RPX.cur&&0}catch(e){}});
 }}
console.log('reports built',reps.length-soon.length,'/',reps.length,'not built:',soon.join(','));
// keyboard shortcuts
ctx='shortcuts';await closeAll();await p.evaluate(()=>go('dash'));
for(const k of ['Alt+n','Alt+e','Alt+r','Alt+t','Alt+p','Alt+q','Alt+x','Control+k','?']){ctx='key '+k;await p.keyboard.press(k);await p.waitForTimeout(200);const open=await p.evaluate(()=>[...document.querySelectorAll('.ov')].filter(o=>!o.hidden).map(o=>o.id).join(',')+' view:'+[...document.querySelectorAll('main section, section')].filter(s=>!s.hidden&&s.id).map(s=>s.id).slice(0,2).join(','));console.log(k,'->',open);await closeAll();await p.keyboard.press('Escape');await p.evaluate(()=>{try{go('dash')}catch(e){}})}
console.log('OVERFLOW',over);console.log('ERRORS',errs.length);errs.forEach(e=>console.log(' -',e));await b.close()})();
