(() => {
"use strict";
const $ = id => document.getElementById(id);
const SETTINGS_KEY = "recipeVaultSettingsV031";
const WEEKLY_PLANS_KEY = "recipeVaultWeeklyPlansV104";
const base = window.RECIPE_VAULT_CONFIG || {};
const settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
const config = {...base, ...settings};
const days = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
let recipes = [];
let plans = readPlans();
let activeWeek = mondayOf(new Date());
let assigningRecipe = null;

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

function readPlans(){
  try{
    const parsed = JSON.parse(localStorage.getItem(WEEKLY_PLANS_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  }catch(error){
    return {};
  }
}

function savePlans(){ localStorage.setItem(WEEKLY_PLANS_KEY, JSON.stringify(plans)); }
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
  if(!plans[key]) plans[key] = {days:{}, pool:[], updatedAt:null};
  if(!plans[key].days) plans[key].days = {};
  if(!Array.isArray(plans[key].pool)) plans[key].pool = [];
  return plans[key];
}
function recipeById(id){ return recipes.find(recipe => String(recipe.id) === String(id)); }
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
    const recipe = recipeById(recipeId);
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

  document.querySelectorAll("[data-clear-day]").forEach(button => button.addEventListener("click", () => {
    delete plan.days[button.dataset.clearDay];
    plan.updatedAt = new Date().toISOString();
    savePlans();
    renderPlanner();
    renderPool();
  }));
  renderPool();
  renderHistory();
}

function renderPool(){
  const plan = planFor();
  const poolRecipes = plan.pool.map(recipeById).filter(Boolean);
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
        const existing = recipeId ? (recipeById(recipeId)?.name || "Unknown recipe") : "Empty";
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

function assign(date){
  const weekStart = mondayOf(date);
  const plan = planFor(weekStart);
  const day = days[(date.getDay() + 6) % 7];
  const oldRecipeId = plan.days[day] || "";
  if(oldRecipeId && String(oldRecipeId) !== String(assigningRecipe.id)){
    const oldName = recipeById(oldRecipeId)?.name || "Unknown recipe";
    const confirmed = window.confirm(`${fullDate(date)} already has:\n\n${oldName}\n\nReplace it with:\n\n${assigningRecipe.name}?`);
    if(!confirmed) return;
  }
  plan.days[day] = assigningRecipe.id;
  plan.updatedAt = new Date().toISOString();
  savePlans();
  $("plannerAssignStatus").textContent = `Added to ${fullDate(date)}.`;
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

function addToPool(recipeId){
  const plan = planFor();
  if(!plan.pool.some(id => String(id) === String(recipeId))){
    plan.pool.push(recipeId);
    plan.updatedAt = new Date().toISOString();
    savePlans();
  }
  $("recipePoolStatus").textContent = "Added to this week's pool.";
  setTimeout(() => { if($("recipePoolStatus")) $("recipePoolStatus").textContent = ""; }, 1800);
  renderPool();
  renderResults();
  renderHistory();
}

function removeFromPool(recipeId){
  const plan = planFor();
  plan.pool = plan.pool.filter(id => String(id) !== String(recipeId));
  plan.updatedAt = new Date().toISOString();
  savePlans();
  renderPool();
  renderResults();
  renderHistory();
}

document.addEventListener("click", event => {
  const assignButton = event.target.closest("[data-assign-recipe]");
  if(assignButton){
    const recipe = recipeById(assignButton.dataset.assignRecipe);
    if(recipe) openAssignDialog(recipe);
    return;
  }
  const dateButton = event.target.closest("[data-assign-date]");
  if(dateButton && assigningRecipe){
    assign(new Date(`${dateButton.dataset.assignDate}T12:00:00`));
    return;
  }
  const poolButton = event.target.closest("[data-add-to-pool]");
  if(poolButton && !poolButton.disabled){ addToPool(poolButton.dataset.addToPool); return; }
  const removeButton = event.target.closest("[data-remove-from-pool]");
  if(removeButton){ removeFromPool(removeButton.dataset.removeFromPool); }
});

$("plannerSearch").addEventListener("input", renderResults);
["plannerProtein","plannerType","plannerCuisine","plannerCollection","plannerQuickOnly"].forEach(id => $(id).addEventListener("change", renderResults));
$("plannerClearFilters").addEventListener("click", () => {
  $("plannerSearch").value = "";
  ["plannerProtein","plannerType","plannerCuisine","plannerCollection"].forEach(id => $(id).value = "");
  $("plannerQuickOnly").checked = false;
  renderResults();
});
$("clearRecipePool").addEventListener("click", () => {
  const plan = planFor();
  if(!plan.pool.length) return;
  if(!window.confirm(`Remove all ${plan.pool.length} recipes from this week's pool?`)) return;
  plan.pool = [];
  plan.updatedAt = new Date().toISOString();
  savePlans();
  renderPool();
  renderResults();
  renderHistory();
});
$("closePlannerAssign").addEventListener("click", () => $("plannerAssignDialog").close());
$("previousWeek").addEventListener("click", () => { activeWeek = addDays(activeWeek, -7); renderPlanner(); renderResults(); });
$("nextWeek").addEventListener("click", () => { activeWeek = addDays(activeWeek, 7); renderPlanner(); renderResults(); });
$("thisWeek").addEventListener("click", () => { activeWeek = mondayOf(new Date()); renderPlanner(); renderResults(); });

document.querySelectorAll("dialog").forEach(dialog => dialog.addEventListener("click", event => {
  if(event.target === dialog) dialog.close();
}));

async function loadRecipes(){
  $("weekStatus").textContent = "Loading recipes…";
  try{
    const source = config.sheetCsvUrl || "recipes.json";
    const url = new URL(source, window.location.href);
    if(config.sheetCsvUrl) url.searchParams.set("rv", String(Date.now()));
    const response = await fetch(url.toString(), {cache:"no-store"});
    if(!response.ok) throw new Error(`HTTP ${response.status}`);
    recipes = (config.sheetCsvUrl ? parseCSV(await response.text()) : await response.json())
      .map(clean).filter(recipe => !recipe.hidden)
      .sort((a,b) => String(a.name).localeCompare(String(b.name)));
    fill("plannerProtein", unique(recipes.map(recipe => recipe.protein)));
    fill("plannerType", unique(recipes.map(recipe => recipe.type)));
    fill("plannerCuisine", unique(recipes.map(recipe => recipe.cuisine)));
    fill("plannerCollection", unique(recipes.flatMap(recipe => recipe.collections)));
    $("weekStatus").textContent = "";
    renderPlanner();
    renderResults();
  }catch(error){
    $("weekStatus").textContent = `Could not load recipes: ${error.message}`;
  }
}

loadRecipes();
})();
