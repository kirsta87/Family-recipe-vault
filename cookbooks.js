const $ = id => document.getElementById(id);
const SETTINGS_KEY = "recipeVaultSettingsV031";
const LIBRARY_KEY = "recipeVaultCookbookLibraryV150";
const COOKBOOK_ENGINE_VERSION = "1.6.0";
const PHOTO_MIN_AREA = 42000;
const PHOTO_RECIPE_TIMEOUT_MS = 2500;
const PAGE_PREVIEW_SCALE = 1.25;
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
function splitList(value){ return String(value||"").split(/\r?\n/).map(v=>v.trim()).filter(Boolean); }

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
async function analyzePdf(file){
  $("choosePdfPanel").hidden=true;$("analyzePanel").hidden=false;$("importHeading").textContent="Analyzing cookbook";
  try{
    const pdfjs=await getPdfJs(); const buffer=await file.arrayBuffer(); const pdf=await pdfjs.getDocument({data:buffer}).promise;
    const pages=[]; let cover="";
    for(let pageNo=1;pageNo<=pdf.numPages;pageNo++){
      $("analyzeStatus").textContent=`Reading page ${pageNo} of ${pdf.numPages}`;$("analyzeCurrent").textContent="Looking for titles, ingredient lists, and cooking steps…";$("analyzeProgress").value=Math.round(pageNo/pdf.numPages*85);
      const page=await pdf.getPage(pageNo); const content=await page.getTextContent();
      const richLines=itemsToStructuredLines(content.items);
      const lines=richLines.map(line=>line.text);
      const baseViewport=page.getViewport({scale:1});
      pages.push({page:pageNo,lines,richLines,text:lines.join("\n"),width:baseViewport.width,height:baseViewport.height});
      if(pageNo===1){const viewport=page.getViewport({scale:.45});const canvas=document.createElement("canvas");canvas.width=viewport.width;canvas.height=viewport.height;await page.render({canvasContext:canvas.getContext("2d"),viewport}).promise;cover=canvas.toDataURL("image/jpeg",.7);}
    }
    $("analyzeStatus").textContent="Separating recipes from the rest of the book…";$("analyzeProgress").value=92;
    const candidates=detectRecipes(pages);
    $("analyzeStatus").textContent="Matching cookbook photos to recipes…";
    for(let i=0;i<candidates.length;i++){
      const candidate=candidates[i];
      $("analyzeCurrent").textContent=`Checking photos for ${candidate.title}`;
      $("analyzeProgress").value=92+Math.round(((i+1)/Math.max(1,candidates.length))*8);
      candidate.image=await withTimeout(
        extractRecipePhoto(pdf,candidate),
        PHOTO_RECIPE_TIMEOUT_MS,
        ""
      ).catch(()=>"");
      candidate.imageKind=candidate.image?"photo":"";
      if(!candidate.image){
        $("analyzeCurrent").textContent=`No separate image object found for ${candidate.title} — creating a page preview…`;
        candidate.image=await withTimeout(renderRecipePhotoCrop(pdf,candidate),2200,"").catch(()=>"");
        candidate.imageKind=candidate.image?"photo-crop":"";
      }
      candidate.useImage=Boolean(candidate.image);
      await nextFrame();
    }
    importState={fileName:file.name,pageCount:pdf.numPages,cover,candidates,title:guessBookTitle(pages,file.name),author:""};
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
  const scale=1.65;
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
      if(prev && gap>Math.max(34,(prev.fontSize||10)*3.1))flush();
      segment.push(item);
    }
    flush();
  }
  return lines.filter(line=>line.text).sort((a,b)=>b.y-a.y||a.x-b.x);
}
function itemsToLines(items){return itemsToStructuredLines(items).map(line=>line.text);}
const LINK_NOISE=/\b(click|tap)\s+here\b|video\s+tutorial|shop\s+here|see\s+the\s+.*i\s+use|save\s+digitally|pinterest|www\.|https?:|download|print here/i;
const SECTION_NOISE=/^(ingredients?|directions?|instructions?|method|macros?(?:\s*\(approx\))?|nutrition|yield\/?servings?|serves?|servings?|prep time|cook time|notes?|important info|recipe(?:s)?|breakfast|lunch|dinner|desserts?|sauces?|extras|carbs|protein|veggies)$/i;
function ingredientLike(line){return /^([¼½¾⅓⅔⅛⅜⅝⅞\d]|one |two |three |four |five |six |a |an )/i.test(line)&&/(cup|tbsp|tbs\b|tablespoon|tsp|teaspoon|ounce|oz\b|pound|lb\b|gram|kg\b|ml\b|clove|can\b|package|block\b|pinch|slice|piece|sprig|bunch|stick|large|medium|small|wrap|egg\b|bread|milk|cheese|chicken|beef|pork|salt|pepper|oil)/i.test(line);}
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
  return !text||text.length<4||text.length>80||SECTION_NOISE.test(text)||LINK_NOISE.test(text)||ingredientLike(text)||instructionLike(text)||/^([¼½¾⅓⅔⅛⅜⅝⅞\d]+|one|two|three|four|five|six)\b/i.test(text)||/^(chapter|part|page)\s/i.test(text)||/^(the|a)\s+(basics|collection)$/i.test(text)||!/[A-Za-z]/.test(text);
}
function titleScore(line,page,regions){
  const text=line.text.trim(); let score=0; const words=text.split(/\s+/).length;
  score+=(line.fontSize||0)*2.2;
  if(words>=2&&words<=7)score+=22; else if(words>10)score-=18;
  if(text===text.toUpperCase()&&/[A-Z]/.test(text))score+=18;
  if(/^[A-Z][A-Za-z'’&-]+(?:\s+[A-Z][A-Za-z'’&-]+){1,7}$/.test(text))score+=12;
  if(/[.!?]$/.test(text))score-=12;
  if(LINK_NOISE.test(text))score-=100;
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
function findTitleLineFromPage(page,regions){
  const rich=(page.richLines||[]).filter(line=>!titleRejected(line.text)); if(!rich.length)return null;
  return rich.sort((a,b)=>titleScore(b,page,regions)-titleScore(a,page,regions))[0]||null;
}
function cleanLine(text){return String(text||"").replace(/^[-•▪◦]\s*/,"").replace(/\s+/g," ").trim();}
function lineInBox(line,box){return line.x>=box.x-8&&line.x<=box.x+box.w+8&&line.y>=box.y-8&&line.y<=box.y+box.h+8;}
function buildCandidate(group){
  const page=group.pages[0], W=page.width||600,H=page.height||800;
  const ingredientsHeader=findRegionHeader(page,"ingredients");
  const instructionsHeader=findRegionHeader(page,"instructions");
  const regions={ingredients:ingredientsHeader,instructions:instructionsHeader};
  const titleLine=findTitleLineFromPage(page,regions);
  const title=titleLine?.text||`Recipe on page ${group.startPage}`;
  const lines=(page.richLines||[]).filter(l=>l!==titleLine&&!SECTION_NOISE.test(l.text)&&!LINK_NOISE.test(l.text));
  let ingredientLines=[],instructionLines=[];

  if(ingredientsHeader && instructionsHeader){
    const sameColumn=Math.abs(ingredientsHeader.x-instructionsHeader.x)<W*.18;
    if(sameColumn){
      // Stacked left-column headings (Soul Fuel): ingredients above instructions.
      ingredientLines=lines.filter(l=>l.x<W*.48 && l.y<ingredientsHeader.y && l.y>instructionsHeader.y+8);
      instructionLines=lines.filter(l=>l.x<W*.52 && l.y<instructionsHeader.y);
    }else{
      // Side-by-side / mixed columns (Heat & Eat): use each heading's visual column.
      const split=(ingredientsHeader.x+instructionsHeader.x)/2;
      ingredientLines=lines.filter(l=>l.x<split && l.y<ingredientsHeader.y+8);
      instructionLines=lines.filter(l=>l.x>=split-12 && l.y<instructionsHeader.y+10);
    }
  }
  // Semantic fallback when headings are decorative or absent from the text layer.
  if(!ingredientLines.length)ingredientLines=lines.filter(l=>ingredientLike(l.text));
  if(!instructionLines.length)instructionLines=lines.filter(l=>instructionLike(l.text)||(/^\d+[.)]?\s*/.test(l.text)&&l.text.length>12));

  const ingredients=[...new Set(ingredientLines.map(l=>cleanLine(l.text)).filter(t=>t&&t!==title&&!SECTION_NOISE.test(t)&&!LINK_NOISE.test(t)&&(ingredientLike(t)||t.length<95)))].slice(0,80);
  const instructions=[...new Set(instructionLines.map(l=>cleanLine(l.text)).filter(t=>t&&t!==title&&!SECTION_NOISE.test(t)&&!LINK_NOISE.test(t)&&!ingredientLike(t)&&t.length>8))].slice(0,60);
  const leftDensity=lines.filter(l=>l.x<W/2).reduce((n,l)=>n+l.text.length,0),rightDensity=lines.filter(l=>l.x>=W/2).reduce((n,l)=>n+l.text.length,0);
  return {include:true,title,titleLine,regions,textDensity:{left:leftDensity,right:rightDensity},pageWidth:W,pageHeight:H,page:group.startPage,endPage:group.endPage,ingredients,instructions,protein:"",type:"",cuisine:"",warnings:[],engineVersion:COOKBOOK_ENGINE_VERSION};
}
function guessBookTitle(pages,fileName){const first=pages.slice(0,4).flatMap(p=>p.lines).find(x=>x.length>5&&x.length<90&&!/copyright|contents|www\.|isbn/i.test(x));return first||fileName.replace(/\.pdf$/i,"").replace(/[_-]+/g," ");}
function showReview(){
  $("analyzePanel").hidden=true;$("reviewPanel").hidden=false;$("importHeading").textContent="Review cookbook";$("cookbookTitle").value=importState.title;$("cookbookAuthor").value=importState.author;$("cookbookCollection").value=importState.title;$("coverPreview").innerHTML=importState.cover?`<img src="${importState.cover}" alt="Cookbook cover preview">`:`<div class="cover-placeholder">📖</div>`;renderReview();
}
function renderReview(){
  const selected=importState.candidates.filter(x=>x.include).length;$("reviewSummary").textContent=`${importState.candidates.length} possible recipes found · ${selected} selected`;
  $("recipeReviewList").innerHTML=importState.candidates.map((r,i)=>`<article class="recipe-review-card ${r.include?"":"excluded"}"><div class="recipe-review-layout"><div class="recipe-photo-review">${r.image?`<img src="${r.image}" alt="${r.imageKind==="photo-crop"?"Cropped cookbook food photo":"Extracted cookbook photo"}">`:`<div class="cookbook-photo-placeholder">No image found</div>`}${r.image?`<div class="photo-source-label">${r.imageKind==="photo-crop"?"Cropped recipe photo":"Recipe photo"}</div><label class="review-check photo-toggle"><input type="checkbox" data-review-image="${i}" ${r.useImage!==false?"checked":""}><span>Use this image</span></label>`:""}</div><div class="recipe-review-content"><div class="recipe-review-head"><label class="review-check"><input type="checkbox" data-review-include="${i}" ${r.include?"checked":""}><span>Import</span></label><span class="page-badge">Page ${r.page}${r.endPage!==r.page?`–${r.endPage}`:""}</span></div><label class="field">Recipe title<input data-review-title="${i}" value="${escapeHTML(r.title)}"></label><details><summary>Review ingredients & instructions</summary><div class="review-columns"><label class="field">Ingredients<textarea rows="10" data-review-ingredients="${i}">${escapeHTML(r.ingredients.join("\n"))}</textarea></label><label class="field">Instructions<textarea rows="10" data-review-instructions="${i}">${escapeHTML(r.instructions.join("\n"))}</textarea></label></div></details></div></div></article>`).join("");
}
function syncReviewFields(){importState.candidates.forEach((r,i)=>{r.include=document.querySelector(`[data-review-include="${i}"]`)?.checked??r.include;r.useImage=document.querySelector(`[data-review-image="${i}"]`)?.checked??r.useImage;r.title=document.querySelector(`[data-review-title="${i}"]`)?.value.trim()||r.title;r.ingredients=splitList(document.querySelector(`[data-review-ingredients="${i}"]`)?.value||r.ingredients.join("\n"));r.instructions=splitList(document.querySelector(`[data-review-instructions="${i}"]`)?.value||r.instructions.join("\n"));});}
async function postVault(payload){if(!config.appsScriptUrl||!config.sharedKey)throw new Error("Open Recipe Vault settings and enter the Apps Script URL and family write key first.");const body=new URLSearchParams();body.set("payload",JSON.stringify({...payload,key:config.sharedKey}));const response=await fetch(config.appsScriptUrl,{method:"POST",body,redirect:"follow"});const result=await response.json();if(!result.success)throw new Error(result.error||"Request failed");return result;}
async function importSelected(){
  syncReviewFields(); const selected=importState.candidates.filter(r=>r.include); if(!selected.length)return alert("Select at least one recipe.");
  const title=$("cookbookTitle").value.trim()||importState.title,author=$("cookbookAuthor").value.trim(),collection=$("cookbookCollection").value.trim()||title,id=makeId(); let imported=0,skipped=0,failed=0;
  const btn=$("importCookbookRecipes");btn.disabled=true;
  for(let i=0;i<selected.length;i++){const r=selected[i];btn.textContent=`Importing ${i+1} of ${selected.length}…`;const recipe={name:r.title,url:"",source:`Cookbook: ${title} · p. ${r.page}`,image:r.useImage?r.image||"":"",protein:r.protein,type:r.type,cuisine:r.cuisine,tags:`Cookbook|${title}|Page ${r.page}`,collections:collection,prep_time:"",cook_time:"",total_time:"",ingredients:r.ingredients,instructions:r.instructions,nutrition:"",kirsta_rating:"",tj_rating:"",torrin_rating:"",torrin_notes:"",notes:`Imported from ${title}${author?` by ${author}`:""}, page ${r.page}.`,made_count:0,hidden:false,added:new Date().toISOString().slice(0,10),last_made:"",pdf_url:"",cookbook_id:id,cookbook_title:title,cookbook_page:r.page};
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

document.addEventListener("click",e=>{const open=e.target.closest("[data-open-cookbook]");if(open&&!e.target.closest("[data-delete-cookbook]")){openCookbook(open.dataset.openCookbook);return;}const del=e.target.closest("[data-delete-cookbook]");if(del){e.stopPropagation();deleteTargetId=del.dataset.deleteCookbook;const cb=library.find(x=>x.id===deleteTargetId);$("deleteCookbookMessage").textContent=`Choose what should happen to ${cb?.title||"this cookbook"}.`;$("deleteCookbookDialog").showModal();}});
$("uploadCookbookBtn").onclick=showImport;$("emptyUploadBtn").onclick=showImport;$("cancelImport").onclick=cancelImport;$("choosePdfBtn").onclick=()=>$("cookbookFile").click();$("cookbookFile").onchange=e=>e.target.files?.[0]&&analyzePdf(e.target.files[0]);
const drop=$("choosePdfPanel");["dragenter","dragover"].forEach(t=>drop.addEventListener(t,e=>{e.preventDefault();drop.classList.add("dragging")}));["dragleave","drop"].forEach(t=>drop.addEventListener(t,e=>{e.preventDefault();drop.classList.remove("dragging")}));drop.addEventListener("drop",e=>e.dataTransfer.files?.[0]&&analyzePdf(e.dataTransfer.files[0]));
$("selectAllRecipes").onclick=()=>{syncReviewFields();importState.candidates.forEach(r=>r.include=true);renderReview();};$("selectNoneRecipes").onclick=()=>{syncReviewFields();importState.candidates.forEach(r=>r.include=false);renderReview();};$("recipeReviewList").addEventListener("change",e=>{if(e.target.matches("[data-review-include]")){syncReviewFields();renderReview();}});$("importCookbookRecipes").onclick=importSelected;
$("cookbookSearch").oninput=renderShelf;$("cookbookRecipeSearch").oninput=renderCookbookRecipes;$("backToShelf").onclick=()=>{$("cookbookDetailView").hidden=true;$("libraryView").hidden=false;renderShelf();};
$("closeDeleteCookbook").onclick=()=>$("deleteCookbookDialog").close();$("cancelDeleteCookbook").onclick=()=>$("deleteCookbookDialog").close();$("removeCookbookOnly").onclick=()=>deleteCookbook(false);$("removeCookbookAndRecipes").onclick=()=>deleteCookbook(true);
loadRecipes();
