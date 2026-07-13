(() => {
"use strict";
const $ = id => document.getElementById(id);
const SETTINGS_KEY = "recipeVaultSettingsV031";
const WEEKLY_PLANS_KEY = "recipeVaultWeeklyPlansV104";
const PLANNER_RECIPE_CACHE_KEY = "recipeVaultPlannerRecipeCacheV118";

function readPlannerRecipeCache(){
  try{
    const cached = JSON.parse(localStorage.getItem(PLANNER_RECIPE_CACHE_KEY) || "null");
    const source = config.sheetCsvUrl || "recipes.json";
    if(!cached || cached.source !== source || !Array.isArray(cached.rows)) return null;
    return cached;
  }catch(error){
    return null;
  }
}

function writePlannerRecipeCache(rows){
  try{
    localStorage.setItem(PLANNER_RECIPE_CACHE_KEY, JSON.stringify({
      source: config.sheetCsvUrl || "recipes.json",
      savedAt: Date.now(),
      rows
    }));
  }catch(error){
    console.warn("Planner recipe cache could not be saved:", error);
  }
}

const base = window.RECIPE_VAULT_CONFIG || {};
const settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
const config = {...base, ...settings};
const days = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
let recipes = [];
let plans = readPlans();
let activeWeek = mondayOf(new Date());
let assigningRecipe = null;
let syncReady = false;
let sharedLoadSequence = 0;
let plannerMutationSequence = 0;
let sharedSaveQueue = Promise.resolve();

window.addEventListener("error", event => {
  const box = $("fatalError");
  box.hidden = false;
  box.textContent = `Planner error: ${event.message}`;
});

function escapeHTML(value){
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"
  })[character]);
}

function parseCSV(text){
  const rows = [];
  let row = [], field = "", quoted = false;
  for(let index = 0; index < text.length; index++){
    const character = text[index], next = text[index + 1];
    if(character === '"' && quoted && next === '"'){
      field += '"';
      index++;
    }else if(character === '"'){
      quoted = !quoted;
    }else if(character === "," && !quoted){
      row.push(field); field = "";
    }else if((character === "\n" || character === "\r") && !quoted){
      if(character === "\r" && next === "\n") index++;
      row.push(field);
      if(row.some(value => value !== "")) rows.push(row);
      row = []; field = "";
    }else{
      field += character;
    }
  }
  if(field || row.length){ row.push(field); rows.push(row); }
  if(rows.length < 2) return [];
  const headers = rows.shift().map(value => value.trim().toLowerCase());
  return rows.map(columns => {
    const item = {};
    headers.forEach((header, index) => item[header] = columns[index] ?? "");
    return item;
  });
}

function parseList(value){
  const text = String(value || "").trim();
  if(!text) return [];
  try{
    const parsed = JSON.parse(text);
    if(Array.isArray(parsed)) return parsed.map(String);
  }catch(error){}
  return text.split(/\r?\n|\|/).map(item => item.trim()).filter(Boolean);
}

function clean(recipe){
  return {
    ...recipe,
    tags: String(recipe.tags || "").split("|").map(item => item.trim()).filter(Boolean),
    collections: String(recipe.collections || "").split("|").map(item => item.trim()).filter(Boolean),
    ingredients: parseList(recipe.ingredients),
    total_time: Number(recipe.total_time) || 0,
    hidden: String(recipe.hidden).toLowerCase() === "true"
  };
}


function dayNameFromKey(key, weekStart){
  const text = String(key || "").trim();
  if(days.includes(text)) return text;
  if(/^\d{4}-\d{2}-\d{2}$/.test(text)){
    const date = new Date(`${text}T12:00:00`);
    if(!Number.isNaN(date.getTime())) return days[(date.getDay() + 6) % 7];
  }
  return "";
}
function normalizePlanReference(value, plan){
  if(value && typeof value === "object"){
    const id = normalizeRecipeId(value.id || value.recipeId || value.recipe_id || "");
    if(id){
      if(!plan.recipeSnapshots || typeof plan.recipeSnapshots !== "object") plan.recipeSnapshots = {};
      plan.recipeSnapshots[id] = {
        id,
        name:value.name || value.title || "Planned recipe",
        image:value.image || "",
        protein:value.protein || "",
        type:value.type || "",
        total_time:Number(value.total_time || value.totalTime) || 0
      };
      return id;
    }
  }
  return normalizeRecipeId(value);
}
function normalizePlanShape(plan, key){
  const cleanPlan = plan && typeof plan === "object" ? plan : {};
  if(!cleanPlan.recipeSnapshots || typeof cleanPlan.recipeSnapshots !== "object") cleanPlan.recipeSnapshots = {};
  const sourceDays = cleanPlan.days && typeof cleanPlan.days === "object" ? cleanPlan.days : {};
  const weekStart = /^\d{4}-\d{2}-\d{2}$/.test(String(key || "")) ? mondayOf(new Date(`${key}T12:00:00`)) : activeWeek;
  const normalizedDays = {};
  Object.entries(sourceDays).forEach(([rawKey, rawValue]) => {
    const day = dayNameFromKey(rawKey, weekStart);
    const id = normalizePlanReference(rawValue, cleanPlan);
    if(day && id) normalizedDays[day] = id;
  });
  cleanPlan.days = normalizedDays;
  cleanPlan.pool = (Array.isArray(cleanPlan.pool) ? cleanPlan.pool : [])
    .map(value => normalizePlanReference(value, cleanPlan))
    .filter(Boolean);
  cleanPlan.revision = Math.max(0, Number(cleanPlan.revision) || 0);
  return cleanPlan;
}
function planHasContent(plan){
  return Boolean(
    Object.keys(plan?.days || {}).length ||
    (plan?.pool || []).length
  );
}
function countPlannedMeals(allPlans){
  return Object.values(allPlans || {}).reduce((total, plan) => total + Object.keys(plan?.days || {}).length, 0);
}

function readPlans(){
  try{
    const parsed = JSON.parse(localStorage.getItem(WEEKLY_PLANS_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  }catch(error){
    return {};
  }
}

function savePlans(){ localStorage.setItem(WEEKLY_PLANS_KEY, JSON.stringify(plans)); }
function planTimestamp(plan){
  const value = Date.parse(plan?.updatedAt || "");
  return Number.isFinite(value) ? value : 0;
}
function setPlannerSyncStatus(state, message, detail){
  const status = $("weekStatus");
  if(!status) return;
  status.dataset.state = state || "";
  status.textContent = state === "error" ? "Offline — changes saved on this device" : (state === "checking" ? "Syncing…" : "");
  status.title = detail || message || "";
}

async function plannerPost(payload){
  if(!config.appsScriptUrl){
    throw new Error("Apps Script URL is missing. Open Settings on the main vault and save it again.");
  }
  if(!config.sharedKey){
    throw new Error("Family key is missing in this browser. Open Settings on the main vault and save it again.");
  }

  const form = new URLSearchParams();
  form.set("payload", JSON.stringify({...payload, key:config.sharedKey}));

  let response;
  try{
    response = await fetch(config.appsScriptUrl, {
      method:"POST",
      body:form,
      redirect:"follow",
      cache:"no-store"
    });
  }catch(error){
    throw new Error(`Could not reach Apps Script: ${error.message}`);
  }

  const text = await response.text();
  if(!response.ok){
    throw new Error(`Apps Script returned HTTP ${response.status}.`);
  }

  let result;
  try{
    result = JSON.parse(text);
  }catch(error){
    throw new Error("Apps Script returned an unreadable response. The deployment URL may be outdated.");
  }

  if(!result.success){
    if(String(result.error || "").toLowerCase().includes("unauthorized")){
      throw new Error("The family key was rejected. The key in Site Settings must exactly match the key in Apps Script.");
    }
    throw new Error(result.error || "Meal plan sync failed.");
  }

  return result;
}

async function loadSharedPlans(force = false){
  if(syncReady && !force) return true;
  const requestSequence = ++sharedLoadSequence;
  if(force) syncReady = false;

  setPlannerSyncStatus("checking", "Checking shared planner…", "Connecting to Apps Script and the Meal Plans sheet.");

  const result = await plannerPost({action:"getMealPlans"});
  if(requestSequence !== sharedLoadSequence) return false;

  const rawRemote = result?.plans || {};
  const remote = Object.fromEntries(Object.entries(rawRemote).map(([key, plan]) => {
    const normalized = normalizePlanShape(plan, key);
    normalized.pendingSync = false;
    return [key, normalized];
  }));
  const local = Object.fromEntries(Object.entries(readPlans()).map(([key, plan]) => [key, normalizePlanShape(plan, key)]));
  const merged = {...remote};
  const plansToUpload = [];

  Object.entries(local).forEach(([key, localPlan]) => {
    const remotePlan = remote[key];

    // Only a real unsent browser edit may override shared data.
    // A stale local copy must never win merely because its clock/timestamp is newer.
    if(localPlan.pendingSync){
      merged[key] = localPlan;
      plansToUpload.push([key, localPlan]);
      return;
    }

    // Shared data is authoritative after the initial migration. If a week does
    // not exist remotely, keep the local copy visible but do not upload it unless
    // it was explicitly marked pending by a user edit.
    if(!remotePlan && planHasContent(localPlan)){
      merged[key] = localPlan;
    }
  });

  plans = merged;
  savePlans();

  for(const [key, plan] of plansToUpload){
    const versionBeingSaved = plan.updatedAt || new Date().toISOString();
    plan.updatedAt = versionBeingSaved;
    await queueSharedPlanSave(key, plan, versionBeingSaved);
  }

  savePlans();
  syncReady = true;
  setPlannerSyncStatus(
    "connected",
    "Shared planner connected",
    `${Object.keys(remote).length} shared week${Object.keys(remote).length === 1 ? "" : "s"} loaded with ${countPlannedMeals(remote)} planned meal${countPlannedMeals(remote) === 1 ? "" : "s"}.`
  );
  return true;
}

function queueSharedPlanSave(key, plan, versionBeingSaved){
  const payloadPlan = JSON.parse(JSON.stringify({...plan, pendingSync:false}));
  sharedSaveQueue = sharedSaveQueue.then(async () => {
    const result = await plannerPost({
      action:"saveMealPlan",
      weekKey:key,
      plan:payloadPlan,
      baseRevision:Number(payloadPlan.baseRevision ?? payloadPlan.revision ?? 0)
    });

    if(result.conflict){
      const currentShared = normalizePlanShape(result.currentPlan || {}, key);
      currentShared.pendingSync = false;
      plans[key] = currentShared;
      savePlans();
      renderPlanner();
      renderResults();
      throw new Error("This meal plan changed on another browser. The newest shared version was reloaded.");
    }

    const current = plans[key];
    if(current && current.updatedAt === versionBeingSaved){
      const savedPlan = normalizePlanShape(result.plan || payloadPlan, key);
      savedPlan.pendingSync = false;
      delete savedPlan.baseRevision;
      plans[key] = savedPlan;
      savePlans();
    }
    return result;
  });
  return sharedSaveQueue;
}

async function saveSharedWeek(date = activeWeek){
  // Invalidate any shared-plan GET that started before this edit.
  sharedLoadSequence++;
  plannerMutationSequence++;

  const key = weekKey(date);
  const plan = normalizePlanShape(planFor(date), key);
  ensurePlanSnapshots(plan);
  const versionBeingSaved = new Date().toISOString();
  plan.baseRevision = Math.max(0, Number(plan.revision) || 0);
  plan.updatedAt = versionBeingSaved;
  plan.pendingSync = true;
  plans[key] = plan;
  savePlans();

  try{
    await queueSharedPlanSave(key, plan, versionBeingSaved);
    $("weekStatus").dataset.state = "connected";
    $("weekStatus").textContent = "Saved";
    $("weekStatus").title = "Saved to the shared meal planner.";
    setTimeout(() => { if($("weekStatus")?.textContent === "Saved") $("weekStatus").textContent = ""; }, 1800);
    return true;
  }catch(error){
    $("weekStatus").textContent = error.message.includes("another browser")
      ? "Newer shared plan reloaded"
      : "Saved on this device; shared sync will retry later";
    return false;
  }
}
function mondayOf(date){
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  const day = copy.getDay();
  copy.setDate(copy.getDate() + (day === 0 ? -6 : 1 - day));
  return copy;
}
function addDays(date, amount){ const copy = new Date(date); copy.setDate(copy.getDate() + amount); return copy; }
function weekKey(date){ return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`; }
function formatDate(date, includeYear = false){
  return date.toLocaleDateString(undefined, {month:"short", day:"numeric", ...(includeYear ? {year:"numeric"} : {})});
}
function fullDate(date){ return date.toLocaleDateString(undefined, {weekday:"long", month:"long", day:"numeric"}); }
function shortFullDate(date){ return date.toLocaleDateString(undefined, {weekday:"short", month:"short", day:"numeric"}); }
function weekLabel(date){
  const end = addDays(date, 6);
  const sameYear = date.getFullYear() === end.getFullYear();
  return `${formatDate(date, !sameYear)} – ${formatDate(end, true)}`;
}
function planFor(date = activeWeek){
  const key = weekKey(date);
  if(!plans[key]) plans[key] = {days:{}, pool:[], recipeSnapshots:{}, updatedAt:null};
  plans[key] = normalizePlanShape(plans[key], key);
  return plans[key];
}
function normalizeRecipeId(id){ return String(id ?? "").trim(); }
function recipeById(id){
  const target = normalizeRecipeId(id);
  return recipes.find(recipe => normalizeRecipeId(recipe.id) === target);
}
function snapshotForRecipe(recipe){
  if(!recipe) return null;
  return {id:normalizeRecipeId(recipe.id), name:recipe.name || "Untitled recipe", image:recipe.image || "", protein:recipe.protein || "", type:recipe.type || "", total_time:Number(recipe.total_time)||0};
}
function ensurePlanSnapshots(plan){
  if(!plan || typeof plan !== "object") return false;
  if(!plan.recipeSnapshots || typeof plan.recipeSnapshots !== "object") plan.recipeSnapshots = {};
  let changed = false;
  const ids = [...Object.values(plan.days || {}), ...(plan.pool || [])].map(normalizeRecipeId).filter(Boolean);
  ids.forEach(id => {
    const live = recipeById(id);
    if(live){
      const snap = snapshotForRecipe(live);
      if(JSON.stringify(plan.recipeSnapshots[id] || null) !== JSON.stringify(snap)){
        plan.recipeSnapshots[id] = snap;
        changed = true;
      }
    }
  });
  return changed;
}
function recipeForPlan(id, plan){
  return recipeById(id) || plan?.recipeSnapshots?.[normalizeRecipeId(id)] || null;
}
function unique(values){ return [...new Set(values.filter(Boolean))].sort((a,b) => a.localeCompare(b)); }
function fill(id, values){
  const select = $(id);
  select.innerHTML = select.options[0].outerHTML + values.map(value => `<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`).join("");
}
function assignedDayForRecipe(plan, recipeId){
  return days.find(day => String(plan.days[day] || "") === String(recipeId)) || "";
}

function scheduledDatesForRecipe(recipeId, startWeek = activeWeek, weekCount = 2){
  const dates = [];
  for(let weekOffset = 0; weekOffset < weekCount; weekOffset++){
    const weekStart = addDays(startWeek, weekOffset * 7);
    const plan = planFor(weekStart);
    days.forEach((day, dayIndex) => {
      if(String(plan.days[day] || "") === String(recipeId)){
        dates.push(addDays(weekStart, dayIndex));
      }
    });
  }
  return dates.sort((a,b) => a - b);
}

function scheduledDateText(recipeId){
  const dates = scheduledDatesForRecipe(recipeId);
  if(!dates.length) return "";
  return dates.map(date => shortFullDate(date)).join(" • ");
}

function renderPlanner(){
  const plan = planFor();
  $("weekTitle").textContent = weekLabel(activeWeek);
  $("plannerGrid").innerHTML = days.map((day, index) => {
    const date = addDays(activeWeek, index);
    const recipeId = plan.days[day] || "";
    const recipe = recipeForPlan(recipeId, plan);
    return `<article class="planner-day-card">
      <div class="planner-day-header">
        <div><strong>${day}</strong><span>${formatDate(date)}</span></div>
        ${recipeId ? `<button class="planner-clear" type="button" data-clear-day="${day}">Clear</button>` : ""}
      </div>
      ${recipe?.image ? `<img class="planner-recipe-image" src="${escapeHTML(recipe.image)}" alt="">` : ""}
      ${recipe ? `<a class="planner-recipe-link" href="index.html?recipe=${encodeURIComponent(recipe.id)}">${escapeHTML(recipe.name || "Open recipe")}</a>
        <p class="planner-recipe-meta">${escapeHTML([recipe.protein, recipe.type, recipe.total_time ? `${recipe.total_time} min` : ""].filter(Boolean).join(" • "))}</p>`
        : `<p class="muted planner-empty">Nothing planned yet.</p>`}
    </article>`;
  }).join("");

  document.querySelectorAll("[data-clear-day]").forEach(button => button.addEventListener("click", async () => {
    delete plan.days[button.dataset.clearDay];
    plan.updatedAt = new Date().toISOString();
    await saveSharedWeek(activeWeek);
    renderPlanner();
    renderPool();
  }));
  renderPool();
  renderHistory();
}

function renderPool(){
  const plan = planFor();
  const poolRecipes = plan.pool.map(id => recipeForPlan(id, plan)).filter(Boolean);
  $("recipePoolCount").textContent = `${poolRecipes.length} recipe${poolRecipes.length === 1 ? "" : "s"}`;
  $("clearRecipePool").disabled = poolRecipes.length === 0;
  $("recipePool").innerHTML = poolRecipes.length ? poolRecipes.map(recipe => {
    const assignedDay = assignedDayForRecipe(plan, recipe.id);
    const scheduledText = scheduledDateText(recipe.id);
    return `<article class="recipe-pool-card ${scheduledText ? "assigned" : ""}">
      ${recipe.image ? `<img src="${escapeHTML(recipe.image)}" alt="">` : '<div class="planner-result-placeholder">No image</div>'}
      <div class="recipe-pool-content">
        <h3>${escapeHTML(recipe.name || "Untitled recipe")}</h3>
        <p>${escapeHTML([recipe.protein, recipe.type, recipe.total_time ? `${recipe.total_time} min` : ""].filter(Boolean).join(" • "))}</p>
        ${scheduledText ? `<p class="pool-assigned-note">Scheduled: ${escapeHTML(scheduledText)}</p>` : '<p class="pool-unscheduled-note">Not assigned to a day yet</p>'}
        <div class="pool-card-actions">
          <button class="primary compact" type="button" data-assign-recipe="${escapeHTML(recipe.id)}">${scheduledText ? "Move or copy to day" : "Assign to day"}</button>
          <button class="secondary compact" type="button" data-remove-from-pool="${escapeHTML(recipe.id)}">Remove</button>
        </div>
      </div>
    </article>`;
  }).join("") : '<div class="recipe-pool-empty"><strong>Your pool is empty.</strong><span>Add recipes from the search results below when you know you want them this week but have not picked a day.</span></div>';
}

function renderHistory(){
  const keys = Object.keys(plans)
    .filter(key => Object.keys(plans[key]?.days || {}).length || (plans[key]?.pool || []).length)
    .sort((a,b) => b.localeCompare(a));
  $("savedWeeks").innerHTML = keys.length ? keys.map(key => {
    const start = mondayOf(new Date(`${key}T12:00:00`));
    const mealCount = Object.keys(plans[key].days || {}).length;
    const poolCount = (plans[key].pool || []).length;
    const detail = [mealCount ? `${mealCount} meal${mealCount === 1 ? "" : "s"}` : "", poolCount ? `${poolCount} pooled` : ""].filter(Boolean).join(" • ");
    return `<button class="saved-week-button ${key === weekKey(activeWeek) ? "active" : ""}" type="button" data-week-key="${key}">
      <strong>${escapeHTML(weekLabel(start))}</strong><span>${escapeHTML(detail || "Empty")}</span>
    </button>`;
  }).join("") : '<p class="muted">No saved weeks yet.</p>';
  document.querySelectorAll("[data-week-key]").forEach(button => button.addEventListener("click", () => {
    activeWeek = mondayOf(new Date(`${button.dataset.weekKey}T12:00:00`));
    renderPlanner();
    window.scrollTo({top:0, behavior:"smooth"});
  }));
}

function searchText(recipe){
  return [recipe.name, recipe.protein, recipe.type, recipe.cuisine, ...recipe.tags, ...recipe.collections, ...recipe.ingredients]
    .filter(Boolean).join(" ").toLowerCase();
}

function renderResults(){
  const query = $("plannerSearch").value.trim().toLowerCase();
  const protein = $("plannerProtein").value;
  const type = $("plannerType").value;
  const cuisine = $("plannerCuisine").value;
  const collection = $("plannerCollection").value;
  const quick = $("plannerQuickOnly").checked;
  const plan = planFor();
  const visible = recipes.filter(recipe =>
    (!query || searchText(recipe).includes(query)) &&
    (!protein || recipe.protein === protein) &&
    (!type || recipe.type === type) &&
    (!cuisine || recipe.cuisine === cuisine) &&
    (!collection || recipe.collections.includes(collection)) &&
    (!quick || (recipe.total_time > 0 && recipe.total_time <= 30))
  );
  $("plannerResultCount").textContent = `${visible.length} recipe${visible.length === 1 ? "" : "s"}`;
  $("plannerResults").innerHTML = visible.map(recipe => {
    const inPool = plan.pool.some(id => String(id) === String(recipe.id));
    const scheduledText = scheduledDateText(recipe.id);
    return `<article class="planner-result-card">
      ${recipe.image ? `<img src="${escapeHTML(recipe.image)}" alt="">` : '<div class="planner-result-placeholder">No image</div>'}
      <div>
        <h3>${escapeHTML(recipe.name || "Untitled recipe")}</h3>
        <p>${escapeHTML([recipe.protein, recipe.type, recipe.cuisine, recipe.total_time ? `${recipe.total_time} min` : ""].filter(Boolean).join(" • "))}</p>
        ${scheduledText ? `<p class="planner-result-scheduled">Scheduled: ${escapeHTML(scheduledText)}</p>` : ""}
        <div class="planner-result-actions">
          <button class="primary compact" type="button" data-assign-recipe="${escapeHTML(recipe.id)}">Assign to day</button>
          <button class="secondary compact" type="button" data-add-to-pool="${escapeHTML(recipe.id)}" ${inPool ? "disabled" : ""}>${inPool ? "In pool" : "Add to pool"}</button>
        </div>
      </div>
    </article>`;
  }).join("");
}

function renderWeekDateGroup(weekStart, label){
  const plan = planFor(weekStart);
  return `<section class="meal-plan-week-group">
    <div class="meal-plan-week-heading"><span>${escapeHTML(label)}</span><strong>${escapeHTML(weekLabel(weekStart))}</strong></div>
    <div class="meal-plan-week-days">
      ${days.map((day, index) => {
        const date = addDays(weekStart, index);
        const recipeId = plan.days[day] || "";
        const existing = recipeId ? (recipeForPlan(recipeId, plan)?.name || "Planned recipe unavailable") : "Empty";
        const isCurrentRecipe = recipeId && assigningRecipe && String(recipeId) === String(assigningRecipe.id);
        const stateClass = isCurrentRecipe ? "current-recipe" : (recipeId ? "occupied" : "");
        const detail = isCurrentRecipe ? `${existing} • Already planned` : existing;
        return `<button class="meal-plan-date-choice ${stateClass}" type="button" data-assign-date="${date.toISOString().slice(0,10)}">
          <strong>${escapeHTML(fullDate(date))}</strong><span>${escapeHTML(detail)}</span>
        </button>`;
      }).join("")}
    </div>
  </section>`;
}

function renderAssignDates(){
  const firstWeek = activeWeek;
  const secondWeek = addDays(firstWeek, 7);
  $("plannerAssignDates").innerHTML = renderWeekDateGroup(firstWeek, "Selected week") + renderWeekDateGroup(secondWeek, "Following week");
}

async function assign(date){
  const weekStart = mondayOf(date);
  const plan = planFor(weekStart);
  const day = days[(date.getDay() + 6) % 7];
  const oldRecipeId = plan.days[day] || "";
  if(oldRecipeId && String(oldRecipeId) !== String(assigningRecipe.id)){
    const oldName = recipeForPlan(oldRecipeId, plan)?.name || "Planned recipe unavailable";
    const confirmed = window.confirm(`${fullDate(date)} already has:\n\n${oldName}\n\nReplace it with:\n\n${assigningRecipe.name}?`);
    if(!confirmed) return;
  }
  plan.days[day] = assigningRecipe.id;
  if(!plan.recipeSnapshots) plan.recipeSnapshots = {};
  plan.recipeSnapshots[normalizeRecipeId(assigningRecipe.id)] = snapshotForRecipe(assigningRecipe);
  plan.updatedAt = new Date().toISOString();
  const synced = await saveSharedWeek(weekStart);
  $("plannerAssignStatus").textContent = synced
    ? `Added to ${fullDate(date)} and shared.`
    : `Added to ${fullDate(date)} on this device; sync will retry later.`;
  $("plannerAssignStatus").className = "import-status success";
  renderPlanner();
  renderResults();
  renderAssignDates();
}

function openAssignDialog(recipe){
  assigningRecipe = recipe;
  $("plannerAssignName").textContent = recipe.name || "Untitled recipe";
  $("plannerAssignStatus").textContent = "";
  renderAssignDates();
  $("plannerAssignDialog").showModal();
}

async function addToPool(recipeId){
  const plan = planFor();
  if(!plan.pool.some(id => String(id) === String(recipeId))){
    plan.pool.push(recipeId);
    if(!plan.recipeSnapshots) plan.recipeSnapshots = {};
    const pooledRecipe = recipeById(recipeId);
    if(pooledRecipe) plan.recipeSnapshots[normalizeRecipeId(recipeId)] = snapshotForRecipe(pooledRecipe);
    plan.updatedAt = new Date().toISOString();
    await saveSharedWeek(activeWeek);
  }
  $("recipePoolStatus").textContent = "Added to this week's pool.";
  setTimeout(() => { if($("recipePoolStatus")) $("recipePoolStatus").textContent = ""; }, 1800);
  renderPool();
  renderResults();
  renderHistory();
}

async function removeFromPool(recipeId){
  const plan = planFor();
  plan.pool = plan.pool.filter(id => String(id) !== String(recipeId));
  plan.updatedAt = new Date().toISOString();
  await saveSharedWeek(activeWeek);
  renderPool();
  renderResults();
  renderHistory();
}

document.addEventListener("click", async event => {
  const assignButton = event.target.closest("[data-assign-recipe]");
  if(assignButton){
    const recipe = recipeById(assignButton.dataset.assignRecipe);
    if(recipe) openAssignDialog(recipe);
    return;
  }
  const dateButton = event.target.closest("[data-assign-date]");
  if(dateButton && assigningRecipe){
    await assign(new Date(`${dateButton.dataset.assignDate}T12:00:00`));
    return;
  }
  const poolButton = event.target.closest("[data-add-to-pool]");
  if(poolButton && !poolButton.disabled){ await addToPool(poolButton.dataset.addToPool); return; }
  const removeButton = event.target.closest("[data-remove-from-pool]");
  if(removeButton){ await removeFromPool(removeButton.dataset.removeFromPool); }
});

$("plannerSearch").addEventListener("input", renderResults);
["plannerProtein","plannerType","plannerCuisine","plannerCollection","plannerQuickOnly"].forEach(id => $(id).addEventListener("change", renderResults));
$("plannerClearFilters").addEventListener("click", () => {
  $("plannerSearch").value = "";
  ["plannerProtein","plannerType","plannerCuisine","plannerCollection"].forEach(id => $(id).value = "");
  $("plannerQuickOnly").checked = false;
  renderResults();
});
$("clearRecipePool").addEventListener("click", async () => {
  const plan = planFor();
  if(!plan.pool.length) return;
  if(!window.confirm(`Remove all ${plan.pool.length} recipes from this week's pool?`)) return;
  plan.pool = [];
  plan.updatedAt = new Date().toISOString();
  await saveSharedWeek(activeWeek);
  renderPool();
  renderResults();
  renderHistory();
});
$("closePlannerAssign").addEventListener("click", () => $("plannerAssignDialog").close());
$("previousWeek").addEventListener("click", () => { activeWeek = addDays(activeWeek, -7); renderPlanner(); renderResults(); });
$("nextWeek").addEventListener("click", () => { activeWeek = addDays(activeWeek, 7); renderPlanner(); renderResults(); });
$("thisWeek").addEventListener("click", () => { activeWeek = mondayOf(new Date()); renderPlanner(); renderResults(); });


// Shopping list ------------------------------------------------------------
const SHOPPING_CATEGORIES = [
  "Produce",
  "Meat",
  "Dairy",
  "Canned",
  "Condiments & Spices",
  "Frozen",
  "Bakery",
  "Breads & Dried Goods",
  "Snacks",
  "Other"
];
const SHOPPING_CATEGORY_MEMORY_KEY = "recipeVaultShoppingCategoryMemoryV121";
let latestShoppingText = "";
let latestShoppingItems = [];
let shoppingCategoryMemory = readShoppingCategoryMemory();
let extraShoppingRecipeIds = new Set();

function readShoppingCategoryMemory(){
  try{
    const parsed = JSON.parse(localStorage.getItem(SHOPPING_CATEGORY_MEMORY_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  }catch(error){
    return {};
  }
}

function saveShoppingCategoryMemory(){
  localStorage.setItem(SHOPPING_CATEGORY_MEMORY_KEY, JSON.stringify(shoppingCategoryMemory));
}

function ingredientMemoryKey(value){
  return String(value || "")
    .toLowerCase()
    .replace(/^\s*(?:\d+(?:\.\d+)?|\d+\/\d+|[¼½¾⅓⅔⅛⅜⅝⅞])\s*/g, "")
    .replace(/\b(units?|pieces?)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function plannedRecipesForWeek(){
  const plan = planFor();
  const seen = new Set();
  return days.map(day => {
    const id = normalizeRecipeId(plan.days[day] || "");
    if(!id || seen.has(id)) return null;
    seen.add(id);
    const recipe = recipeForPlan(id, plan);
    return recipe ? {day, recipe} : null;
  }).filter(Boolean);
}

function categoryForIngredient(text){
  const memoryKey = ingredientMemoryKey(text);
  if(memoryKey && shoppingCategoryMemory[memoryKey]) return shoppingCategoryMemory[memoryKey];

  const value = String(text || "").toLowerCase();
  if(/\b(chicken|beef|steak|pork|bacon|sausage|turkey|ham|lamb|salmon|shrimp|fish|tilapia|cod|ground meat|ground chuck)\b/.test(value)) return "Meat";
  if(/\b(milk|cream|half and half|cheese|parmesan|mozzarella|cheddar|butter|yogurt|egg|eggs|sour cream|cream cheese|ricotta)\b/.test(value)) return "Dairy";
  if(/\b(canned|can of|beans|black beans|kidney beans|chickpeas|tomato paste|diced tomatoes|crushed tomatoes|coconut milk|evaporated milk|condensed soup|tuna)\b/.test(value)) return "Canned";
  if(/\b(frozen|ice cream|frozen vegetables|frozen corn|frozen peas|frozen fruit|tater tots|french fries)\b/.test(value)) return "Frozen";
  if(/\b(onion|garlic cloves?|bell pepper|jalape[nñ]o|tomato|potato|sweet potato|carrot|celery|lettuce|mixed greens|spring mix|spinach|kale|broccoli|cauliflower|lime|lemon|avocado|cilantro|parsley|mushroom|zucchini|cucumber|corn on the cob|ginger|apple|pear|mango|scallion|green onion|cabbage|asparagus|green beans|berries|strawberr|blueberr|banana)\b/.test(value)) return "Produce";
  if(/\b(bakery|fresh bread|baguette|ciabatta|croissant|dinner rolls?|hamburger buns?|hot dog buns?|bagels?|muffins?)\b/.test(value)) return "Bakery";
  if(/\b(rice|pasta|noodles?|spaghetti|macaroni|flour|sugar|oats|quinoa|couscous|bread crumbs?|breadcrumbs|tortillas?|pita|naan|wraps?|crackers?|cereal|dry beans|lentils)\b/.test(value)) return "Breads & Dried Goods";
  if(/\b(chips?|pretzels?|popcorn|cookies?|granola bars?|fruit snacks?|nuts?|trail mix|candy|chocolate)\b/.test(value)) return "Snacks";
  if(/\b(salt|pepper|garlic powder|onion powder|paprika|cumin|oregano|basil|thyme|rosemary|seasoning|spice|oil|olive oil|vinegar|soy sauce|hot sauce|barbecue sauce|bbq sauce|ketchup|mustard|mayonnaise|mayo|relish|honey|maple syrup|salsa|dressing|broth|stock|bouillon)\b/.test(value)) return "Condiments & Spices";
  return "Other";
}

function normalizeFractionText(text){
  return String(text || "")
    .replace(/¼/g," 1/4").replace(/½/g," 1/2").replace(/¾/g," 3/4")
    .replace(/⅓/g," 1/3").replace(/⅔/g," 2/3").replace(/⅛/g," 1/8")
    .replace(/⅜/g," 3/8").replace(/⅝/g," 5/8").replace(/⅞/g," 7/8")
    .replace(/\s+/g," ").trim();
}

function numberFromToken(token){
  const value = String(token || "").trim();
  if(/^\d+\/\d+$/.test(value)){
    const [a,b] = value.split("/").map(Number);
    return b ? a / b : NaN;
  }
  return Number(value);
}

function cleanIngredientName(value){
  return String(value || "")
    .replace(/^\s*(?:units?|pieces?)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function displayUnit(value){
  const unit = String(value || "").toLowerCase();
  return /^(units?|pieces?)$/.test(unit) ? "" : unit;
}

function parseIngredientLine(line){
  const original = String(line || "").trim();
  const text = normalizeFractionText(original);
  const match = text.match(/^(?:(\d+(?:\.\d+)?)\s+)?(\d+\/\d+|\d+(?:\.\d+)?)(?:\s+)(cups?|c|tablespoons?|tbsp|teaspoons?|tsp|ounces?|oz|pounds?|lbs?|lb|grams?|g|kilograms?|kg|milliliters?|ml|liters?|l|cloves?|cans?|packages?|pkg|sticks?|slices?|pieces?|units?)\b\s*(.*)$/i);
  if(match){
    const whole = match[1] ? Number(match[1]) : 0;
    const amount = whole + numberFromToken(match[2]);
    const unit = displayUnit(match[3]);
    const name = cleanIngredientName(match[4]);
    if(Number.isFinite(amount) && name){
      return {original, amount, unit, name, key:`${unit}|${ingredientMemoryKey(name)}`};
    }
  }
  const noUnit = text.match(/^(?:(\d+(?:\.\d+)?)\s+)?(\d+\/\d+|\d+(?:\.\d+)?)\s+(.+)$/);
  if(noUnit){
    const amount = (noUnit[1] ? Number(noUnit[1]) : 0) + numberFromToken(noUnit[2]);
    const name = cleanIngredientName(noUnit[3]);
    if(Number.isFinite(amount) && name){
      return {original, amount, unit:"", name, key:`|${ingredientMemoryKey(name)}`};
    }
  }
  const name = cleanIngredientName(original);
  return {original, amount:null, unit:"", name, key:`raw|${ingredientMemoryKey(name)}`};
}

function prettyAmount(value){
  const rounded = Math.round(value * 100) / 100;
  const whole = Math.floor(rounded);
  const fraction = Math.round((rounded - whole) * 8) / 8;
  const labels = {0.125:"1/8",0.25:"1/4",0.375:"3/8",0.5:"1/2",0.625:"5/8",0.75:"3/4",0.875:"7/8"};
  if(!fraction) return String(whole);
  if(labels[fraction]) return whole ? `${whole} ${labels[fraction]}` : labels[fraction];
  return String(rounded);
}

function selectedShoppingRecipes(){
  const selected = [...document.querySelectorAll('[data-shopping-recipe]:checked')]
    .map(input => recipeById(input.value))
    .filter(Boolean);
  extraShoppingRecipeIds.forEach(id => {
    const recipe = recipeById(id);
    if(recipe && !selected.some(item => String(item.id) === String(recipe.id))){
      selected.push(recipe);
    }
  });
  return selected;
}

function renderExtraShoppingRecipes(){
  const query = String($("shoppingExtraSearch")?.value || "").trim().toLowerCase();
  const selectedIds = new Set([
    ...[...document.querySelectorAll('[data-shopping-recipe]:checked')].map(input => String(input.value)),
    ...[...extraShoppingRecipeIds].map(String)
  ]);
  const matches = query
    ? recipes.filter(recipe => searchText(recipe).includes(query) && !selectedIds.has(String(recipe.id))).slice(0, 20)
    : [];

  $("shoppingExtraResults").innerHTML = query
    ? (matches.length ? matches.map(recipe => `
      <button class="shopping-extra-result" type="button" data-add-shopping-extra="${escapeHTML(recipe.id)}">
        <strong>${escapeHTML(recipe.name || "Untitled recipe")}</strong>
        <span>${escapeHTML([recipe.protein, recipe.type].filter(Boolean).join(" • "))}</span>
      </button>`).join("") : '<p class="muted">No matching recipes.</p>')
    : '<p class="muted">Search for a topping, side, sauce, dessert, or any additional recipe.</p>';

  const extras = [...extraShoppingRecipeIds].map(recipeById).filter(Boolean);
  $("shoppingExtraSelected").innerHTML = extras.length
    ? extras.map(recipe => `<span class="shopping-extra-chip">${escapeHTML(recipe.name || "Untitled recipe")}<button type="button" data-remove-shopping-extra="${escapeHTML(recipe.id)}" aria-label="Remove ${escapeHTML(recipe.name || "recipe")}">×</button></span>`).join("")
    : '<span class="muted">No extra recipes added.</span>';
}

function openShoppingListDialog(){
  const planned = plannedRecipesForWeek();
  extraShoppingRecipeIds = new Set();
  $("shoppingListTitle").textContent = `Shopping list · ${weekLabel(activeWeek)}`;
  $("shoppingListIntro").textContent = planned.length
    ? "Uncheck a planned meal or add extra recipes that are not assigned to a day."
    : "Add extra recipes below, or schedule meals before generating the list.";
  $("shoppingRecipeChooser").innerHTML = planned.length ? planned.map(({day,recipe}) => `
    <label class="shopping-recipe-choice">
      <input type="checkbox" data-shopping-recipe value="${escapeHTML(recipe.id)}" checked>
      <span><strong>${escapeHTML(recipe.name || "Untitled recipe")}</strong><small>${escapeHTML(day)}</small></span>
    </label>`).join("") : '<p class="muted">No planned recipes this week.</p>';
  $("shoppingExtraSearch").value = "";
  renderExtraShoppingRecipes();
  $("shoppingRecipeChooser").hidden = false;
  $("shoppingExtraRecipes").hidden = false;
  $("shoppingListOutput").hidden = true;
  $("generateShoppingList").hidden = false;
  $("backToShoppingRecipes").hidden = true;
  $("copyShoppingList").hidden = true;
  $("printShoppingList").hidden = true;
  $("shoppingListStatus").textContent = "";
  $("shoppingListDialog").showModal();
}

function shoppingItemDisplay(item){
  if(item.amount === null) return cleanIngredientName(item.original);
  return `${prettyAmount(item.amount)}${item.unit ? ` ${item.unit}` : ""} ${item.name}`.trim();
}

function buildShoppingText(){
  const grouped = Object.fromEntries(SHOPPING_CATEGORIES.map(name => [name,[]]));
  latestShoppingItems.forEach(item => grouped[item.category].push(item.display));
  const activeGroups = SHOPPING_CATEGORIES.filter(name => grouped[name].length);
  latestShoppingText = activeGroups.map(group => `${group}\n${grouped[group].sort((a,b)=>a.localeCompare(b)).map(item => `☐ ${item}`).join("\n")}`).join("\n\n");
  return {grouped, activeGroups};
}

function renderShoppingOutput(selectedRecipes){
  const {grouped, activeGroups} = buildShoppingText();
  const categoryOptions = SHOPPING_CATEGORIES.map(category => `<option value="${escapeHTML(category)}">${escapeHTML(category)}</option>`).join("");
  $("shoppingListOutput").innerHTML = `
    <div class="shopping-list-summary"><strong>${latestShoppingItems.length} ingredient${latestShoppingItems.length === 1 ? "" : "s"}</strong><span>From ${selectedRecipes.length} recipe${selectedRecipes.length === 1 ? "" : "s"}</span></div>
    ${activeGroups.map(group => `<section class="shopping-category" data-shopping-category="${escapeHTML(group)}"><h3>${escapeHTML(group)}</h3>${latestShoppingItems.filter(item => item.category === group).sort((a,b)=>a.display.localeCompare(b.display)).map(item => `<div class="shopping-item-row"><label class="shopping-item"><input type="checkbox"><span>${escapeHTML(item.display)}</span></label><select class="shopping-section-select" data-shopping-item-key="${escapeHTML(item.itemKey)}" aria-label="Move ${escapeHTML(item.display)} to another section">${categoryOptions}</select></div>`).join("")}</section>`).join("")}
    <section class="shopping-list-recipes"><h3>Generated from</h3><p>${selectedRecipes.map(recipe => escapeHTML(recipe.name || "Untitled recipe")).join(" • ")}</p></section>`;

  document.querySelectorAll("[data-shopping-item-key]").forEach(select => {
    const item = latestShoppingItems.find(entry => entry.itemKey === select.dataset.shoppingItemKey);
    if(item) select.value = item.category;
    select.addEventListener("change", () => {
      const changed = latestShoppingItems.find(entry => entry.itemKey === select.dataset.shoppingItemKey);
      if(!changed) return;
      changed.category = select.value;
      const memoryKey = ingredientMemoryKey(changed.name);
      if(memoryKey){
        shoppingCategoryMemory[memoryKey] = select.value;
        saveShoppingCategoryMemory();
      }
      renderShoppingOutput(selectedRecipes);
      $("shoppingListStatus").textContent = `${changed.name} will go to ${select.value} on future lists.`;
      $("shoppingListStatus").className = "import-status success";
    });
  });

  latestShoppingText += `\n\nGenerated from: ${selectedRecipes.map(recipe => recipe.name || "Untitled recipe").join(", ")}`;
}

function buildShoppingList(){
  const selected = selectedShoppingRecipes();
  if(!selected.length){
    $("shoppingListStatus").textContent = "Choose at least one recipe.";
    $("shoppingListStatus").className = "import-status error";
    return;
  }
  const merged = new Map();
  selected.forEach(recipe => {
    [...new Set((recipe.ingredients || []).map(item => String(item).trim()).filter(Boolean))].forEach(line => {
      const parsed = parseIngredientLine(line);
      if(parsed.amount !== null && merged.has(parsed.key)){
        merged.get(parsed.key).amount += parsed.amount;
      }else if(!merged.has(parsed.key)){
        merged.set(parsed.key, {...parsed});
      }
    });
  });
  latestShoppingItems = [...merged.values()].map((item, index) => ({
    ...item,
    itemKey:`shopping-${index}-${ingredientMemoryKey(item.name)}`,
    display:shoppingItemDisplay(item),
    category:categoryForIngredient(item.name)
  }));
  renderShoppingOutput(selected);
  $("shoppingRecipeChooser").hidden = true;
  $("shoppingExtraRecipes").hidden = true;
  $("shoppingListOutput").hidden = false;
  $("generateShoppingList").hidden = true;
  $("backToShoppingRecipes").hidden = false;
  $("copyShoppingList").hidden = false;
  $("printShoppingList").hidden = false;
  $("shoppingListStatus").textContent = "Matching ingredients were combined. Move anything once and the list will remember next time.";
  $("shoppingListStatus").className = "import-status success";
}

$("shoppingExtraSearch").addEventListener("input", renderExtraShoppingRecipes);
document.addEventListener("click", event => {
  const addExtra = event.target.closest("[data-add-shopping-extra]");
  if(addExtra){
    extraShoppingRecipeIds.add(addExtra.dataset.addShoppingExtra);
    $("shoppingExtraSearch").value = "";
    renderExtraShoppingRecipes();
    return;
  }
  const removeExtra = event.target.closest("[data-remove-shopping-extra]");
  if(removeExtra){
    extraShoppingRecipeIds.delete(removeExtra.dataset.removeShoppingExtra);
    renderExtraShoppingRecipes();
  }
});

$("openShoppingList").addEventListener("click", openShoppingListDialog);
$("closeShoppingList").addEventListener("click", () => $("shoppingListDialog").close());
$("generateShoppingList").addEventListener("click", buildShoppingList);
$("backToShoppingRecipes").addEventListener("click", () => {
  $("shoppingRecipeChooser").hidden = false;
  $("shoppingExtraRecipes").hidden = false;
  $("shoppingListOutput").hidden = true;
  $("generateShoppingList").hidden = false;
  $("backToShoppingRecipes").hidden = true;
  $("copyShoppingList").hidden = true;
  $("printShoppingList").hidden = true;
});
$("copyShoppingList").addEventListener("click", async () => {
  try{
    await navigator.clipboard.writeText(latestShoppingText);
    $("shoppingListStatus").textContent = "Shopping list copied.";
  }catch(error){
    $("shoppingListStatus").textContent = "Could not copy automatically. Select the list and copy it manually.";
  }
});
$("printShoppingList").addEventListener("click", () => window.print());


let automaticSyncInProgress = false;
async function refreshSharedPlannerSilently(){
  if(automaticSyncInProgress || document.hidden) return;
  automaticSyncInProgress = true;
  try{
    await loadSharedPlans(true);
    renderPlanner();
    renderResults();
  }catch(error){
    syncReady = false;
    setPlannerSyncStatus("error", "Shared planner unavailable", error.message);
  }finally{
    automaticSyncInProgress = false;
  }
}

window.addEventListener("focus", refreshSharedPlannerSilently);
window.addEventListener("pageshow", event => {
  if(event.persisted) refreshSharedPlannerSilently();
});
document.addEventListener("visibilitychange", () => {
  if(!document.hidden) refreshSharedPlannerSilently();
});
setInterval(() => {
  if(!document.hidden) refreshSharedPlannerSilently();
}, 60000);

document.querySelectorAll("dialog").forEach(dialog => dialog.addEventListener("click", event => {
  if(event.target === dialog) dialog.close();
}));

function applyPlannerRecipeRows(rows){
  recipes = rows
    .map(clean)
    .filter(recipe => !recipe.hidden)
    .sort((a,b) => String(a.name).localeCompare(String(b.name)));
  fill("plannerProtein", unique(recipes.map(recipe => recipe.protein)));
  fill("plannerType", unique(recipes.map(recipe => recipe.type)));
  fill("plannerCuisine", unique(recipes.map(recipe => recipe.cuisine)));
  fill("plannerCollection", unique(recipes.flatMap(recipe => recipe.collections)));
}

async function fetchPlannerRecipes(){
  const source = config.sheetCsvUrl || "recipes.json";
  const url = new URL(source, window.location.href);
  if(config.sheetCsvUrl) url.searchParams.set("rv", String(Date.now()));
  const response = await fetch(url.toString(), {cache:"no-store"});
  if(!response.ok) throw new Error(`HTTP ${response.status}`);
  const rows = config.sheetCsvUrl ? parseCSV(await response.text()) : await response.json();
  writePlannerRecipeCache(rows);
  applyPlannerRecipeRows(rows);
  return rows;
}

async function loadRecipes(){
  const cached = readPlannerRecipeCache();

  if(cached?.rows?.length){
    applyPlannerRecipeRows(cached.rows);
    $("weekStatus").textContent = "Refreshing…";
    renderPlanner();
    renderResults();
  }else{
    $("weekStatus").textContent = "Loading…";
    // Render the calendar shell and locally saved plans immediately.
    renderPlanner();
  }

  // Recipes and shared plans are independent; load them at the same time.
  const recipeTask = fetchPlannerRecipes();
  const planTask = loadSharedPlans(true);
  const [recipeResult, planResult] = await Promise.allSettled([recipeTask, planTask]);

  if(recipeResult.status === "rejected" && !cached?.rows?.length){
    $("weekStatus").textContent = `Could not load recipes: ${recipeResult.reason?.message || recipeResult.reason}`;
    return;
  }

  if(planResult.status === "rejected"){
    syncReady = false;
    setPlannerSyncStatus("error", "Shared planner unavailable", planResult.reason?.message || String(planResult.reason));
    $("weekStatus").textContent = "Showing saved planner; shared refresh delayed";
  }else{
    $("weekStatus").textContent = "";
  }

  renderPlanner();
  renderResults();
}

loadRecipes();
})();