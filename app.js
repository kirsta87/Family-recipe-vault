(() => {
"use strict";

window.RECIPE_VAULT_BUILD = 252;
const $ = id => document.getElementById(id);

function on(id, eventName, handler){
  const element = $(id);
  if(!element){
    console.warn(`Missing optional element: ${id}`);
    return;
  }
  element.addEventListener(eventName, handler);
}
const SETTINGS_KEY = "recipeVaultSettingsV031";
const PLANNER_KEY = "recipeVaultWeeklyPlansV104";
const base = window.RECIPE_VAULT_CONFIG || {};
let settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
let config = {...base, ...settings};
const plannerMode = String(settings.plannerMode || "editor").toLowerCase();
const isPlannerViewer = plannerMode === "view";
let recipes = [];
let active = null;
let planner = JSON.parse(localStorage.getItem(PLANNER_KEY) || "{}");
let mealPlanRecipe = null;
let plannerSyncLoaded = false;
let plannerSaveChain = Promise.resolve();
let selectedVibes = new Set();
let surpriseRecipeId = null;

const COLLECTION_OVERRIDE_KEY = "recipeVaultCollectionOverridesV098";
const COLLECTION_OVERRIDE_TTL_MS = 15 * 60 * 1000;
const LEGACY_RECIPE_CACHE_KEY = "recipeVaultRecipeCacheV118";
const RECIPE_CACHE_DB = "recipeVaultCacheV218";
const RECIPE_CACHE_STORE = "recipeCache";
const RECIPE_CACHE_RECORD = "current";
const RECIPE_DNA_KEY = "recipeVaultRecipeDNAV141";
const RECIPE_DNA_DB = "recipeVaultRecipeDNAV220";
const RECIPE_DNA_STORE = "dna";
const RECIPE_DNA_RECORD = "current";
const RECIPE_DNA_ENGINE_VERSION = 5;
const RECIPE_METADATA_QUEUE_KEY = "recipeVaultMetadataQueueV235";
let recipeIntelligenceRunning = false;
let recipeIntelligencePromptShown = false;
let recipeDNAStore = readLegacyRecipeDNAStore();
let recipeDNAWriteTimer = null;
const recipeDNAReady = loadRecipeDNAStore().catch(error => {
  console.warn("Recipe DNA storage startup failed; using the recoverable local copy:", error);
  recipeDNAStore = readLegacyRecipeDNAStore();
  return recipeDNAStore;
});

function openRecipeCacheDB(){
  return new Promise((resolve, reject) => {
    if(!window.indexedDB){ reject(new Error("IndexedDB is unavailable.")); return; }
    const request = indexedDB.open(RECIPE_CACHE_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if(!db.objectStoreNames.contains(RECIPE_CACHE_STORE)) db.createObjectStore(RECIPE_CACHE_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open recipe cache."));
  });
}

async function readRecipeCache(){
  try{
    const db = await openRecipeCacheDB();
    const cached = await new Promise((resolve, reject) => {
      const transaction = db.transaction(RECIPE_CACHE_STORE, "readonly");
      const request = transaction.objectStore(RECIPE_CACHE_STORE).get(RECIPE_CACHE_RECORD);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error("Could not read recipe cache."));
    });
    db.close();
    const source = config.sheetCsvUrl || "recipes.json";
    if(cached && cached.source === source && Array.isArray(cached.rows)) return cached;
    try{
      const legacy = JSON.parse(localStorage.getItem(LEGACY_RECIPE_CACHE_KEY) || "null");
      if(legacy && legacy.source === source && Array.isArray(legacy.rows)) return legacy;
    }catch(error){
      console.warn("Legacy recipe cache could not be read:", error);
    }
    return null;
  }catch(error){
    console.warn("Recipe cache could not be read:", error);
    try{
      const source = config.sheetCsvUrl || "recipes.json";
      const legacy = JSON.parse(localStorage.getItem(LEGACY_RECIPE_CACHE_KEY) || "null");
      return legacy && legacy.source === source && Array.isArray(legacy.rows) ? legacy : null;
    }catch(legacyError){
      return null;
    }
  }
}

async function writeRecipeCache(rows){
  try{
    const db = await openRecipeCacheDB();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(RECIPE_CACHE_STORE, "readwrite");
      transaction.objectStore(RECIPE_CACHE_STORE).put({
        source: config.sheetCsvUrl || "recipes.json",
        savedAt: Date.now(),
        rows
      }, RECIPE_CACHE_RECORD);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Could not save recipe cache."));
      transaction.onabort = () => reject(transaction.error || new Error("Recipe cache save was aborted."));
    });
    db.close();
    try{ localStorage.removeItem(LEGACY_RECIPE_CACHE_KEY); }catch(error){ /* storage may already be full or unavailable */ }
  }catch(error){
    console.warn("Recipe cache could not be saved:", error);
  }
}

function applyRecipeRows(rows, statusText){
  recipes = applyCollectionOverrides(rows.map(clean));
  refreshRecipeIntelligence({automatic:true});
  renderFilters();
  refreshEntryCategoryMenus();
  render();
  openLinkedRecipe();
  if(statusText) $("status").textContent = statusText;
}


function readCollectionOverrides(){
  try{
    const stored = JSON.parse(localStorage.getItem(COLLECTION_OVERRIDE_KEY) || "{}");
    const now = Date.now();
    const active = {};
    Object.entries(stored).forEach(([id, entry]) => {
      if(entry && now - Number(entry.savedAt || 0) < COLLECTION_OVERRIDE_TTL_MS){
        active[id] = entry;
      }
    });
    localStorage.setItem(COLLECTION_OVERRIDE_KEY, JSON.stringify(active));
    return active;
  }catch(error){
    return {};
  }
}

function rememberCollectionOverride(recipeId, collections){
  if(!recipeId) return;
  const overrides = readCollectionOverrides();
  overrides[String(recipeId)] = {
    collections: [...new Set((collections || []).filter(Boolean))],
    savedAt: Date.now()
  };
  localStorage.setItem(COLLECTION_OVERRIDE_KEY, JSON.stringify(overrides));
}

function applyCollectionOverrides(items){
  const overrides = readCollectionOverrides();
  let changed = false;
  items.forEach(recipe => {
    const entry = overrides[String(recipe.id || "")];
    if(!entry) return;
    const sheetValues = [...new Set((recipe.collections || []).filter(Boolean))].sort();
    const savedValues = [...new Set((entry.collections || []).filter(Boolean))].sort();
    if(JSON.stringify(sheetValues) === JSON.stringify(savedValues)){
      delete overrides[String(recipe.id)];
      changed = true;
    }else{
      recipe.collections = savedValues;
    }
  });
  if(changed){
    localStorage.setItem(COLLECTION_OVERRIDE_KEY, JSON.stringify(overrides));
  }
  return items;
}

function freshDataUrl(url){
  if(!config.sheetCsvUrl) return url;
  try{
    const fresh = new URL(url);
    fresh.searchParams.set("rv", String(Date.now()));
    return fresh.toString();
  }catch(error){
    return `${url}${url.includes("?") ? "&" : "?"}rv=${Date.now()}`;
  }
}
let inlineEditingId = null;
let linkedRecipeOpened = false;

window.addEventListener("error", event => {
  const box = $("fatalError");
  box.hidden = false;
  box.textContent = `Website error: ${event.message}`;
});

function parseCSV(text){
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for(let i = 0; i < text.length; i++){
    const c = text[i];
    const n = text[i + 1];

    if(c === '"' && quoted && n === '"'){
      field += '"';
      i++;
    } else if(c === '"'){
      quoted = !quoted;
    } else if(c === "," && !quoted){
      row.push(field);
      field = "";
    } else if((c === "\n" || c === "\r") && !quoted){
      if(c === "\r" && n === "\n") i++;
      row.push(field);
      if(row.some(value => value !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }

  if(field || row.length){
    row.push(field);
    rows.push(row);
  }

  if(rows.length < 2) return [];
  const headers = rows.shift().map(value => value.trim().toLowerCase());

  return rows.map(columns => {
    const item = {};
    headers.forEach((header, index) => item[header] = columns[index] ?? "");
    return item;
  });
}

function parseStoredList(value){
  const text = String(value || "").trim();
  if(!text) return [];

  try{
    const parsed = JSON.parse(text);
    if(Array.isArray(parsed)) return parsed.map(item => String(item));
  }catch(error){
    // Older rows may use pipes or line breaks instead of JSON.
  }

  return text
    .split(/\r?\n|\|/)
    .map(item => item.trim())
    .filter(Boolean);
}

function clean(r){
  return {
    ...r,
    tags: String(r.tags || "").split("|").map(x => x.trim()).filter(Boolean),
    collections: String(r.collections || "").split("|").map(x => x.trim()).filter(Boolean),
    total_time: Number(r.total_time) || 0,
    kirsta_rating: Number(r.kirsta_rating) || 0,
    tj_rating: Number(r.tj_rating) || 0,
    torrin_rating: Number(r.torrin_rating) || 0,
    made_count: Number(r.made_count) || 0,
    hidden: String(r.hidden).toLowerCase() === "true",
    ingredients: parseStoredList(r.ingredients),
    instructions: parseStoredList(r.instructions),
    nutrition: String(r.nutrition || ""),
    pdf_url: String(r.pdf_url || ""),
    last_made: String(r.last_made || ""),
    description: String(r.description || r.author_notes || ""),
    yield: String(r.yield || ""),
    video_url: String(r.video_url || ""),
    recipe_links: parseStoredList(r.recipe_links),
    cookbook_title: String(r.cookbook_title || ""),
    cookbook_author: String(r.cookbook_author || ""),
    cookbook_page: String(r.cookbook_page || ""),
    source_page_image: String(r.source_page_image || "")
  };
}

const DEFAULT_PROTEINS = [
  "Chicken",
  "Beef",
  "Pork",
  "Turkey",
  "Seafood",
  "Vegetarian",
  "Other"
];

const DEFAULT_MEAL_TYPES = [
  "Breakfast",
  "Burgers",
  "Bowls",
  "Casserole",
  "Dessert",
  "Flatbread",
  "Pasta",
  "Pizza",
  "Salad",
  "Sandwiches",
  "Soup",
  "Tacos",
  "Other"
];

function categoryValues(field, defaults){
  return unique([
    ...defaults,
    ...recipes.map(recipe => recipe[field])
  ]);
}

function collectionValues(){
  return unique(recipes.flatMap(recipe => recipe.collections || []));
}


function multiCollectionMarkup(selectedValues = [], pickerKey = ""){
  const selected = unique((selectedValues || []).map(value => String(value).trim()).filter(Boolean));
  const available = collectionValues().filter(value => !selected.includes(value));
  return `
    <div class="multi-collection-picker" data-picker-key="${escapeHTML(pickerKey)}" data-values="${escapeHTML(selected.join("|"))}">
      <div class="collection-add-row">
        <select data-collection-choice>
          <option value="">Add a collection…</option>
          ${available.map(value => `<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`).join("")}
          <option value="__new__">Add new…</option>
        </select>
        <input data-new-collection type="text" placeholder="New collection" hidden>
        <button class="secondary collection-add-button" type="button" data-add-collection>Add</button>
      </div>
      <div class="collection-chips">
        ${selected.length ? selected.map(value => `<button class="collection-chip" type="button" data-remove-collection="${escapeHTML(value)}">${escapeHTML(value)} ×</button>`).join("") : '<span class="muted collection-empty">No collections selected</span>'}
      </div>
    </div>`;
}

function mountMultiCollectionPicker(containerId, selectedValues = []){
  const container = $(containerId);
  if(container) container.innerHTML = multiCollectionMarkup(selectedValues, containerId);
}

function pickerCollections(picker){
  if(!picker) return [];
  return unique(String(picker.dataset.values || "").split("|").map(value => value.trim()).filter(Boolean));
}

function pickerCollectionString(containerOrId){
  const container = typeof containerOrId === "string" ? $(containerOrId) : containerOrId;
  const picker = container?.matches?.(".multi-collection-picker") ? container : container?.querySelector?.(".multi-collection-picker");
  return pickerCollections(picker).join("|");
}

function refreshPicker(picker, values){
  const parent = picker.parentElement;
  const key = picker.dataset.pickerKey || "";
  parent.innerHTML = multiCollectionMarkup(values, key);
}

document.addEventListener("change", event => {
  const select = event.target.closest("[data-collection-choice]");
  if(!select) return;
  const picker = select.closest(".multi-collection-picker");
  const input = picker.querySelector("[data-new-collection]");
  input.hidden = select.value !== "__new__";
  if(!input.hidden) input.focus();
  else input.value = "";
});

document.addEventListener("click", event => {
  const removeButton = event.target.closest("[data-remove-collection]");
  if(removeButton){
    const picker = removeButton.closest(".multi-collection-picker");
    refreshPicker(picker, pickerCollections(picker).filter(value => value !== removeButton.dataset.removeCollection));
    return;
  }

  const addButton = event.target.closest("[data-add-collection]");
  if(!addButton) return;
  const picker = addButton.closest(".multi-collection-picker");
  const select = picker.querySelector("[data-collection-choice]");
  const input = picker.querySelector("[data-new-collection]");
  const value = select.value === "__new__" ? input.value.trim() : select.value.trim();
  if(!value) return;
  refreshPicker(picker, [...pickerCollections(picker), value]);
});

function fillCategorySelect(id, values, selectedValue = ""){
  const select = $(id);
  if(!select) return;

  const cleanValues = unique(values.filter(value => value && value !== "__new__"));

  select.innerHTML = [
    '<option value="">Select one</option>',
    ...cleanValues.map(value =>
      `<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`
    ),
    '<option value="__new__">Add new…</option>'
  ].join("");

  if(selectedValue && cleanValues.includes(selectedValue)){
    select.value = selectedValue;
  }else if(selectedValue){
    select.value = "__new__";
  }else{
    select.value = "";
  }
}

function setupNewCategory(selectId, inputId){
  const select = $(selectId);
  const input = $(inputId);
  if(!select || !input) return;

  const updateVisibility = () => {
    const show = select.value === "__new__";
    input.hidden = !show;
    if(show) input.focus();
    if(!show) input.value = "";
  };

  select.addEventListener("change", updateVisibility);
  updateVisibility();
}

function selectedCategory(selectId, inputId){
  const select = $(selectId);
  const input = $(inputId);

  if(!select) return "";

  if(select.value === "__new__"){
    return String(input?.value || "").trim();
  }

  return select.value;
}

function refreshEntryCategoryMenus(){
  const proteins = categoryValues("protein", DEFAULT_PROTEINS);
  const mealTypes = categoryValues("type", DEFAULT_MEAL_TYPES);
  const collections = collectionValues();

  fillCategorySelect("manualProtein", proteins);
  fillCategorySelect("manualType", mealTypes);
  mountMultiCollectionPicker("manualCollectionPicker", pickerCollections($("manualCollectionPicker")?.querySelector(".multi-collection-picker")));
}

async function loadRecipes(){
  await recipeDNAReady;
  const cached = await readRecipeCache();
  let showedCache = false;

  if(cached?.rows?.length){
    applyRecipeRows(cached.rows, "• showing saved recipes");
    showedCache = true;
  }else{
    $("status").textContent = "Loading…";
  }

  // Meal-plan data should never hold up recipe cards.
  loadSharedPlanner().then(() => render()).catch(() => undefined);

  try{
    const url = config.sheetCsvUrl || "recipes.json";
    const response = await fetch(freshDataUrl(url), {cache:"no-store"});
    if(!response.ok) throw new Error(`HTTP ${response.status}`);

    const rows = config.sheetCsvUrl
      ? parseCSV(await response.text())
      : await response.json();

    await writeRecipeCache(rows);
    applyRecipeRows(
      rows,
      config.sheetCsvUrl ? "• synced from family sheet" : "• starter mode"
    );
  }catch(error){
    if(showedCache){
      $("status").textContent = "• showing saved recipes; refresh delayed";
    }else{
      recipes = [];
      $("status").textContent = `• load failed: ${error.message}`;
      renderFilters();
      refreshEntryCategoryMenus();
      render();
    }
  }
}

function unique(values){
  return [...new Set(values.filter(Boolean))].sort((a,b) => a.localeCompare(b));
}

function renderFilters(){
  populateSelect("proteinSelect", unique(recipes.map(r => r.protein)));
  populateSelect("typeSelect", unique(recipes.map(r => r.type)));
  populateSelect("cuisineSelect", unique(recipes.map(r => r.cuisine)));
  populateSelect("collectionSelect", unique(recipes.flatMap(r => r.collections || [])));
}

function populateSelect(id, values){
  const select = $(id);
  if(!select) return;

  const current = select.value;
  const first = select.options[0].outerHTML;

  select.innerHTML =
    first +
    values.map(value =>
      `<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`
    ).join("");

  if(values.includes(current)){
    select.value = current;
  }
}

function escapeHTML(value){
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"
  })[c]);
}

function normalizeSearchText(value){
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function searchTokens(query){
  return [...new Set(
    normalizeSearchText(query)
      .split(/\s+/)
      .map(token => token.trim())
      .filter(Boolean)
  )];
}

function searchScore(recipe, query){
  const normalizedQuery = normalizeSearchText(query);
  if(!normalizedQuery) return {score:0, reason:""};

  const tokens = searchTokens(normalizedQuery);
  if(!tokens.length) return {score:0, reason:""};

  const buckets = [
    {weight:100, label:"ingredient match", values:recipe.ingredients || []},
    {weight:85, label:"title match", values:[recipe.name]},
    {weight:65, label:"category match", values:[recipe.protein, recipe.type, recipe.cuisine, ...(recipe.tags || []), ...(recipe.collections || [])]},
    {weight:40, label:"family note match", values:[recipe.notes, recipe.torrin_notes]},
    {weight:20, label:"instruction match", values:recipe.instructions || []}
  ].map(bucket => ({
    ...bucket,
    text: normalizeSearchText(bucket.values.filter(Boolean).join(" "))
  }));

  const allSearchableText = buckets.map(bucket => bucket.text).join(" ");

  // AND search: every word must appear somewhere in the recipe.
  if(!tokens.every(token => allSearchableText.includes(token))){
    return {score:0, reason:""};
  }

  let score = 0;
  let bestBucket = null;

  buckets.forEach(bucket => {
    const matchedTokens = tokens.filter(token => bucket.text.includes(token));
    if(!matchedTokens.length) return;

    const coverage = matchedTokens.length / tokens.length;
    const bucketScore = bucket.weight * coverage;
    score += bucketScore;

    if(!bestBucket || bucketScore > bestBucket.bucketScore){
      bestBucket = {...bucket, bucketScore, matchedTokens};
    }
  });

  const titleText = normalizeSearchText(recipe.name);
  const ingredientText = normalizeSearchText((recipe.ingredients || []).join(" "));
  const categoryText = normalizeSearchText([
    recipe.protein,
    recipe.type,
    recipe.cuisine,
    ...(recipe.tags || []),
    ...(recipe.collections || [])
  ].filter(Boolean).join(" "));

  // Exact phrase bonuses.
  if(titleText === normalizedQuery) score += 120;
  else if(titleText.includes(normalizedQuery)) score += 70;

  if(ingredientText.includes(normalizedQuery)) score += 45;
  if(categoryText.includes(normalizedQuery)) score += 25;

  // Extra relevance when all words appear together within one strong field.
  if(tokens.every(token => ingredientText.includes(token))) score += 35;
  if(tokens.every(token => titleText.includes(token))) score += 50;
  if(tokens.every(token => categoryText.includes(token))) score += 20;

  let reason = bestBucket?.label || "recipe match";

  const matchingBucketLabels = buckets
    .filter(bucket => tokens.some(token => bucket.text.includes(token)))
    .sort((a,b) => b.weight - a.weight)
    .map(bucket => bucket.label);

  if(matchingBucketLabels.length > 1 && !tokens.every(token => bestBucket?.text.includes(token))){
    reason = "matches across recipe";
  }

  return {score, reason};
}


const VIBE_PROFILES = {
  mexican:{label:"Mexican night", minimum:26, terms:["mexican","tex mex","tex-mex","taco","tacos","burrito","burritos","quesadilla","enchilada","fajita","nachos","tortilla","salsa","pico","cilantro","chipotle","adobo"], penalties:["italian","alfredo","teriyaki"]},
  pasta:{label:"Pasta night", minimum:24, terms:["pasta","spaghetti","penne","rotini","rigatoni","linguine","fettuccine","alfredo","lasagna","ravioli","tortellini","gnocchi","mac and cheese","macaroni"]},
  handheld:{label:"Tacos & handhelds", minimum:22, terms:["taco","burrito","quesadilla","sandwich","burger","wrap","sub","slider","hot dog","panini","pita","gyro"]},
  cold:{label:"Cold & fresh", minimum:58},
  cozy:{label:"Cozy night", minimum:35},
  light:{label:"Fresh & light", minimum:32},
  hearty:{label:"Hearty & filling", minimum:32},
  easy:{label:"Quick & easy", minimum:30},
  summer:{label:"Summer / grilled", minimum:34},
  creamy:{label:"Creamy & cheesy", minimum:30},
  comfort:{label:"Comfort food", minimum:34},
  grill:{label:"Grill night", minimum:22, terms:["grill","grilled","barbecue","bbq","kabob","kebab","skewer","smoker","smoked"]},
  crockpot:{label:"Crockpot", minimum:22, terms:["crockpot","slow cooker","cook on low","cook on high"]},
  chicken:{label:"Chicken dinner", minimum:18, terms:["chicken","chicken breast","chicken thigh","rotisserie chicken"]},
  beef:{label:"Beef dinner", minimum:18, terms:["beef","steak","ground beef","roast","sirloin","brisket"]},
  bowls:{label:"Bowls & salads", minimum:22, terms:["bowl","salad","pasta salad","grain bowl","rice bowl","taco bowl","power bowl"]},
  breakfast:{label:"Breakfast", minimum:20, terms:["breakfast","brunch","pancake","waffle","egg","omelet","french toast","oatmeal","biscuit","hash brown"]},
  crowd:{label:"Crowd pleaser", minimum:24, terms:["party","potluck","crowd","slider","dip","nachos","casserole","sheet pan","barbecue","bbq","pizza"]}
};

function emptyRecipeDNAStore(){
  return {engineVersion:0,lastFullCheck:0,recipes:{}};
}

function normalizeRecipeDNAStore(stored){
  if(!stored || typeof stored !== "object") return emptyRecipeDNAStore();
  return {
    engineVersion:Number(stored.engineVersion || 0),
    lastFullCheck:Number(stored.lastFullCheck || 0),
    recipes:stored.recipes && typeof stored.recipes === "object" ? stored.recipes : {}
  };
}

function readLegacyRecipeDNAStore(){
  try{ return normalizeRecipeDNAStore(JSON.parse(localStorage.getItem(RECIPE_DNA_KEY) || "null")); }
  catch(error){ return emptyRecipeDNAStore(); }
}

function openRecipeDNADB(){
  return new Promise((resolve,reject) => {
    if(!window.indexedDB){ reject(new Error("IndexedDB is unavailable.")); return; }
    const request=indexedDB.open(RECIPE_DNA_DB,1);
    request.onupgradeneeded=()=>{
      const db=request.result;
      if(!db.objectStoreNames.contains(RECIPE_DNA_STORE)) db.createObjectStore(RECIPE_DNA_STORE);
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error || new Error("Could not open Recipe DNA storage."));
  });
}

async function loadRecipeDNAStore(){
  const legacy=readLegacyRecipeDNAStore();
  try{
    const db=await openRecipeDNADB();
    const stored=await new Promise((resolve,reject)=>{
      const tx=db.transaction(RECIPE_DNA_STORE,"readonly");
      const request=tx.objectStore(RECIPE_DNA_STORE).get(RECIPE_DNA_RECORD);
      request.onsuccess=()=>resolve(request.result || null);
      request.onerror=()=>reject(request.error || new Error("Could not read Recipe DNA."));
    });
    db.close();
    recipeDNAStore=stored ? normalizeRecipeDNAStore(stored) : legacy;
    if(!stored && Object.keys(legacy.recipes).length) await writeRecipeDNAStore();
    try{ localStorage.removeItem(RECIPE_DNA_KEY); }catch(error){ /* legacy storage may be unavailable */ }
  }catch(error){
    recipeDNAStore=legacy;
    console.warn("Recipe DNA IndexedDB could not be loaded; using the in-memory copy for this visit:", error);
  }
  return recipeDNAStore;
}

async function writeRecipeDNAStore(){
  const db=await openRecipeDNADB();
  try{
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(RECIPE_DNA_STORE,"readwrite");
      tx.objectStore(RECIPE_DNA_STORE).put(recipeDNAStore,RECIPE_DNA_RECORD);
      tx.oncomplete=resolve;
      tx.onerror=()=>reject(tx.error || new Error("Could not save Recipe DNA."));
      tx.onabort=()=>reject(tx.error || new Error("Recipe DNA save was aborted."));
    });
  }finally{ db.close(); }
}

function scheduleRecipeDNAWrite(){
  clearTimeout(recipeDNAWriteTimer);
  recipeDNAWriteTimer=setTimeout(()=>{
    writeRecipeDNAStore().catch(error=>console.warn("Recipe intelligence could not be saved:",error));
  },350);
}

function recipeVibeText(recipe){
  return normalizeSearchText([
    recipe.name, recipe.protein, recipe.type, recipe.cuisine, recipe.notes, recipe.torrin_notes,
    ...(recipe.tags || []), ...(recipe.collections || []),
    ...(recipe.ingredients || []), ...(recipe.instructions || [])
  ].filter(Boolean).join(" "));
}

function recipeDNAFingerprint(recipe){
  const source = JSON.stringify({
    name:recipe.name || "", protein:recipe.protein || "", type:recipe.type || "", cuisine:recipe.cuisine || "",
    tags:recipe.tags || [], collections:recipe.collections || [], ingredients:recipe.ingredients || [],
    instructions:recipe.instructions || [], total_time:Number(recipe.total_time || 0)
  });
  let hash = 2166136261;
  for(let index=0; index<source.length; index++){
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function phraseHits(text, phrases){
  return phrases.reduce((count, phrase) => count + (text.includes(normalizeSearchText(phrase)) ? 1 : 0), 0);
}

function analyzeRecipeDNA(recipe){
  const text = recipeVibeText(recipe);
  const title = normalizeSearchText(recipe.name || "");
  const instructions = normalizeSearchText((recipe.instructions || []).join(" "));
  const ingredients = normalizeSearchText((recipe.ingredients || []).join(" "));
  const type = normalizeSearchText(recipe.type || "");
  const cuisine = normalizeSearchText(recipe.cuisine || "");
  const minutes = Number(recipe.total_time || 0);
  const scores = {
    cold:0, cozy:0, light:0, hearty:0, easy:0, summer:0, creamy:0, comfort:0,
    handheld:0, pasta:0, bowl:0, crockpot:0, chicken:0, beef:0, crowd:0, breakfast:0
  };
  const traits = {
    temperature:[], method:[], texture:[], season:[], effort:[], style:[],
    dish:[], protein:[], occasion:[], cuisine:[]
  };
  const add = (key, amount, haystack=text, phrases=[]) => {
    scores[key] += phraseHits(haystack, phrases) * amount;
  };
  const has = (haystack, phrases) => phraseHits(haystack, phrases) > 0;

  const coldStrong = ["serve chilled","served chilled","chill before serving","refrigerate before serving","serve cold","cold pasta salad","pasta salad","chicken salad","tuna salad","egg salad","no cook","no-cook","overnight oats","smoothie","cold noodles","chilled soup","poke bowl","ceviche"];
  const coldDish = ["salad","slaw","caprese","fruit salad","pasta salad","sandwich","wrap","summer roll"];
  const hotStrong = ["serve hot","serve warm","crockpot","slow cooker","cook on low","cook on high","bake at","preheat oven","roast for","simmer","boil","casserole","soup","stew","pot roast","braise"];
  const activeCooking = ["crockpot","slow cooker","bake","baked","roast","roasted","simmer","boil","fry","fried","air fryer","grill","grilled","skillet","stovetop"];
  const coldStrongHits = phraseHits(text,coldStrong);
  const hotHits = phraseHits(instructions + " " + title,hotStrong);
  const activeCookingHits = phraseHits(instructions,activeCooking);

  scores.cold += coldStrongHits * 38 + phraseHits(title + " " + type,coldDish) * 22;
  if(has(instructions,["refrigerate","chill","serve cold","serve chilled","cool completely"])) scores.cold += 32;
  if(hotHits) scores.cold -= hotHits * 30;
  if(activeCookingHits && !coldStrongHits && !has(instructions,["cool completely","chill","refrigerate"])) scores.cold -= 24;

  add("cozy",18,text,["soup","stew","casserole","pot pie","chili","bisque","dumpling","roast","slow cooker","crockpot","baked pasta","mac and cheese","braise"]);
  add("cozy",8,text,["creamy","warming","comfort","gravy"]);
  scores.cozy -= coldStrongHits * 22;

  add("light",8,text,["salad","lettuce","cucumber","zucchini","vegetable","veggie","lemon","citrus","herb","fruit","bruschetta","grilled chicken","shrimp","vinaigrette"]);
  scores.light += coldStrongHits * 11;
  add("light",-14,text,["heavy cream","fried","loaded","alfredo","mac and cheese","gravy","cream cheese","smothered"]);

  add("hearty",9,text,["beef","pork","potato","pasta","rice","burger","roast","stew","chili","casserole","sausage","meatball","biscuits","gravy","burrito","quesadilla"]);
  add("hearty",15,title,["loaded","smothered","hearty","stuffed"]);

  add("easy",13,text,["sheet pan","one pan","one pot","slow cooker","crockpot","air fryer","skillet","dump and go","no cook","no-cook","sandwich","quesadilla","taco","burrito bowl"]);
  if(minutes > 0 && minutes <= 20) scores.easy += 32;
  else if(minutes > 0 && minutes <= 35) scores.easy += 22;
  else if(minutes > 75) scores.easy -= 10;
  add("easy",-15,text,["homemade dough","from scratch","marinate overnight","multiple batches"]);

  add("summer",10,text,["grill","grilled","bbq","barbecue","summer","peach","corn","tomato","bruschetta","lemon","lime","watermelon","kabob","skewer","burrata"]);
  scores.summer += coldStrongHits * 15;
  add("summer",-17,text,["stew","pot pie","braise","winter"]);

  add("creamy",12,ingredients + " " + title,["heavy cream","cream cheese","sour cream","alfredo","parmesan","mozzarella","gouda","cheddar","burrata","cheese sauce","mac and cheese","queso"]);
  add("creamy",24,title,["creamy","cheesy"]);

  add("comfort",10,text,["fried","burger","mashed potato","gravy","mac and cheese","casserole","pot pie","meatloaf","biscuits","cheesy","creamy","loaded","smothered","comfort","burrito","quesadilla","pizza"]);
  scores.comfort += scores.cozy * .35;

  // Dish-family scores make every recipe discoverable through a useful shortcut.
  add("handheld",34,title + " " + type,["taco","tacos","burrito","burritos","quesadilla","wrap","sandwich","burger","slider","gyro","pita","enchilada","taquito","hot dog"]);
  add("handheld",12,text,["tortilla","taco shell","hamburger bun","brioche bun","wrap"]);
  add("pasta",34,title + " " + type,["pasta","spaghetti","fettuccine","linguine","rigatoni","penne","rotini","macaroni","lasagna","ravioli","tortellini","noodle"]);
  add("pasta",12,ingredients,["pasta","spaghetti","fettuccine","linguine","rigatoni","penne","rotini","macaroni","lasagna noodles","egg noodles"]);
  add("bowl",30,title + " " + type,["bowl","salad","slaw","grain bowl","rice bowl","poke"]);
  add("bowl",10,text,["serve over rice","serve in bowls","lettuce","mixed greens"]);
  add("crockpot",42,text,["crockpot","slow cooker","cook on low","cook on high"]);
  add("chicken",28,title + " " + type,["chicken","turkey"]);
  add("chicken",18,ingredients,["chicken breast","chicken thigh","ground chicken","rotisserie chicken","ground turkey"]);
  add("beef",28,title + " " + type,["beef","steak","burger","roast","meatball"]);
  add("beef",18,ingredients,["ground beef","beef roast","chuck roast","steak","sirloin","brisket"]);
  add("breakfast",38,title + " " + type,["breakfast","brunch","pancake","waffle","french toast","omelet","frittata","egg bake","oatmeal","overnight oats","muffin"]);
  add("breakfast",12,text,["breakfast sausage","hash brown","maple syrup"]);
  add("crowd",12,text,["casserole","sheet pan","slow cooker","crockpot","party","potluck","game day","slider","taco bar","baked pasta"]);
  scores.crowd += Math.max(scores.comfort,0) * .25 + Math.max(scores.easy,0) * .18;
  if(has(title,["family","party","crowd","big batch"])) scores.crowd += 25;

  // Cuisine traits improve natural-language searches without taking over the visible metadata.
  const cuisineMap = {
    mexican:["mexican","taco","burrito","quesadilla","enchilada","salsa","cilantro","tortilla"],
    italian:["italian","pasta","parmesan","mozzarella","marinara","bruschetta","pesto"],
    asian:["asian","soy sauce","sesame","teriyaki","stir fry","ramen","rice noodles"],
    greek:["greek","feta","tzatziki","gyro","oregano"],
    bbq:["bbq","barbecue","smoked","smoker"]
  };
  Object.entries(cuisineMap).forEach(([name,words]) => {
    if(has(cuisine + " " + text,words)) traits.cuisine.push(name);
  });

  if(scores.cold >= 52){ traits.temperature.push("cold"); traits.style.push("fresh"); }
  else if(hotHits || activeCookingHits) traits.temperature.push("hot");
  else traits.temperature.push("room temperature");
  if(has(text,["crockpot","slow cooker"])) traits.method.push("crockpot");
  if(has(text,["grill","grilled","bbq"])) traits.method.push("grill");
  if(has(text,["no cook","no-cook"]) || (coldStrongHits && !activeCookingHits)) traits.method.push("no cook");
  if(has(text,["air fryer"])) traits.method.push("air fryer");
  if(has(text,["bake","baked","oven","roast"])) traits.method.push("oven");
  if(has(text,["skillet","stovetop","saute","sauté"])) traits.method.push("stovetop");
  if(scores.creamy >= 25) traits.texture.push("creamy or cheesy");
  if(scores.light >= 28) traits.style.push("light");
  if(scores.hearty >= 28) traits.style.push("hearty");
  if(scores.cozy >= 30) traits.style.push("cozy");
  if(scores.comfort >= 28) traits.style.push("comfort");
  if(scores.summer >= 28) traits.season.push("summer");
  if(scores.easy >= 25) traits.effort.push("low effort");
  if(scores.handheld >= 30) traits.dish.push("handheld");
  if(scores.pasta >= 30) traits.dish.push("pasta");
  if(scores.bowl >= 28) traits.dish.push("bowl or salad");
  if(scores.breakfast >= 30) traits.dish.push("breakfast");
  if(scores.chicken >= 28) traits.protein.push("chicken");
  if(scores.beef >= 28) traits.protein.push("beef");
  if(scores.crowd >= 26) traits.occasion.push("crowd pleaser");

  Object.keys(scores).forEach(key => scores[key] = Math.round(scores[key]));
  return {fingerprint:recipeDNAFingerprint(recipe), analyzedAt:Date.now(), scores, traits};
}

function inferVisibleRecipeMetadata(recipe, dna){
  const text = normalizeSearchText([
    recipe.name, recipe.cuisine, ...(recipe.tags || []), ...(recipe.collections || []),
    ...(recipe.ingredients || []), ...(recipe.instructions || [])
  ].filter(Boolean).join(" "));
  const title = normalizeSearchText(recipe.name || "");
  const hasAny = terms => terms.some(term => text.includes(normalizeSearchText(term)));
  const titleHas = terms => terms.some(term => title.includes(normalizeSearchText(term)));

  let protein = String(recipe.protein || "").trim();
  if(!protein){
    if(hasAny(["chicken","rotisserie chicken"])) protein = "Chicken";
    else if(hasAny(["ground turkey","turkey breast","turkey sausage","turkey meatball"])) protein = "Turkey";
    else if(hasAny(["ground beef","beef","steak","sirloin","brisket","chuck roast","pot roast"])) protein = "Beef";
    else if(hasAny(["pork","bacon","ham","prosciutto","sausage","pulled pork"])) protein = "Pork";
    else if(hasAny(["shrimp","salmon","tuna","cod","tilapia","fish","crab","lobster","scallop"])) protein = "Seafood";
    else if(hasAny(["tofu","tempeh","lentil","chickpea","black bean","white bean","kidney bean"]) || !hasAny(["chicken","turkey","beef","steak","pork","bacon","ham","sausage","shrimp","salmon","tuna","fish"])) protein = "Vegetarian";
    else protein = "Other";
  }

  let type = String(recipe.type || "").trim();
  if(!type){
    if(titleHas(["breakfast","pancake","waffle","french toast","omelet","oatmeal","egg bake","breakfast burrito"])) type = "Breakfast";
    else if(titleHas(["burger","cheeseburger","hamburger"])) type = "Burgers";
    else if(titleHas(["bowl","rice bowl","grain bowl","power bowl"])) type = "Bowls";
    else if(titleHas(["casserole","bake"])) type = "Casserole";
    else if(titleHas(["cake","cookie","brownie","pie","cheesecake","pudding","dessert","cobbler","crisp"])) type = "Dessert";
    else if(titleHas(["flatbread"])) type = "Flatbread";
    else if(titleHas(["pasta","spaghetti","penne","rigatoni","fettuccine","linguine","lasagna","ravioli","tortellini","gnocchi","mac and cheese","macaroni"])) type = "Pasta";
    else if(titleHas(["pizza"])) type = "Pizza";
    else if(titleHas(["salad","slaw"])) type = "Salad";
    else if(titleHas(["sandwich","slider","wrap","panini","sub","gyro","pita"])) type = "Sandwiches";
    else if(titleHas(["soup","stew","chili","bisque","chowder"])) type = "Soup";
    else if(titleHas(["taco","burrito","quesadilla","enchilada","fajita","nacho"])) type = "Tacos";
    else if(dna?.traits?.dish?.includes("pasta")) type = "Pasta";
    else if(dna?.traits?.dish?.includes("breakfast")) type = "Breakfast";
    else if(dna?.traits?.dish?.includes("handheld")) type = "Sandwiches";
    else if(dna?.traits?.dish?.includes("bowl or salad")) type = titleHas(["salad","slaw"]) ? "Salad" : "Bowls";
    else type = "Other";
  }
  return {protein, type};
}

function recipeNeedsVisibleMetadata(recipe){
  return !String(recipe.protein || "").trim() || !String(recipe.type || "").trim();
}

function recipeIntelligenceCandidates({force=false}={}){
  // Normal runs focus on recipes that actually need visible metadata.
  // A manual full recheck can still rebuild hidden DNA for everything.
  return recipes.filter(recipe => {
    if(force) return true;
    const id = String(recipe.id || recipe.name || "");
    const current = recipeDNAStore.recipes[id];
    return recipeNeedsVisibleMetadata(recipe) || !current || current.fingerprint !== recipeDNAFingerprint(recipe);
  });
}

function cleanRecipeDNAStore(){
  const liveIds = new Set(recipes.map(recipe => String(recipe.id || recipe.name || "")));
  Object.keys(recipeDNAStore.recipes).forEach(id => { if(!liveIds.has(id)) delete recipeDNAStore.recipes[id]; });
}

function readMetadataQueue(){
  try{
    const value = JSON.parse(localStorage.getItem(RECIPE_METADATA_QUEUE_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  }catch(error){ return []; }
}

function writeMetadataQueue(queue){
  try{ localStorage.setItem(RECIPE_METADATA_QUEUE_KEY, JSON.stringify(queue)); }catch(error){
    console.warn("Could not checkpoint Recipe DNA metadata queue:", error);
  }
}

async function postVaultWithTimeout(payload, timeoutMs=20000){
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try{
    if(!requireWriteConnection()) return null;
    const form = new URLSearchParams();
    form.set("payload", JSON.stringify({...payload, key: config.sharedKey}));
    const response = await fetch(config.appsScriptUrl, {
      method:"POST", body:form, redirect:"follow", signal:controller.signal
    });
    const result = await response.json();
    if(!result.success) throw new Error(result.error || "Request failed");
    return result;
  }finally{ clearTimeout(timer); }
}

async function drainRecipeMetadataQueue({onProgress}={}){
  let queue = readMetadataQueue();
  if(!queue.length) return {saved:0, remaining:0};
  let saved = 0;
  const concurrency = 5;

  while(queue.length){
    const batch = queue.slice(0, concurrency);
    const results = await Promise.allSettled(batch.map(async item => {
      let lastError;
      for(let attempt=0; attempt<2; attempt++){
        try{
          await postVaultWithTimeout({action:"update", id:item.id, url:item.url, updates:item.updates});
          return item;
        }catch(error){
          lastError = error;
          await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
        }
      }
      throw lastError;
    }));

    const failed = [];
    results.forEach((result,index) => {
      const item = batch[index];
      if(result.status === "fulfilled"){
        saved++;
        const recipe = recipes.find(r => String(r.id || "") === String(item.id || "")) || recipes.find(r => r.url && r.url === item.url);
        if(recipe) Object.assign(recipe, item.updates);
      }else{
        failed.push(item);
        console.warn("Recipe metadata save will retry later:", item, result.reason);
      }
    });

    queue = queue.slice(batch.length).concat(failed);
    writeMetadataQueue(queue);
    if(onProgress) onProgress(saved, queue.length);

    // If every item in this batch failed, stop instead of looping forever.
    if(failed.length === batch.length) break;
    await new Promise(resolve => setTimeout(resolve, 120));
  }
  return {saved, remaining:queue.length};
}

function setIntelligenceDialogMode(mode){
  const prompt = $("recipeIntelligencePrompt");
  const progress = $("recipeIntelligenceProgress");
  const complete = $("recipeIntelligenceComplete");
  if(prompt) prompt.hidden = mode !== "prompt";
  if(progress) progress.hidden = mode !== "progress";
  if(complete) complete.hidden = mode !== "complete";
}

function showRecipeIntelligencePrompt(count, engineChanged){
  const dialog = $("recipeIntelligenceDialog");
  if(!dialog || dialog.open || recipeIntelligenceRunning) return;
  const heading = $("recipeIntelligenceHeading");
  const message = $("recipeIntelligenceMessage");
  if(heading) heading.textContent = "Analyze missing recipe details";
  if(message) message.textContent = `Recipe Vault found ${count} recipe${count===1?"":"s"} that need Recipe DNA or updated details. Missing Protein and Meal Type fields will be filled without overwriting anything you entered.`;
  setIntelligenceDialogMode("prompt");
  dialog.showModal();
  recipeIntelligencePromptShown = true;
}

function showRecipeIntelligenceError(error){
  recipeIntelligenceRunning = false;
  const dialog = $("recipeIntelligenceDialog");
  const message = error?.name === "AbortError" ? "The server took too long to answer. Unsaved recipes were checkpointed and will resume automatically." : (error?.message || String(error || "Recipe analysis failed."));
  const status = $("recipeIntelligenceStatus");
  const current = $("recipeIntelligenceCurrent");
  const traits = $("recipeIntelligenceTraits");
  if(status) status.textContent = `Recipe analysis paused: ${message}`;
  if(current) current.textContent = "Saving paused safely";
  if(traits) traits.textContent = message;
  if(dialog && !dialog.open){ try{ dialog.showModal(); }catch(showError){ console.error(showError); } }
  setIntelligenceDialogMode("progress");
  console.error("Recipe Intelligence paused:", error);
}

function startRecipeIntelligenceAnalysis({force=false}={}){
  if(recipeIntelligenceRunning) return;
  let candidates;
  try{ candidates = recipeIntelligenceCandidates({force}); }
  catch(error){ showRecipeIntelligenceError(error); return; }

  const dialog = $("recipeIntelligenceDialog");
  const existingQueue = readMetadataQueue();
  if(!candidates.length && !existingQueue.length){
    const status = $("recipeIntelligenceStatus");
    if(status) status.textContent = `Recipe Intelligence engine v${RECIPE_DNA_ENGINE_VERSION} is current.`;
    if(dialog?.open) dialog.close();
    return;
  }

  recipeIntelligenceRunning = true;
  if(dialog && !dialog.open) dialog.showModal();
  setIntelligenceDialogMode("progress");
  const bar = $("recipeIntelligenceBar");
  const countText = $("recipeIntelligenceCount");
  const currentText = $("recipeIntelligenceCurrent");
  const traitText = $("recipeIntelligenceTraits");
  const status = $("recipeIntelligenceStatus");
  if(status) status.textContent = `Analyzing ${candidates.length} recipe${candidates.length===1?"":"s"} locally…`;

  let index = 0;
  let traitCount = 0;
  const queuedByKey = new Map(existingQueue.map(item => [String(item.id || item.url || ""), item]));
  const startedAt = Date.now();

  const finishAnalysis = async () => {
    cleanRecipeDNAStore();
    recipeDNAStore.engineVersion = RECIPE_DNA_ENGINE_VERSION;
    recipeDNAStore.lastFullCheck = Date.now();
    const queue = Array.from(queuedByKey.values());
    writeMetadataQueue(queue);
    await writeRecipeDNAStore();

    if(!queue.length){
      recipeIntelligenceRunning = false;
      const doneText = $("recipeIntelligenceDoneText");
      if(doneText) doneText.textContent = `${candidates.length} recipe${candidates.length===1?"":"s"} analyzed. No blank Protein or Meal Type fields needed saving.`;
      setIntelligenceDialogMode("complete");
      return;
    }

    if(countText) countText.textContent = `Saving 0 of ${queue.length} recipes…`;
    if(currentText) currentText.textContent = "Saving categories safely";
    if(traitText) traitText.textContent = "Progress is checkpointed. Closing this window will not lose completed work.";
    if(status) status.textContent = `Saving ${queue.length} recipe categorization${queue.length===1?"":"s"}…`;

    const result = await drainRecipeMetadataQueue({onProgress:(saved,remaining)=>{
      const total = saved + remaining;
      if(countText) countText.textContent = `Saving recipe ${saved} of ${total} · ${remaining} remaining`;
      if(bar){ const pct = total ? Math.round(saved/total*100) : 100; bar.value=pct; bar.textContent=`${pct}%`; }
    }});

    recipeIntelligenceRunning = false;
    const elapsed = Math.max(1, Math.round((Date.now() - startedAt)/1000));
    const doneText = $("recipeIntelligenceDoneText");
    if(result.remaining){
      if(doneText) doneText.textContent = `${result.saved} recipes saved. ${result.remaining} are safely queued and will retry the next time Recipe Vault opens. You do not need to restart the full analysis.`;
    }else{
      if(doneText) doneText.textContent = `${candidates.length} recipes analyzed. ${result.saved} missing Protein/Meal Type fields filled. ${traitCount.toLocaleString()} hidden traits identified in ${elapsed} seconds.`;
    }
    setIntelligenceDialogMode("complete");
    if(status) status.textContent = result.remaining ? `${result.remaining} Recipe DNA updates queued for retry` : `Recipe Intelligence is current · engine v${RECIPE_DNA_ENGINE_VERSION}`;
    renderFilters(); refreshEntryCategoryMenus(); render();
  };

  const step = () => {
    try{
      const chunkEnd = Math.min(index + 30, candidates.length);
      for(; index < chunkEnd; index++){
        const recipe = candidates[index];
        const id = String(recipe.id || recipe.name || "");
        const dna = analyzeRecipeDNA(recipe);
        recipeDNAStore.recipes[id] = dna;
        const inferred = inferVisibleRecipeMetadata(recipe, dna);
        const updates = {};
        if(!String(recipe.protein || "").trim() && inferred.protein) updates.protein = inferred.protein;
        if(!String(recipe.type || "").trim() && inferred.type) updates.type = inferred.type;
        if(Object.keys(updates).length){
          Object.assign(recipe, updates); // instant in-session result
          queuedByKey.set(String(recipe.id || recipe.url || recipe.name || ""), {id:recipe.id, url:recipe.url, updates});
        }
        traitCount += Object.values(dna.traits || {}).reduce((sum, values) => sum + (Array.isArray(values) ? values.length : 0), 0);
        if(currentText) currentText.textContent = recipe.name || "Untitled recipe";
        if(traitText){
          const traits = Object.values(dna.traits || {}).flat();
          traitText.textContent = traits.length ? `Detected: ${traits.slice(0,6).join(" · ")}` : "Analyzing cooking method, temperature, effort, and style…";
        }
      }
      const percent = candidates.length ? Math.round(index/candidates.length*100) : 100;
      if(bar){ bar.value=percent; bar.textContent=`${percent}%`; }
      if(countText) countText.textContent = `Analyzing recipe ${index} of ${candidates.length} · ${percent}%`;
      if(index < candidates.length){ setTimeout(step, 0); return; }
      finishAnalysis().catch(showRecipeIntelligenceError);
    }catch(error){ showRecipeIntelligenceError(error); }
  };
  setTimeout(step, 0);
}

function refreshRecipeIntelligence({force=false,automatic=false}={}){
  const engineChanged = recipeDNAStore.engineVersion !== RECIPE_DNA_ENGINE_VERSION;
  const candidates = recipeIntelligenceCandidates({force});
  cleanRecipeDNAStore();

  // A single edited/imported recipe can update quietly. A first run or engine upgrade gets a visible review prompt.
  if(automatic && candidates.length && !force){
    if(engineChanged || candidates.length > 5){
      const status = $("recipeIntelligenceStatus");
      if(status) status.textContent = `${candidates.length} recipe${candidates.length===1?"":"s"} ready for Recipe Intelligence analysis.`;
      if(!recipeIntelligencePromptShown) setTimeout(() => showRecipeIntelligencePrompt(candidates.length, engineChanged), 120);
      return candidates.length;
    }
    candidates.forEach(recipe => {
      const id = String(recipe.id || recipe.name || "");
      recipeDNAStore.recipes[id] = analyzeRecipeDNA(recipe);
    });
    recipeDNAStore.engineVersion = RECIPE_DNA_ENGINE_VERSION;
    scheduleRecipeDNAWrite();
  }else if(force){
    startRecipeIntelligenceAnalysis({force:true});
    return candidates.length;
  }

  const status = $("recipeIntelligenceStatus");
  if(status && !candidates.length) status.textContent = `Recipe Intelligence is current · engine v${RECIPE_DNA_ENGINE_VERSION}`;
  if(!automatic) render();
  return candidates.length;
}

function inferredVibesFromText(value){
  const text = normalizeSearchText(value);
  const found = new Set();
  const aliases = {
    cold:["cold","chilled","fresh","no cook","salad","hot outside"],
    cozy:["cozy","warm","warming","soup weather","cold outside"],
    light:["light","not heavy","healthyish","healthy ish","bright"],
    hearty:["hearty","filling","substantial","hungry"],
    easy:["easy","quick","lazy","low effort","dont want to cook","do not want to cook","weeknight"],
    summer:["summer","grill","grilled","hot outside","heat wave","backyard"],
    creamy:["creamy","cheesy","cheese"],
    comfort:["comfort","comforting","indulgent","craving"],
    handheld:["taco","tacos","burrito","burritos","quesadilla","sandwich","burger","wrap","handheld","mexican night"],
    pasta:["pasta","spaghetti","noodles","italian night"],
    bowl:["bowl","salad","rice bowl","grain bowl"],
    crockpot:["crockpot","slow cooker","dump meal"],
    chicken:["chicken","turkey"],
    beef:["beef","steak","burger","roast"],
    crowd:["crowd","company","people coming over","potluck","party","game day"],
    breakfast:["breakfast","brunch","breakfast for dinner"]
  };
  Object.entries(aliases).forEach(([key,phrases]) => {
    if(phrases.some(phrase => text.includes(normalizeSearchText(phrase)))) found.add(key);
  });
  return found;
}

function activeVibes(){
  const combined = new Set(selectedVibes);
  inferredVibesFromText($("vibeInput")?.value || "").forEach(vibe => combined.add(vibe));
  return combined;
}

function profileTextScore(recipe, profile){
  const text = recipeVibeText(recipe);
  const title = normalizeSearchText(recipe.name || "");
  let score = 0;
  (profile.terms || []).forEach(term => {
    const normalized = normalizeSearchText(term);
    if(title.includes(normalized)) score += 22;
    else if(text.includes(normalized)) score += 10;
  });
  (profile.penalties || []).forEach(term => {
    if(text.includes(normalizeSearchText(term))) score -= 14;
  });
  return score;
}

function vibeScore(recipe, vibes){
  if(!vibes.size) return 0;
  const id = String(recipe.id || recipe.name || "");
  let dna = recipeDNAStore.recipes[id];
  if(!dna || dna.fingerprint !== recipeDNAFingerprint(recipe)){
    dna = analyzeRecipeDNA(recipe);
    recipeDNAStore.recipes[id] = dna;
    scheduleRecipeDNAWrite();
  }
  let total = 0;
  for(const key of vibes){
    const profile = VIBE_PROFILES[key];
    if(!profile) return -999;
    const storedScore = Number(dna.scores?.[key] || 0);
    const familyScore = profileTextScore(recipe, profile);
    const score = Math.max(storedScore, familyScore);
    if(score < profile.minimum) return -999;
    total += score;
  }
  return total;
}

function updateVibeCounts(){
  document.querySelectorAll("[data-vibe]").forEach(button => {
    const key = button.dataset.vibe;
    const count = recipes.filter(recipe => !recipe.hidden && vibeScore(recipe, new Set([key])) > 0).length;
    const countNode = button.querySelector(".vibe-count");
    if(countNode) countNode.textContent = `${count} recipe${count===1?"":"s"}`;
  });
}

function renderActiveVibeChips(){
  const host = $("activeVibeChips");
  if(!host) return;
  host.innerHTML = [...selectedVibes].map(key => `<button type="button" class="active-vibe-chip" data-remove-vibe="${escapeHTML(key)}">${escapeHTML(VIBE_PROFILES[key]?.label || key)} <span aria-hidden="true">×</span></button>`).join("");
  host.hidden = selectedVibes.size === 0;
}

function updateVibeUI(){
  document.querySelectorAll("[data-vibe]").forEach(button => {
    const active = selectedVibes.has(button.dataset.vibe);
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  renderActiveVibeChips();
  updateVibeCounts();
}

function parseDateValue(value){
  const text = String(value || "").trim();
  if(!text) return 0;

  const parsed = new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(text)
      ? `${text}T12:00:00`
      : text
  );

  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function inlineSelectOptions(values, selectedValue = ""){
  const cleanValues = unique(values.filter(value => value && value !== "__new__"));
  return [
    '<option value="">Select one</option>',
    ...cleanValues.map(value =>
      `<option value="${escapeHTML(value)}"${value === selectedValue ? " selected" : ""}>${escapeHTML(value)}</option>`
    ),
    '<option value="__new__">Add new…</option>'
  ].join("");
}

function renderInlineEditor(recipe){
  const safeId = escapeHTML(recipe.id);

  return `
    <form class="card-inline-editor" data-inline-edit-id="${safeId}">
      <div class="inline-edit-header">
        ${recipe.image ? `<img class="inline-edit-image" src="${escapeHTML(recipe.image)}" alt="${escapeHTML(recipe.name || "Recipe")}">` : '<div class="inline-edit-image inline-edit-image-empty">No image</div>'}
        <div class="inline-edit-title-summary">
          <strong data-inline-title-display>${escapeHTML(recipe.name || "Untitled recipe")}</strong>
          <button class="secondary inline-title-toggle" type="button" data-edit-inline-title>Edit title</button>
        </div>
      </div>

      <label class="inline-edit-field inline-edit-title" hidden>Title
        <input name="name" type="text" value="${escapeHTML(recipe.name || "")}" required>
      </label>

      <div class="inline-edit-grid">
        <label class="inline-edit-field">Protein
          <select name="protein">${inlineSelectOptions(categoryValues("protein", DEFAULT_PROTEINS), recipe.protein || "")}</select>
          <input class="inline-new-value" name="proteinNew" type="text" placeholder="New protein" hidden>
        </label>

        <label class="inline-edit-field">Meal type
          <select name="type">${inlineSelectOptions(categoryValues("type", DEFAULT_MEAL_TYPES), recipe.type || "")}</select>
          <input class="inline-new-value" name="typeNew" type="text" placeholder="New meal type" hidden>
        </label>

        <div class="inline-edit-field">Collection
          ${multiCollectionMarkup(recipe.collections || [], `inline-${recipe.id}`)}
        </div>
      </div>

      <div class="inline-edit-actions">
        <button class="primary" type="submit">Save</button>
        <button class="secondary" type="button" data-close-inline-editor>Close</button>
        <span class="inline-edit-status" aria-live="polite"></span>
      </div>
    </form>
  `;
}

function render(){
  if(document.querySelector("[data-vibe]")) updateVibeCounts();
  const query = $("searchInput").value.trim().toLowerCase();
  const vibes = activeVibes();
  const protein = $("proteinSelect").value;
  const type = $("typeSelect").value;
  const cuisine = $("cuisineSelect").value;
  const collection = $("collectionSelect").value;
  const hiddenOnly = $("showHidden").checked;
  const sortMode = $("sortSelect").value;

  let visible = recipes
    .map(recipe => {
      const match = searchScore(recipe, query);
      const moodScore = vibeScore(recipe, vibes);
      return {recipe, score:match.score, reason:match.reason, moodScore};
    })
    .filter(item => {
      const recipe = item.recipe;

      return (!query || item.score > 0)
        && (!vibes.size || item.moodScore > 0)
        && (!protein || recipe.protein === protein)
        && (!type || recipe.type === type)
        && (!cuisine || recipe.cuisine === cuisine)
        && (!collection || (recipe.collections || []).includes(collection))
        && (!$("kirstaFav").checked || recipe.kirsta_rating >= 4)
        && (!$("tjFav").checked || recipe.tj_rating >= 4)
        && (!$("torrinFav").checked || recipe.torrin_rating >= 4)
        && (!$("quickOnly").checked || (recipe.total_time > 0 && recipe.total_time <= 30))
        && (hiddenOnly ? recipe.hidden : !recipe.hidden);
    });

  visible.sort((a,b) => {
    if(sortMode === "newest") return parseDateValue(b.recipe.added) - parseDateValue(a.recipe.added);
    if(sortMode === "az") return String(a.recipe.name).localeCompare(String(b.recipe.name));
    if(sortMode === "lastMade") return parseDateValue(b.recipe.last_made) - parseDateValue(a.recipe.last_made);
    if(vibes.size && b.moodScore !== a.moodScore) return b.moodScore - a.moodScore;
    if(query && b.score !== a.score) return b.score - a.score;
    return String(a.recipe.name).localeCompare(String(b.recipe.name));
  });

  $("count").textContent = `${visible.length} recipe${visible.length === 1 ? "" : "s"}`;
  if($("vibeStatus")){
    const labels = [...vibes].map(key => VIBE_PROFILES[key]?.label).filter(Boolean);
    $("vibeStatus").textContent = labels.length
      ? `${visible.length} recipe${visible.length === 1 ? "" : "s"} match ${labels.join(" + ")}. Best matches are first.`
      : "Pick a shortcut or describe the mood in your own words.";
  }
  $("grid").classList.toggle("has-inline-editor", Boolean(inlineEditingId));

  $("grid").innerHTML = visible.map(item => {
    const recipe = item.recipe;

    if(inlineEditingId === recipe.id){
      return `<article class="card card-editing" data-id="${escapeHTML(recipe.id)}">${renderInlineEditor(recipe)}</article>`;
    }

    return `
      <article class="card${surpriseRecipeId === recipe.id ? " vibe-pick" : ""}" data-id="${escapeHTML(recipe.id)}" role="button" tabindex="0" aria-label="Open ${escapeHTML(recipe.name || "recipe")}">
        <button class="card-pencil-edit" type="button" data-inline-card-edit="${escapeHTML(recipe.id)}" aria-label="Edit ${escapeHTML(recipe.name || "recipe")}" title="Edit recipe">✎</button>
        <button class="card-meal-plan" type="button" data-add-to-meal-plan="${escapeHTML(recipe.id)}" aria-label="Add ${escapeHTML(recipe.name || "recipe")} to meal plan">Add to meal plan</button>
        ${recipe.image ? `<img class="recipe-card-image" src="${escapeHTML(recipe.image)}" alt="${escapeHTML(recipe.name || "Recipe")}">` : ""}
        <div class="meta">${escapeHTML([recipe.protein, recipe.type, recipe.source].filter(Boolean).join(" • "))}</div>
        <h2>${escapeHTML(recipe.name || "Untitled recipe")}</h2>
        ${query && item.reason ? `<p class="match-reason">${escapeHTML(item.reason)}</p>` : ""}
        <p>${escapeHTML(recipe.description || recipe.notes || "")}</p>
      </article>
    `;
  }).join("");

  document.querySelectorAll(".card[data-id]").forEach(card => {
    if(card.classList.contains("card-editing")) return;
    const openCard = () => openRecipe(recipes.find(recipe => recipe.id === card.dataset.id));
    card.addEventListener("click", event => {
      if(event.target.closest("[data-inline-card-edit], [data-add-to-meal-plan]")) return;
      openCard();
    });
    card.addEventListener("keydown", event => {
      if(event.key === "Enter" || event.key === " "){
        event.preventDefault();
        openCard();
      }
    });
  });
}

function inlineSelectedValue(form, selectName, newInputName){
  const select = form.elements[selectName];
  if(!select) return "";
  return select.value === "__new__"
    ? String(form.elements[newInputName]?.value || "").trim()
    : select.value;
}

document.addEventListener("click", event => {
  const editButton = event.target.closest("[data-inline-card-edit]");
  if(editButton){
    event.preventDefault();
    event.stopPropagation();
    inlineEditingId = editButton.dataset.inlineCardEdit;
    render();
    requestAnimationFrame(() => {
      document.querySelector(`[data-inline-edit-id="${CSS.escape(inlineEditingId)}"]`)?.scrollIntoView({block:"nearest"});
    });
    return;
  }

  if(event.target.closest("[data-close-inline-editor]")){
    inlineEditingId = null;
    render();
    return;
  }
});

document.addEventListener("click", event => {
  const button = event.target.closest("[data-edit-inline-title]");
  if(!button) return;

  const form = button.closest(".card-inline-editor");
  const titleField = form?.querySelector(".inline-edit-title");
  const input = form?.elements?.name;
  if(!titleField || !input) return;

  const willOpen = titleField.hidden;
  titleField.hidden = !willOpen;
  button.textContent = willOpen ? "Hide title" : "Edit title";
  if(willOpen){
    input.focus();
    input.select();
  }
});

document.addEventListener("change", event => {
  const select = event.target.closest(".card-inline-editor select");
  if(!select) return;

  const form = select.closest(".card-inline-editor");
  const inputName = `${select.name}New`;
  const input = form.elements[inputName];
  if(!input) return;

  input.hidden = select.value !== "__new__";
  if(select.value === "__new__") input.focus();
  else input.value = "";
});

document.addEventListener("submit", async event => {
  const form = event.target.closest(".card-inline-editor");
  if(!form) return;

  event.preventDefault();
  const recipe = recipes.find(item => item.id === form.dataset.inlineEditId);
  if(!recipe) return;

  const status = form.querySelector(".inline-edit-status");
  const saveButton = form.querySelector('button[type="submit"]');
  const updates = {
    name: String(form.elements.name.value || "").trim(),
    protein: inlineSelectedValue(form, "protein", "proteinNew"),
    type: inlineSelectedValue(form, "type", "typeNew"),
    collections: pickerCollectionString(form.querySelector(".multi-collection-picker"))
  };

  if(!updates.name){
    status.textContent = "Title required.";
    status.className = "inline-edit-status error";
    return;
  }

  status.textContent = "Saving…";
  status.className = "inline-edit-status";
  saveButton.disabled = true;

  try{
    const result = await postVault({
      action: "update",
      id: recipe.id,
      url: recipe.url,
      updates
    });
    if(!result) return;

    status.textContent = "Saved.";
    status.className = "inline-edit-status success";
    inlineEditingId = null;
    await loadRecipes();
  }catch(error){
    status.textContent = `Could not save: ${error.message}`;
    status.className = "inline-edit-status error";
    saveButton.disabled = false;
  }
});




function stablePlannerValue(value){
  if(Array.isArray(value)) return value.map(stablePlannerValue);
  if(value && typeof value === "object"){
    return Object.keys(value).sort().reduce((out, key) => { out[key] = stablePlannerValue(value[key]); return out; }, {});
  }
  return value;
}
function plannerContentSignature(value){
  return JSON.stringify(stablePlannerValue({
    days:value?.days || {},
    pool:Array.isArray(value?.pool) ? value.pool : [],
    made:value?.made || {},
    mealPrep:Array.isArray(value?.mealPrep) ? value.mealPrep : []
  }));
}

function plannerTimestamp(plan){
  const value = Date.parse(plan?.updatedAt || "");
  return Number.isFinite(value) ? value : 0;
}

async function plannerPost(payload){
  if(!config.appsScriptUrl || !config.sharedKey) throw new Error("Shared planner settings are missing.");

  const request = {...payload, key:config.sharedKey};

  if(request.action === "getMealPlans"){
    return new Promise((resolve, reject) => {
      const callbackName = `recipeVaultPlanner_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const script = document.createElement("script");
      const timer = setTimeout(() => cleanup(new Error("Shared planner did not respond.")), 12000);

      function cleanup(error, result){
        clearTimeout(timer);
        try{ delete window[callbackName]; }catch(_error){ window[callbackName] = undefined; }
        script.remove();
        if(error) reject(error); else resolve(result);
      }

      window[callbackName] = result => {
        if(!result?.success) return cleanup(new Error(result?.error || "Shared planner load failed."));
        cleanup(null, result);
      };

      const url = new URL(config.appsScriptUrl);
      url.searchParams.set("action", "getMealPlans");
      url.searchParams.set("key", config.sharedKey);
      url.searchParams.set("callback", callbackName);
      url.searchParams.set("_", String(Date.now()));
      script.onerror = () => cleanup(new Error("Shared planner could not be reached."));
      script.src = url.toString();
      document.head.appendChild(script);
    });
  }

  if(request.action !== "saveMealPlan") throw new Error("Unknown planner action.");

  const sourcePlan = request.plan && typeof request.plan === "object" ? request.plan : {};
  const sharedPlan = {
    days: sourcePlan.days && typeof sourcePlan.days === "object" ? sourcePlan.days : {},
    pool: Array.isArray(sourcePlan.pool) ? sourcePlan.pool : [],
    made: sourcePlan.made && typeof sourcePlan.made === "object" ? sourcePlan.made : {},
    mealPrep: Array.isArray(sourcePlan.mealPrep) ? sourcePlan.mealPrep : [],
    updatedAt: sourcePlan.updatedAt || new Date().toISOString()
  };

  await new Promise((resolve, reject) => {
    const frameName = `recipeVaultSave_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const iframe = document.createElement("iframe");
    const form = document.createElement("form");
    iframe.name = frameName;
    iframe.hidden = true;
    form.hidden = true;
    form.method = "POST";
    form.action = config.appsScriptUrl;
    form.target = frameName;

    const field = document.createElement("input");
    field.type = "hidden";
    field.name = "payload";
    field.value = JSON.stringify({
      action:"saveMealPlan",
      key:config.sharedKey,
      weekKey:request.weekKey,
      plan:sharedPlan
    });
    form.appendChild(field);

    let submitted = false;
    let finished = false;
    const timeout = setTimeout(() => finish(), 8000);
    function finish(error){
      if(finished) return;
      finished = true;
      clearTimeout(timeout);
      setTimeout(() => { form.remove(); iframe.remove(); }, 0);
      if(error) reject(error); else resolve();
    }
    iframe.addEventListener("load", () => {
      if(!submitted){
        submitted = true;
        form.submit();
        return;
      }
      finish();
    });
    iframe.addEventListener("error", () => finish(new Error("Shared planner save could not be submitted.")), {once:true});

    document.body.appendChild(form);
    document.body.appendChild(iframe);
  });

  return {success:true};
}

function normalizePlannerRevision(plan){
  const clean = plan && typeof plan === "object" ? plan : {};
  clean.revision = Math.max(0, Number(clean.revision) || 0);
  clean.baseRevision = Math.max(0, Number(clean.baseRevision) || clean.revision);
  return clean;
}

async function loadSharedPlanner(){
  if(plannerSyncLoaded || !config.appsScriptUrl || !config.sharedKey) return;
  plannerSyncLoaded = true;
  try{
    const result = await plannerPost({action:"getMealPlans"});
    const remote = Object.fromEntries(Object.entries(result?.plans || {}).map(([key, plan]) => {
      const normalized = normalizePlannerRevision(plan);
      normalized.pendingSync = false;
      normalized.baseRevision = normalized.revision;
      return [key, normalized];
    }));
    const local = plannerRead();
    if(isPlannerViewer){ planner = remote; localStorage.setItem(PLANNER_KEY, JSON.stringify(remote)); return; }

    // The home page does not perform destructive startup uploads. Existing local
    // weeks are retained; remote-only weeks are added. The planner page performs
    // the full additive reconciliation with normalized day arrays.
    planner = {...local};
    for(const [key, remotePlan] of Object.entries(remote)){
      if(!planner[key]) planner[key] = remotePlan;
      else{
        planner[key].revision = remotePlan.revision;
        planner[key].baseRevision = remotePlan.revision;
      }
    }
    localStorage.setItem(PLANNER_KEY, JSON.stringify(planner));
  }catch(error){
    plannerSyncLoaded = false;
    console.warn("Meal plans are using this browser until sync is available:", error);
  }
}

async function saveSharedPlannerWeek(key, plan, options = {}){
  if(isPlannerViewer) return false;
  normalizePlannerRevision(plan);
  plan.baseRevision = Math.max(0, Number(plan.revision) || 0);
  plan.pendingSync = true;
  localStorage.setItem(PLANNER_KEY, JSON.stringify(planner));
  const snapshot = JSON.parse(JSON.stringify(plan));
  const allowDestructive = options.allowDestructive !== false;
  const source = String(options.source || "home-add-to-plan");
  const task = async () => {
    try{
      let sentPlan = {...snapshot,pendingSync:false};
      let result = await plannerPost({
        action:"saveMealPlan", weekKey:key, plan:sentPlan, baseRevision:snapshot.baseRevision,
        allowDestructive, source, mutationId:`${key}:${snapshot.updatedAt || Date.now()}`
      });
      if(result.conflict){
        const retryRevision = Math.max(0, Number(result.currentPlan?.revision) || Number(result.revision) || 0);
        sentPlan = {...sentPlan, revision:retryRevision, baseRevision:retryRevision};
        result = await plannerPost({
          action:"saveMealPlan", weekKey:key, plan:sentPlan, baseRevision:retryRevision,
          allowDestructive, source, mutationId:`${key}:${snapshot.updatedAt || Date.now()}:retry`
        });
        if(result.conflict) throw new Error("Shared planner changed twice; local plan preserved.");
      }
      const verification = await plannerPost({action:"getMealPlans"});
      const verified = normalizePlannerRevision(verification?.plans?.[key] || {});
      if(plannerContentSignature(verified) !== plannerContentSignature(sentPlan)){
        throw new Error("Shared verification failed; the local meal plan was preserved.");
      }
      const current = planner[key];
      if(current){
        current.revision = Math.max(Number(verified.revision)||0, Number(result.plan?.revision)||0);
        current.baseRevision = current.revision;
        if(current.updatedAt === snapshot.updatedAt) current.pendingSync = false;
      }
      localStorage.setItem(PLANNER_KEY, JSON.stringify(planner));
      return true;
    }catch(error){ console.warn("Meal plan saved locally but could not sync:", error); return false; }
  };
  const resultPromise = plannerSaveChain.catch(() => undefined).then(task);
  plannerSaveChain = resultPromise.then(() => undefined, () => undefined);
  return resultPromise;
}

function plannerMonday(date){
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  const day = copy.getDay();
  copy.setDate(copy.getDate() + (day === 0 ? -6 : 1 - day));
  return copy;
}
function plannerAddDays(date, amount){ const copy = new Date(date); copy.setDate(copy.getDate()+amount); return copy; }
function plannerWeekKey(date){ return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`; }
function plannerDayName(date){ return ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][date.getDay()]; }
function plannerDateLabel(date){ return date.toLocaleDateString(undefined,{weekday:"long",month:"long",day:"numeric"}); }
function plannerWeekLabel(date){
  const end=plannerAddDays(date,6);
  const left=date.toLocaleDateString(undefined,{month:"long",day:"numeric"});
  const right=end.toLocaleDateString(undefined,{month:date.getMonth()===end.getMonth()?undefined:"long",day:"numeric",year:"numeric"});
  return `${left} – ${right}`;
}
function plannerRead(){
  try{ const value=JSON.parse(localStorage.getItem(PLANNER_KEY)||"{}"); return value && typeof value==="object" ? value : {}; }
  catch(error){ return {}; }
}
function plannerRecipeName(id, plan){
  const key = String(id ?? "").trim();
  return recipes.find(recipe => String(recipe.id ?? "").trim()===key)?.name || plan?.recipeSnapshots?.[key]?.name || "Planned recipe unavailable";
}
function plannerSlot(date){
  const monday=plannerMonday(date), key=plannerWeekKey(monday), day=plannerDayName(date);
  const plans=planner;
  return {plans,key,day,recipeId:(Array.isArray(plans[key]?.days?.[day]) ? plans[key].days[day][0] : plans[key]?.days?.[day]) || ""};
}
async function assignRecipeToDate(recipe, date){
  if(isPlannerViewer){
    window.alert("This phone is using the shared view. Add meals from the primary computer.");
    return false;
  }
  const slot=plannerSlot(date);
  if(slot.recipeId && String(slot.recipeId)!==String(recipe.id)){
    const existing=plannerRecipeName(slot.recipeId, slot.plans[slot.key]);
    const ok=window.confirm(`${plannerDateLabel(date)} already has:\n\n${existing}\n\nReplace it with:\n\n${recipe.name}?`);
    if(!ok) return false;
  }
  if(!slot.plans[slot.key]) slot.plans[slot.key]={days:{},updatedAt:null};
  if(!slot.plans[slot.key].days) slot.plans[slot.key].days={};
  slot.plans[slot.key].days[slot.day]=[String(recipe.id)];
  if(!slot.plans[slot.key].recipeSnapshots) slot.plans[slot.key].recipeSnapshots={};
  slot.plans[slot.key].recipeSnapshots[String(recipe.id)]={id:String(recipe.id),name:recipe.name||"Untitled recipe",image:recipe.image||"",protein:recipe.protein||"",type:recipe.type||"",total_time:Number(recipe.total_time)||0};
  slot.plans[slot.key].updatedAt=new Date().toISOString();
  planner=slot.plans;
  const synced = await saveSharedPlannerWeek(slot.key, slot.plans[slot.key], {allowDestructive:true, source:"home-add-to-plan"});
  return {saved:true, synced};
}
function renderMealPlanWeekGroup(start,label){
  return `<section class="meal-plan-week-group">
    <div class="meal-plan-week-heading"><span>${escapeHTML(label)}</span><strong>${escapeHTML(plannerWeekLabel(start))}</strong></div>
    <div class="meal-plan-week-days">
      ${Array.from({length:7},(_,index)=>{
        const date=plannerAddDays(start,index), slot=plannerSlot(date), existing=slot.recipeId ? plannerRecipeName(slot.recipeId, slot.plans[slot.key]) : "Empty";
        const isCurrentRecipe = slot.recipeId && mealPlanRecipe && String(slot.recipeId) === String(mealPlanRecipe.id);
        const stateClass = isCurrentRecipe ? "current-recipe" : (slot.recipeId ? "occupied" : "");
        const detail = isCurrentRecipe ? `${existing} • Already planned` : existing;
        return `<button class="meal-plan-date-choice ${stateClass}" type="button" data-meal-plan-date="${date.toISOString().slice(0,10)}">
          <strong>${escapeHTML(plannerDateLabel(date))}</strong>
          <span>${escapeHTML(detail)}</span>
        </button>`;
      }).join("")}
    </div>
  </section>`;
}
function renderMealPlanDateChoices(){
  const firstWeek=plannerMonday(new Date());
  const secondWeek=plannerAddDays(firstWeek,7);
  $("mealPlanDateChoices").innerHTML=renderMealPlanWeekGroup(firstWeek,"This week")+renderMealPlanWeekGroup(secondWeek,"Next week");
}
function openMealPlanDialog(recipe){
  mealPlanRecipe=recipe;
  $("mealPlanRecipeName").textContent=recipe.name || "Untitled recipe";
  $("mealPlanDialogStatus").textContent="";
  renderMealPlanDateChoices();
  $("mealPlanDialog").showModal();
}
document.addEventListener("click",async event=>{
  const addButton=event.target.closest("[data-add-to-meal-plan]");
  if(addButton){
    event.preventDefault(); event.stopPropagation();
    const recipe=recipes.find(item=>String(item.id)===String(addButton.dataset.addToMealPlan));
    if(recipe) openMealPlanDialog(recipe);
    return;
  }
  const dateButton=event.target.closest("[data-meal-plan-date]");
  if(dateButton && mealPlanRecipe){
    const date=new Date(`${dateButton.dataset.mealPlanDate}T12:00:00`);
    const saved = await assignRecipeToDate(mealPlanRecipe,date);
    if(saved?.saved){
      $("mealPlanDialogStatus").textContent=saved.synced
        ? `Added to ${plannerDateLabel(date)} and shared.`
        : `Added to ${plannerDateLabel(date)} on this device; sync will retry later.`;
      $("mealPlanDialogStatus").className=saved.synced ? "import-status success" : "import-status";
      renderMealPlanDateChoices();
    }
  }
});
on("closeMealPlanDialog","click",()=>$("mealPlanDialog").close());

let quickEditRecipe = null;

function openQuickEdit(recipe){
  quickEditRecipe = recipe;

  $("quickEditName").value = recipe.name || "";

  const proteins = categoryValues("protein", DEFAULT_PROTEINS);
  const mealTypes = categoryValues("type", DEFAULT_MEAL_TYPES);
  const collections = collectionValues();

  fillCategorySelect(
    "quickEditProtein",
    proteins,
    recipe.protein || ""
  );

  fillCategorySelect(
    "quickEditType",
    mealTypes,
    recipe.type || ""
  );

  mountMultiCollectionPicker("quickEditCollectionPicker", recipe.collections || []);

  $("quickEditProteinNew").value =
    recipe.protein && !proteins.includes(recipe.protein)
      ? recipe.protein
      : "";

  $("quickEditTypeNew").value =
    recipe.type && !mealTypes.includes(recipe.type)
      ? recipe.type
      : "";


  $("quickEditProteinNew").hidden =
    $("quickEditProtein").value !== "__new__";

  $("quickEditTypeNew").hidden =
    $("quickEditType").value !== "__new__";


  setImportStatus("quickEditStatus", "");
  $("quickEditDialog").showModal();
}

document.addEventListener("click", event => {
  const button = event.target.closest("[data-quick-edit-id]");
  if(!button) return;

  event.preventDefault();
  event.stopPropagation();

  const recipe = recipes.find(
    item => item.id === button.dataset.quickEditId
  );

  if(recipe) openQuickEdit(recipe);
});

on("closeQuickEdit", "click", () => {
  $("quickEditDialog").close();
});

on("quickEditForm", "submit", async event => {
  event.preventDefault();

  if(!quickEditRecipe) return;

  const updates = {
    name: $("quickEditName").value.trim(),
    protein: selectedCategory(
      "quickEditProtein",
      "quickEditProteinNew"
    ),
    type: selectedCategory(
      "quickEditType",
      "quickEditTypeNew"
    ),
    collections: pickerCollectionString("quickEditCollectionPicker")
  };

  if(!updates.name){
    setImportStatus(
      "quickEditStatus",
      "Recipe title is required.",
      "error"
    );
    return;
  }

  setImportStatus("quickEditStatus", "Saving…");

  try{
    const result = await postVault({
      action: "update",
      id: quickEditRecipe.id,
      url: quickEditRecipe.url,
      updates
    });

    if(!result) return;

    $("quickEditDialog").close();
    quickEditRecipe = null;
    await loadRecipes();
  }catch(error){
    setImportStatus(
      "quickEditStatus",
      `Could not save: ${error.message}`,
      "error"
    );
  }
});

function formatDisplayDate(value){
  const text = String(value || "").trim();
  if(!text) return "";

  const parsed = new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(text)
      ? `${text}T12:00:00`
      : text
  );

  if(Number.isNaN(parsed.getTime())) return text;

  return parsed.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric"
  });
}


function inferredCookbookPage(recipe){
  const direct=Number(recipe?.cookbook_page||recipe?.source_page||recipe?.page);
  if(Number.isFinite(direct)&&direct>0)return direct;
  const hay=[recipe?.source,recipe?.tags,recipe?.collections].flatMap(value=>Array.isArray(value)?value:[value]).filter(Boolean).join(" | ");
  const match=hay.match(/(?:\bpage\s*|\bp\.?\s*)(\d{1,4})\b/i);
  return match?Number(match[1]):0;
}
function pdfURL(recipe){
  return `https://www.hellofresh.com/recipecards/card/${recipe.id}.pdf`;
}

function openRecipe(recipe){
  active = recipe;
  $("recipeTitle").textContent = recipe.name || "Untitled recipe";
  $("recipeMeta").textContent = [
    recipe.protein, recipe.type, recipe.cuisine,
    recipe.total_time ? `${recipe.total_time} min` : ""
  ].filter(Boolean).join(" • ");
  $("notes").value = recipe.notes || "";
  const importMeta=$("recipeImportMeta");
  const metaChips=[recipe.yield?`<span class="recipe-meta-chip">Servings: ${escapeHTML(recipe.yield)}</span>`:"",recipe.cookbook_title?`<span class="recipe-meta-chip">${escapeHTML(recipe.cookbook_title)}${recipe.cookbook_page?` · Page ${escapeHTML(recipe.cookbook_page)}`:""}</span>`:""];importMeta.innerHTML=metaChips.filter(Boolean).join("");importMeta.hidden=!metaChips.some(Boolean);
  const description=$("recipeDescription");description.textContent=recipe.description||"";description.hidden=!recipe.description;
  const tutorial=$("recipeTutorialLinks");const tutorialLinks=[...(recipe.recipe_links||[]),recipe.video_url].filter(Boolean).filter((x,i,a)=>a.indexOf(x)===i);tutorial.innerHTML=tutorialLinks.map((url,i)=>`<a class="secondary linkbtn" href="${escapeHTML(url)}" target="_blank" rel="noopener">${i?`Tutorial link ${i+1}`:"Watch video tutorial"}</a>`).join("");tutorial.hidden=!tutorialLinks.length;

  const madeSummary = $("madeSummary");
  const madeCount = Number(recipe.made_count || 0);
  const lastMade = formatDisplayDate(recipe.last_made);

  if(madeCount > 0 || lastMade){
    const pieces = [];
    if(madeCount > 0){
      pieces.push(`Made ${madeCount} time${madeCount === 1 ? "" : "s"}`);
    }
    if(lastMade){
      pieces.push(`Last made ${lastMade}`);
    }
    madeSummary.textContent = pieces.join(" • ");
    madeSummary.hidden = false;
  }else{
    madeSummary.textContent = "";
    madeSummary.hidden = true;
  }

  const detailImage = $("recipeImage");
  if(recipe.image){
    detailImage.src = recipe.image;
    detailImage.alt = recipe.name || "Recipe";
    detailImage.hidden = false;
  }else{
    detailImage.removeAttribute("src");
    detailImage.hidden = true;
  }

  $("ingredientsList").innerHTML = recipe.ingredients.length
    ? recipe.ingredients.map(item => `<li>${escapeHTML(item)}</li>`).join("")
    : "<li>Ingredient details have not been imported for this recipe yet.</li>";

  $("instructionsList").innerHTML = recipe.instructions.length
    ? recipe.instructions.map(item => `<li>${escapeHTML(String(item).replace(/^\s*\d+[.)]\s*/,""))}</li>`).join("")
    : "<li>Cooking steps have not been imported for this recipe yet.</li>";

  $("nutritionText").textContent = recipe.nutrition || "Nutrition details have not been imported.";
  $("hideBtn").textContent = recipe.hidden ? "Restore recipe" : "Hide recipe";
  $("sourceLink").href = recipe.url || "#";$("sourceLink").hidden=!recipe.url;
  const hasSourcePage=Boolean(recipe.source_page_image||inferredCookbookPage(recipe));
  $("sourcePageBtn").hidden=!(hasSourcePage||recipe.pdf_url);
  $("sourcePageBtn").textContent=hasSourcePage?"View original PDF page":"Open PDF";
  renderStars("kirstaStars", "kirsta_rating");
  renderStars("tjStars", "tj_rating");
  renderStars("torrinStars", "torrin_rating");
  $("recipeDialog").showModal();
}

function renderStars(target, field){
  const container = $(target);
  container.innerHTML = "";

  for(let value = 1; value <= 5; value++){
    const button = document.createElement("button");
    button.type = "button";
    button.className = "star";
    button.textContent = value <= Number(active[field] || 0) ? "★" : "☆";
    button.addEventListener("click", async () => {
      const ok = await write("update", active, {[field]: value});
      if(ok){
        active[field] = value;
        renderStars(target, field);
      }
    });
    container.appendChild(button);
  }
}

async function write(action, recipe, updates){
  if(!config.appsScriptUrl || !config.sharedKey){
    alert("Open Manage and enter the Apps Script URL and family write key.");
    return false;
  }

  const form = new URLSearchParams();
  form.set("payload", JSON.stringify({
    action,
    key: config.sharedKey,
    id: recipe.id,
    url: recipe.url,
    updates
  }));

  try{
    const response = await fetch(config.appsScriptUrl, {
      method: "POST",
      body: form,
      redirect: "follow"
    });
    const result = await response.json();
    if(!result.success) throw new Error(result.error || "Save failed");
    await loadRecipes();
    return true;
  } catch(error){
    alert(`Could not save: ${error.message}`);
    return false;
  }
}

function extractHelloFresh(raw){
  try{
    const url = new URL(raw);
    const slug = url.pathname.split("/").filter(Boolean).pop() || "";
    const pieces = slug.split("-");
    const id = pieces.pop();

    if(!/^[a-f0-9]{24}$/i.test(id)) throw new Error("Missing recipe ID");

    return {
      name: pieces.map(word => word ? word[0].toUpperCase() + word.slice(1) : "").join(" "),
      url: url.href,
      id,
      source: "HelloFresh",
      image: "",
      protein: "",
      type: "",
      cuisine: "",
      tags: "",
      prep_time: "",
      cook_time: "",
      total_time: "",
      kirsta_rating: "",
      tj_rating: "",
      torrin_rating: "",
      torrin_notes: "",
      notes: "",
      made_count: 0,
      hidden: false,
      added: new Date().toISOString().slice(0,10),
      last_made: ""
    };
  } catch {
    return null;
  }
}


on("manageBtn", "click", () => {
  $("sheetUrl").value = config.sheetCsvUrl || "";
  $("scriptUrl").value = config.appsScriptUrl || "";
  $("familyKey").value = config.sharedKey || "";
  $("manageDialog").showModal();
});
on("closeManage", "click", () => $("manageDialog").close());
on("saveSettings", "click", () => {
  settings = {
    sheetCsvUrl: $("sheetUrl").value.trim(),
    appsScriptUrl: $("scriptUrl").value.trim(),
    sharedKey: $("familyKey").value.trim()
  };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  config = {...base, ...settings};
  $("manageDialog").close();
  loadRecipes();
});

on("backupImagesBtn", "click", async () => {
  const button = $("backupImagesBtn");
  const folderLink = $("mediaFolderLink");
  let nextRow = 2;
  let backedUp = 0;
  let skipped = 0;
  let failed = 0;
  const failures = [];
  let passes = 0;

  button.disabled = true;
  folderLink.hidden = true;
  const failureReport = $("imageBackupFailures");
  failureReport.hidden = true;
  failureReport.innerHTML = "";
  setImportStatus("imageBackupStatus", "Starting image backup…");

  try{
    while(passes < 200){
      const result = await postVault({
        action: "backupImages",
        startRow: nextRow,
        batchSize: 6
      });

      if(!result) return;

      backedUp += Number(result.backedUp || 0);
      skipped += Number(result.skipped || 0);
      failed += Number(result.failed || 0);
      if(Array.isArray(result.failures)) failures.push(...result.failures);
      nextRow = Number(result.nextRow || nextRow + 1);
      passes++;

      setImportStatus(
        "imageBackupStatus",
        `Working… ${backedUp} backed up${failed ? `, ${failed} failed` : ""}.`
      );

      if(result.folderUrl){
        folderLink.href = result.folderUrl;
        folderLink.hidden = false;
      }

      if(result.done) break;
    }

    if(passes >= 200){
      throw new Error("Backup stopped before finishing. Run it again to continue.");
    }

    const message = failed
      ? `Finished: ${backedUp} images backed up, ${skipped} already safe or blank, ${failed} could not be copied.`
      : `Finished: ${backedUp} images backed up. ${skipped} were already safe or blank.`;

    setImportStatus(
      "imageBackupStatus",
      message,
      failed ? "" : "success"
    );

    if(failures.length){
      failureReport.innerHTML = `
        <strong>Could not copy:</strong>
        <ul>${failures.map(item => `
          <li>
            <strong>${escapeHTML(item.name || "Untitled recipe")}</strong><br>
            <span>${escapeHTML(item.reason || "Unknown error")}</span><br>
            <a href="${escapeHTML(item.imageUrl || "#")}" target="_blank" rel="noopener">Open original image</a>
          </li>
        `).join("")}</ul>
        <p>The original image links were left unchanged.</p>
      `;
      failureReport.hidden = false;
    }

    await loadRecipes();
  }catch(error){
    setImportStatus(
      "imageBackupStatus",
      `Image backup stopped: ${error.message}`,
      "error"
    );
  }finally{
    button.disabled = false;
  }
});

function setImportStatus(elementId, message, type = ""){
  const element = $(elementId);
  if(!element) return;
  element.textContent = message;
  element.className = `import-status ${type}`.trim();
}

function requireWriteConnection(){
  if(config.appsScriptUrl && config.sharedKey) return true;
  alert("Open Manage and enter the Apps Script URL and family write key.");
  return false;
}

async function postVault(payload){
  if(!requireWriteConnection()) return null;

  const form = new URLSearchParams();
  form.set("payload", JSON.stringify({
    ...payload,
    key: config.sharedKey
  }));

  const response = await fetch(config.appsScriptUrl, {
    method: "POST",
    body: form,
    redirect: "follow"
  });

  const result = await response.json();

  if(!result.success){
    throw new Error(result.error || "Request failed");
  }

  return result;
}


let pendingDuplicateRequest = null;

function normalizeDuplicateUrl(value){
  try{
    const url = new URL(String(value || "").trim());
    url.hash = "";
    [
      "utm_source","utm_medium","utm_campaign","utm_term","utm_content",
      "fbclid","gclid","mc_cid","mc_eid"
    ].forEach(name => url.searchParams.delete(name));
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return `${url.hostname}${url.pathname}${url.search}`.toLowerCase();
  }catch(error){
    return String(value || "").trim().toLowerCase().replace(/\/+$/, "");
  }
}

function normalizeDuplicateTitle(value){
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(best|easy|homemade|recipe)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findLocalDuplicate(existing){
  if(!existing) return null;
  return recipes.find(recipe => existing.id && recipe.id === existing.id)
    || recipes.find(recipe => existing.url && normalizeDuplicateUrl(recipe.url) === normalizeDuplicateUrl(existing.url))
    || recipes.find(recipe => normalizeDuplicateTitle(recipe.name) === normalizeDuplicateTitle(existing.name));
}


function openLinkedRecipe(){
  if(linkedRecipeOpened || !recipes.length) return;

  const params = new URLSearchParams(window.location.search);
  const recipeId = params.get("recipe");
  if(!recipeId) return;

  const recipe = recipes.find(item => item.id === recipeId);
  if(!recipe) return;

  linkedRecipeOpened = true;
  openRecipe(recipe);
}

function openRecipeInNewTab(recipe){
  if(!recipe?.id){
    alert("The existing recipe could not be opened. Refresh the page and try again.");
    return;
  }

  const url = new URL(window.location.href);
  url.searchParams.set("recipe", recipe.id);
  url.hash = "";

  const link = document.createElement("a");
  link.href = url.toString();
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function showDuplicateDialog(result, request){
  pendingDuplicateRequest = {result, request};
  const existing = result.existing || {};
  const exact = result.matchType === "url" || result.matchType === "id";

  $("duplicateHeading").textContent = exact
    ? "This recipe is already in your vault"
    : "This looks like a possible duplicate";
  $("duplicateMessage").textContent = exact
    ? "Choose whether to open the saved recipe, refresh it from the source, or keep another copy."
    : "The title is very similar to a recipe already saved. Check the existing recipe before deciding.";
  $("duplicateExistingName").textContent = existing.name || "Existing recipe";
  $("duplicateExistingMeta").textContent = [existing.source, existing.url].filter(Boolean).join(" • ");
  $("duplicateDialog").showModal();
}

async function submitDuplicateChoice(choice){
  if(!pendingDuplicateRequest) return;

  const {result, request} = pendingDuplicateRequest;
  const existing = result.existing || {};

  if(choice === "open"){
    const recipe = findLocalDuplicate(existing);
    openRecipeInNewTab(recipe);
    return;
  }

  if(choice === "cancel"){
    $("duplicateDialog").close();
    pendingDuplicateRequest = null;
    return;
  }

  $("duplicateRefresh").disabled = true;
  $("duplicateKeepBoth").disabled = true;
  $("duplicateOpen").disabled = true;

  try{
    const nextRequest = {
      ...request,
      duplicateAction: choice,
      duplicateRow: result.row
    };
    const saved = await postVault(nextRequest);
    if(!saved) return;

    $("duplicateDialog").close();
    pendingDuplicateRequest = null;
    await loadRecipes();

    if(request.action === "addManual"){
      $("manualRecipeForm").reset();
      $("manualSource").value = "Family Recipe";
      refreshEntryCategoryMenus();
      setImportStatus("manualStatus", `${choice === "refresh" ? "Refreshed" : "Saved another copy of"} ${saved.recipe?.name || "recipe"}.`, "success");
    }else{
      $("importUrl").value = "";
      setImportStatus("urlImportStatus", `${choice === "refresh" ? "Refreshed" : "Imported another copy of"} ${saved.recipe?.name || "recipe"}.`, "success");
    }
  }catch(error){
    alert(`Could not save: ${error.message}`);
  }finally{
    $("duplicateRefresh").disabled = false;
    $("duplicateKeepBoth").disabled = false;
    $("duplicateOpen").disabled = false;
  }
}

on("duplicateOpen", "click", () => submitDuplicateChoice("open"));
on("duplicateRefresh", "click", () => submitDuplicateChoice("refresh"));
on("duplicateKeepBoth", "click", () => submitDuplicateChoice("keep"));
on("duplicateCancel", "click", () => submitDuplicateChoice("cancel"));
on("closeDuplicate", "click", () => submitDuplicateChoice("cancel"));

function switchAddTab(tabName){
  document.querySelectorAll(".add-tab").forEach(button => {
    button.classList.toggle("active", button.dataset.addTab === tabName);
  });

  ["url","manual","pack"].forEach(name => {
    const panelId = `addPanel${name.charAt(0).toUpperCase()}${name.slice(1)}`;
    const panel = $(panelId);
    if(panel) panel.classList.toggle("active", name === tabName);
  });
}

document.querySelectorAll(".add-tab").forEach(button => {
  button.addEventListener("click", () => switchAddTab(button.dataset.addTab));
});

on("addBtn", "click", () => {
  switchAddTab("url");
  $("addDialog").showModal();
});
on("closeAdd", "click", () => $("addDialog").close());

on("urlImportForm", "submit", async event => {
  event.preventDefault();

  const rawValues = $("importUrl").value
    .split(/\r?\n/)
    .map(value => value.trim())
    .filter(Boolean);

  const uniqueUrls = [];
  const seen = new Set();
  const invalid = [];

  rawValues.forEach(value => {
    try{
      const parsed = new URL(value);
      if(!/^https?:$/.test(parsed.protocol)) throw new Error("Unsupported protocol");
      const key = normalizeDuplicateUrl(parsed.href);
      if(!seen.has(key)){
        seen.add(key);
        uniqueUrls.push(parsed.href);
      }
    }catch(error){
      invalid.push(value);
    }
  });

  if(!uniqueUrls.length){
    setImportStatus("urlImportStatus", "Paste at least one valid recipe URL.", "error");
    return;
  }

  if(uniqueUrls.length > 100){
    setImportStatus("urlImportStatus", "Please import no more than 100 URLs at one time.", "error");
    return;
  }

  const duplicatePolicy = $("urlDuplicatePolicy")?.value || "skip";
  const submitButton = $("urlImportSubmit");
  submitButton.disabled = true;
  $("urlImportResults").innerHTML = "";

  let imported = 0;
  let refreshed = 0;
  let skipped = 0;
  let failed = invalid.length;

  const appendResult = (message, type = "") => {
    const item = document.createElement("div");
    item.className = `bulk-result ${type}`.trim();
    item.textContent = message;
    $("urlImportResults").appendChild(item);
  };

  invalid.forEach(value => appendResult(`✕ Invalid URL: ${value}`, "error"));

  try{
    for(let index = 0; index < uniqueUrls.length; index++){
      const url = uniqueUrls[index];
      setImportStatus("urlImportStatus", `Importing ${index + 1} of ${uniqueUrls.length}…`);

      try{
        let result = await postVault({action: "importUrl", url});
        if(!result) return;

        if(result.action === "duplicate"){
          if(duplicatePolicy === "skip"){
            skipped++;
            appendResult(`— Skipped duplicate: ${result.existing?.name || url}`);
            continue;
          }

          result = await postVault({
            action: "importUrl",
            url,
            duplicateAction: duplicatePolicy,
            duplicateRow: result.row
          });
          if(!result) return;
        }

        if(result.action === "refreshed"){
          refreshed++;
          appendResult(`✓ Refreshed: ${result.recipe?.name || url}`, "success");
        }else{
          imported++;
          appendResult(`✓ Imported: ${result.recipe?.name || url}`, "success");
        }
      }catch(error){
        failed++;
        appendResult(`✕ ${url} — ${error.message}`, "error");
      }
    }

    const parts = [];
    if(imported) parts.push(`${imported} imported`);
    if(refreshed) parts.push(`${refreshed} refreshed`);
    if(skipped) parts.push(`${skipped} skipped`);
    if(failed) parts.push(`${failed} failed`);

    setImportStatus(
      "urlImportStatus",
      `Finished: ${parts.join(", ") || "no changes"}.`,
      failed ? "" : "success"
    );

    if(!failed) $("importUrl").value = "";
    await loadRecipes();
  }finally{
    submitButton.disabled = false;
  }
});

on("manualRecipeForm", "submit", async event => {
  event.preventDefault();

  const ingredients = $("manualIngredients").value
    .split(/\r?\n/)
    .map(value => value.trim())
    .filter(Boolean);

  const instructions = $("manualInstructions").value
    .split(/\r?\n/)
    .map(value => value.trim())
    .filter(Boolean);

  const recipe = {
    name: $("manualName").value.trim(),
    url: $("manualUrl").value.trim(),
    source: $("manualSource").value.trim() || "Family Recipe",
    image: $("manualImage").value.trim(),
    protein: selectedCategory("manualProtein", "manualProteinNew"),
    type: selectedCategory("manualType", "manualTypeNew"),
    cuisine: $("manualCuisine").value.trim(),
    tags: $("manualTags").value
      .split(/[|,]/)
      .map(value => value.trim())
      .filter(Boolean)
      .join("|"),
    collections: pickerCollectionString("manualCollectionPicker"),
    prep_time: $("manualPrep").value.trim(),
    cook_time: $("manualCook").value.trim(),
    total_time: $("manualTotal").value.trim(),
    ingredients,
    instructions,
    nutrition: $("manualNutrition").value.trim(),
    kirsta_rating: "",
    tj_rating: "",
    torrin_rating: "",
    torrin_notes: "",
    notes: "",
    made_count: 0,
    hidden: false,
    added: new Date().toISOString().slice(0,10),
    last_made: "",
    pdf_url: ""
  };

  setImportStatus("manualStatus", "Saving custom recipe…");

  try{
    const result = await postVault({
      action: "addManual",
      recipe
    });

    if(!result) return;

    if(result.action === "duplicate"){
      setImportStatus("manualStatus", "Possible duplicate found. Choose what to do next.");
      showDuplicateDialog(result, {
        action: "addManual",
        recipe
      });
      return;
    }

    $("manualRecipeForm").reset();
    $("manualSource").value = "Family Recipe";
    $("manualProteinNew").hidden = true;
    $("manualTypeNew").hidden = true;
    mountMultiCollectionPicker("manualCollectionPicker", []);
    refreshEntryCategoryMenus();
    setImportStatus("manualStatus", `Saved ${result.recipe?.name || recipe.name}.`, "success");
    await loadRecipes();
  }catch(error){
    setImportStatus("manualStatus", `Could not save: ${error.message}`, "error");
  }
});

function populateRecipeEditor(recipe){
  $("editName").value = recipe.name || "";
  $("editSource").value = recipe.source || "";
  $("editUrl").value = recipe.url || "";
  $("editImage").value = recipe.image || "";
  const proteinValues = categoryValues("protein", DEFAULT_PROTEINS);
  const mealTypeValues = categoryValues("type", DEFAULT_MEAL_TYPES);
  const collections = collectionValues();

  fillCategorySelect("editProtein", proteinValues, recipe.protein || "");
  fillCategorySelect("editType", mealTypeValues, recipe.type || "");
  mountMultiCollectionPicker("editCollectionPicker", recipe.collections || []);

  $("editProteinNew").value =
    recipe.protein && !proteinValues.includes(recipe.protein)
      ? recipe.protein
      : "";

  $("editTypeNew").value =
    recipe.type && !mealTypeValues.includes(recipe.type)
      ? recipe.type
      : "";

  $("editProteinNew").hidden = $("editProtein").value !== "__new__";
  $("editTypeNew").hidden = $("editType").value !== "__new__";
  $("editCuisine").value = recipe.cuisine || "";
  $("editPrep").value = recipe.prep_time || "";
  $("editCook").value = recipe.cook_time || "";
  $("editTotal").value = recipe.total_time || "";
  $("editTags").value = Array.isArray(recipe.tags)
    ? recipe.tags.join(" | ")
    : String(recipe.tags || "");
  $("editIngredients").value = (recipe.ingredients || []).join("\n");
  $("editInstructions").value = (recipe.instructions || []).join("\n");
  $("editNutrition").value = recipe.nutrition || "";
  $("editPdfUrl").value = recipe.pdf_url || "";
  setImportStatus("editRecipeStatus", "");
}

function collectRecipeEdits(){
  return {
    name: $("editName").value.trim(),
    source: $("editSource").value.trim(),
    url: $("editUrl").value.trim(),
    image: $("editImage").value.trim(),
    protein: selectedCategory("editProtein", "editProteinNew"),
    type: selectedCategory("editType", "editTypeNew"),
    cuisine: $("editCuisine").value.trim(),
    prep_time: $("editPrep").value.trim(),
    cook_time: $("editCook").value.trim(),
    total_time: $("editTotal").value.trim(),
    tags: $("editTags").value
      .split(/[|,]/)
      .map(value => value.trim())
      .filter(Boolean)
      .join("|"),
    collections: pickerCollectionString("editCollectionPicker"),
    ingredients: $("editIngredients").value
      .split(/\r?\n/)
      .map(value => value.trim())
      .filter(Boolean),
    instructions: $("editInstructions").value
      .split(/\r?\n/)
      .map(value => value.trim())
      .filter(Boolean),
    nutrition: $("editNutrition").value.trim(),
    pdf_url: $("editPdfUrl").value.trim()
  };
}

on("editRecipeBtn", "click", () => {
  if(!active) return;
  populateRecipeEditor(active);
  $("editRecipeDialog").showModal();
});

on("closeEditRecipe", "click", () => {
  $("editRecipeDialog").close();
});

on("editRecipeForm", "submit", async event => {
  event.preventDefault();

  if(!active) return;

  const updates = collectRecipeEdits();

  if(!updates.name){
    setImportStatus("editRecipeStatus", "Recipe name is required.", "error");
    return;
  }

  if(!updates.ingredients.length || !updates.instructions.length){
    setImportStatus(
      "editRecipeStatus",
      "Add at least one ingredient and one instruction.",
      "error"
    );
    return;
  }

  setImportStatus("editRecipeStatus", "Saving changes…");

  try{
    const result = await postVault({
      action: "update",
      id: active.id,
      url: active.url,
      updates
    });

    if(!result) return;

    const activeId = active.id;
    $("editRecipeDialog").close();
    $("recipeDialog").close();

    await loadRecipes();

    const refreshed = recipes.find(recipe => recipe.id === activeId);
    if(refreshed){
      openRecipe(refreshed);
    }

    setImportStatus("editRecipeStatus", "Recipe updated.", "success");
  }catch(error){
    setImportStatus(
      "editRecipeStatus",
      `Could not save changes: ${error.message}`,
      "error"
    );
  }
});

function recipeReturnUrl(){
  const params = new URLSearchParams(window.location.search);
  const value = String(params.get("return") || "").trim();
  if(!value) return "";
  try{
    const url = new URL(value, window.location.href);
    if(url.origin !== window.location.origin) return "";
    return url.href;
  }catch(error){
    return "";
  }
}

on("closeRecipe", "click", () => {
  $("recipeDialog").close();
  const returnUrl = recipeReturnUrl();
  if(returnUrl) window.location.href = returnUrl;
});
on("saveNotes", "click", async () => {
  if(!active) return;
  const notes = $("notes").value.trim();
  const button = $("saveNotes");
  const status = $("notesStatus");
  button.disabled = true;
  if(status){ status.textContent = "Saving…"; status.className = "import-status"; }
  try{
    const result = await postVault({action:"update", id:active.id, url:active.url, updates:{notes}});
    if(!result) return;
    active.notes = notes;
    const cached = recipes.find(recipe => String(recipe.id) === String(active.id));
    if(cached) cached.notes = notes;
    if(status){ status.textContent = "Notes saved"; status.className = "import-status success"; }
    setTimeout(() => { if(status?.textContent === "Notes saved") status.textContent = ""; }, 2200);
  }catch(error){
    if(status){ status.textContent = `Could not save notes: ${error.message}`; status.className = "import-status error"; }
  }finally{
    button.disabled = false;
  }
});
function openExternalPdfInViewer(url){
  const pdfUrl=String(url||"").trim();
  if(!pdfUrl) return false;
  // Some recipe hosts force Content-Disposition: attachment, which downloads the
  // PDF even when opened in a new tab. Google Docs Viewer keeps it viewable.
  const viewer=`https://docs.google.com/gview?embedded=0&url=${encodeURIComponent(pdfUrl)}`;
  const opened=window.open(viewer,"_blank","noopener,noreferrer");
  return Boolean(opened);
}

on("sourcePageBtn","click",()=>{
  const inferredPage=inferredCookbookPage(active);
  if(active?.source_page_image){
    const dialog=$("sourcePagePreviewDialog"),img=$("sourcePagePreviewImage"),status=$("sourcePagePreviewStatus");
    $("sourcePagePreviewTitle").textContent=`${active.name||"Original recipe page"}${inferredPage?` · Page ${inferredPage}`:""}`;
    status.textContent="Loading page…";status.hidden=false;img.hidden=true;
    img.onload=()=>{status.hidden=true;img.hidden=false;};
    img.onerror=()=>{status.hidden=false;status.textContent="This saved page preview could not be opened. Re-upload the cookbook and choose Update existing recipes to rebuild it.";img.hidden=true;};
    img.src=active.source_page_image;
    if(!dialog.open)dialog.showModal();
  }else if(inferredPage){
    const pageUrl=new URL("cookbooks.html",window.location.href);
    pageUrl.searchParams.set("recipe",active.id||"");
    pageUrl.searchParams.set("page",String(inferredPage));
    window.open(pageUrl.href,"_blank","noopener,noreferrer");
  }else if(active?.pdf_url){
    openExternalPdfInViewer(active.pdf_url);
  }
});
on("closeSourcePagePreview","click",()=>{$("sourcePagePreviewDialog").close();});
on("madeBtn", "click", () => write("update", active, {
  made_count: Number(active.made_count || 0) + 1,
  last_made: new Date().toISOString().slice(0,10)
}));
on("hideBtn", "click", async () => {
  const ok = await write("update", active, {hidden: !active.hidden});
  if(ok) $("recipeDialog").close();
});


on("toggleSearchBtn", "click", () => {
  const panel = $("searchPanel");
  const button = $("toggleSearchBtn");
  const isOpen = button.getAttribute("aria-expanded") === "true";

  button.setAttribute("aria-expanded", String(!isOpen));
  panel.classList.toggle("collapsed", isOpen);
});


on("toggleInspireBtn", "click", () => {
  const panel = $("inspirePanel");
  const button = $("toggleInspireBtn");
  const isOpen = button.getAttribute("aria-expanded") === "true";
  button.setAttribute("aria-expanded", String(!isOpen));
  panel.hidden = isOpen;
});

document.addEventListener("click", event => {
  const removeChip = event.target.closest("[data-remove-vibe]");
  if(removeChip){
    selectedVibes.delete(removeChip.dataset.removeVibe);
    surpriseRecipeId = null;
    updateVibeUI();
    render();
    return;
  }
  const chip = event.target.closest("[data-vibe]");
  if(!chip) return;
  const vibe = chip.dataset.vibe;
  if(selectedVibes.has(vibe)) selectedVibes.delete(vibe);
  else selectedVibes.add(vibe);
  surpriseRecipeId = null;
  updateVibeUI();
  render();
});

on("vibeInput", "input", () => { surpriseRecipeId = null; render(); });

on("vibeSurpriseBtn", "click", () => {
  const vibes = activeVibes();
  const protein = $("proteinSelect").value;
  const type = $("typeSelect").value;
  const cuisine = $("cuisineSelect").value;
  const collection = $("collectionSelect").value;
  let choices = recipes.filter(recipe =>
    (!vibes.size || vibeScore(recipe, vibes) > 0) &&
    (!protein || recipe.protein === protein) &&
    (!type || recipe.type === type) &&
    (!cuisine || recipe.cuisine === cuisine) &&
    (!collection || (recipe.collections || []).includes(collection)) &&
    !recipe.hidden
  );
  if(!choices.length){
    $("vibeStatus").textContent = "Nothing matches that combination yet. Try removing one filter.";
    return;
  }
  const best = choices
    .map(recipe => ({recipe, score:vibeScore(recipe, vibes)}))
    .sort((a,b) => b.score - a.score);
  const pool = best.slice(0, Math.min(8, best.length));
  const pick = pool[Math.floor(Math.random() * pool.length)].recipe;
  surpriseRecipeId = pick.id;
  render();
  requestAnimationFrame(() => {
    document.querySelector(`[data-id="${CSS.escape(pick.id)}"]`)?.scrollIntoView({behavior:"smooth", block:"center"});
  });
  $("vibeStatus").textContent = `Tonight's pick: ${pick.name}.`;
});

on("searchInput", "input", render);

[
  "proteinSelect",
  "typeSelect",
  "cuisineSelect",
  "collectionSelect",
  "sortSelect",
  "kirstaFav",
  "tjFav",
  "torrinFav",
  "quickOnly",
  "showHidden"
].forEach(id => on(id, "change", render));

on("clearBtn", "click", () => {
  $("searchInput").value = "";
  $("proteinSelect").value = "";
  $("typeSelect").value = "";
  $("cuisineSelect").value = "";
  $("collectionSelect").value = "";
  $("sortSelect").value = "relevance";
  if($("vibeInput")) $("vibeInput").value = "";
  selectedVibes.clear();
  surpriseRecipeId = null;
  updateVibeUI();

  [
    "kirstaFav",
    "tjFav",
    "torrinFav",
    "quickOnly",
    "showHidden"
  ].forEach(id => {
    $(id).checked = false;
  });

  render();
});



// Recipe Pack importer -----------------------------------------------------
let recipePackState = null;

function packMinutes(value){
  const match = String(value || "").match(/\d+/);
  return match ? Number(match[0]) : "";
}

function packSafePath(value){
  const path = String(value || "").replace(/\\/g, "/");
  return path && !path.startsWith("/") && !path.split("/").includes("..") ? path : "";
}

function packRecipeId(recipe, index){
  return `pack-${Date.now()}-${index}-${Math.random().toString(36).slice(2,8)}`;
}

function packDuplicate(recipe){
  const title = normalizeDuplicateTitle(recipe.name);
  return recipes.find(item => title && normalizeDuplicateTitle(item.name) === title)
    || (recipe.url ? recipes.find(item => normalizeDuplicateUrl(item.url) === normalizeDuplicateUrl(recipe.url)) : null)
    || null;
}

function packImageToDataUrl(blob){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read image."));
    reader.readAsDataURL(blob);
  });
}

async function parseRecipePack(file){
  const schema = window.RECIPE_PACK_SCHEMA;
  if(!window.JSZip) throw new Error("ZIP support did not load. Refresh the page and try again.");
  if(!file || file.size > schema.limits.maxZipBytes) throw new Error("Recipe pack must be 25 MB or smaller.");

  const zip = await JSZip.loadAsync(file);
  const names = Object.keys(zip.files);
  if(names.some(name => !packSafePath(name))) throw new Error("The ZIP contains an unsafe file path.");

  const manifestFile = zip.file("manifest.json");
  if(!manifestFile) throw new Error("manifest.json is missing from the ZIP.");

  let manifest;
  try{ manifest = JSON.parse(await manifestFile.async("text")); }
  catch(error){ throw new Error("manifest.json is not valid JSON."); }

  if(manifest.format !== schema.format) throw new Error(`Unsupported pack format. Expected ${schema.format}.`);
  if(!schema.supportedVersions.includes(Number(manifest.version))) throw new Error(`Recipe pack version ${manifest.version} is not supported.`);
  if(!Array.isArray(manifest.recipes)) throw new Error("manifest.json must contain a recipes array.");
  if(manifest.recipes.length > schema.limits.maxRecipes) throw new Error(`Recipe packs can contain at most ${schema.limits.maxRecipes} recipes.`);

  const items = [];
  for(let index = 0; index < manifest.recipes.length; index++){
    const raw = manifest.recipes[index] || {};
    const warnings = [];
    const errors = [];
    const title = String(raw.title || "").trim();
    const ingredients = Array.isArray(raw.ingredients) ? raw.ingredients.map(String) : [];
    const instructions = Array.isArray(raw.instructions) ? raw.instructions.map(String) : [];
    if(!title) errors.push("Title is required.");
    if(!ingredients.length) errors.push("At least one ingredient is required.");
    if(!instructions.length) errors.push("At least one instruction is required.");

    let imageData = "", imageMime = "", imageName = "", imagePreview = "";
    const imagePath = packSafePath(raw.image);
    if(raw.image && !imagePath){
      warnings.push("Unsafe image path ignored.");
    }else if(imagePath){
      const imageFile = zip.file(imagePath);
      if(!imageFile){
        warnings.push(`Image not found: ${imagePath}`);
      }else{
        const rawBlob = await imageFile.async("blob");
        const extension = imagePath.split(".").pop().toLowerCase();
        const inferredMime = extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : (["jpg","jpeg"].includes(extension) ? "image/jpeg" : "");
        const blob = inferredMime ? new Blob([rawBlob], {type: inferredMime}) : rawBlob;
        if(blob.size > schema.limits.maxImageBytes){
          warnings.push("Image is larger than 8 MB and was skipped.");
        }else if(!schema.imageTypes.includes(inferredMime)){
          warnings.push("Image must be JPG, PNG, or WebP.");
        }else{
          imageData = await packImageToDataUrl(blob);
          imageMime = inferredMime;
          imageName = imagePath.split("/").pop();
          imagePreview = URL.createObjectURL(blob);
        }
      }
    }else{
      warnings.push("No image included.");
    }

    const recipe = {
      name: title,
      url: String(raw.sourceUrl || "").trim(),
      source: String(raw.sourceName || "Recipe Vault Pack").trim() || "Recipe Vault Pack",
      image: "",
      protein: String(raw.protein || "").trim(),
      type: String(raw.mealType || "").trim(),
      cuisine: String(raw.cuisine || "").trim(),
      tags: Array.isArray(raw.tags) ? raw.tags.map(String).join("|") : "",
      collections: Array.isArray(raw.collections) ? raw.collections.map(String).join("|") : "",
      prep_time: packMinutes(raw.prepTime),
      cook_time: packMinutes(raw.cookTime),
      total_time: packMinutes(raw.totalTime),
      ingredients,
      instructions,
      nutrition: String(raw.nutrition || "").trim(),
      notes: [raw.description, raw.notes].filter(Boolean).map(String).join("\n\n"),
      kirsta_rating:"", tj_rating:"", torrin_rating:"", torrin_notes:"",
      made_count:0, hidden:false, added:new Date().toISOString().slice(0,10), last_made:"", pdf_url:""
    };
    const duplicate = packDuplicate(recipe);
    items.push({id:packRecipeId(recipe,index), include:!errors.length, recipe, duplicate, warnings, errors, imageData, imageMime, imageName, imagePreview, duplicateAction: duplicate ? "skip" : "keep"});
  }
  return {manifest, items};
}

function packOptions(values, selected, placeholder){
  const all = [...new Set([...(values || []), selected].filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  return `<option value="">${escapeHTML(placeholder)}</option>${all.map(value => `<option value="${escapeHTML(value)}" ${value===selected?"selected":""}>${escapeHTML(value)}</option>`).join("")}<option value="__new__">Add new…</option>`;
}

function renderRecipePackPreview(){
  const container = $("recipePackPreview");
  const footer = $("recipePackFooter");
  if(!recipePackState){ container.innerHTML=""; footer.hidden=true; return; }
  const proteins = categoryValues("protein", DEFAULT_PROTEINS);
  const types = categoryValues("type", DEFAULT_MEAL_TYPES);
  container.innerHTML = `<div class="recipe-pack-heading"><strong>${escapeHTML(recipePackState.manifest.packName || "Recipe Pack")}</strong><span>${recipePackState.items.length} recipes</span></div>` + recipePackState.items.map((item,index) => {
    const status = item.errors.length ? item.errors.join(" ") : item.warnings.join(" ");
    return `<article class="recipe-pack-item ${item.errors.length?"has-error":""}">
      <label class="recipe-pack-include"><input type="checkbox" data-pack-include="${index}" ${item.include?"checked":""} ${item.errors.length?"disabled":""}> Include</label>
      ${item.imagePreview ? `<img src="${escapeHTML(item.imagePreview)}" alt="">` : '<div class="recipe-pack-placeholder">No image</div>'}
      <div class="recipe-pack-fields">
        <label class="field">Title<input data-pack-title="${index}" value="${escapeHTML(item.recipe.name)}"></label>
        <div class="three-column-form">
          <label class="field">Protein<select data-pack-protein="${index}">${packOptions(proteins,item.recipe.protein,"Select protein")}</select><input class="new-category-input" data-pack-protein-new="${index}" placeholder="New protein" hidden></label>
          <label class="field">Meal type<select data-pack-type="${index}">${packOptions(types,item.recipe.type,"Select meal type")}</select><input class="new-category-input" data-pack-type-new="${index}" placeholder="New meal type" hidden></label>
          <label class="field">Collections<input data-pack-collections="${index}" value="${escapeHTML(item.recipe.collections)}" placeholder="Quick | Comfort Food"></label>
        </div>
        <p class="recipe-pack-counts">${item.recipe.ingredients.length} ingredients • ${item.recipe.instructions.length} instructions</p>
        ${item.duplicate ? `<div class="recipe-pack-duplicate"><strong>Possible duplicate:</strong> ${escapeHTML(item.duplicate.name)}<label>Action<select data-pack-duplicate="${index}"><option value="skip" selected>Skip imported recipe</option><option value="keep">Import anyway</option><option value="refresh">Replace existing recipe</option></select></label></div>` : ""}
        ${status ? `<p class="recipe-pack-warning">${escapeHTML(status)}</p>` : ""}
      </div>
    </article>`;
  }).join("");
  footer.hidden = false;
}

async function chooseRecipePackFile(file){
  setImportStatus("recipePackStatus", "Reading recipe pack…");
  try{
    recipePackState = await parseRecipePack(file);
    renderRecipePackPreview();
    setImportStatus("recipePackStatus", "Review the recipes below, then import selected.", "success");
  }catch(error){
    recipePackState = null;
    renderRecipePackPreview();
    setImportStatus("recipePackStatus", error.message, "error");
  }
}

on("chooseRecipePack", "click", () => $("recipePackFile").click());
on("recipePackFile", "change", event => chooseRecipePackFile(event.target.files?.[0]));
const packDrop = $("recipePackDrop");
if(packDrop){
  ["dragenter","dragover"].forEach(type => packDrop.addEventListener(type,event=>{event.preventDefault(); packDrop.classList.add("dragging");}));
  ["dragleave","drop"].forEach(type => packDrop.addEventListener(type,event=>{event.preventDefault(); packDrop.classList.remove("dragging");}));
  packDrop.addEventListener("drop", event => chooseRecipePackFile(event.dataTransfer.files?.[0]));
}

document.addEventListener("change", event => {
  if(!recipePackState) return;
  let match;
  if((match=event.target.dataset.packInclude) !== undefined) recipePackState.items[Number(match)].include = event.target.checked;
  if((match=event.target.dataset.packDuplicate) !== undefined) recipePackState.items[Number(match)].duplicateAction = event.target.value;
  if((match=event.target.dataset.packProtein) !== undefined){
    const input=document.querySelector(`[data-pack-protein-new="${match}"]`); input.hidden=event.target.value!=="__new__";
  }
  if((match=event.target.dataset.packType) !== undefined){
    const input=document.querySelector(`[data-pack-type-new="${match}"]`); input.hidden=event.target.value!=="__new__";
  }
});

on("cancelRecipePack", "click", () => { recipePackState=null; $("recipePackFile").value=""; renderRecipePackPreview(); setImportStatus("recipePackStatus",""); });

on("importSelectedPackRecipes", "click", async () => {
  if(!recipePackState) return;
  const button=$("importSelectedPackRecipes");
  button.disabled=true;
  let imported=0, skipped=0, replaced=0, failed=0, withoutImages=0;
  for(let index=0; index<recipePackState.items.length; index++){
    const item=recipePackState.items[index];
    if(!item.include || item.errors.length){ skipped++; continue; }
    item.recipe.name = document.querySelector(`[data-pack-title="${index}"]`).value.trim();
    const proteinSelect=document.querySelector(`[data-pack-protein="${index}"]`);
    item.recipe.protein = proteinSelect.value === "__new__" ? document.querySelector(`[data-pack-protein-new="${index}"]`).value.trim() : proteinSelect.value;
    const typeSelect=document.querySelector(`[data-pack-type="${index}"]`);
    item.recipe.type = typeSelect.value === "__new__" ? document.querySelector(`[data-pack-type-new="${index}"]`).value.trim() : typeSelect.value;
    item.recipe.collections = document.querySelector(`[data-pack-collections="${index}"]`).value.split(/[|,]/).map(v=>v.trim()).filter(Boolean).join("|");
    if(item.duplicate && item.duplicateAction === "skip"){ skipped++; continue; }
    setImportStatus("recipePackStatus", `Importing ${index+1} of ${recipePackState.items.length}…`);
    try{
      const result=await postVault({action:"importPackRecipe", recipe:item.recipe, imageData:item.imageData, imageMime:item.imageMime, imageName:item.imageName, duplicateAction:item.duplicateAction});
      if(result.action === "duplicate"){ skipped++; continue; }
      if(result.action === "refreshed") replaced++; else imported++;
      if(!item.imageData) withoutImages++;
    }catch(error){ failed++; item.warnings.push(error.message); }
  }
  button.disabled=false;
  await loadRecipes();
  setImportStatus("recipePackStatus", `Finished: ${imported} imported, ${replaced} replaced, ${skipped} skipped, ${failed} failed, ${withoutImages} without images.`, failed?"":"success");
});

setupNewCategory("manualProtein", "manualProteinNew");
setupNewCategory("manualType", "manualTypeNew");
setupNewCategory("editProtein", "editProteinNew");
setupNewCategory("editType", "editTypeNew");
setupNewCategory("quickEditProtein", "quickEditProteinNew");
setupNewCategory("quickEditType", "quickEditTypeNew");

document.querySelectorAll("dialog").forEach(dialog => {
  dialog.addEventListener("click", event => {
    if(event.target !== dialog) return;
    dialog.close();
  });
});

mountMultiCollectionPicker("manualCollectionPicker", []);
on("recipeAnalyzerBtn", "click", () => {
  Promise.resolve(recipeDNAReady).then(() => {
    const count = recipeIntelligenceCandidates().length;
    const queued = readMetadataQueue().length;
    showRecipeIntelligencePrompt(Math.max(count, queued), false);
    if(!count && !queued){
      const dialog = $("recipeIntelligenceDialog");
      const message = $("recipeIntelligenceMessage");
      if(message) message.textContent = `Recipe Intelligence is current. You can still run a full recheck.`;
      setIntelligenceDialogMode("prompt");
      if(dialog && !dialog.open) dialog.showModal();
    }
  }).catch(showRecipeIntelligenceError);
});

on("recheckRecipeIntelligence", "click", event => {
  event.currentTarget.disabled = true;
  const status=$("recipeIntelligenceStatus");
  if(status) status.textContent="Starting full Recipe DNA analysis…";
  Promise.resolve(recipeDNAReady).then(()=>startRecipeIntelligenceAnalysis({force:true})).catch(showRecipeIntelligenceError).finally(()=>{ event.currentTarget.disabled=false; });
});
on("startRecipeIntelligence", "click", event => {
  event.currentTarget.disabled = true;
  const status=$("recipeIntelligenceStatus");
  if(status) status.textContent="Starting Recipe DNA analysis…";
  Promise.resolve(recipeDNAReady).then(()=>startRecipeIntelligenceAnalysis()).catch(showRecipeIntelligenceError).finally(()=>{ event.currentTarget.disabled=false; });
});
on("laterRecipeIntelligence", "click", () => {
  $("recipeIntelligenceDialog")?.close();
  const count = recipeIntelligenceCandidates().length;
  const status = $("recipeIntelligenceStatus");
  if(status) status.textContent = `${count} recipe${count===1?"":"s"} waiting for analysis. Use Recheck recipes now whenever you're ready.`;
});
on("closeRecipeIntelligence", "click", () => $("recipeIntelligenceDialog")?.close());
on("exploreRecipeIntelligence", "click", () => {
  $("recipeIntelligenceDialog")?.close();
  $("vibeInput")?.focus();
  document.querySelector(".vibe-finder")?.scrollIntoView({behavior:"smooth",block:"start"});
});
loadRecipes();
})();
