import { chromium } from 'playwright';
import { readFile, writeFile, mkdir, copyFile, cp, access, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root=process.cwd(),out=path.join(root,'_site');
const refresh=process.env.REFRESH_PREVIEWS==='true';
const lines=(await readFile('links.txt','utf8')).split(/\r?\n/);
const entries=[],seen=new Set();let category='project';
for(const [i,line] of lines.entries()){
 const value=line.trim();if(!value||value.startsWith('#'))continue;
 if(value==='[project]'||value==='[tool]'){category=value.slice(1,-1);continue;}
 let u;try{u=new URL(value)}catch{throw new Error(`Invalid URL on line ${i+1}: ${value}`)}
 if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw new Error(`Unsupported URL on line ${i+1}`);
 u.hash='';if(seen.has(u.href))continue;seen.add(u.href);entries.push({url:u.href,category});
}
await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});
await copyFile('index.html',path.join(out,'index.html'));
await cp('assets',path.join(out,'assets'),{recursive:true});
await writeFile(path.join(out,'.nojekyll'),'');
let previous=[];
try{const s=await readFile('catalog.js','utf8');previous=JSON.parse(s.slice(s.indexOf('=')+1).trim().replace(/;\s*$/,''));}catch{}

let browser;const cards=[];
try{
 for(const {url,category} of entries){
  const old=previous.find(p=>p.url===url);
  const item={url,category,title:old?.title||decodeURI(new URL(url).pathname).split('/').filter(Boolean).pop()||new URL(url).hostname,description:old?.description||'برای آشنایی بیشتر، وارد سایت شوید.'};
  let existing=false;
  if(old?.image&&/^assets\/[\w.-]+$/.test(old.image)){
   try{await access(old.image);existing=true;item.image=old.image;if(old.capturedAt)item.capturedAt=old.capturedAt;}catch{}
  }
  // Preserve the approved previews. Capture new links automatically.
  if(existing&&!refresh){cards.push(item);continue;}
  browser??=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:1200,height:800},deviceScaleFactor:1,locale:'fa-IR',reducedMotion:'reduce',serviceWorkers:'block'});
  const page=await context.newPage();
  try{
   const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:35000});
   if(!response?.ok())throw new Error(`HTTP ${response?.status()}`);
   await page.waitForLoadState('networkidle',{timeout:10000}).catch(()=>{});
   await page.evaluate(()=>Promise.race([document.fonts.ready,new Promise(r=>setTimeout(r,4000))]));
   await page.waitForTimeout(2500);
   // Reveal sections whose entrance animation would otherwise hide the screenshot.
   await page.evaluate(()=>{document.querySelectorAll('[data-aos]').forEach(e=>e.classList.add('aos-animate'));});
   const info=await page.evaluate(()=>({title:document.querySelector('meta[property="og:title"]')?.content||document.title,description:document.querySelector('meta[name="description"]')?.content||document.querySelector('meta[property="og:description"]')?.content||''}));
   if(info.title.trim())item.title=info.title.trim().slice(0,180);
   if(info.description.trim())item.description=info.description.trim().slice(0,350);
   const name=createHash('sha256').update(url).digest('hex').slice(0,20)+'.jpg';
   await page.screenshot({path:path.join(out,'assets',name),type:'jpeg',quality:83,fullPage:false,animations:'disabled',timeout:15000});
   item.image='assets/'+name;item.capturedAt=new Date().toISOString();console.log('Captured:',url);
  }catch(e){console.warn('Preview unavailable:',url,e.message);item.previewError=true;}
  finally{await context.close();}
  cards.push(item);
 }
}finally{await browser?.close();}
await writeFile(path.join(out,'catalog.js'),'window.SITE_CARDS = '+JSON.stringify(cards,null,2)+';\n');
console.log(`Built ${cards.length} cards in _site/`);
