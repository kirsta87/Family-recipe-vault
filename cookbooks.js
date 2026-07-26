const $ = id => document.getElementById(id);
const SETTINGS_KEY = "recipeVaultSettingsV031";
const LIBRARY_KEY = "recipeVaultCookbookLibraryV150";
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
  const scale=1.55;
  const viewport=page.getViewport({scale});
  const full=document.createElement("canvas");
  full.width=Math.round(viewport.width); full.height=Math.round(viewport.height);
  await page.render({canvasContext:full.getContext("2d"),viewport}).promise;

  const pageWidth=candidate.pageWidth||page.getViewport({scale:1}).width;
  const pageHeight=candidate.pageHeight||page.getViewport({scale:1}).height;
  const title=candidate.titleLine||null;
  let x=0,y=0,w=full.width,h=Math.round(full.height*.38);
  if(title){
    const titleX=Math.max(0,title.x||0), titleY=Math.max(0,title.y||pageHeight*.62);
    const rightColumn=titleX>pageWidth*.42;
    x=Math.round((rightColumn?pageWidth*.43:0)*scale);
    w=Math.round((rightColumn?pageWidth*.57:pageWidth)*scale);
    const titleTop=Math.max(pageHeight-titleY-24, pageHeight*.18);
    h=Math.round(Math.min(pageHeight*.48,titleTop)*scale);
  }
  y=0;
  if(w<180||h<120)return "";
  const crop=document.createElement("canvas");
  crop.width=Math.min(900,w); crop.height=Math.max(1,Math.round(h*(crop.width/w)));
  crop.getContext("2d").drawImage(full,x,y,w,h,0,0,crop.width,crop.height);
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
    const text=String(item.str||"").trim(); if(!text)continue;
    const x=item.transform?.[4]||0,y=Math.round(item.transform?.[5]||0);
    const fontSize=Math.max(Math.abs(item.transform?.[0]||0),Math.abs(item.transform?.[3]||0),item.height||0);
    let row=rows.find(a=>Math.abs(a.y-y)<=Math.max(3,fontSize*.22));
    if(!row){row={y,items:[]};rows.push(row);}
    row.items.push({x,text,fontSize,width:item.width||0});
  }
  const lines=[];
  for(const row of rows.sort((a,b)=>b.y-a.y)){
    const sorted=row.items.sort((a,b)=>a.x-b.x);
    let segment=[];
    const flush=()=>{
      if(!segment.length)return;
      lines.push({text:segment.map(v=>v.text).join(" ").replace(/\s+/g," ").trim(),fontSize:Math.max(...segment.map(v=>v.fontSize||0)),x:Math.min(...segment.map(v=>v.x||0)),y:row.y});
      segment=[];
    };
    for(const item of sorted){
      const prev=segment[segment.length-1];
      const prevEnd=prev ? prev.x+(prev.width||prev.text.length*(prev.fontSize||10)*.45) : 0;
      const gap=prev ? item.x-prevEnd : 0;
      if(prev && gap>Math.max(48,(prev.fontSize||10)*4.5))flush();
      segment.push(item);
    }
    flush();
  }
  return lines.filter(line=>line.text).sort((a,b)=>b.y-a.y||a.x-b.x);
}
function itemsToLines(items){return itemsToStructuredLines(items).map(line=>line.text);}
function ingredientLike(line){return /^([¼½¾⅓⅔⅛⅜⅝⅞\d]|one |two |three |four |five |six |a |an )/i.test(line)&&/(cup|tbsp|tbs\b|tablespoon|tsp|teaspoon|ounce|oz\b|pound|lb\b|gram|kg\b|ml\b|clove|can\b|package|block\b|pinch|slice|sprig|bunch|stick|large|medium|small)/i.test(line);}
function instructionLike(line){return /^(\d+[.)]|step\s+\d+|preheat|heat |stir |mix |add |place |cook |bake |roast |grill |season |combine |whisk |serve |pour |transfer |cover |bring )/i.test(line);}
function pageScore(p){const t=p.text;let s=0;if(/ingredients?/i.test(t))s+=4;if(/directions?|instructions?|method/i.test(t))s+=4;s+=Math.min(5,p.lines.filter(ingredientLike).length);s+=Math.min(4,p.lines.filter(instructionLike).length);if(/contents|index|acknowledg|introduction|copyright/i.test(t)&&p.lines.length<45)s-=7;return s;}
function detectRecipes(pages){
  const result=[];
  for(const p of pages){
    if(pageScore(p)<5)continue;
    const candidate=buildCandidate({pages:[p],startPage:p.page,endPage:p.page});
    if(candidate.ingredients.length>=2||candidate.instructions.length>=2)result.push(candidate);
  }
  return result;
}
function titleRejected(line){
  const text=String(line||"").trim();
  return !text||text.length<4||text.length>90||/ingredients?|directions?|instructions?|method|serves?|servings?|yield|prep time|cook time|nutrition|notes?/i.test(text)||ingredientLike(text)||instructionLike(text)||/^([¼½¾⅓⅔⅛⅜⅝⅞\d]+|one|two|three|four|five|six)\b/i.test(text)||/^(chapter|part|page)\s/i.test(text)||!/[A-Za-z]/.test(text);
}
function titleScore(line,page){
  const text=line.text.trim(); let score=0;
  const words=text.split(/\s+/).length;
  score+=(line.fontSize||0)*2;
  if(words>=2&&words<=8)score+=18;
  if(text===text.toUpperCase()&&/[A-Z]/.test(text))score+=25;
  if(/^[A-Z][A-Za-z'’&-]+(?:\s+[A-Z][A-Za-z'’&-]+){1,7}$/.test(text))score+=15;
  if((line.y||0)>(page.height||800)*.48)score+=10;
  if((line.x||0)>(page.width||600)*.35)score+=4;
  if(/[.!?]$/.test(text))score-=10;
  return score;
}
function findTitleLineFromPage(page){
  const rich=(page.richLines||[]).filter(line=>!titleRejected(line.text));
  if(!rich.length)return null;
  return rich.sort((a,b)=>titleScore(b,page)-titleScore(a,page))[0]||null;
}
function findTitleFromPage(page){return findTitleLineFromPage(page)?.text||"";}
function findTitle(lines){return (lines||[]).find((line,i)=>i<20&&!titleRejected(line))||"";}
function buildCandidate(group){
  const page=group.pages[0];
  const lines=group.pages.flatMap(p=>p.lines);
  const titleLine=findTitleLineFromPage(page);
  const title=titleLine?.text||findTitle(lines)||`Recipe on page ${group.startPage}`;
  let mode="",ingredients=[],instructions=[];
  for(const line of lines){
    if(line===title)continue;
    if(/^ingredients?\b/i.test(line)){mode="ingredients";continue;}
    if(/^(directions?|instructions?|method)\b/i.test(line)){mode="instructions";continue;}
    if(mode==="ingredients"&&(ingredientLike(line)||(!instructionLike(line)&&line.length<120&&!titleRejected(line))))ingredients.push(line);
    else if(mode==="instructions"&&line.length>12&&!ingredientLike(line))instructions.push(line);
  }
  if(!ingredients.length)ingredients=lines.filter(line=>line!==title&&ingredientLike(line));
  if(!instructions.length)instructions=lines.filter(line=>line!==title&&instructionLike(line));
  return {include:true,title,titleLine,pageWidth:page.width,pageHeight:page.height,page:group.startPage,endPage:group.endPage,ingredients:[...new Set(ingredients)].slice(0,80),instructions:[...new Set(instructions)].slice(0,60),protein:"",type:"",cuisine:"",warnings:[]};
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
