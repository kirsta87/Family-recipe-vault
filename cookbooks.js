const $ = id => document.getElementById(id);
const SETTINGS_KEY = "recipeVaultSettingsV031";
const LIBRARY_KEY = "recipeVaultCookbookLibraryV150";
const BUILD_193 = true;
const COOKBOOK_ENGINE_VERSION = "3.4.0";
window.RECIPE_VAULT_ENGINES = {...(window.RECIPE_VAULT_ENGINES||{}), cookbook:"3.4", parser:"Coordinate Region Collector v2"};
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
let activePdfDocument = null;
let activeSourcePage = 1;
let sourceReturnToRecipe = false;
let activeCookbookRecipe = null;

const PDF_STORE_DB = "recipeVaultCookbookPdfsV1";
const PDF_STORE_NAME = "pdfs";
function pdfStoreKey(value){return normalize(value||"").replace(/\s+/g,"-")||"cookbook";}
function openPdfStore(){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(PDF_STORE_DB,1);
    request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(PDF_STORE_NAME))request.result.createObjectStore(PDF_STORE_NAME);};
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
}
async function saveCookbookPdf(blob,keys=[]){
  if(!blob||!("indexedDB" in window))return false;
  const unique=[...new Set(keys.map(pdfStoreKey).filter(Boolean))];if(!unique.length)return false;
  const db=await openPdfStore();
  await new Promise((resolve,reject)=>{const tx=db.transaction(PDF_STORE_NAME,"readwrite"),store=tx.objectStore(PDF_STORE_NAME);unique.forEach(key=>store.put(blob,key));tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
  db.close();return true;
}
async function loadCookbookPdf(keys=[]){
  if(!("indexedDB" in window))return null;
  const db=await openPdfStore();
  try{
    for(const raw of keys){const key=pdfStoreKey(raw);if(!key)continue;const blob=await new Promise((resolve,reject)=>{const tx=db.transaction(PDF_STORE_NAME,"readonly"),req=tx.objectStore(PDF_STORE_NAME).get(key);req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error);});if(blob)return blob;}
    return null;
  }finally{db.close();}
}

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
function meaningfulTokens(value){
  const stop=new Set(["cookbook","recipes","recipe","pdf","page","pages","the","and","with","from","edition"]);
  return normalize(value).split(" ").filter(token=>token.length>2&&!stop.has(token));
}
function recipeCookbookLabel(recipe){
  const source=String(recipe?.source||"");
  const match=source.match(/cookbook\s*:\s*(.*?)(?:\s*[·|•-]\s*p(?:age)?\.?\s*\d+|$)/i);
  return (match?.[1]||recipe?.cookbook_title||"").trim();
}
function recipeStableRef(recipe){
  if(recipe?.id)return `id:${recipe.id}`;
  if(recipe?.url)return `url:${normalize(recipe.url)}`;
  return `recipe:${normalize(recipe?.name)}|page:${normalize(recipe?.cookbook_page||recipe?.source)}|added:${normalize(recipe?.added)}`;
}
function cookbookIdentityValues(cookbook){
  const values=[cookbook?.title,cookbook?.originalTitle,cookbook?.fileName?.replace(/\.[^.]+$/,""),...(Array.isArray(cookbook?.aliases)?cookbook.aliases:[])];
  return [...new Set(values.map(v=>String(v||"").trim()).filter(Boolean))];
}
function cookbookRecipeMatches(recipe, cookbook){
  if(!recipe||!cookbook)return false;
  if(String(recipe.cookbook_id||"")===String(cookbook.id||""))return true;
  const ref=recipeStableRef(recipe);
  if(Array.isArray(cookbook.recipeRefs)&&cookbook.recipeRefs.includes(ref))return true;

  const identities=cookbookIdentityValues(cookbook);
  const recipeLabel=recipeCookbookLabel(recipe);
  const recipeValues=[recipeLabel,recipe.cookbook_title,recipe.collections];
  for(const identity of identities){
    const normalizedIdentity=normalize(identity);
    if(!normalizedIdentity)continue;
    if(recipeValues.some(value=>normalize(value)===normalizedIdentity))return true;
  }

  // Legacy imports sometimes lost cookbook_id and only retained the original
  // upload title in Source/Tags. Compare distinctive title tokens so renaming a
  // cookbook never makes its already-imported recipes disappear.
  const recipeTokens=new Set(meaningfulTokens([recipeLabel,recipe.cookbook_title,recipe.source,recipe.tags].join(" ")));
  if(!recipeTokens.size)return false;
  return identities.some(identity=>{
    const tokens=meaningfulTokens(identity);
    if(!tokens.length)return false;
    const overlap=tokens.filter(token=>recipeTokens.has(token));
    if(!overlap.length)return false;
    if(tokens.length===1)return overlap.length===1;
    return overlap.length/tokens.length>=0.5;
  });
}
function cookbookRecipes(cookbook,{remember=true}={}){
  const matches=recipes.filter(recipe=>cookbookRecipeMatches(recipe,cookbook));
  if(remember&&matches.length){
    const refs=new Set(Array.isArray(cookbook.recipeRefs)?cookbook.recipeRefs:[]);
    matches.forEach(recipe=>refs.add(recipeStableRef(recipe)));
    cookbook.recipeRefs=[...refs];
    const labels=matches.map(recipeCookbookLabel).filter(Boolean);
    cookbook.aliases=[...new Set([...(Array.isArray(cookbook.aliases)?cookbook.aliases:[]),cookbook.originalTitle,...labels].filter(Boolean))];
    saveLibrary();
  }
  return matches;
}
function coverMarkup(cb){ return cb.cover ? `<img src="${cb.cover}" alt="">` : `<div class="cover-placeholder">📖</div>`; }
function recipePhotoMarkup(recipe){ return recipe.image ? `<img class="cookbook-recipe-photo" src="${recipe.image}" alt="${escapeHTML(recipe.name||"Cookbook recipe")}">` : `<div class="cookbook-recipe-photo cookbook-photo-placeholder">🍽️</div>`; }
function renderShelf(){
  const q=normalize($("cookbookSearch")?.value); const visible=library.filter(cb=>!q||normalize(`${cb.title} ${cb.author}`).includes(q));
  $("cookbookEmpty").hidden=library.length>0;
  $("cookbookGrid").innerHTML=visible.map(cb=>{const count=cookbookRecipes(cb).length || cb.importedCount||0;return `<article class="cookbook-card" data-open-cookbook="${cb.id}"><div class="cookbook-cover">${coverMarkup(cb)}</div><div class="cookbook-card-body"><p class="eyebrow">${count} RECIPE${count===1?"":"S"}</p><h3>${escapeHTML(cb.title)}</h3><p>${escapeHTML(cb.author||"Cookbook PDF")}</p><div class="cookbook-card-actions"><button class="icon-button danger-text" data-delete-cookbook="${cb.id}" title="Remove cookbook">×</button></div></div></article>`}).join("");
}
function openCookbook(id){
  const cb=library.find(x=>x.id===id); if(!cb)return; activeCookbookId=id;
  $("libraryView").hidden=true;$("importView").hidden=true;$("cookbookDetailView").hidden=false;
  const count=cookbookRecipes(cb).length;
  $("cookbookDetailHeader").innerHTML=`<div class="detail-cover">${coverMarkup(cb)}</div><div><p class="eyebrow">COOKBOOK</p><h2>${escapeHTML(cb.title)}</h2><p>${escapeHTML(cb.author||"")}</p><p class="muted">${count||cb.importedCount||0} imported recipes${cb.pageCount?` · ${cb.pageCount} PDF pages`:""}</p><div class="cookbook-detail-header-actions"><button type="button" class="secondary compact-button" data-edit-cookbook="${cb.id}">Edit cookbook details</button></div></div>`;
  renderCookbookRecipes();
}
function stripStepNumber(text){return String(text||"").replace(/^\s*\d+[.)]\s*/,"").trim();}
function cleanImportedFamilyNotes(recipe){
  let text=String(recipe?.notes||"").trim();
  if(!text)return "";
  const description=String(recipe?.description||"").trim();
  if(description&&text.startsWith(description))text=text.slice(description.length).replace(/^\s+/,"");
  text=text
    .replace(/(?:^|\n)\s*Yield:\s*[^\n]*(?=\n|$)/gi,"")
    .replace(/(?:^|\n)\s*Video\s*\/\s*tutorial links:\s*(?:\n\s*https?:\/\/[^\n]+)+/gi,"")
    .replace(/(?:^|\n)\s*Imported from [^\n]+(?:\n|$)/gi,"\n")
    .replace(/^\s*https?:\/\/\S+\s*$/gim,"")
    .replace(/\n{3,}/g,"\n\n")
    .trim();
  return text;
}
function renderCookbookRecipes(){
  const cb=library.find(x=>x.id===activeCookbookId); if(!cb)return; const q=normalize($("cookbookRecipeSearch").value);
  const list=cookbookRecipes(cb).filter(r=>!q||normalize([r.name,r.ingredients,r.tags,r.cuisine].join(" ")).includes(q));
  $("cookbookRecipeGrid").innerHTML=list.length?list.map(r=>{const recipeRef=recipeStableRef(r);return `<button type="button" class="card cookbook-recipe-card" data-open-cookbook-recipe-ref="${escapeHTML(recipeRef)}" aria-label="Open ${escapeHTML(r.name||"recipe")}">${recipePhotoMarkup(r)}<span class="card-body"><h3>${escapeHTML(r.name||"Untitled recipe")}</h3><span>${escapeHTML(r.protein||r.type||r.cuisine||"")}</span></span></button>`}).join(""):`<div class="empty-state"><strong>No matching recipes found.</strong><p>Recipes imported from this cookbook will appear here.</p></div>`;
}
function parseSerializedValue(value){
  if(typeof value!=="string") return value;
  const text=value.trim();
  if(!text) return "";
  if((text.startsWith("[")&&text.endsWith("]"))||(text.startsWith("{")&&text.endsWith("}"))){
    try{return JSON.parse(text);}catch(_){/* fall through to plain text */}
  }
  return value;
}
function normalizeRecipeList(value){
  value=parseSerializedValue(value);
  if(Array.isArray(value)) return value.flatMap(item=>normalizeRecipeList(item)).filter(Boolean);
  if(value==null) return [];
  if(typeof value==="object"){
    const preferred=value.text||value.name||value.ingredient||value.instruction||value.step||value.value;
    return preferred!=null?normalizeRecipeList(preferred):Object.values(value).flatMap(normalizeRecipeList);
  }
  const text=String(value).trim();
  if(!text) return [];
  return text
    .split(/\r?\n|(?=\s*[•▪◦]\s*)/)
    .map(x=>x.replace(/^\s*[•▪◦-]\s*/,"").trim())
    .filter(Boolean);
}

function recipeSourcePage(recipe){
  const direct=Number(recipeField(recipe,"cookbook_page","cookbookPage","source_page","sourcePage","page"));
  if(Number.isFinite(direct)&&direct>0)return direct;
  const hay=[recipe?.source,recipe?.tags,recipe?.collections].flatMap(value=>Array.isArray(value)?value:[value]).filter(Boolean).join(" | ");
  const match=hay.match(/(?:\bpage\s*|\bp\.?\s*)(\d{1,4})\b/i);
  return match?Number(match[1]):0;
}
function recipeField(recipe,...names){
  if(!recipe||typeof recipe!=="object")return "";
  for(const name of names){
    if(recipe[name]!=null&&String(recipe[name]).trim()!=="")return recipe[name];
    const wanted=String(name).toLowerCase().replace(/[^a-z0-9]/g,"");
    const key=Object.keys(recipe).find(k=>String(k).toLowerCase().replace(/[^a-z0-9]/g,"")===wanted);
    if(key&&recipe[key]!=null&&String(recipe[key]).trim()!=="")return recipe[key];
  }
  return "";
}
function legacyCookbookNotes(recipe){
  return String(recipeField(recipe,"notes","author_note","author_notes","description")||"").trim();
}
function extractLabeledNoteValue(notes,labelPattern){
  const match=String(notes||"").match(new RegExp(`(?:^|\\n)\\s*(?:${labelPattern})\\s*:\\s*([^\\n]+)`,`i`));
  return match?.[1]?.trim()||"";
}
function normalizeRecipeLinks(recipe){
  const notes=legacyCookbookNotes(recipe);
  const labeled=extractLabeledNoteValue(notes,"video(?:\\s*\\/\\s*tutorial)? links?|tutorial links?|video url|recipe links?");
  const values=[
    recipeField(recipe,"recipe_links","recipeLinks","links"),
    recipeField(recipe,"video_url","videoUrl","tutorial_url","tutorialUrl"),
    labeled,
    recipeField(recipe,"url")
  ];
  const found=[];
  for(const raw of values){
    const parsed=parseSerializedValue(raw);
    const items=Array.isArray(parsed)?parsed:[parsed];
    for(const item of items){
      if(!item)continue;
      const candidate=typeof item==="object"?(item.url||item.href||item.link||""):String(item);
      const matches=String(candidate).match(/https?:\/\/[^\s"'<>\]]+/gi)||[];
      for(const url of matches){if(!found.includes(url))found.push(url);}
    }
  }
  return found;
}
function recipeServings(recipe){
  const direct=recipeField(recipe,"yield","yieldText","servings","serves","recipe_yield","recipeYield","serving_size","servingSize");
  if(String(direct||"").trim())return String(direct).trim();
  return extractLabeledNoteValue(legacyCookbookNotes(recipe),"yield(?:\\s*\\/\\s*servings)?|servings?|serves");
}
function cookbookAuthorNote(recipe){
  if(!recipe||typeof recipe!=="object")return "";

  // Cookbook descriptions have existed under several field names across older
  // imports and server schemas. Check every plausible source instead of letting
  // one empty/metadata-only legacy field hide a valid author headnote.
  const candidateFields=[
    "description","recipe_description","recipeDescription","author_note","author_notes",
    "authorNote","authorNotes","headnote","head_note","intro","summary","notes","family_notes"
  ];
  const candidates=[];
  for(const field of candidateFields){
    const raw=recipeField(recipe,field);
    if(raw==null||String(raw).trim()==="")continue;
    const parsed=parseSerializedValue(raw);
    const values=Array.isArray(parsed)?parsed:[parsed];
    for(const value of values){
      const text=typeof value==="object"
        ?String(value.text||value.description||value.note||value.value||"")
        :String(value||"");
      const cleaned=text
        .replace(/(?:^|\n)\s*(?:Yield(?:\s*\/\s*servings)?|Servings?|Serves)\s*:\s*[^\n]*/gi,"")
        .replace(/(?:^|\n)\s*(?:Video(?:\s*\/\s*tutorial)? links?|Tutorial links?|Video URL|Recipe links?)\s*:\s*https?:\/\/\S+/gi,"")
        .replace(/^\s*https?:\/\/\S+\s*$/gim,"")
        .replace(/\n{3,}/g,"\n\n")
        .trim();
      if(!cleaned)continue;
      if(/^\[?\s*https?:\/\//i.test(cleaned))continue;
      if(/^(?:yield|servings?|serves)\s*:/i.test(cleaned)&&cleaned.length<100)continue;
      candidates.push(cleaned);
    }
  }

  if(!candidates.length)return "";
  // Descriptions are normally prose. Prefer the longest useful candidate so a
  // short metadata fragment cannot win over the actual cookbook headnote.
  return [...new Set(candidates)].sort((a,b)=>b.length-a.length)[0];
}
function cookbookFamilyNotes(recipe){
  if(Object.prototype.hasOwnProperty.call(recipe||{},"family_notes"))return String(recipe.family_notes||"").trim();
  return "";
}
function openCookbookRecipe(recipe){
  if(!recipe)return; activeCookbookRecipe=recipe;
  $("cookbookRecipeTitle").textContent=recipe.name||"Untitled recipe";
  const currentBook=library.find(cb=>String(cb.id)===String(recipe.cookbook_id));
  $("cookbookRecipeSource").textContent=[currentBook?.title||recipe.cookbook_title,recipe.cookbook_page?`Page ${recipe.cookbook_page}`:""].filter(Boolean).join(" · ");
  const servings=recipeServings(recipe);
  $("cookbookRecipeTopMeta").innerHTML=[servings?`<span class="recipe-meta-chip">Servings: ${escapeHTML(servings)}</span>`:"",recipe.total_time?`<span class="recipe-meta-chip">${escapeHTML(recipe.total_time)} min</span>`:""] .filter(Boolean).join("");
  const img=$("cookbookRecipeImage"); if(recipe.image){img.src=recipe.image;img.alt=recipe.name||"Recipe";img.hidden=false}else img.hidden=true;
  const authorNote=cookbookAuthorNote(recipe);
  const desc=$("cookbookRecipeDescription"); desc.textContent=authorNote;desc.hidden=!authorNote;
  const links=normalizeRecipeLinks(recipe);
  const linkBox=$("cookbookRecipeLinks"); linkBox.innerHTML=links.map((url,i)=>`<a class="secondary linkbtn" href="${escapeHTML(url)}" target="_blank" rel="noopener">${i?`Tutorial link ${i+1}`:"Watch video tutorial"}</a>`).join("");linkBox.hidden=!links.length;
  const ingredientItems=normalizeRecipeList(recipe.ingredients);
  const instructionItems=normalizeRecipeList(recipe.instructions);
  $("cookbookRecipeIngredients").innerHTML=ingredientItems.map(x=>`<li>${escapeHTML(x)}</li>`).join("");
  $("cookbookRecipeInstructions").innerHTML=instructionItems.map(x=>`<li>${escapeHTML(stripStepNumber(x))}</li>`).join("");
  $("cookbookRecipeNotes").value=cookbookFamilyNotes(recipe);
  // Keep the source-page control clickable even when an older import has no saved preview.
  // The click handler can then explain what is missing instead of silently doing nothing.
  $("viewCookbookSourcePage").disabled=false;
  const savedSourcePreview=recipeField(recipe,"source_page_image","sourcePageImage","pdf_page_image","pdfPageImage","page_image","pageImage");
  $("viewCookbookSourcePage").dataset.hasSourcePreview=savedSourcePreview?"true":"false";
  $("cookbookRecipeDialog").showModal();
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
function chooseTocTitle(matchTitle, visualTitle){
  const toc=cleanLine(matchTitle||"");
  const visual=cleanLine(visualTitle||"");
  if(!toc)return visual;
  if(!visual)return toc;
  const tocWords=toc.split(/\s+/).filter(Boolean);
  const visualWords=visual.split(/\s+/).filter(Boolean);
  const visualNorm=normalize(visual);
  // Some cookbook TOC links use one oversized annotation rectangle that covers
  // several neighboring recipe names. Prefer the heading printed on the page.
  if(tocWords.length>Math.max(10,visualWords.length*2+2)||toc.length>visual.length*2.2){
    if(visualWords.length>=2&&!titleRejected(visual))return visual;
  }
  if(visualNorm&&normalize(toc).includes(visualNorm)&&tocWords.length>visualWords.length+3)return visual;
  return toc;
}
function extractYieldText(page){
  const text=(page.richLines||[]).map(l=>cleanLine(l.text));
  const direct=text.find(t=>/^(?:yield\s*\/\s*servings?|servings?|serves?|makes?)\s*:\s*\S+/i.test(t));
  if(direct)return direct.replace(/^(?:yield\s*\/\s*servings?|servings?|serves?|makes?)\s*:\s*/i,'').trim();
  for(const raw of text){
    let m=raw.match(/recipe\s+is\s+for\s+(\d+(?:\s*[-–]\s*\d+)?\s+(?:bowls?|servings?|wraps?|pieces?|portions?|cookies?|muffins?|pancakes?|waffles?|sandwiches?|cups?))/i);
    if(m)return m[1];
    m=raw.match(/suggested\s+servings?\s*[:,]?\s*(\d+(?:\s*[-–]\s*\d+)?)/i);
    if(m)return m[1];
  }
  return '';
}
function extractMacroNutrition(page){
  const text=(page.richLines||[]).map(l=>cleanLine(l.text)).join('\n');
  const take=label=>{
    const m=text.match(new RegExp('(?:^|\\n)\\s*'+label+'\\s*:\\s*([0-9]+(?:\\.[0-9]+)?\\s*(?:g|kcal|calories?)?)','i'));
    return m?m[1].replace(/\s+/g,'').replace(/calories?/i,''):'';
  };
  const calories=take('calories?'),fat=take('fat'),protein=take('protein'),carbs=take('carbs?|carbohydrates?');
  return [calories&&`Calories: ${calories}`,protein&&`Protein: ${protein}`,carbs&&`Carbs: ${carbs}`,fat&&`Fat: ${fat}`].filter(Boolean).join(' | ');
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
      candidate.title=smartTitleCase(chooseTocTitle(match.title,candidate.visualTitle));
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
  const payload={build:195,engine:COOKBOOK_ENGINE_VERSION,fileName:importState.fileName,recipe:r.debugReport||r};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`parser-report-page-${r.page}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}

async function analyzePdf(file){
  $("choosePdfPanel").hidden=true;$("analyzePanel").hidden=false;$("importHeading").textContent="Analyzing cookbook";
  try{
    const pdfjs=await getPdfJs(); const buffer=await file.arrayBuffer(); const pdfBlob=new Blob([buffer],{type:"application/pdf"});
    await saveCookbookPdf(pdfBlob,[file.name]).catch(()=>false);
    const pdf=await pdfjs.getDocument({data:buffer.slice(0)}).promise; activePdfDocument=pdf;
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
    importState={fileName:file.name,pageCount:pdf.numPages,cover,candidates,title:guessBookTitle(pages,file.name),author:"",tocCount:tocMap.size,pdfBlob};
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
  return {yieldText:yieldLine?cleanLine(yieldLine.text):extractYieldText(page),description,descriptionLines};
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
  return {include:true,title:smartTitleCase(title),titleLine,yieldText:meta.yieldText||extractYieldText(page),nutrition:extractMacroNutrition(page),description:meta.description,links:recipeVideoLinks(group.pages),regions,textDensity:{left:leftDensity,right:rightDensity},pageWidth:W,pageHeight:H,page:group.startPage,endPage:group.endPage,ingredients,instructions,protein:"",type:"",cuisine:"",warnings,layoutProfile:classifyPageLayout(page,regions),engineVersion:COOKBOOK_ENGINE_VERSION,pages:group.pages,rawLines:page.richLines||[],titleCandidates};
}
function guessBookTitle(pages,fileName){const first=pages.slice(0,4).flatMap(p=>p.lines).find(x=>x.length>5&&x.length<90&&!/copyright|contents|www\.|isbn/i.test(x));return first||fileName.replace(/\.pdf$/i,"").replace(/[_-]+/g," ");}

function recipeTitleTokens(value){
  const stop=new Set(["the","a","an","and","or","with","of","for","to","in","on","style","easy","best","healthy","high","protein"]);
  return new Set(normalize(value).split(" ").filter(t=>t.length>1&&!stop.has(t)));
}
function jaccard(a,b){
  const A=a instanceof Set?a:new Set(a),B=b instanceof Set?b:new Set(b);
  if(!A.size&&!B.size)return 1;
  const overlap=[...A].filter(x=>B.has(x)).length;
  return overlap/(A.size+B.size-overlap||1);
}
function normalizedIngredientTokens(value){
  const rows=normalizeRecipeList(value);
  const noise=new Set(["cup","cups","tbsp","tsp","tablespoon","tablespoons","teaspoon","teaspoons","oz","ounce","ounces","lb","lbs","pound","pounds","gram","grams","g","ml","can","package","pkg","optional","taste"]);
  return new Set(normalize(rows.join(" ")).split(" ").filter(t=>t.length>1&&!/^\d+$/.test(t)&&!noise.has(t)));
}
function duplicateSimilarity(candidate,existing){
  const titleScore=jaccard(recipeTitleTokens(candidate.title),recipeTitleTokens(existing.name));
  const ingredientScore=jaccard(normalizedIngredientTokens(candidate.ingredients),normalizedIngredientTokens(existing.ingredients));
  const instructionScore=jaccard(recipeTitleTokens(normalizeRecipeList(candidate.instructions).join(" ")),recipeTitleTokens(normalizeRecipeList(existing.instructions).join(" ")));
  const exactTitle=normalize(candidate.title)===normalize(existing.name);
  const score=exactTitle?Math.max(.96,.58*ingredientScore+.42*instructionScore):(.42*titleScore+.48*ingredientScore+.10*instructionScore);
  return Math.min(1,score);
}
function identifyExistingCookbook(){
  const fileBase=normalize(String(importState?.fileName||"").replace(/\.[^.]+$/,""));
  const title=normalize(importState?.title||"");
  let best=null,bestScore=0;
  for(const cb of library){
    const values=cookbookIdentityValues(cb).map(normalize);
    let score=0;
    if(fileBase&&values.includes(fileBase))score=1;
    else if(title&&values.includes(title))score=.98;
    else score=Math.max(...values.map(v=>jaccard(new Set(meaningfulTokens(v)),new Set(meaningfulTokens(fileBase||title)))),0);
    if(score>bestScore){bestScore=score;best=cb;}
  }
  return bestScore>=.72?best:null;
}
function classifyImportCandidates(){
  const matched=identifyExistingCookbook();
  importState.matchedCookbook=matched||null;
  const sameBookRecipes=matched?cookbookRecipes(matched,{remember:false}):[];
  importState.candidates.forEach(r=>{
    r.importStatus="new";r.duplicateMatch=null;r.duplicateConfidence=0;
    const pageMatch=sameBookRecipes.find(existing=>Number(existing.cookbook_page||0)===Number(r.page||0)&&normalize(existing.name)===normalize(r.title));
    const titleMatch=sameBookRecipes.find(existing=>normalize(existing.name)===normalize(r.title));
    const already=pageMatch||titleMatch;
    if(already){r.importStatus="already";r.include=false;r.duplicateMatch=already;r.duplicateConfidence=1;return;}
    let best=null,bestScore=0;
    for(const existing of recipes){
      const score=duplicateSimilarity(r,existing);
      if(score>bestScore){bestScore=score;best=existing;}
    }
    if(best&&bestScore>=.84){
      r.importStatus="possible-duplicate";r.include=false;r.duplicateMatch=best;r.duplicateConfidence=bestScore;
    }else r.include=true;
  });
}
function importStatusCounts(){
  const counts={new:0,already:0,duplicates:0,selected:0};
  for(const r of importState?.candidates||[]){
    if(r.importStatus==="already")counts.already++;
    else if(r.importStatus==="possible-duplicate")counts.duplicates++;
    else counts.new++;
    if(r.include)counts.selected++;
  }
  return counts;
}

function prepareReviewFields(){
  $("cookbookTitle").value=importState.title;
  $("cookbookAuthor").value=importState.author;
  $("cookbookCollection").value=importState.matchedCookbook?.collection||importState.title;
  $("coverPreview").innerHTML=importState.cover?`<img src="${importState.cover}" alt="Cookbook cover preview">`:`<div class="cover-placeholder">📖</div>`;
}
function showMissingRecipeReview(){
  $("reimportChoicePanel").hidden=true;
  $("reviewPanel").hidden=false;
  $("importHeading").textContent="Review missing recipes";
  importState.candidates.forEach(r=>r.include=r.importStatus==="new");
  prepareReviewFields();
  renderReview();
}
function showReview(){
  classifyImportCandidates();
  $("analyzePanel").hidden=true;
  prepareReviewFields();
  if(importState.matchedCookbook){
    const counts=importStatusCounts();
    $("reviewPanel").hidden=true;
    $("reimportChoicePanel").hidden=false;
    $("importHeading").textContent="Cookbook recognized";
    $("reimportChoiceTitle").textContent=`${importState.matchedCookbook.title} is already on your shelf`;
    $("reimportChoiceSummary").textContent=`${counts.already} existing recipes matched · ${counts.new} missing recipes found${counts.duplicates?` · ${counts.duplicates} possible duplicates`:""}. What would you like to do?`;
    return;
  }
  $("reimportChoicePanel").hidden=true;
  $("reviewPanel").hidden=false;
  $("importHeading").textContent="Review cookbook";
  renderReview();
}
function assessImportCandidate(r){
  const issues=[];
  const title=(r.title||"").trim();
  const description=(r.description||"").trim();
  const ingredients=Array.isArray(r.ingredients)?r.ingredients.filter(Boolean):[];
  const instructions=Array.isArray(r.instructions)?r.instructions.filter(Boolean):[];
  const links=Array.isArray(r.links)?r.links.filter(Boolean):[];
  const confidence=Number(r.titleConfidence||0);
  const timeLed=/^\d+\s*(?:min(?:ute)?s?|hour|hr)s?\b/i.test(title);
  const instructionLed=/^(?:add|bake|beat|blend|boil|chop|combine|continue|cook|cut|drain|flip|fold|heat|let|make|melt|mix|place|pour|preheat|remove|serve|set|slice|stir|whisk)\b/i.test(title);
  const measurementLed=/^(?:\d+\s*(?:\/\d+)?|[¼½¾⅓⅔⅛⅜⅝⅞])\s*(?:cup|tsp|tbsp|tablespoon|teaspoon|oz|ounce|lb|pound|gram|g|ml|can|package|pkg|block|spray)\b/i.test(title);
  if(!title) issues.push({level:"high",code:"missing-title",label:"Missing title"});
  else {
    if(confidence && confidence<55) issues.push({level:"high",code:"low-title-confidence",label:`Low title confidence (${confidence}%)`});
    else if(confidence && confidence<75) issues.push({level:"medium",code:"review-title-confidence",label:`Review title confidence (${confidence}%)`});
    if(!timeLed&&instructionLed) issues.push({level:"high",code:"instruction-title",label:"Title looks like an instruction"});
    if(measurementLed) issues.push({level:"high",code:"measurement-title",label:"Title looks like an ingredient"});
    if(title.length>80||title.split(/\s+/).length>12) issues.push({level:"medium",code:"long-title",label:"Title is unusually long"});
    if(/[.!?]$/.test(title)&&title.split(/\s+/).length>5) issues.push({level:"medium",code:"sentence-title",label:"Title looks like a sentence"});
  }
  if(!ingredients.length) issues.push({level:"high",code:"missing-ingredients",label:"No ingredients found"});
  if(!instructions.length) issues.push({level:"high",code:"missing-instructions",label:"No instructions found"});
  else if(instructions.length===1&&instructions[0].length<55) issues.push({level:"medium",code:"short-instructions",label:"Instructions may be incomplete"});
  if(links.length>1) issues.push({level:"medium",code:"multiple-links",label:`Multiple tutorial links (${links.length})`});
  if(description.length>700||/\b(?:1\.|2\.|3\.)\s+/.test(description)) issues.push({level:"medium",code:"description-bleed",label:"Description may contain instructions"});
  if(!r.yieldText) issues.push({level:"low",code:"missing-yield",label:"Yield / servings missing"});
  if((r.warnings||[]).length) (r.warnings||[]).forEach(w=>issues.push({level:"medium",code:"parser-warning",label:w}));
  const severity=issues.some(x=>x.level==="high")?"high":issues.some(x=>x.level==="medium")?"medium":issues.length?"low":"good";
  return {issues,severity};
}
function renderImportHealth(){
  const panel=$("importHealthPanel");if(!panel)return;
  const assessments=importState.candidates.map(assessImportCandidate);
  const needsReview=assessments.map((a,i)=>({a,i,r:importState.candidates[i]})).filter(x=>x.a.severity!=="good");
  const high=needsReview.filter(x=>x.a.severity==="high").length;
  const medium=needsReview.filter(x=>x.a.severity==="medium").length;
  const good=assessments.length-needsReview.length;
  panel.innerHTML=`<div class="import-health-head"><div><h3>Import quality report</h3><p>${good} look good · ${needsReview.length} need a glance${high?` · ${high} high priority`:""}</p></div>${needsReview.length?`<button type="button" class="secondary compact-button" data-show-review-only>Show only flagged</button>`:""}</div>${needsReview.length?`<div class="import-health-list">${needsReview.map(({a,i,r})=>`<button type="button" class="health-issue health-${a.severity}" data-jump-recipe="${i}"><span class="health-page">Page ${r.page}</span><strong>${escapeHTML(r.title||"Untitled recipe")}</strong><span>${escapeHTML(a.issues.slice(0,2).map(x=>x.label).join(" · "))}${a.issues.length>2?` · +${a.issues.length-2} more`:""}</span></button>`).join("")}</div>`:`<div class="health-all-good">✓ No obvious missing or suspicious fields found.</div>`}`;
}
async function showSourcePage(pageNo){
  if(!activePdfDocument){alert("The original PDF is no longer open. Re-upload the cookbook to view its source pages.");return;}
  activeSourcePage=Math.max(1,Math.min(activePdfDocument.numPages,Number(pageNo)||1));
  const dialog=$("sourcePageDialog"),loading=$("sourcePageLoading"),img=$("sourcePageImage");
  $("sourcePageTitle").textContent=`Page ${activeSourcePage} of ${activePdfDocument.numPages}`;
  $("sourcePagePrev").disabled=activeSourcePage<=1;
  $("sourcePageNext").disabled=activeSourcePage>=activePdfDocument.numPages;
  loading.hidden=false;img.hidden=true;
  if(!dialog.open)dialog.showModal();
  try{
    const page=await activePdfDocument.getPage(activeSourcePage);
    const base=page.getViewport({scale:1});
    const maxWidth=Math.min(1200,Math.max(720,window.innerWidth*.82));
    const scale=Math.max(1,Math.min(2,maxWidth/base.width));
    const viewport=page.getViewport({scale});
    const canvas=document.createElement("canvas");canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
    await page.render({canvasContext:canvas.getContext("2d"),viewport}).promise;
    img.src=canvas.toDataURL("image/jpeg",.9);img.hidden=false;
  }catch(error){loading.textContent=`Could not render page: ${error.message||"Unknown error"}`;return;}
  loading.hidden=true;loading.textContent="Rendering original page…";
}

function scrollReviewTop(){
  const target=$("importHealthPanel")||$("reviewPanel");
  target?.scrollIntoView({behavior:"smooth",block:"start"});
}

function renderReview(){
  const counts=importStatusCounts();$('reviewSummary').textContent=`${counts.new} new · ${counts.already} already imported · ${counts.duplicates} possible duplicates · ${counts.selected} selected`;
  const smart=$("smartImportSummary");if(smart){const book=importState.matchedCookbook;smart.hidden=false;smart.innerHTML=`<div><strong>${book?`Continuing ${escapeHTML(book.title)}`:"Smart duplicate scan"}</strong><p>${counts.new} new recipes found${counts.already?` · ${counts.already} already imported`:""}${counts.duplicates?` · ${counts.duplicates} possible duplicates need a decision`:""}.</p></div><button type="button" class="primary compact-button" data-select-new>Import all new recipes</button>`;}
  renderImportHealth();
  $('recipeReviewList').innerHTML=importState.candidates.map((r,i)=>{const health=assessImportCandidate(r);return `<article id="recipe-review-${i}" data-review-card="${i}" data-health="${health.severity}" class="recipe-review-card ${health.severity!=='good'?'needs-review':''} ${r.include?'':'excluded'}"><div class="recipe-review-layout"><div class="recipe-photo-review">${r.image?`<img src="${r.image}" alt="${r.imageKind==='photo-crop'?'Cropped cookbook food photo':'Extracted cookbook photo'}">`:`<div class="cookbook-photo-placeholder">No image found</div>`}${r.image?`<div class="photo-source-label">${r.imageKind==='photo-crop'?'Cropped recipe photo':'Recipe photo'}</div><label class="review-check photo-toggle"><input type="checkbox" data-review-image="${i}" ${r.useImage!==false?'checked':''}><span>Use this image</span></label>`:''}</div><div class="recipe-review-content"><div class="recipe-review-head"><div class="review-status-wrap">${r.importStatus==='already'?`<span class="import-status status-already">Already imported ✓</span>`:r.importStatus==='possible-duplicate'?`<span class="import-status status-duplicate">Possible duplicate · ${Math.round((r.duplicateConfidence||0)*100)}%</span>`:`<span class="import-status status-new">New</span>`}${r.duplicateMatch?`<small>Looks like: ${escapeHTML(r.duplicateMatch.name||'Existing recipe')}${recipeCookbookLabel(r.duplicateMatch)?` · ${escapeHTML(recipeCookbookLabel(r.duplicateMatch))}`:''}</small>`:''}</div><label class="review-check"><input type="checkbox" data-review-include="${i}" ${r.include?'checked':''} ${r.importStatus==='already'?'disabled':''}><span>${r.importStatus==='possible-duplicate'?'Keep both':r.importStatus==='already'?'Imported':'Import'}</span></label><div class="recipe-review-page-tools"><span class="page-badge">Page ${r.page}${r.endPage!==r.page?`–${r.endPage}`:''} · ${escapeHTML(r.layoutProfile||"adaptive")}</span><button type="button" class="secondary compact-button" data-view-source-page="${r.page}">View source page</button></div></div><label class="field">Recipe title<input data-review-title="${i}" value="${escapeHTML(r.title)}"></label><div class="parser-source-row"><span class="parser-source-badge">Title: ${escapeHTML(r.titleSource||"visual fallback")} · ${Number(r.titleConfidence||0)}%</span><div class="parser-card-actions"><button type="button" class="secondary compact-button" data-parser-report="${i}">Download parser report</button><button type="button" class="secondary compact-button" data-back-review-top>Back to report ↑</button></div></div><details class="parser-debug"><summary>🐞 Debug parser</summary><pre>${escapeHTML(JSON.stringify(r.debugReport||{},null,2))}</pre></details><div class="review-meta-grid"><label class="field">Yield / servings<input data-review-yield="${i}" value="${escapeHTML(r.yieldText||'')}"></label><label class="field">Macros / nutrition<input data-review-nutrition="${i}" value="${escapeHTML(r.nutrition||'')}" placeholder="Calories: 336 | Protein: 38g | Carbs: 28g | Fat: 8g"></label><label class="field review-description-field">Description<textarea rows="3" data-review-description="${i}">${escapeHTML(r.description||'')}</textarea></label></div><label class="field">Video / tutorial links<textarea rows="2" data-review-links="${i}" placeholder="One link per line">${escapeHTML((r.links||[]).join('\n'))}</textarea></label>${(r.warnings||[]).length?`<div class="parser-warning">${(r.warnings||[]).map(w=>`⚠ ${escapeHTML(w)}`).join("<br>")}</div>`:""}<details><summary>Review ingredients & instructions</summary><div class="review-columns"><label class="field">Ingredients<textarea rows="10" data-review-ingredients="${i}">${escapeHTML(r.ingredients.map(item=>`• ${item}`).join('\n'))}</textarea></label><label class="field">Instructions<textarea rows="10" data-review-instructions="${i}">${escapeHTML(r.instructions.join('\n'))}</textarea></label></div></details></div></div></article>`}).join('');
}

function syncReviewFields(){importState.candidates.forEach((r,i)=>{r.include=document.querySelector(`[data-review-include="${i}"]`)?.checked??r.include;r.useImage=document.querySelector(`[data-review-image="${i}"]`)?.checked??r.useImage;r.title=smartTitleCase(document.querySelector(`[data-review-title="${i}"]`)?.value.trim()||r.title);r.yieldText=document.querySelector(`[data-review-yield="${i}"]`)?.value.trim()||'';r.nutrition=document.querySelector(`[data-review-nutrition="${i}"]`)?.value.trim()||'';r.description=document.querySelector(`[data-review-description="${i}"]`)?.value.trim()||'';r.links=splitLinks(document.querySelector(`[data-review-links="${i}"]`)?.value||(r.links||[]).join('\n'));r.ingredients=splitList(document.querySelector(`[data-review-ingredients="${i}"]`)?.value||r.ingredients.join('\n'));r.instructions=splitList(document.querySelector(`[data-review-instructions="${i}"]`)?.value||r.instructions.join('\n'));});}
async function postVault(payload){if(!config.appsScriptUrl||!config.sharedKey)throw new Error("Open Recipe Vault settings and enter the Apps Script URL and family write key first.");const body=new URLSearchParams();body.set("payload",JSON.stringify({...payload,key:config.sharedKey}));const response=await fetch(config.appsScriptUrl,{method:"POST",body,redirect:"follow"});const result=await response.json();if(!result.success)throw new Error(result.error||"Request failed");return result;}
async function renderImportedSourcePreview(pageNo){
  if(!activePdfDocument)return "";
  importState.sourcePreviewCache=importState.sourcePreviewCache||{};
  if(importState.sourcePreviewCache[pageNo])return importState.sourcePreviewCache[pageNo];
  try{const page=await activePdfDocument.getPage(pageNo),viewport=page.getViewport({scale:.72}),canvas=document.createElement("canvas");canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);await page.render({canvasContext:canvas.getContext("2d"),viewport}).promise;return importState.sourcePreviewCache[pageNo]=canvas.toDataURL("image/jpeg",.62);}catch{return "";}
}
async function updateExistingCookbookRecipes(){
  const book=importState.matchedCookbook;if(!book)return;
  const allMatches=importState.candidates.filter(r=>r.importStatus==="already"&&r.duplicateMatch);
  const jobs=allMatches.map(candidate=>{
    const existing=candidate.duplicateMatch;
    const missingPage=false;
    const missingYield=!recipeField(existing,"yield","yieldText","servings","recipe_yield","serving_size")&&candidate.yieldText;
    const missingDescription=!recipeField(existing,"description","author_note","authorNotes","headnote")&&candidate.description;
    const missingVideo=!recipeField(existing,"video_url","videoUrl","tutorial_url","tutorialUrl")&&(candidate.links||[])[0];
    const missingLinks=!normalizeRecipeList(recipeField(existing,"recipe_links","recipeLinks","links","tutorial_links")).length&&(candidate.links||[]).length;
    return {candidate,existing,missingPage,missingYield,missingDescription,missingVideo,missingLinks};
  }).filter(job=>job.missingPage||job.missingYield||job.missingDescription||job.missingVideo||job.missingLinks);

  const choicePanel=$("reimportChoicePanel"),progressPanel=$("cookbookUpdateProgress");
  choicePanel.hidden=true;progressPanel.hidden=false;
  const bar=$("updateProgressBar"),count=$("updateProgressCount"),detail=$("updateProgressDetail"),status=$("updateProgressStatus"),title=$("updateProgressTitle");
  title.textContent=`Refreshing ${book.title}`;
  status.textContent=jobs.length?`Updating ${jobs.length} recipes that are actually missing cookbook details.`:"Linking the original PDF. Existing source-page references are already usable.";
  bar.value=jobs.length?0:100;count.textContent=`0 of ${jobs.length}`;detail.textContent=jobs.length?"Preparing updates":"Linking PDF";

  let updated=0,failed=0,pagesAttached=0,descriptionsAdded=0,yieldsAdded=0,linksAdded=0,completed=0;
  const pdfLinked=await saveCookbookPdf(importState.pdfBlob,[book.id,book.fileName,importState.fileName,book.title]).catch(()=>false);
  const updateProgress=()=>{
    completed++;
    bar.value=jobs.length?Math.round((completed/jobs.length)*100):100;
    count.textContent=`${completed} of ${jobs.length}`;
    detail.textContent=completed<jobs.length?"Updating recipes":"Finishing cookbook";
  };
  const runJob=async job=>{
    const {candidate,existing}=job;
    const updates={};
    if(!recipeField(existing,"cookbook_id","cookbookId"))updates.cookbook_id=book.id;
    if(!recipeField(existing,"cookbook_title","cookbookTitle"))updates.cookbook_title=book.title;
    if(!recipeField(existing,"cookbook_author","cookbookAuthor")&&(book.author||importState.author))updates.cookbook_author=book.author||importState.author||"";
    // Legacy imports already contain the page in Source/Tags. Read that directly instead of
    // forcing a slow server write for every recipe.
    if(!recipeSourcePage(existing)&&candidate.page)updates.cookbook_page=candidate.page;
    // Source pages are rendered from the locally stored PDF instead of uploading a huge image for every recipe.
    if(job.missingYield){updates.yield=candidate.yieldText;yieldsAdded++;}
    if(job.missingDescription){updates.description=candidate.description;descriptionsAdded++;}
    if(job.missingVideo){updates.video_url=candidate.links[0];linksAdded++;}
    if(job.missingLinks){updates.recipe_links=candidate.links;}
    try{if(Object.keys(updates).length){await postVault({action:"update",id:existing.id,url:existing.url,updates});Object.assign(existing,updates);updated++;}}
    catch(e){failed++;}
    finally{updateProgress();}
  };

  // A small worker pool keeps Apps Script responsive while avoiding 77 fully sequential requests.
  const queue=[...jobs];
  const workers=Array.from({length:Math.min(4,Math.max(1,queue.length))},async()=>{while(queue.length)await runJob(queue.shift());});
  await Promise.all(workers);

  book.fileName=importState.fileName;book.pageCount=importState.pageCount;book.cover=book.cover||importState.cover;book.aliases=[...new Set([...(book.aliases||[]),book.title,importState.title].filter(Boolean))];saveLibrary();
  progressPanel.hidden=true;$("importResults").hidden=false;
  const unchanged=Math.max(0,allMatches.length-jobs.length);
  $("importResults").innerHTML=`<div class="success-panel"><div class="success-icon">✓</div><h2>${escapeHTML(book.title)} is updated</h2><p>${updated} recipes refreshed${unchanged?` · ${unchanged} were already complete`:""}${failed?` · ${failed} could not be updated`:""}.</p><div class="maintenance-summary"><div><strong>${pdfLinked?"✓":"—"}</strong><span>original PDF linked</span></div><div><strong>${descriptionsAdded}</strong><span>descriptions restored</span></div><div><strong>${yieldsAdded}</strong><span>serving sizes restored</span></div><div><strong>${linksAdded}</strong><span>tutorial links restored</span></div></div><p class="muted">Family Notes, ratings, collections, and personal edits were left untouched.</p><div class="actions"><button id="browseImported" class="primary">Browse cookbook</button><a class="secondary linkbtn" href="index.html">Return to Recipe Vault</a></div></div>`;
  $("browseImported").onclick=()=>{loadRecipes().then(()=>openCookbook(book.id));};
}
async function importSelected(){
  syncReviewFields(); const selected=importState.candidates.filter(r=>r.include&&r.importStatus!=="already");
  const existingBook=importState.matchedCookbook||null;
  const title=$("cookbookTitle").value.trim()||importState.title,author=$("cookbookAuthor").value.trim(),collection=$("cookbookCollection").value.trim()||title,id=existingBook?.id||makeId(); let imported=0,skipped=0,failed=0,previewsAttached=0;
  if(!selected.length&&!existingBook)return alert("Select at least one recipe.");
  const btn=$("importCookbookRecipes");btn.disabled=true;
  if(existingBook){
    const existingRecipes=cookbookRecipes(existingBook,{remember:false}).filter(r=>!recipeField(r,"source_page_image","sourcePageImage","pdf_page_image","pdfPageImage")&&Number(recipeField(r,"cookbook_page","cookbookPage","source_page","sourcePage","page"))>0);
    for(let i=0;i<existingRecipes.length;i++){
      const recipe=existingRecipes[i],page=Number(recipeField(recipe,"cookbook_page","cookbookPage","source_page","sourcePage","page"));
      btn.textContent=`Attaching original pages ${i+1} of ${existingRecipes.length}…`;
      const preview=await renderImportedSourcePreview(page);if(!preview)continue;
      try{await postVault({action:"update",id:recipe.id,url:recipe.url,updates:{source_page_image:preview}});recipe.source_page_image=preview;previewsAttached++;}catch{}
    }
  }
  await saveCookbookPdf(importState.pdfBlob,[id,importState.fileName,title]).catch(()=>false);
  for(let i=0;i<selected.length;i++){const r=selected[i];btn.textContent=`Importing ${i+1} of ${selected.length}…`;const sourcePageImage="";const recipe={name:smartTitleCase(r.title),url:"",source:`Cookbook: ${title} · p. ${r.page}`,image:r.useImage?r.image||"":"",protein:r.protein,type:r.type,cuisine:r.cuisine,tags:`Cookbook|${title}|Page ${r.page}`,collections:collection,prep_time:"",cook_time:"",total_time:"",ingredients:r.ingredients,instructions:r.instructions.map(stripStepNumber),nutrition:r.nutrition||"",kirsta_rating:"",tj_rating:"",torrin_rating:"",torrin_notes:"",description:r.description||"",yield:r.yieldText||"",video_url:(r.links||[])[0]||"",recipe_links:r.links||[],notes:"",made_count:0,hidden:false,added:new Date().toISOString().slice(0,10),last_made:"",pdf_url:"",cookbook_id:id,cookbook_title:title,cookbook_author:author,cookbook_page:r.page,source_page_image:sourcePageImage};
    try{const res=await postVault({action:"addManual",recipe,duplicateAction:"skip"});if(res.action==="duplicate")skipped++;else imported++;}catch(e){failed++;r.warnings.push(e.message);}
  }
  if(existingBook){existingBook.title=title;existingBook.author=author;existingBook.collection=collection;existingBook.cover=existingBook.cover||importState.cover;existingBook.pageCount=importState.pageCount;existingBook.importedCount=(cookbookRecipes(existingBook,{remember:false}).length||existingBook.importedCount||0)+imported;existingBook.fileName=importState.fileName;existingBook.aliases=[...new Set([...(existingBook.aliases||[]),title,importState.title].filter(Boolean))];}
  else library.unshift({id,title,originalTitle:title,aliases:[title],author,collection,cover:importState.cover,pageCount:importState.pageCount,importedCount:imported,recipeRefs:[],addedAt:new Date().toISOString(),fileName:importState.fileName});saveLibrary();btn.disabled=false;btn.textContent="Import selected";
  $("reviewPanel").hidden=true;$("importResults").hidden=false;$("importResults").innerHTML=`<div class="success-panel"><div class="success-icon">✓</div><h2>${escapeHTML(title)} is on your shelf</h2><p>${imported} recipes imported${skipped?`, ${skipped} duplicates skipped`:""}${previewsAttached?`, ${previewsAttached} original PDF pages attached`:""}${failed?`, ${failed} failed`:""}.</p><div class="actions"><button id="browseImported" class="primary">Browse cookbook</button><a class="secondary linkbtn" href="index.html">Return to Recipe Vault</a></div></div>`;$("browseImported").onclick=()=>{loadRecipes().then(()=>openCookbook(id));};
}
function beginEditCookbook(id){const cb=library.find(x=>x.id===id);if(!cb)return;$("editCookbookTitle").value=cb.title||"";$("editCookbookAuthor").value=cb.author||"";$("editCookbookCollection").value=cb.collection||cb.title||"";$("editCookbookDialog").dataset.id=id;$("editCookbookDialog").showModal();}
async function saveCookbookMetadata(){
  const id=$("editCookbookDialog").dataset.id,cb=library.find(x=>x.id===id);
  if(!cb)return;
  const previousTitle=cb.title;
  const newTitle=$("editCookbookTitle").value.trim()||cb.title;
  const newAuthor=$("editCookbookAuthor").value.trim();
  const newCollection=$("editCookbookCollection").value.trim()||newTitle;
  cb.originalTitle=cb.originalTitle||previousTitle;
  cb.aliases=[...new Set([...(Array.isArray(cb.aliases)?cb.aliases:[]),previousTitle,newTitle].filter(Boolean))];
  cb.title=newTitle;cb.author=newAuthor;cb.collection=newCollection;saveLibrary();
  const btn=$("saveCookbookMetadata");btn.textContent="Saved ✓";
  setTimeout(()=>{btn.textContent="Save changes";},900);
  $("editCookbookDialog").close();openCookbook(id);
}
async function saveActiveCookbookNotes(){if(!activeCookbookRecipe)return;const family_notes=$("cookbookRecipeNotes").value.trim();await postVault({action:"update",id:activeCookbookRecipe.id,url:activeCookbookRecipe.url,updates:{family_notes}});activeCookbookRecipe.family_notes=family_notes;}
async function showImportedSource(recipe){
  if(!recipe)return;
  const sourcePreview=recipeField(recipe,"source_page_image","sourcePageImage","pdf_page_image","pdfPageImage","page_image","pageImage");
  const sourcePage=recipeSourcePage(recipe);
  const currentBook=library.find(cb=>String(cb.id)===String(recipe.cookbook_id));
  sourceReturnToRecipe=$("cookbookRecipeDialog").open;
  if(sourceReturnToRecipe)$("cookbookRecipeDialog").close();
  if(sourcePreview){
    $("sourcePageTitle").textContent=`${currentBook?.title||recipe.cookbook_title||"Cookbook"}${sourcePage?` · Page ${sourcePage}`:""}`;
    $("sourcePagePrev").hidden=true;$("sourcePageNext").hidden=true;$("sourcePageLoading").hidden=true;
    $("sourcePageImage").src=sourcePreview;$("sourcePageImage").hidden=false;
    $("sourcePageDialog").showModal();return;
  }
  if(!sourcePage){alert("This recipe does not have a source page number saved.");if(sourceReturnToRecipe)$("cookbookRecipeDialog").showModal();return;}
  try{
    if(!activePdfDocument){
      const blob=await loadCookbookPdf([currentBook?.id,currentBook?.fileName,recipe.cookbook_title,currentBook?.title]);
      if(!blob)throw new Error("missing");
      const pdfjs=await getPdfJs();activePdfDocument=await pdfjs.getDocument({data:await blob.arrayBuffer()}).promise;
    }
    $("sourcePagePrev").hidden=false;$("sourcePageNext").hidden=false;
    await showSourcePage(sourcePage);
  }catch{
    sourceReturnToRecipe=false;
    alert("The PDF is not linked in this browser yet. Re-upload this cookbook once and choose Update existing recipes. After that, original pages will open without updating every recipe individually.");
    if(activeCookbookRecipe)$("cookbookRecipeDialog").showModal();
  }
}
async function deleteCookbook(removeRecipes){
  const cb=library.find(x=>x.id===deleteTargetId);if(!cb)return; let deletionFailed=false;
  if(removeRecipes){const matches=cookbookRecipes(cb);for(const recipe of matches){try{await postVault({action:"delete",id:recipe.id,url:recipe.url});}catch{deletionFailed=true;break;}}}
  library=library.filter(x=>x.id!==cb.id);saveLibrary();$("deleteCookbookDialog").close();renderShelf();if(deletionFailed)alert("The cookbook was removed from the shelf, but your Apps Script does not appear to support permanent recipe deletion. Its recipes were left in the vault.");
}

document.addEventListener("click",e=>{const selectNew=e.target.closest("[data-select-new]");if(selectNew){syncReviewFields();importState.candidates.forEach(r=>r.include=r.importStatus==="new");renderReview();return;}const recipeCard=e.target.closest("[data-open-cookbook-recipe-ref]");if(recipeCard){const recipe=recipes.find(item=>recipeStableRef(item)===recipeCard.dataset.openCookbookRecipeRef);if(recipe)openCookbookRecipe(recipe);else console.warn("Recipe Vault: cookbook card recipe could not be resolved",recipeCard.dataset.openCookbookRecipeRef);return;}const editBook=e.target.closest("[data-edit-cookbook]");if(editBook){beginEditCookbook(editBook.dataset.editCookbook);return;}const source=e.target.closest("[data-view-source-page]");if(source){showSourcePage(Number(source.dataset.viewSourcePage));return;}const backTop=e.target.closest("[data-back-review-top]");if(backTop){scrollReviewTop();return;}const jump=e.target.closest("[data-jump-recipe]");if(jump){const card=document.getElementById(`recipe-review-${jump.dataset.jumpRecipe}`);card?.scrollIntoView({behavior:"smooth",block:"start"});card?.classList.add("health-highlight");setTimeout(()=>card?.classList.remove("health-highlight"),1800);return;}const reviewOnly=e.target.closest("[data-show-review-only]");if(reviewOnly){const active=reviewOnly.dataset.active==="true";document.querySelectorAll("[data-review-card]").forEach(card=>card.hidden=!active&&card.dataset.health==="good");reviewOnly.dataset.active=String(!active);reviewOnly.textContent=active?"Show only flagged":"Show all recipes";return;}const report=e.target.closest("[data-parser-report]");if(report){downloadParserReport(Number(report.dataset.parserReport));return;}const open=e.target.closest("[data-open-cookbook]");if(open&&!e.target.closest("[data-delete-cookbook]")){openCookbook(open.dataset.openCookbook);return;}const del=e.target.closest("[data-delete-cookbook]");if(del){e.stopPropagation();deleteTargetId=del.dataset.deleteCookbook;const cb=library.find(x=>x.id===deleteTargetId);$("deleteCookbookMessage").textContent=`Choose what should happen to ${cb?.title||"this cookbook"}.`;$("deleteCookbookDialog").showModal();}});
$("uploadCookbookBtn").onclick=showImport;$("emptyUploadBtn").onclick=showImport;$("cancelImport").onclick=cancelImport;$("choosePdfBtn").onclick=()=>$("cookbookFile").click();$("cookbookFile").onchange=e=>e.target.files?.[0]&&analyzePdf(e.target.files[0]);
const drop=$("choosePdfPanel");["dragenter","dragover"].forEach(t=>drop.addEventListener(t,e=>{e.preventDefault();drop.classList.add("dragging")}));["dragleave","drop"].forEach(t=>drop.addEventListener(t,e=>{e.preventDefault();drop.classList.remove("dragging")}));drop.addEventListener("drop",e=>e.dataTransfer.files?.[0]&&analyzePdf(e.dataTransfer.files[0]));
$("updateExistingRecipes").onclick=updateExistingCookbookRecipes;
$("importMissingRecipes").onclick=showMissingRecipeReview;
$("cancelReimportChoice").onclick=cancelImport;
$("selectAllRecipes").onclick=()=>{syncReviewFields();importState.candidates.forEach(r=>r.include=r.importStatus!=="already");renderReview();};$("selectNoneRecipes").onclick=()=>{syncReviewFields();importState.candidates.forEach(r=>r.include=false);renderReview();};$("recipeReviewList").addEventListener("change",e=>{if(e.target.matches("[data-review-include]")){syncReviewFields();renderReview();}});$("importCookbookRecipes").onclick=importSelected;
$("cookbookSearch").oninput=renderShelf;$("cookbookRecipeSearch").oninput=renderCookbookRecipes;$("backToShelf").onclick=()=>{$("cookbookDetailView").hidden=true;$("libraryView").hidden=false;renderShelf();};
$("closeDeleteCookbook").onclick=()=>$("deleteCookbookDialog").close();$("cancelDeleteCookbook").onclick=()=>$("deleteCookbookDialog").close();$("removeCookbookOnly").onclick=()=>deleteCookbook(false);$("removeCookbookAndRecipes").onclick=()=>deleteCookbook(true);
$("reviewBackToTop").onclick=scrollReviewTop;
$("closeSourcePage").onclick=()=>{$("sourcePageDialog").close();if(sourceReturnToRecipe&&activeCookbookRecipe){sourceReturnToRecipe=false;$("cookbookRecipeDialog").showModal();}};
$("sourcePagePrev").onclick=()=>showSourcePage(activeSourcePage-1);
$("sourcePageNext").onclick=()=>showSourcePage(activeSourcePage+1);
window.addEventListener("scroll",()=>{const btn=$("reviewBackToTop");if(btn)btn.hidden=$("reviewPanel").hidden||window.scrollY<700;},{passive:true});
loadRecipes();

$("closeCookbookRecipe").onclick=()=>$("cookbookRecipeDialog").close();
$("saveCookbookRecipeNotes").onclick=async()=>{try{await saveActiveCookbookNotes();alert("Family notes saved.");}catch(e){alert(e.message);}};
$("viewCookbookSourcePage").onclick=()=>showImportedSource(activeCookbookRecipe);
$("closeEditCookbook").onclick=()=>$("editCookbookDialog").close();$("cancelEditCookbook").onclick=()=>$("editCookbookDialog").close();$("saveCookbookMetadata").onclick=saveCookbookMetadata;

