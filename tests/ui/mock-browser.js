/* Nachgebildete browser-API für die Oberflächentests in Chromium (Playwright).
 * Wird per addInitScript vor jeder Seite geladen. Cookies und storage.local liegen im Speicher
 * und überleben Seitenwechsel über sessionStorage. Die Hintergrundseite (background.js) wird in
 * dieselbe Seite geladen, runtime.sendMessage ruft also den echten Nachrichten-Handler auf.
 * window.__page bildet local-/sessionStorage einer Webseite nach (für Live-Ansicht/Eintragsregeln).
 * Grenze: Firefox-Eigenheiten (Partitionen, browsingData-Verhalten) werden nicht nachgebildet. */
(function(){
 const L=()=>{const ls=[];return {addListener:f=>ls.push(f),removeListener:f=>{const i=ls.indexOf(f);if(i>=0)ls.splice(i,1)},_ls:ls,_fire:(...a)=>Promise.all(ls.map(f=>f(...a)))}};
 const saved=JSON.parse(sessionStorage.getItem('mockstore')||'{}');
 const store=saved.store||{};
 const st=L(); const ck=L(); const msg=L(); const startup=L();
 const now=Date.now()/1000;
 const C=(name,domain,extra={})=>Object.assign({name,domain,path:'/',value:'v'+name.length+'abc',storeId:'firefox-default',secure:true,httpOnly:false,sameSite:'lax',session:false,hostOnly:false,expirationDate:now+86400*30,firstPartyDomain:''},extra);
 let cookies=saved.cookies||[
  C('_ga','.example.com'),C('_gid','.example.com'),C('OptanonConsent','.example.com',{value:'groups=C0001%3A1%2CC0002%3A0'}),
  C('PHPSESSID','www.example.com',{session:true,expirationDate:undefined,httpOnly:true,hostOnly:true,value:'sess-ORIGINAL'}),
  C('lang','www.example.com',{value:'de'}),C('IDE','.doubleclick.net',{partitionKey:{topLevelSite:'https://example.com'},sameSite:'no_restriction'}),
  C('session','.github.com'),C('cto_bundle','.srf.ch'),
 ];
 const persist=()=>sessionStorage.setItem('mockstore',JSON.stringify({store,cookies}));
 const id=c=>[c.storeId,c.domain,c.path,c.name,c.firstPartyDomain||'',(c.partitionKey&&c.partitionKey.topLevelSite)||''].join('|');
 const mkS=(o)=>{const m=new Map(Object.entries(o));return{get length(){return m.size},key:i=>[...m.keys()][i],getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),_m:m}};
 window.__page={localStorage:mkS({'_ga_tracker':'GA1.2.3','theme':'dark','auth.token':'eyJhbGciOi...','ads_seen':'[1,2,3]'}),sessionStorage:mkS({'tmp_scroll':'420','wizardStep':'3'})};
 window.__mock={cookies:()=>cookies,store,startup,persist};
 window.browser={
  storage:{local:{get:async k=>({[k]:store[k]===undefined?undefined:JSON.parse(JSON.stringify(store[k]))}),set:async o=>{for(const k in o){const old=store[k];store[k]=JSON.parse(JSON.stringify(o[k]));persist();st._fire({[k]:{oldValue:old,newValue:JSON.parse(JSON.stringify(store[k]))}},'local')}}},onChanged:st},
  cookies:{getAllCookieStores:async()=>[{id:'firefox-default'}],
   getAll:async f=>cookies.filter(c=>c.storeId===f.storeId).map(c=>JSON.parse(JSON.stringify(c))),
   remove:async d=>{const host=new URL(d.url).hostname;const i=cookies.findIndex(c=>c.name===d.name&&c.domain.replace(/^\./,'')===host&&c.storeId===d.storeId&&JSON.stringify(c.partitionKey||null)===JSON.stringify(d.partitionKey||null));if(i<0)return null;const [c]=cookies.splice(i,1);persist();ck._fire({removed:true,cookie:c,cause:'explicit'});return d},
   set:async d=>{const host=new URL(d.url).hostname;const c={name:d.name,value:d.value,domain:d.domain||host,hostOnly:!d.domain,path:d.path||'/',secure:!!d.secure,httpOnly:!!d.httpOnly,sameSite:d.sameSite||'lax',session:!d.expirationDate,expirationDate:d.expirationDate,storeId:d.storeId||'firefox-default',firstPartyDomain:d.firstPartyDomain||'',partitionKey:d.partitionKey};if(!c.partitionKey)delete c.partitionKey;const i=cookies.findIndex(x=>id(x)===id(c));if(i>=0)cookies.splice(i,1);cookies.push(c);persist();ck._fire({removed:false,cookie:c,cause:'explicit'});return c},
   onChanged:ck},
  contextualIdentities:{query:async()=>[]},
  tabs:{executeScript:async(id,d)=>{const w=window.__page;const r=await (new Function('window','location','browser','return '+d.code.replace(/;\s*$/,'')))(w,{host:'www.example.com',origin:'https://www.example.com'},window.browser);return [r];},
   query:async()=>[{id:1,url:'https://www.example.com/',active:true}],get:async()=>({id:1,url:'https://www.example.com/',active:true}),create:async()=>{},onUpdated:L(),onRemoved:L(),onActivated:L()},
  runtime:{getURL:p=>p,onStartup:startup,onInstalled:L(),onMessage:msg,openOptionsPage(){},
   sendMessage:async m=>{for(let i=0;i<100&&!msg._ls.length;i++)await new Promise(r=>setTimeout(r,20));const r=await Promise.all(msg._ls.map(f=>f(m)));return JSON.parse(JSON.stringify(r.find(x=>x!==undefined)??null))}},
  alarms:{clear(){},create(){},onAlarm:L()},
  browsingData:{remove:async(o,t)=>{window.__bd=(window.__bd||[]);window.__bd.push({o,t});}},
  contentScripts:{register:async o=>{window.__cs=(window.__cs||[]);window.__cs.push(o);return{unregister:async()=>{window.__cs=window.__cs.filter(x=>x!==o)}}}},
  browserAction:{setBadgeText(){},setBadgeBackgroundColor(){},setTitle(){}},
 };
 document.addEventListener('DOMContentLoaded',()=>{const p=document.createElement('script');p.src='../lib/pagefns.js';p.onload=()=>{const s=document.createElement('script');s.src='../background.js';document.body.append(s);};document.body.append(p);});
 window.close=()=>{};
})();
