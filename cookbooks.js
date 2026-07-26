const $ = id => document.getElementById(id);
const SETTINGS_KEY = "recipeVaultSettingsV031";
const LIBRARY_KEY = "recipeVaultCookbookLibraryV150";
const COOKBOOK_ENGINE_VERSION = "3.2.0";
window.RECIPE_VAULT_ENGINES = {...(window.RECIPE_VAULT_ENGINES||{}), cookbook:"3.2", parser:"Coordinate Region Collector v2"};
const PHOTO_MIN_AREA = 42000;
const PHOTO_RECIPE_TIMEOUT_MS = 900;
const PAGE_PREVIEW_SCALE = .82;
const PHOTO_CROP_QUALITY = .82;
const PHOTO_OBJECT_TIMEOUT_MS = 700;
const CACHE_KEY = "recipeVaultRecipeCacheV118";
const base = window.RECIPE_VAULT_CONFIG || {};
const settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
const config = {...base, ...settings};
let library = readLibrary();
let recipes = [];
let importState = null;
let activeCookbookId = null;
let deleteTargetId = null;

function escapeHTML(value){ return String(value ?? "").replace(/[&<>'"]/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[ch])); }
function readLibrary(){ try{return JSON.parse(localStorage.getItem(LIBRARY_KEY)||"[]")||[];}catch{return [];} }
function saveLibrary(){ localStorage.setItem(LIBRARY_KEY, JSON.stringify(library)); }
function makeId(){ return `cb_${Date.now()}_${Math.random().toString(36).slice(2,8)}`; }
function normalize(value){ return String(value||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim(); }
function splitList(value){ return String(value||"").split(/\r?\n/).map(v=>v.trim().replace(/^[-•▪◦]\s*/,"")).filter(Boolean); }
function smartTitleCase(value){
  const small=new Set(["a","an","and","as","at","but","by","for","from","in","into","nor","of","on","or","over","per","the","to","up","via","with"]);
  const keep=new Set(["BBQ","BLT","PB&J","TBS","TBSP","TSP"]);
  return String(value||"").trim().toLowerCase().split(/(\s+)/).map((part,index,all)=>{
    if(/^\s+$/.test(part))return part;
    const bare=part.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi,"");
    const prefix=part.slice(0,part.indexOf(bare));
    const suffix=part.slice(part.indexOf(bare)+bare.length);
    if(!bare)return part;
    const upper=bare.toUpperCase();
    if(keep.has(upper))return prefix+upper+suffix;
    if(/^\d/.test(bare))return prefix+bare.replace(/[a-z]+/gi,m=>m[0].toUpperCase()+m.slice(1))+suffix;
    const wordIndex=all.slice(0,index).filter(x=>!/^\s+$/.test(x)).length;
    const totalWords=all.filter(x=>!/^\s+$/.test(x)).length;
    const lower=bare.toLowerCase();
    const cased=(wordIndex>0&&wordIndex<totalWords-1&&small.has(lower))?lower:lower.charAt(0).toUpperCase()+lower.slice(1);
    return prefix+cased+suffix;
  }).join("");
}
function splitLinks(value){return [...new Set(String(value||"").split(/\r?\n/).map(v=>v.trim()).filter(v=>/^https?:\/\//i.test(v)))];}

async function loadRecipes(){
  try{
    const cached=JSON.parse(localStorage.getItem(CACHE_KEY)||"null");
    if(cached?.rows) recipes=cached.rows;
    const source=config.sheetCsvUrl||"recipes.json";
    const response=await fetch(source+(source.includes("?")?"&":"?")+"rv="+Date.now());
    if(!response.ok) throw new Error();
    const text=await response.text();
    recipes=source.endsWith(".json")?JSON.parse(text):parseCSV(text);
  }catch{}
  renderShelf();
}
function parseCSV(text){
  const rows=[];let row=[],field="",quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i],n=text[i+1];if(c==='"'&&quoted&&n==='"'){field+='"';i++;}else if(c==='"')quoted=!quoted;else if(c===','&&!quoted){row.push(field);field="";}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&n==='\n')i++;row.push(field);if(row.some(Boolean))rows.push(row);row=[];field="";}else field+=c;}
  if(field||row.length){row.push(field);rows.push(row);} if(rows.length<2)return [];
  const headers=rows.shift().map(h=>h.trim()); return rows.map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]||""])));
}
function cookbookRecipeMatches(recipe, cookbook){
  const hay=normalize([recipe.source,recipe.tags,recipe.collections,recipe.cookbook_title].join(" "));
  return hay.includes(normalize(cookbook.title)) || String(recipe.cookbook_id||"")===cookbook.id;
}
function coverMarkup(cb){ return cb.cover ? `<img src="${cb.cover}" alt="">` : `<div class="cover-placeholder">📖</div>`; }
function recipePhotoMarkup(recipe){ return recipe.image ? `<img class="cookbook-recipe-photo" src="${recipe.image}" alt="${escapeHTML(recipe.name||"Cookbook recipe")}">` : `<div class="cookbook-recipe-photo cookbook-photo-placeholder">🍽️</div>`; }
function renderShelf(){
  const q=normalize($("cookbookSearch")?.value); const visible=library.filter(cb=>!q||normalize(`${cb.title} ${cb.author}`).includes(q));
  $("cookbookEmpty").hidden=library.length>0;
  $("cookbookGrid").innerHTML=visible.map(cb=>{const count=recipes.filter(r=>cookbookRecipeMatches(r,cb)).length || cb.importedCount||0;return `<article class="cookbook-card" data-open-cookbook="${cb.id}"><div class="cookbook-cover">${coverMarkup(cb)}</div><div class="cookbook-card-body"><p class="eyebrow">${count} RECIPE${count===1?"":"S"}</p><h3>${escapeHTML(cb.title)}</h3><p>${escapeHTML(cb.author||"Cookbook PDF")}</p><div class="cookbook-card-actions"><button class="secondary compact-button" data-open-cookbook="${cb.id}">Browse</button><button class="icon-button danger-text" data-delete-cookbook="${cb.id}" title="Remove cookbook">×</button></div></div></article>`}).join("");
}
function openCookbook(id){
  const cb=library.find(x=>x.id===id); if(!cb)return; activeCookbookId=id;
  $("libraryView").hidden=true;$("importView").hidden=true;$("cookbookDetailView").hidden=false;
  const count=recipes.filter(r=>cookbookRecipeMatches(r,cb)).length;
  $("cookbookDetailHeader").innerHTML=`<div class="detail-cover">${coverMarkup(cb)}</div><div><p class="eyebrow">COOKBOOK</p><h2>${escapeHTML(cb.title)}</h2><p>${escapeHTML(cb.author||"")}</p><p class="muted">${count||cb.importedCount||0} imported recipes${cb.pageCount?` · ${cb.pageCount} PDF pages`:""}</p></div>`;
  renderCookbookRecipes();
}
function renderCookbookRecipes(){
  const cb=library.find(x=>x.id===activeCookbookId); if(!cb)return; const q=normalize($("cookbookRecipeSearch").value);
  const list=recipes.filter(r=>cookbookRecipeMatches(r,cb)).filter(r=>!q||normalize([r.name,r.ingredients,r.tags,r.cuisine].join(" ")).includes(q));
  $("cookbookRecipeGrid").innerHTML=list.length?list.map(r=>`<article class="card cookbook-recipe-card">${recipePhotoMarkup(r)}<div class="card-body"><p class="eyebrow">PAGE ${escapeHTML(r.cookbook_page||String(r.source||"").match(/p\.\s*(\d+)/i)?.[1]||"—")}</p><h3>${escapeHTML(r.name||"Untitled recipe")}</h3><p>${escapeHTML(r.protein||r.type||r.cuisine||"")}</p><a class="secondary linkbtn" href="index.html?recipe=${encodeURIComponent(r.id||"")}">Open recipe</a></div></article>`).join(""):`<div class="empty-state"><strong>No matching recipes found.</strong><p>Recipes imported from this cookbook will appear here.</p></div>`;
}
function showImport(){ $("libraryView").hidden=true;$("cookbookDetailView").hidden=true;$("importView").hidden=false;$("choosePdfPanel").hidden=false;$("analyzePanel").hidden=true;$("reviewPanel").hidden=true;$("importResults").hidden=true;importState=null; }
function cancelImport(){ $("importView").hidden=true;$("libraryView").hidden=false;$("cookbookFile").value="";renderShelf(); }

async function getPdfJs(){
  const mod=await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs");
  mod.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs"; return mod;
}
function annotationText(lines,rect){
  if(!Array.isArray(rect)||rect.length<4)return "";
  const [x1,y1,x2,y2]=rect; const pad=14;
  const hits=(lines||[]).filter(l=>{
    const cx=(l.x||0)+(l.width||0)/2, cy=l.y||0;
    return cx>=Math.min(x1,x2)-pad&&cx<=Math.max(x1,x2)+pad&&cy>=Math.min(y1,y2)-pad&&cy<=Math.max(y1,y2)+pad;
  }).sort((a,b)=>b.y-a.y||a.x-b.x);
  return hits.map(l=>l.text).join(" ").replace(/\s+/g," ").trim();
}
function extractPageLinks(annotations,lines){
  return (annotations||[]).map(a=>({url:a.url||a.unsafeUrl||"",label:annotationText(lines,a.rect),rect:a.rect||[]}))
    .filter(x=>/^https?:\/\//i.test(x.url));
}
function recipeVideoLinks(pages){
  const seen=new Set(),out=[];
  for(const page of pages||[]){
    const candidates=(page.links||[]).map(link=>{
      const label=cleanLine(link.label||"");
      if(!/video\s*tutorial|watch\s+(?:the|my)?\s*video|video\b/i.test(label))return null;
      const rect=Array.isArray(link.rect)?link.rect:[];
      const x1=Number(rect[0]||0),y1=Number(rect[1]||0),x2=Number(rect[2]||0),y2=Number(rect[3]||0);
      const area=Math.abs((x2-x1)*(y2-y1));
      let score=0;
      if(/video\s*tutorial/i.test(label))score+=100;
      if(/click\s+here\s+for\s+video/i.test(label))score+=45;
      if(/watch\s+(?:the|my)?\s*video/i.test(label))score+=35;
      if(area>500)score+=10;
      // Tutorial buttons in these digital cookbooks live in the lower recipe panel.
      if(y1<(page.height||800)*.35)score+=8;
      return {link,score};
    }).filter(Boolean).sort((a,b)=>b.score-a.score);
    const best=candidates[0]?.link;
    if(best&&!seen.has(best.url)){seen.add(best.url);out.push(best.url);}
  }
  return out.slice(0,1);
}


async function resolvePdfDestinationPage(pdf,dest){
  try{
    const resolved=typeof dest==="string" ? await pdf.getDestination(dest) : dest;
    if(!Array.isArray(resolved)||!resolved[0])return null;
    const ref=resolved[0];
    if(Number.isInteger(ref))return ref+1;
    return (await pdf.getPageIndex(ref))+1;
  }catch{return null;}
}
async function buildTocTitleMap(pdf){
  const map=new Map();
  const add=(page,title,source)=>{
    title=cleanLine(title||"");
    if(!page||!title||title.length<3||title.length>120||SECTION_NOISE.test(title)||LINK_NOISE.test(title))return;
    const existing=map.get(page);
    if(!existing||title.length>existing.title.length)map.set(page,{title,source});
  };
  const walk=async items=>{
    for(const item of items||[]){
      const page=await resolvePdfDestinationPage(pdf,item.dest);
      if(page)add(page,item.title,"PDF outline");
      if(item.items?.length)await walk(item.items);
    }
  };
  try{await walk(await pdf.getOutline());}catch{}
  // Digital cookbook tables of contents often use internal link annotations rather than PDF outlines.
  for(let pageNo=1;pageNo<=Math.min(pdf.numPages,14);pageNo++){
    try{
      const page=await pdf.getPage(pageNo);
      const content=await page.getTextContent();
      const lines=itemsToStructuredLines(content.items);
      const annotations=await page.getAnnotations({intent:"display"});
      for(const a of annotations||[]){
        if(a.url||a.unsafeUrl)continue;
        const target=await resolvePdfDestinationPage(pdf,a.dest);
        const label=annotationText(lines,a.rect);
        if(target&&label)add(target,label,"linked table of contents");
      }
    }catch{}
  }
  return map;
}
function applyTocTitles(candidates,tocMap){
  for(const candidate of candidates){
    let match=tocMap.get(candidate.page);
    if(!match){
      // Some PDFs link to the page immediately before/after the visible numbered page.
      for(const delta of [-1,1]){const nearby=tocMap.get(candidate.page+delta);if(nearby){match=nearby;break;}}
    }
    if(match){
      candidate.visualTitle=candidate.title;
      candidate.title=smartTitleCase(match.title);
      candidate.titleSource=match.source;
      candidate.titleConfidence=99;
      candidate.warnings=(candidate.warnings||[]).filter(w=>!/title/i.test(w));
    }else{
      candidate.titleSource="visual region fallback";
      candidate.titleConfidence=titleRejected(candidate.title)?25:Math.min(88,Math.round((candidate.titleLine?.fontSize||10)*3));
      if(candidate.titleConfidence<55&&!candidate.warnings.some(w=>/title/i.test(w)))candidate.warnings.push("Low-confidence title: verify before importing.");
    }
    candidate.debugReport={
      page:candidate.page, layout:candidate.layoutProfile, chosenTitle:candidate.title, titleSource:candidate.titleSource,
      visualTitle:candidate.visualTitle||candidate.title, confidence:candidate.titleConfidence,
      titleLine:candidate.titleLine||null, regions:candidate.regions||{},
      titleCandidates:candidate.titleCandidates||[],
      nearbyLines:(candidate.rawLines||candidate.pages?.[0]?.richLines||[]).map(l=>({text:l.text,fontSize:l.fontSize,x:l.x,y:l.y,width:l.width})).slice(0,160)
    };
  }
}
function downloadParserReport(index){
  syncReviewFields();
  const r=importState?.candidates?.[index];if(!r)return;
  const payload={build:178,engine:COOKBOOK_ENGINE_VERSION,fileName:importState.fileName,recipe:r.debugReport||r};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`parser-report-page-${r.page}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}

async function analyzePdf(file){
  $("choosePdfPanel").hidden=true;$("analyzePanel").hidden=false;$("importHeading").textContent="Analyzing cookbook";
  try{
    const pdfjs=await getPdfJs(); const buffer=await file.arrayBuffer(); const pdf=await pdfjs.getDocument({data:buffer}).promise;
    const pages=[]; let cover=""; const tocMap=await buildTocTitleMap(pdf);
    for(let pageNo=1;pageNo<=pdf.numPages;pageNo++){
      $("analyzeStatus").textContent=`Reading page ${pageNo} of ${pdf.numPages}`;$("analyzeCurrent").textContent="Looking for titles, ingredient lists, and cooking steps…";$("analyzeProgress").value=Math.round(pageNo/pdf.numPages*85);
      const page=await pdf.getPage(pageNo); const content=await page.getTextContent();
      const richLines=itemsToStructuredLines(content.items);
      const lines=richLines.map(line=>line.text);
      const annotations=await page.getAnnotations({intent:"display"}).catch(()=>[]);
      const links=extractPageLinks(annotations,richLines);
      const baseViewport=page.getViewport({scale:1});
      pages.push({page:pageNo,lines,richLines,links,text:lines.join("\n"),width:baseViewport.width,height:baseViewport.height});
      if(pageNo===1){const viewport=page.getViewport({scale:.45});const canvas=document.createElement("canvas");canvas.width=viewport.width;canvas.height=viewport.height;await page.render({canvasContext:canvas.getContext("2d"),viewport}).promise;cover=canvas.toDataURL("image/jpeg",.7);}
    }
    $("analyzeStatus").textContent="Separating recipes from the rest of the book…";$("analyzeProgress").value=92;
    const candidates=detectRecipes(pages); applyTocTitles(candidates,tocMap);
    $("analyzeStatus").textContent="Creating recipe photos…";
    // Digital cookbooks often contain dozens of PDF image objects per page. Scanning
    // every object was much slower than rendering one small crop, so photo creation
    // now uses a lightweight page render only. Process a few pages concurrently to
    // keep large cookbooks moving without overwhelming the browser.
    const concurrency=4;
    let completed=0;
    for(let start=0;start<candidates.length;start+=concurrency){
      const batch=candidates.slice(start,start+concurrency);
      await Promise.all(batch.map(async candidate=>{
        candidate.image=await withTimeout(renderRecipePhotoCrop(pdf,candidate),PHOTO_RECIPE_TIMEOUT_MS,"").catch(()=>"");
        candidate.imageKind=candidate.image?"photo-crop":"";
        candidate.useImage=Boolean(candidate.image);
        completed++;
        $("analyzeCurrent").textContent=`Created photos for ${completed} of ${candidates.length} recipes`;
        $("analyzeProgress").value=92+Math.round((completed/Math.max(1,candidates.length))*8);
      }));
      await nextFrame();
    }
    importState={fileName:file.name,pageCount:pdf.numPages,cover,candidates,title:guessBookTitle(pages,file.name),author:"",tocCount:tocMap.size};
    $("analyzeProgress").value=100; showReview();
  }catch(error){$("analyzePanel").innerHTML=`<div class="cookbook-analyze-card"><h3>Could not read this PDF</h3><p>${escapeHTML(error.message||"PDF analysis failed.")}</p><button class="secondary" onclick="location.reload()">Start over</button></div>`;}
}

async function renderRecipePagePreview(pdf,pageNo){
  const page=await pdf.getPage(pageNo);
  const viewport=page.getViewport({scale:PAGE_PREVIEW_SCALE});
  const maxWidth=900;
  const scale=Math.min(1,maxWidth/viewport.width);
  const canvas=document.createElement("canvas");
  canvas.width=Math.max(1,Math.round(viewport.width*scale));
  canvas.height=Math.max(1,Math.round(viewport.height*scale));
  const renderViewport=page.getViewport({scale:PAGE_PREVIEW_SCALE*scale});
  await page.render({canvasContext:canvas.getContext("2d"),viewport:renderViewport}).promise;
  return canvas.toDataURL("image/jpeg",.72);
}

async function renderRecipePhotoCrop(pdf,candidate){
  const page=await pdf.getPage(candidate.page);
  const scale=.86;
  const viewport=page.getViewport({scale});
  const full=document.createElement("canvas");
  full.width=Math.round(viewport.width); full.height=Math.round(viewport.height);
  await page.render({canvasContext:full.getContext("2d"),viewport}).promise;

  const W=candidate.pageWidth||page.getViewport({scale:1}).width;
  const H=candidate.pageHeight||page.getViewport({scale:1}).height;
  const title=candidate.titleLine||null;
  const headers=candidate.regions||{};
  let box=null;

  // Template A: title sits in the right column beneath a hero photo (Soul Fuel style).
  if(title && title.x>W*.43){
    const titleTop=H-(title.y+(title.fontSize||18));
    box={x:W*.45,y:0,w:W*.55,h:Math.max(H*.20,Math.min(H*.47,titleTop-8))};
  }
  // Template B: title across the top, ingredients left, directions right/below (Heat & Eat style).
  else if(headers.ingredients && headers.instructions){
    const ix=headers.ingredients.x, dx=headers.instructions.x;
    if(ix<W*.48 && dx>W*.42){
      const top=Math.max(H*.12, H-(title?.y||H*.92)+(title?.fontSize||20)*1.8);
      const directionsTop=H-(headers.instructions.y||H*.36);
      box={x:W*.43,y:top,w:W*.57,h:Math.max(H*.24,directionsTop-top-8)};
    }
  }
  // Generic two-column fallback: keep only the likely hero-photo half, never the full page.
  if(!box){
    const rightHeavy=(candidate.textDensity?.right||0) < (candidate.textDensity?.left||0)*.85;
    box=rightHeavy?{x:W*.48,y:H*.08,w:W*.52,h:H*.46}:{x:0,y:H*.08,w:W,h:H*.34};
  }

  box.x=Math.max(0,Math.min(W-1,box.x)); box.y=Math.max(0,Math.min(H-1,box.y));
  box.w=Math.max(1,Math.min(W-box.x,box.w)); box.h=Math.max(1,Math.min(H-box.y,box.h));
  if(box.w<W*.28||box.h<H*.14)return "";
  const sx=Math.round(box.x*scale), sy=Math.round(box.y*scale), sw=Math.round(box.w*scale), sh=Math.round(box.h*scale);
  const crop=document.createElement("canvas");
  crop.width=Math.min(900,sw); crop.height=Math.max(1,Math.round(sh*(crop.width/sw)));
  crop.getContext("2d").drawImage(full,sx,sy,sw,sh,0,0,crop.width,crop.height);
  return crop.toDataURL("image/jpeg",PHOTO_CROP_QUALITY);
}

async function extractRecipePhoto(pdf,candidate){
  let best=null;
  for(let pageNo=candidate.page;pageNo<=Math.min(candidate.endPage,candidate.page+2);pageNo++){
    const page=await pdf.getPage(pageNo);
    const found=await extractImagesFromPage(page);
    for(const image of found){
      const area=(image.width||0)*(image.height||0);
      const ratio=(image.width||1)/(image.height||1);
      if(area<PHOTO_MIN_AREA||ratio<.45||ratio>2.4)continue;
      if(!best||area>best.area)best={...image,area};
    }
  }
  return best?.dataUrl||"";
}
async function extractImagesFromPage(page){
  const pdfjs=await getPdfJs();
  const ops=await page.getOperatorList();
  const found=[];
  for(let i=0;i<ops.fnArray.length;i++){
    const fn=ops.fnArray[i],args=ops.argsArray[i]||[];
    if(fn===pdfjs.OPS.paintInlineImageXObject&&args[0]){
      const converted=imageObjectToDataUrl(args[0]); if(converted)found.push(converted);
    }
    if(fn===pdfjs.OPS.paintImageXObject&&args[0]){
      const obj=await getPdfObject(page.objs,args[0]);
      const converted=imageObjectToDataUrl(obj); if(converted)found.push(converted);
    }
  }
  return found;
}
function withTimeout(promise,ms,fallback=null){
  return Promise.race([
    Promise.resolve(promise),
    new Promise(resolve=>setTimeout(()=>resolve(fallback),ms))
  ]);
}
function nextFrame(){ return new Promise(resolve=>requestAnimationFrame(()=>resolve())); }
function getPdfObject(store,name){
  return new Promise(resolve=>{
    let settled=false;
    const finish=value=>{if(settled)return;settled=true;clearTimeout(timer);resolve(value||null);};
    const timer=setTimeout(()=>finish(null),PHOTO_OBJECT_TIMEOUT_MS);
    try{
      const immediate=store.get(name,obj=>finish(obj));
      if(immediate)finish(immediate);
    }catch{finish(null);}
  });
}
function imageObjectToDataUrl(obj){
  if(!obj)return null;
  const width=obj.width||obj.naturalWidth||0,height=obj.height||obj.naturalHeight||0;
  if(!width||!height)return null;
  const maxSide=520,scale=Math.min(1,maxSide/Math.max(width,height));
  const canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
  const ctx=canvas.getContext("2d");
  try{
    if(obj.data&&obj.width&&obj.height){
      let data=obj.data;
      if(data.length===width*height*3){const rgba=new Uint8ClampedArray(width*height*4);for(let s=0,d=0;s<data.length;s+=3,d+=4){rgba[d]=data[s];rgba[d+1]=data[s+1];rgba[d+2]=data[s+2];rgba[d+3]=255;}data=rgba;}
      const temp=document.createElement("canvas");temp.width=width;temp.height=height;const tctx=temp.getContext("2d");tctx.putImageData(new ImageData(new Uint8ClampedArray(data),width,height),0,0);ctx.drawImage(temp,0,0,canvas.width,canvas.height);
    }else ctx.drawImage(obj,0,0,canvas.width,canvas.height);
    let dataUrl="";
    for(const quality of [.72,.62,.52,.42]){dataUrl=canvas.toDataURL("image/jpeg",quality);if(dataUrl.length<47000)break;}
    if(dataUrl.length>=50000)return null;
    return {width,height,dataUrl};
  }catch{return null;}
}

function itemsToStructuredLines(items){
  const rows=[];
  for(const item of items){
    const raw=String(item.str||"").replace(/\s+/g," ").trim(); if(!raw)continue;
    const x=item.transform?.[4]||0,y=item.transform?.[5]||0;
    const fontSize=Math.max(Math.abs(item.transform?.[0]||0),Math.abs(item.transform?.[3]||0),item.height||0,1);
    let row=rows.find(a=>Math.abs(a.y-y)<=Math.max(2.5,fontSize*.24));
    if(!row){row={y,items:[]};rows.push(row);}
    row.items.push({x,y,text:raw,fontSize,width:item.width||0,fontName:item.fontName||""});
  }
  const lines=[];
  for(const row of rows.sort((a,b)=>b.y-a.y)){
    const sorted=row.items.sort((a,b)=>a.x-b.x); let segment=[];
    const flush=()=>{
      if(!segment.length)return;
      const text=segment.map(v=>v.text).join(" ").replace(/\s+/g," ").trim();
      const minX=Math.min(...segment.map(v=>v.x||0));
      const maxX=Math.max(...segment.map(v=>(v.x||0)+(v.width||v.text.length*(v.fontSize||10)*.45)));
      lines.push({text,fontSize:Math.max(...segment.map(v=>v.fontSize||0)),x:minX,y:row.y,width:Math.max(1,maxX-minX),fontName:segment.map(v=>v.fontName).find(Boolean)||""});
      segment=[];
    };
    for(const item of sorted){
      const prev=segment[segment.length-1];
      const prevEnd=prev ? prev.x+(prev.width||prev.text.length*(prev.fontSize||10)*.45) : 0;
      const gap=prev ? item.x-prevEnd : 0;
      // Large visual gap means a new column/region, even if PDF extraction order interleaves them.
      if(prev && gap>Math.max(22,(prev.fontSize||10)*1.65))flush();
      segment.push(item);
    }
    flush();
  }
  return lines.filter(line=>line.text).sort((a,b)=>b.y-a.y||a.x-b.x);
}
function itemsToLines(items){return itemsToStructuredLines(items).map(line=>line.text);}
const LINK_NOISE=/\b(click|tap)\s+here\b|video\s+tutorial|shop\s+here|see\s+the\s+.*i\s+use|save\s+digitally|pinterest|www\.|https?:|download|print here/i;
const SECTION_NOISE=/^(ingredients?|directions?|instructions?|method|macros?(?:\s*\(approx\))?|nutrition|yield\/?servings?|serves?|servings?|prep time|cook time|notes?|important info|recipe(?:s)?|breakfast|lunch|dinner|desserts?|sauces?|extras|carbs|protein|veggies|toppings?|frosting|optional|add[- ]?ins?|for serving)$/i;
const YIELD_VALUE_RX=/^(?:(?:yield\/?servings?|serves?|servings?|makes?)\s*:?\s*)?(?:\d+(?:\s*[-–]\s*\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:tenders?|servings?|wraps?|bowls?|pieces?|portions?|cookies?|muffins?|pancakes?|waffles?|sandwiches?|cups?)\s*(?:[|·•-]\s*(?:\d+(?:\s*[-–]\s*\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)\s+servings?)?$/i;
function yieldLike(text){return YIELD_VALUE_RX.test(cleanLine(text));}
function timeLedTitleLike(text){
  const t=cleanLine(text);
  return /^\d{1,3}\s*(?:min(?:ute)?s?|hr|hour)s?\b/i.test(t) && /\b(?:chicken|beef|pork|pasta|rice|potatoes?|fries|oats|toast|wrap|waffle|pancake|bowl|soup|salad|casserole|skillet|cookies?|muffins?|bread)\b/i.test(t);
}
function ingredientLike(line){
  if(timeLedTitleLike(line))return false;
  return /^([¼½¾⅓⅔⅛⅜⅝⅞\d]|one |two |three |four |five |six |a |an )/i.test(line)&&/(cup|tbsp|tbs\b|tablespoon|tsp|teaspoon|ounce|oz\b|pound|lb\b|gram|kg\b|ml\b|clove|can\b|package|block\b|pinch|slice|piece|sprig|bunch|stick|large|medium|small|wrap|egg\b|bread|milk|cheese|chicken|beef|pork|salt|pepper|oil)/i.test(line);
}
function instructionLike(line){return /^(\d+[.)]|step\s+\d+|preheat|heat |stir |mix |add |place |cook |bake |roast |grill |season |combine |whisk |serve |pour |transfer |cover |bring |slice |flatten |set |let |remove |fold |flip |spread |spray |dip |melt )/i.test(line);}
function pageScore(p){
  const t=p.text; let s=0;
  const hasIng=/\bingredients?\b/i.test(t),hasIns=/\b(directions?|instructions?|method)\b/i.test(t);
  if(hasIng)s+=5;if(hasIns)s+=5;if(hasIng&&hasIns)s+=5;
  s+=Math.min(6,p.lines.filter(ingredientLike).length);
  s+=Math.min(5,p.lines.filter(instructionLike).length);
  if(/contents|index|acknowledg|introduction|copyright|cheat\s*sheet|important info/i.test(t))s-=10;
  if(p.lines.length<8)s-=5;
  return s;
}
function detectRecipes(pages){
  const result=[];
  for(const p of pages){
    if(pageScore(p)<9)continue;
    const candidate=buildCandidate({pages:[p],startPage:p.page,endPage:p.page});
    if(candidate.title && candidate.ingredients.length>=1 && candidate.instructions.length>=1)result.push(candidate);
  }
  return result;
}
function titleRejected(line){
  const text=String(line||"").replace(/\s+/g," ").trim();
  const roleText=text.replace(/[\s:;–—-]+$/g,"").trim();
  const ingredientTerms=(text.match(/\b(?:salt|pepper|paprika|garlic powder|onion powder|seasoning|oil|broth|cream|cheese|flour|sugar)\b/gi)||[]).length;
  const ingredientFragment=/[,;:]/.test(text)&&ingredientTerms>=2;
  return !text||text.length<4||text.length>80||SECTION_NOISE.test(roleText)||LINK_NOISE.test(text)||yieldLike(text)||(!timeLedTitleLike(text)&&ingredientLike(text))||ingredientFragment||instructionLike(text)||/^(?:and|or|but|with|from|to|for|until|then|both|into|onto|over|under)\b/i.test(text)||/^(?:page\s*)?\d{1,3}$/i.test(text)||/^(chapter|part|page)\s/i.test(text)||/^(the|a)\s+(basics|collection)$/i.test(text)||!/[A-Za-z]/.test(text);
}
function titleStructurallyRejected(line){
  const text=cleanLine(line);
  const roleText=text.replace(/[\s:;–—-]+$/g,"").trim();
  return !text||text.length<4||text.length>100||SECTION_NOISE.test(roleText)||LINK_NOISE.test(text)||
    yieldLike(text)||/^(?:page\s*)?\d{1,3}$/i.test(text)||/^(chapter|part|page)\s/i.test(text)||
    /^(?:and|or|but|with|from|to|for|until|then|both|into|onto|over|under|continue)\b/i.test(text)||
    /[.!?]$/.test(text)&&text.split(/\s+/).length>7||!/[A-Za-z]/.test(text);
}
function plausibleVisualTitle(line,page,regions){
  const text=cleanLine(line?.text||line);
  if(titleStructurallyRejected(text))return false;
  const words=text.split(/\s+/).filter(Boolean).length;
  if(words<2||words>11)return false;
  // Food words are common in recipe titles. Only treat them as ingredients when
  // the line also looks like an amount/list item or is body-sized text.
  if(ingredientLike(text) && !timeLedTitleLike(text) && (line?.fontSize||0)<20)return false;
  if(instructionLike(text) && (line?.fontSize||0)<20)return false;
  return true;
}

function titleScore(line,page,regions){
  const text=line.text.trim(); let score=0; const words=text.split(/\s+/).length;
  score+=(line.fontSize||0)*2.2;
  if(words>=2&&words<=7)score+=22; else if(words>10)score-=18;
  if(text===text.toUpperCase()&&/[A-Z]/.test(text))score+=18;
  if(/^[A-Z][A-Za-z'’&-]+(?:\s+[A-Z][A-Za-z'’&-]+){1,7}$/.test(text))score+=12;
  if(/[.!?]$/.test(text))score-=18;
  if(/[,;:]/.test(text)&&words>5)score-=28;
  if(/^(?:so|this|another|the best|a great)\b/i.test(text)&&words>5)score-=35;
  if(timeLedTitleLike(text))score+=70;
  if(LINK_NOISE.test(text))score-=100;
  if(yieldLike(text))score-=140;
  const ing=regions?.ingredients,ins=regions?.instructions;
  // Titles commonly live above recipe body or in the opposite column from ingredients.
  if(ing && line.y>ing.y)score+=12;
  if(ing && line.x>page.width*.42 && ing.x<page.width*.4)score+=16;
  if(ins && line.y>ins.y && line.x>page.width*.4)score+=8;
  if(line.y>page.height*.72)score+=8;
  return score;
}
function findRegionHeader(page,kind){
  const rx=kind==="ingredients"?/^ingredients?\s*:?$/i:/^(directions?|instructions?|method)\s*:?$/i;
  return (page.richLines||[]).filter(l=>rx.test(l.text.trim())).sort((a,b)=>(b.fontSize||0)-(a.fontSize||0))[0]||null;
}
function findLikelyYieldLine(page){
  return (page.richLines||[])
    .filter(l=>yieldLike(l.text))
    .sort((a,b)=>(b.fontSize||0)-(a.fontSize||0)||b.y-a.y)[0]||null;
}

function classifyPageLayout(page,regions){
  const W=page.width||600,H=page.height||800;
  const ing=regions?.ingredients,ins=regions?.instructions;
  if(ing&&ins){
    const sameLeft=ing.x<W*.46&&ins.x<W*.46&&Math.abs(ing.x-ins.x)<W*.2;
    if(sameLeft)return "stacked-left-recipe";
    const split=Math.abs(ing.x-ins.x)>W*.22;
    if(split)return "split-columns";
    if(Math.abs(ing.y-ins.y)>H*.18)return "stacked-sections";
  }
  return "adaptive";
}
function anchoredTitleNearYield(page,regions,rich){
  const W=page.width||600,H=page.height||800;
  const yieldLine=findLikelyYieldLine(page);
  if(!yieldLine)return null;
  const yc=(yieldLine.x||0)+(yieldLine.width||0)/2;
  const candidates=rich.filter(line=>{
    const text=cleanLine(line.text);
    const lc=(line.x||0)+(line.width||0)/2;
    const dy=Math.abs((line.y||0)-(yieldLine.y||0));
    const sameRegion=Math.abs(lc-yc)<W*.24;
    const close=dy>2&&dy<H*.19;
    const heading=(line.fontSize||0)>=Math.max(17,(yieldLine.fontSize||10)*1.35);
    const words=text.split(/\s+/).filter(Boolean).length;
    return sameRegion&&close&&heading&&words>=2&&words<=10&&plausibleVisualTitle(line,page,regions);
  });
  if(!candidates.length)return null;
  return candidates.sort((a,b)=>{
    const font=(b.fontSize||0)-(a.fontSize||0);
    if(Math.abs(font)>1)return font;
    const ad=Math.abs(a.y-yieldLine.y),bd=Math.abs(b.y-yieldLine.y);
    if(Math.abs(ad-bd)>3)return ad-bd;
    return titleScore(b,page,regions)-titleScore(a,page,regions);
  })[0];
}
function strongestHeadingInRecipeRegion(page,regions,rich){
  const W=page.width||600,H=page.height||800;
  const layout=classifyPageLayout(page,regions);
  let pool=rich;
  if(layout==="stacked-left-recipe"){
    pool=pool.filter(l=>((l.x||0)+(l.width||0)/2)>W*.47);
  }
  const maxFont=Math.max(0,...pool.map(l=>l.fontSize||0));
  return pool.filter(l=>{
    const text=cleanLine(l.text),words=text.split(/\s+/).filter(Boolean).length;
    return (l.fontSize||0)>=Math.max(17,maxFont*.78)&&words>=2&&words<=10&&text.length<=80&&
      (l.y||0)>H*.18&&(l.y||0)<H*.86&&plausibleVisualTitle(l,page,regions);
  }).sort((a,b)=>titleScore(b,page,regions)-titleScore(a,page,regions))[0]||null;
}

function findTitleLineFromPage(page,regions){
  const rich=(page.richLines||[]).filter(line=>plausibleVisualTitle(line,page,regions));
  if(!rich.length)return null;
  const W=page.width||600,H=page.height||800;
  // Layout Engine 3.0: title extraction is anchored to the visual yield block
  // before any free-form scoring is allowed. This prevents instruction fragments
  // and ingredient subsection labels from ever winning when the real title is
  // visibly paired with servings.
  const anchoredTitle=anchoredTitleNearYield(page,regions,rich);
  if(anchoredTitle)return anchoredTitle;

  // Split-page template used by Soul Fuel and similar digital cookbooks:
  // ingredients + instructions are stacked in the left column, while the hero
  // photo, recipe title, yield and description live in the right column.
  // In this layout, never allow left-column instruction fragments to compete
  // for the title—even when PDF extraction loses the yield anchor.
  const ing=regions?.ingredients, ins=regions?.instructions;
  const stackedLeft=ing&&ins&&ing.x<W*.44&&ins.x<W*.44&&Math.abs(ing.x-ins.x)<W*.22;
  if(stackedLeft){
    const rightHeadings=rich.filter(line=>{
      const center=(line.x||0)+(line.width||0)/2;
      const text=cleanLine(line.text);
      const words=text.split(/\s+/).filter(Boolean).length;
      const inRightColumn=(line.x||0)>W*.43&&center>W*.55;
      const inTitleBand=(line.y||0)>H*.28&&(line.y||0)<H*.68;
      const bodySize=Math.max(11,...(page.richLines||[]).filter(x=>((x.x||0)+(x.width||0)/2)>W*.48).map(x=>x.fontSize||0).filter(v=>v<22));
      const headingSized=(line.fontSize||0)>=Math.max(20,bodySize*1.45);
      const titleLength=words>=2&&words<=10&&text.length<=85;
      return inRightColumn&&inTitleBand&&headingSized&&titleLength&&plausibleVisualTitle(line,page,regions);
    });
    if(rightHeadings.length){
      return rightHeadings.sort((a,b)=>{
        const size=(b.fontSize||0)-(a.fontSize||0);
        if(Math.abs(size)>1)return size;
        return titleScore(b,page,regions)-titleScore(a,page,regions);
      })[0];
    }
  }

  const yieldLine=findLikelyYieldLine(page);
  if(yieldLine){
    // Digital cookbooks usually place the recipe title immediately above the
    // yield/servings block. Anchor the title search to that visual relationship
    // so ingredient fragments can never outrank the real heading.
    const yieldCenter=(yieldLine.x||0)+(yieldLine.width||0)/2;
    const yieldOnRight=yieldCenter>W*.52;
    const anchored=rich.filter(line=>{
      const above=line.y>yieldLine.y+2;
      const close=line.y-yieldLine.y<Math.max(H*.2,150);
      const lineCenter=(line.x||0)+(line.width||0)/2;
      const strictColumn=Math.abs(lineCenter-yieldCenter)<W*.20;
      const correctHalf=!yieldOnRight || lineCenter>W*.46;
      const headingSized=(line.fontSize||0)>=(yieldLine.fontSize||10)*1.25;
      return above&&close&&strictColumn&&correctHalf&&headingSized;
    });
    if(anchored.length){
      return anchored.sort((a,b)=>{
        const scoreDiff=titleScore(b,page,regions)-titleScore(a,page,regions);
        if(Math.abs(scoreDiff)>4)return scoreDiff;
        const ad=Math.abs(a.y-yieldLine.y),bd=Math.abs(b.y-yieldLine.y);
        return ad-bd;
      })[0];
    }
  }
  return strongestHeadingInRecipeRegion(page,regions,rich) || rich.sort((a,b)=>titleScore(b,page,regions)-titleScore(a,page,regions))[0]||null;
}
function cleanLine(text){return String(text||"").replace(/^[-•▪◦]\s*/,"").replace(/\s+/g," ").trim();}
function lineInBox(line,box){return line.x>=box.x-8&&line.x<=box.x+box.w+8&&line.y>=box.y-8&&line.y<=box.y+box.h+8;}
function lineRight(line){return (line.x||0)+(line.width||Math.max(12,line.text.length*(line.fontSize||10)*.42));}
function verticalGap(a,b){return Math.abs((a?.y||0)-(b?.y||0));}
function sameVisualColumn(a,b,W){
  if(!a||!b)return false;
  const ax=(a.x||0), bx=(b.x||0);
  return Math.abs(ax-bx)<Math.max(55,W*.13) || (lineRight(a)>bx-15 && lineRight(b)>ax-15);
}
function buildTitle(page,titleLine,regions){
  if(!titleLine)return `Recipe on page ${page.page}`;
  const W=page.width||600;
  const titleSize=titleLine.fontSize||14;
  const candidates=(page.richLines||[])
    .filter(l=>!SECTION_NOISE.test(cleanLine(l.text))&&!LINK_NOISE.test(l.text))
    .filter(l=>{
      const text=cleanLine(l.text);
      if(!text||ingredientLike(text)||instructionLike(text)||(/^\d+[.)]?\s*/.test(text)&&!timeLedTitleLike(text)))return false;
      const ratio=(l.fontSize||1)/titleSize;
      const sameBand=Math.abs((l.x||0)-(titleLine.x||0))<Math.max(115,W*.22) || sameVisualColumn(l,titleLine,W);
      const compactGap=verticalGap(l,titleLine)<=Math.max(72,titleSize*3.2);
      const titleFont=ratio>.72&&ratio<1.32;
      const quoted=/^["“”'][^"“”']{1,50}["“”']$/.test(text);
      return sameBand&&compactGap&&(titleFont||quoted);
    })
    .sort((a,b)=>b.y-a.y||a.x-b.x);

  // Walk the actual visual title stack. This deliberately merges wrapped title
  // lines such as LOW CARB CHEESY + “WAFFLE”, while stopping before yield or body copy.
  const startIndex=Math.max(0,candidates.indexOf(titleLine));
  const stack=[titleLine];
  let previous=titleLine;
  for(let i=startIndex+1;i<candidates.length;i++){
    const line=candidates[i];
    const text=cleanLine(line.text);
    const gap=verticalGap(line,previous);
    const ratio=(line.fontSize||1)/titleSize;
    const aligned=Math.abs((line.x||0)-(titleLine.x||0))<Math.max(120,W*.23) || sameVisualColumn(line,titleLine,W);
    const short=text.length<=55&&text.split(/\s+/).length<=8;
    const quoted=/^["“”'][^"“”']{1,50}["“”']$/.test(text);
    if(gap>Math.max(38,titleSize*1.8)||!aligned||(!quoted&&!(short&&ratio>.72&&ratio<1.32)))break;
    stack.push(line); previous=line;
  }
  // A continuation can occasionally sort immediately before the selected line.
  for(let i=startIndex-1;i>=0;i--){
    const line=candidates[i],text=cleanLine(line.text);
    const gap=verticalGap(line,stack[0]);
    const ratio=(line.fontSize||1)/titleSize;
    if(gap<=Math.max(38,titleSize*1.8)&&ratio>.72&&ratio<1.32&&text.length<=55)stack.unshift(line);else break;
  }
  const title=[...new Set(stack)]
    .sort((a,b)=>b.y-a.y||a.x-b.x)
    .map(l=>cleanLine(l.text).replace(/^['"“”]+|['"“”]+$/g,''))
    .join(' ').replace(/\s+/g,' ').trim();
  return titleRejected(title)?cleanLine(titleLine.text):title;
}
function linesInHeaderColumn(lines,header,W){
  if(!header)return [];
  const left=Math.max(0,(header.x||0)-Math.max(32,W*.055));
  const right=Math.min(W,lineRight(header)+Math.max(120,W*.35));
  return lines.filter(l=>lineRight(l)>=left&&l.x<=right);
}
function mergeIngredientLines(lines){
  const sorted=[...lines].sort((a,b)=>b.y-a.y||a.x-b.x);
  const out=[];
  const startsIngredientNote=t=>/^(?:toppings?|fillings?|optional(?:ly)?|for serving|to serve|garnish|add[- ]ins?|mix[- ]ins?|cream cheese frosting|sauce|drizzle)\s*:/i.test(t);
  for(const l of sorted){
    const t=cleanLine(l.text); if(!t)continue;
    const prev=out[out.length-1];
    const explicitBullet=/^[-•▪◦]/.test(String(l.text||''));
    const startsNew=ingredientLike(t)||explicitBullet||startsIngredientNote(t);
    const continuation=prev && !startsNew && verticalGap(l,prev._line)<Math.max(18,(l.fontSize||10)*1.55);
    if(continuation && prev.text.length+t.length<220){
      prev.text+=' '+t;
      // Compare the next wrapped line with the most recently merged line, not
      // the first line in the item. This prevents one visual ingredient from
      // becoming several bullets simply because it wraps across 3+ lines.
      prev._line=l;
    }else out.push({text:t,_line:l});
  }
  return out.map(x=>x.text.replace(/\s+/g,' ').trim());
}
function mergeInstructionLines(lines,W=600){
  const cleaned=[...lines]
    .map(l=>({...l,text:cleanLine(l.text)}))
    .filter(l=>l.text&&!LINK_NOISE.test(l.text)&&!yieldLike(l.text));

  // Many designed PDFs store the step number and its sentence as separate text
  // objects. Reconstruct from numbered anchors first so visual lines do not get
  // renumbered individually or interleaved with the description block.
  const anchors=[];
  const content=[];
  for(const l of cleaned){
    const only=l.text.match(/^(\d{1,2})[.)]?$/);
    const inline=l.text.match(/^(\d{1,2})[.)]\s*(.+)$/);
    if(only)anchors.push({...l,n:Number(only[1]),seed:''});
    else if(inline)anchors.push({...l,n:Number(inline[1]),seed:inline[2]});
    else content.push(l);
  }

  if(anchors.length>=2){
    const ordered=anchors.sort((a,b)=>b.y-a.y||a.x-b.x);
    const used=new Set();
    const result=[];
    for(let i=0;i<ordered.length;i++){
      const a=ordered[i], next=ordered[i+1];
      const top=a.y+Math.max(10,(a.fontSize||10)*.9);
      const bottom=next ? next.y+Math.max(2,(next.fontSize||10)*.15) : -Infinity;
      const band=content.filter((l,idx)=>{
        if(used.has(idx))return false;
        const sameSection=l.y<=top&&l.y>bottom;
        const toRight=l.x>=a.x-8;
        const notFar=Math.abs(l.x-a.x)<Math.max(150,W*.24);
        const sameColumn=sameVisualColumn(l,a,W);
        const anchorOnLeft=(a.x||0)<W*.45;
        const contentCenter=(l.x||0)+(l.width||0)/2;
        const staysInSection=!anchorOnLeft || contentCenter<W*.49;
        return sameSection&&toRight&&notFar&&sameColumn&&staysInSection;
      }).sort((x,y)=>y.y-x.y||x.x-y.x);
      const parts=[];
      if(a.seed)parts.push(a.seed);
      for(const l of band){
        const idx=content.indexOf(l); if(idx>=0)used.add(idx);
        const t=l.text;
        // Descriptions are declarative prose and can visually overlap the steps
        // in exported PDFs. Keep imperative cooking text, drop obvious blurbs.
        if(/^(?:so quick|another |the best |a great |this (?:recipe|chicken|dish)|not really a recipe)/i.test(t) && !instructionLike(t))continue;
        parts.push(t);
      }
      const text=parts.join(' ').replace(/\s+/g,' ').trim();
      if(text)result.push({n:a.n,text});
    }
    if(result.length>=2){
      return result
        .sort((a,b)=>a.n-b.n)
        .filter((s,i,arr)=>i===0||s.n!==arr[i-1].n)
        .map(s=>`${s.n}. ${s.text}`);
    }
  }

  // Fallback for PDFs that keep each numbered step in one text object.
  const sorted=cleaned.sort((a,b)=>b.y-a.y||a.x-b.x);
  const steps=[]; let current=null;
  for(const l of sorted){
    const t=l.text;
    const numbered=t.match(/^(\d{1,2})[.)]\s*(.*)$/);
    if(numbered){
      if(current)steps.push(current);
      current={n:Number(numbered[1]),text:numbered[2],line:l};
      continue;
    }
    if(!current){
      if(instructionLike(t))current={n:steps.length+1,text:t,line:l};
      continue;
    }
    const close=verticalGap(l,current.line)<Math.max(26,(l.fontSize||10)*2.15);
    const aligned=sameVisualColumn(l,current.line,W);
    if(aligned&&close){current.text=(current.text+' '+t).replace(/\s+/g,' ').trim();current.line=l;}
    else if(instructionLike(t)){steps.push(current);current={n:steps.length+1,text:t,line:l};}
  }
  if(current)steps.push(current);
  return steps.map((s,i)=>`${s.n||i+1}. ${s.text}`.trim());
}

function mergeProseLines(lines,W=600){
  const sorted=[...lines]
    .map(l=>({...l,text:cleanLine(l.text)}))
    .filter(l=>l.text&&!SECTION_NOISE.test(l.text)&&!LINK_NOISE.test(l.text)&&!yieldLike(l.text))
    .sort((a,b)=>b.y-a.y||a.x-b.x);
  const paragraphs=[];
  let current=null;
  for(const line of sorted){
    const t=line.text;
    if(!t||ingredientLike(t)||instructionLike(t)||/^\d+[.)]?\s*/.test(t))continue;
    if(!current){current={text:t,line};continue;}
    const close=verticalGap(line,current.line)<Math.max(30,(line.fontSize||10)*2.3);
    const aligned=sameVisualColumn(line,current.line,W);
    if(close&&aligned&&current.text.length+t.length<520){current.text+=' '+t;current.line=line;}
    else{paragraphs.push(current.text.replace(/\s+/g,' ').trim());current={text:t,line};}
  }
  if(current)paragraphs.push(current.text.replace(/\s+/g,' ').trim());
  return paragraphs.filter(Boolean);
}
function findYieldAndDescription(page,lines,titleLine,title,regions){
  if(!titleLine)return {yieldText:'',description:'',descriptionLines:[]};
  const W=page.width||600,H=page.height||800;
  const titleNorm=normalize(title);
  const stackedLeft=regions?.ingredients&&regions?.instructions&&regions.ingredients.x<W*.46&&regions.instructions.x<W*.46;
  const titleCenter=(titleLine.x||0)+(titleLine.width||0)/2;
  const titleColumn=lines.filter(l=>{
    const center=(l.x||0)+(l.width||0)/2;
    if(stackedLeft)return center>W*.47;
    return sameVisualColumn(l,titleLine,W)||Math.abs(center-titleCenter)<W*.24;
  });
  const belowTitle=titleColumn.filter(l=>l.y<titleLine.y-2&&l.y>titleLine.y-H*.42);
  const globalYield=findLikelyYieldLine(page);
  const yieldLine=(globalYield&&globalYield.y<titleLine.y&&sameVisualColumn(globalYield,titleLine,W))?globalYield:
    belowTitle.filter(l=>yieldLike(l.text)).sort((a,b)=>b.y-a.y||Math.abs(a.x-titleLine.x)-Math.abs(b.x-titleLine.x))[0]||null;
  const upperBound=yieldLine?yieldLine.y:titleLine.y;
  const descriptionLines=belowTitle.filter(l=>{
    const t=cleanLine(l.text);
    if(!t||l===yieldLine||normalize(t)===titleNorm)return false;
    if(l.y>=upperBound+3)return false;
    if(SECTION_NOISE.test(t)||LINK_NOISE.test(t)||yieldLike(t)||instructionLike(t)||/^\d+[.)]?\s*/.test(t))return false;
    if(regions.ingredients&&sameVisualColumn(l,regions.ingredients,W)&&l.y<regions.ingredients.y)return false;
    if(regions.instructions&&sameVisualColumn(l,regions.instructions,W)&&l.y<regions.instructions.y)return false;
    return t.length>2;
  });
  const paragraphs=mergeProseLines(descriptionLines,W);
  const description=paragraphs
    .filter(t=>t.split(/\s+/).length>=4)
    .join(' ')
    .replace(/\s+/g,' ')
    .trim();
  return {yieldText:yieldLine?cleanLine(yieldLine.text):'',description,descriptionLines};
}

function buildCandidate(group){
  const page=group.pages[0], W=page.width||600,H=page.height||800;
  const ingredientsHeader=findRegionHeader(page,"ingredients");
  const instructionsHeader=findRegionHeader(page,"instructions");
  const regions={ingredients:ingredientsHeader,instructions:instructionsHeader};
  const titleLine=findTitleLineFromPage(page,regions);
  const title=buildTitle(page,titleLine,regions);
  const lines=(page.richLines||[]).filter(l=>l!==titleLine&&!SECTION_NOISE.test(l.text)&&!LINK_NOISE.test(l.text)&&cleanLine(l.text)!==title);
  const meta=findYieldAndDescription(page,lines,titleLine,title,regions);
  const descriptionSet=new Set(meta.descriptionLines);
  let ingredientLines=[],instructionLines=[];

  if(ingredientsHeader && instructionsHeader){
    const sameColumn=Math.abs(ingredientsHeader.x-instructionsHeader.x)<W*.22;
    if(sameColumn){
      // Stacked recipe template: both sections share one column. Stay strictly inside that column.
      const leftLayout=ingredientsHeader.x<W*.46 && instructionsHeader.x<W*.46;
      const column=linesInHeaderColumn(lines,ingredientsHeader,W).filter(l=>{
        if(!leftLayout)return true;
        const center=(l.x||0)+(l.width||0)/2;
        return center<W*.48 && (l.x||0)<W*.43;
      });
      ingredientLines=column.filter(l=>l.y<ingredientsHeader.y-3 && l.y>instructionsHeader.y+8);
      instructionLines=column.filter(l=>l.y<instructionsHeader.y-3);
    }else{
      // Side-by-side template: constrain each section to its own visual column instead of using all page text.
      const ingColumn=linesInHeaderColumn(lines,ingredientsHeader,W);
      const insColumn=linesInHeaderColumn(lines,instructionsHeader,W);
      ingredientLines=ingColumn.filter(l=>l.y<ingredientsHeader.y-3);
      instructionLines=insColumn.filter(l=>l.y<instructionsHeader.y-3);
    }
  }
  if(!ingredientLines.length)ingredientLines=lines.filter(l=>ingredientLike(l.text));
  if(!instructionLines.length)instructionLines=lines.filter(l=>instructionLike(l.text)||/^\d+[.)]?\s*/.test(l.text));

  let ingredients=mergeIngredientLines(ingredientLines)
    .filter(t=>t&&normalize(t)!==normalize(title)&&!SECTION_NOISE.test(t)&&!LINK_NOISE.test(t))
    .slice(0,80);
  const titleParts=new Set(normalize(title).split(/\s+/).filter(Boolean));
  const titleish=t=>{const words=normalize(t).split(/\s+/).filter(Boolean);return words.length>1&&words.every(w=>titleParts.has(w));};
  instructionLines=instructionLines.filter(l=>!yieldLike(l.text)&&!titleish(l.text)&&!descriptionSet.has(l));
  let instructions=mergeInstructionLines(instructionLines,W)
    .filter(t=>t&&!LINK_NOISE.test(t)&&!ingredientLike(t.replace(/^\d+[.)]\s*/,'')))
    .slice(0,60);

  // Keep prose descriptions out of directions. A valid directions list should be step-like and ordered.
  instructions=instructions.filter((t,i)=>i===0||/^\d+[.)]\s+/.test(t));
  const leftDensity=lines.filter(l=>l.x<W/2).reduce((n,l)=>n+l.text.length,0),rightDensity=lines.filter(l=>l.x>=W/2).reduce((n,l)=>n+l.text.length,0);
  const warnings=[];
  const headerCount=(page.richLines||[]).filter(l=>/^(ingredients?|directions?|instructions?|method)\s*:?$/i.test(cleanLine(l.text))).length;
  if(headerCount>2)warnings.push("Multiple recipe regions detected on this page; review this card carefully.");
  if(titleRejected(title)||ingredientLike(title))warnings.push("Low-confidence title detected.");
  const titleCandidates=(page.richLines||[]).filter(l=>plausibleVisualTitle(l,page,regions)).map(l=>({text:cleanLine(l.text),fontSize:l.fontSize,x:l.x,y:l.y,width:l.width,score:Math.round(titleScore(l,page,regions))})).sort((a,b)=>b.score-a.score).slice(0,20);
  return {include:true,title:smartTitleCase(title),titleLine,yieldText:meta.yieldText,description:meta.description,links:recipeVideoLinks(group.pages),regions,textDensity:{left:leftDensity,right:rightDensity},pageWidth:W,pageHeight:H,page:group.startPage,endPage:group.endPage,ingredients,instructions,protein:"",type:"",cuisine:"",warnings,layoutProfile:classifyPageLayout(page,regions),engineVersion:COOKBOOK_ENGINE_VERSION,pages:group.pages,rawLines:page.richLines||[],titleCandidates};
}
function guessBookTitle(pages,fileName){const first=pages.slice(0,4).flatMap(p=>p.lines).find(x=>x.length>5&&x.length<90&&!/copyright|contents|www\.|isbn/i.test(x));return first||fileName.replace(/\.pdf$/i,"").replace(/[_-]+/g," ");}
function showReview(){
  $("analyzePanel").hidden=true;$("reviewPanel").hidden=false;$("importHeading").textContent="Review cookbook";$("cookbookTitle").value=importState.title;$("cookbookAuthor").value=importState.author;$("cookbookCollection").value=importState.title;$("coverPreview").innerHTML=importState.cover?`<img src="${importState.cover}" alt="Cookbook cover preview">`:`<div class="cover-placeholder">📖</div>`;renderReview();
}
function renderReview(){
  const selected=importState.candidates.filter(x=>x.include).length;$('reviewSummary').textContent=`${importState.candidates.length} possible recipes found · ${selected} selected`;
  $('recipeReviewList').innerHTML=importState.candidates.map((r,i)=>`<article class="recipe-review-card ${r.include?'':'excluded'}"><div class="recipe-review-layout"><div class="recipe-photo-review">${r.image?`<img src="${r.image}" alt="${r.imageKind==='photo-crop'?'Cropped cookbook food photo':'Extracted cookbook photo'}">`:`<div class="cookbook-photo-placeholder">No image found</div>`}${r.image?`<div class="photo-source-label">${r.imageKind==='photo-crop'?'Cropped recipe photo':'Recipe photo'}</div><label class="review-check photo-toggle"><input type="checkbox" data-review-image="${i}" ${r.useImage!==false?'checked':''}><span>Use this image</span></label>`:''}</div><div class="recipe-review-content"><div class="recipe-review-head"><label class="review-check"><input type="checkbox" data-review-include="${i}" ${r.include?'checked':''}><span>Import</span></label><span class="page-badge">Page ${r.page}${r.endPage!==r.page?`–${r.endPage}`:''} · ${escapeHTML(r.layoutProfile||"adaptive")}</span></div><label class="field">Recipe title<input data-review-title="${i}" value="${escapeHTML(r.title)}"></label><div class="parser-source-row"><span class="parser-source-badge">Title: ${escapeHTML(r.titleSource||"visual fallback")} · ${Number(r.titleConfidence||0)}%</span><button type="button" class="secondary compact-button" data-parser-report="${i}">Download parser report</button></div><details class="parser-debug"><summary>🐞 Debug parser</summary><pre>${escapeHTML(JSON.stringify(r.debugReport||{},null,2))}</pre></details><div class="review-meta-grid"><label class="field">Yield / servings<input data-review-yield="${i}" value="${escapeHTML(r.yieldText||'')}"></label><label class="field">Description<textarea rows="3" data-review-description="${i}">${escapeHTML(r.description||'')}</textarea></label></div><label class="field">Video / tutorial links<textarea rows="2" data-review-links="${i}" placeholder="One link per line">${escapeHTML((r.links||[]).join('\n'))}</textarea></label>${(r.warnings||[]).length?`<div class="parser-warning">${(r.warnings||[]).map(w=>`⚠ ${escapeHTML(w)}`).join("<br>")}</div>`:""}<details><summary>Review ingredients & instructions</summary><div class="review-columns"><label class="field">Ingredients<textarea rows="10" data-review-ingredients="${i}">${escapeHTML(r.ingredients.map(item=>`• ${item}`).join('\n'))}</textarea></label><label class="field">Instructions<textarea rows="10" data-review-instructions="${i}">${escapeHTML(r.instructions.join('\n'))}</textarea></label></div></details></div></div></article>`).join('');
}
function syncReviewFields(){importState.candidates.forEach((r,i)=>{r.include=document.querySelector(`[data-review-include="${i}"]`)?.checked??r.include;r.useImage=document.querySelector(`[data-review-image="${i}"]`)?.checked??r.useImage;r.title=smartTitleCase(document.querySelector(`[data-review-title="${i}"]`)?.value.trim()||r.title);r.yieldText=document.querySelector(`[data-review-yield="${i}"]`)?.value.trim()||'';r.description=document.querySelector(`[data-review-description="${i}"]`)?.value.trim()||'';r.links=splitLinks(document.querySelector(`[data-review-links="${i}"]`)?.value||(r.links||[]).join('\n'));r.ingredients=splitList(document.querySelector(`[data-review-ingredients="${i}"]`)?.value||r.ingredients.join('\n'));r.instructions=splitList(document.querySelector(`[data-review-instructions="${i}"]`)?.value||r.instructions.join('\n'));});}
async function postVault(payload){if(!config.appsScriptUrl||!config.sharedKey)throw new Error("Open Recipe Vault settings and enter the Apps Script URL and family write key first.");const body=new URLSearchParams();body.set("payload",JSON.stringify({...payload,key:config.sharedKey}));const response=await fetch(config.appsScriptUrl,{method:"POST",body,redirect:"follow"});const result=await response.json();if(!result.success)throw new Error(result.error||"Request failed");return result;}
async function importSelected(){
  syncReviewFields(); const selected=importState.candidates.filter(r=>r.include); if(!selected.length)return alert("Select at least one recipe.");
  const title=$("cookbookTitle").value.trim()||importState.title,author=$("cookbookAuthor").value.trim(),collection=$("cookbookCollection").value.trim()||title,id=makeId(); let imported=0,skipped=0,failed=0;
  const btn=$("importCookbookRecipes");btn.disabled=true;
  for(let i=0;i<selected.length;i++){const r=selected[i];btn.textContent=`Importing ${i+1} of ${selected.length}…`;const recipe={name:smartTitleCase(r.title),url:"",source:`Cookbook: ${title} · p. ${r.page}`,image:r.useImage?r.image||"":"",protein:r.protein,type:r.type,cuisine:r.cuisine,tags:`Cookbook|${title}|Page ${r.page}`,collections:collection,prep_time:"",cook_time:"",total_time:"",ingredients:r.ingredients,instructions:r.instructions,nutrition:"",kirsta_rating:"",tj_rating:"",torrin_rating:"",torrin_notes:"",description:r.description||"",yield:r.yieldText||"",video_url:(r.links||[])[0]||"",recipe_links:r.links||[],notes:[r.description,`Yield: ${r.yieldText||""}`,(r.links||[]).length?`Video / tutorial links:\n${r.links.join("\n")}`:"",`Imported from ${title}${author?` by ${author}`:""}, page ${r.page}.`].filter(Boolean).join("\n\n"),made_count:0,hidden:false,added:new Date().toISOString().slice(0,10),last_made:"",pdf_url:"",cookbook_id:id,cookbook_title:title,cookbook_page:r.page};
    try{const res=await postVault({action:"addManual",recipe,duplicateAction:"skip"});if(res.action==="duplicate")skipped++;else imported++;}catch(e){failed++;r.warnings.push(e.message);}
  }
  library.unshift({id,title,author,collection,cover:importState.cover,pageCount:importState.pageCount,importedCount:imported,addedAt:new Date().toISOString(),fileName:importState.fileName});saveLibrary();btn.disabled=false;btn.textContent="Import selected";
  $("reviewPanel").hidden=true;$("importResults").hidden=false;$("importResults").innerHTML=`<div class="success-panel"><div class="success-icon">✓</div><h2>${escapeHTML(title)} is on your shelf</h2><p>${imported} recipes imported${skipped?`, ${skipped} duplicates skipped`:""}${failed?`, ${failed} failed`:""}.</p><div class="actions"><button id="browseImported" class="primary">Browse cookbook</button><a class="secondary linkbtn" href="index.html">Return to Recipe Vault</a></div></div>`;$("browseImported").onclick=()=>{loadRecipes().then(()=>openCookbook(id));};
}
async function deleteCookbook(removeRecipes){
  const cb=library.find(x=>x.id===deleteTargetId);if(!cb)return; let deletionFailed=false;
  if(removeRecipes){const matches=recipes.filter(r=>cookbookRecipeMatches(r,cb));for(const recipe of matches){try{await postVault({action:"delete",id:recipe.id,url:recipe.url});}catch{deletionFailed=true;break;}}}
  library=library.filter(x=>x.id!==cb.id);saveLibrary();$("deleteCookbookDialog").close();renderShelf();if(deletionFailed)alert("The cookbook was removed from the shelf, but your Apps Script does not appear to support permanent recipe deletion. Its recipes were left in the vault.");
}

document.addEventListener("click",e=>{const report=e.target.closest("[data-parser-report]");if(report){downloadParserReport(Number(report.dataset.parserReport));return;}const open=e.target.closest("[data-open-cookbook]");if(open&&!e.target.closest("[data-delete-cookbook]")){openCookbook(open.dataset.openCookbook);return;}const del=e.target.closest("[data-delete-cookbook]");if(del){e.stopPropagation();deleteTargetId=del.dataset.deleteCookbook;const cb=library.find(x=>x.id===deleteTargetId);$("deleteCookbookMessage").textContent=`Choose what should happen to ${cb?.title||"this cookbook"}.`;$("deleteCookbookDialog").showModal();}});
$("uploadCookbookBtn").onclick=showImport;$("emptyUploadBtn").onclick=showImport;$("cancelImport").onclick=cancelImport;$("choosePdfBtn").onclick=()=>$("cookbookFile").click();$("cookbookFile").onchange=e=>e.target.files?.[0]&&analyzePdf(e.target.files[0]);
const drop=$("choosePdfPanel");["dragenter","dragover"].forEach(t=>drop.addEventListener(t,e=>{e.preventDefault();drop.classList.add("dragging")}));["dragleave","drop"].forEach(t=>drop.addEventListener(t,e=>{e.preventDefault();drop.classList.remove("dragging")}));drop.addEventListener("drop",e=>e.dataTransfer.files?.[0]&&analyzePdf(e.dataTransfer.files[0]));
$("selectAllRecipes").onclick=()=>{syncReviewFields();importState.candidates.forEach(r=>r.include=true);renderReview();};$("selectNoneRecipes").onclick=()=>{syncReviewFields();importState.candidates.forEach(r=>r.include=false);renderReview();};$("recipeReviewList").addEventListener("change",e=>{if(e.target.matches("[data-review-include]")){syncReviewFields();renderReview();}});$("importCookbookRecipes").onclick=importSelected;
$("cookbookSearch").oninput=renderShelf;$("cookbookRecipeSearch").oninput=renderCookbookRecipes;$("backToShelf").onclick=()=>{$("cookbookDetailView").hidden=true;$("libraryView").hidden=false;renderShelf();};
$("closeDeleteCookbook").onclick=()=>$("deleteCookbookDialog").close();$("cancelDeleteCookbook").onclick=()=>$("deleteCookbookDialog").close();$("removeCookbookOnly").onclick=()=>deleteCookbook(false);$("removeCookbookAndRecipes").onclick=()=>deleteCookbook(true);
loadRecipes();
