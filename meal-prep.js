(() => {
"use strict";

const SETTINGS_KEY = "recipeVaultSettingsV031";
const WEEKLY_PLANS_KEY = "recipeVaultWeeklyPlansV104";
const PLANNER_RECIPE_CACHE_KEY = "recipeVaultPlannerRecipeCacheV118";
const MEAL_PREP_ID_PREFIX = "prep";
const $ = id => document.getElementById(id);

const base = window.RECIPE_VAULT_CONFIG || {};
let settings = {};
try { settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"); } catch {}
const config = {...base, ...settings};

let activeWeek = mondayOf(new Date());
let recipes = [];
let saving = false;

function escapeHTML(value){
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"
  })[character]);
}

function mondayOf(date){
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  const day = copy.getDay();
  copy.setDate(copy.getDate() + (day === 0 ? -6 : 1 - day));
  return copy;
}

function addDays(date, amount){
  const copy = new Date(date);
  copy.setDate(copy.getDate() + amount);
  return copy;
}

function weekKey(date){
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}

function readPlans(){
  try{
    const parsed = JSON.parse(localStorage.getItem(WEEKLY_PLANS_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  }catch{
    return {};
  }
}

function savePlans(plans){
  localStorage.setItem(WEEKLY_PLANS_KEY, JSON.stringify(plans));
}

function currentPlan(){
  const plans = readPlans();
  const key = weekKey(activeWeek);
  const plan = plans[key] && typeof plans[key] === "object" ? plans[key] : {days:{},pool:[],recipeSnapshots:{}};
  if(!Array.isArray(plan.mealPrep)) plan.mealPrep = [];
  return {plans,key,plan};
}

function normalizePrepItem(item){
  if(!item || typeof item !== "object") return null;
  const name = String(item.name || item.title || "").trim();
  if(!name) return null;
  return {
    id:String(item.id || `${MEAL_PREP_ID_PREFIX}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`),
    name,
    recipeId:String(item.recipeId || ""),
    amount:String(item.amount || "").trim(),
    notes:String(item.notes || "").trim(),
    complete:Boolean(item.complete),
    addedAt:String(item.addedAt || new Date().toISOString())
  };
}

function recipeFromName(name){
  const normalized = String(name || "").trim().toLowerCase();
  return recipes.find(recipe => String(recipe.name || "").trim().toLowerCase() === normalized) || null;
}

function setStatus(message, state=""){
  const node = $("mealPrepStatus");
  if(!node) return;
  node.textContent = message;
  node.dataset.state = state;
}

function render(){
  const {plan} = currentPlan();
  plan.mealPrep = plan.mealPrep.map(normalizePrepItem).filter(Boolean);
  const list = $("mealPrepList");
  const count = $("mealPrepCount");
  if(!list || !count) return;

  const remaining = plan.mealPrep.filter(item => !item.complete).length;
  count.textContent = plan.mealPrep.length
    ? `${remaining} remaining · ${plan.mealPrep.length} total`
    : "0 planned";

  if(!plan.mealPrep.length){
    list.innerHTML = `<div class="meal-prep-empty"><strong>Nothing queued yet.</strong><span>Add a freezer meal, double batch, breakfast prep, or ingredient prep above.</span></div>`;
    return;
  }

  list.innerHTML = plan.mealPrep.map(item => `
    <article class="meal-prep-item${item.complete ? " is-complete" : ""}" data-prep-id="${escapeHTML(item.id)}">
      <label class="meal-prep-check">
        <input type="checkbox" data-prep-complete="${escapeHTML(item.id)}" ${item.complete ? "checked" : ""}>
        <span aria-hidden="true"></span>
      </label>
      <div class="meal-prep-item-body">
        <div class="meal-prep-item-title">
          <strong>${escapeHTML(item.name)}</strong>
          ${item.recipeId ? '<span class="meal-prep-recipe-badge">Vault recipe</span>' : '<span class="meal-prep-custom-badge">Custom prep</span>'}
        </div>
        ${item.amount ? `<p><b>Amount:</b> ${escapeHTML(item.amount)}</p>` : ""}
        ${item.notes ? `<p><b>Notes:</b> ${escapeHTML(item.notes)}</p>` : ""}
      </div>
      <button class="secondary compact-button meal-prep-remove" type="button" data-prep-remove="${escapeHTML(item.id)}">Remove</button>
    </article>
  `).join("");
}

async function plannerPost(payload){
  if(!config.appsScriptUrl || !config.sharedKey) throw new Error("Shared planner settings are missing.");
  const form = new URLSearchParams();
  form.set("payload", JSON.stringify({...payload, key:config.sharedKey}));
  const response = await fetch(config.appsScriptUrl, {
    method:"POST", body:form, redirect:"follow", cache:"no-store"
  });
  const text = await response.text();
  if(!response.ok) throw new Error(`Apps Script returned HTTP ${response.status}.`);
  let result;
  try { result = JSON.parse(text); }
  catch { throw new Error("Apps Script returned an unreadable response."); }
  if(!result.success) throw new Error(result.error || "Meal prep sync failed.");
  return result;
}

async function persist(mutator){
  if(saving) return;
  saving = true;
  const {plans,key,plan} = currentPlan();
  plan.mealPrep = plan.mealPrep.map(normalizePrepItem).filter(Boolean);
  mutator(plan.mealPrep);
  plan.updatedAt = new Date().toISOString();
  plan.pendingSync = true;
  plans[key] = plan;
  savePlans(plans);
  render();
  setStatus("Saving meal prep…");

  try{
    await plannerPost({action:"saveMealPlan", weekKey:key, plan:{...plan,pendingSync:false}});
    const latest = readPlans();
    if(latest[key] && latest[key].updatedAt === plan.updatedAt){
      latest[key].pendingSync = false;
      savePlans(latest);
    }
    setStatus("Meal prep saved to the shared week.", "success");
  }catch(error){
    setStatus("Saved on this device; shared sync will retry when the planner saves again.", "warning");
    console.warn("Meal prep shared save:", error);
  }finally{
    saving = false;
  }
}

function populateRecipeOptions(){
  const datalist = $("mealPrepRecipeOptions");
  if(!datalist) return;
  datalist.innerHTML = recipes
    .filter(recipe => !recipe.hidden && recipe.name)
    .sort((a,b) => String(a.name).localeCompare(String(b.name)))
    .map(recipe => `<option value="${escapeHTML(recipe.name)}"></option>`)
    .join("");
}

function cleanRecipe(row){
  return {
    ...row,
    name:String(row?.name || "").trim(),
    id:String(row?.id || "").trim(),
    hidden:String(row?.hidden || "").toLowerCase() === "true"
  };
}

async function loadRecipes(){
  try{
    const cached = JSON.parse(localStorage.getItem(PLANNER_RECIPE_CACHE_KEY) || "null");
    if(Array.isArray(cached?.rows)) recipes = cached.rows.map(cleanRecipe);
  }catch{}
  populateRecipeOptions();

  const source = config.sheetCsvUrl || "recipes.json";
  try{
    const response = await fetch(source + (source.includes("?") ? "&" : "?") + "meal_prep=" + Date.now(), {cache:"no-store"});
    if(!response.ok) return;
    if(config.sheetCsvUrl){
      const text = await response.text();
      const rows = parseCSV(text);
      recipes = rows.map(cleanRecipe);
    }else{
      recipes = (await response.json()).map(cleanRecipe);
    }
    populateRecipeOptions();
  }catch(error){
    console.warn("Meal prep recipe suggestions unavailable:", error);
  }
}

function parseCSV(text){
  const rows=[]; let row=[],field="",quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i],n=text[i+1];
    if(c === '"' && quoted && n === '"'){field+='"';i++;}
    else if(c === '"') quoted=!quoted;
    else if(c === "," && !quoted){row.push(field);field="";}
    else if((c === "\n" || c === "\r") && !quoted){
      if(c === "\r" && n === "\n") i++;
      row.push(field); if(row.some(value => value !== "")) rows.push(row); row=[];field="";
    }else field+=c;
  }
  if(field || row.length){row.push(field);rows.push(row);}
  if(rows.length < 2) return [];
  const headers=rows.shift().map(value=>value.trim().toLowerCase());
  return rows.map(columns=>Object.fromEntries(headers.map((header,index)=>[header,columns[index] ?? ""])));
}

$("mealPrepForm")?.addEventListener("submit", event => {
  event.preventDefault();
  const name = $("mealPrepName").value.trim();
  if(!name) return;
  const recipe = recipeFromName(name);
  const item = normalizePrepItem({
    name,
    recipeId:recipe?.id || "",
    amount:$("mealPrepAmount").value,
    notes:$("mealPrepNotes").value
  });
  persist(items => items.push(item));
  event.currentTarget.reset();
  $("mealPrepName").focus();
});

document.addEventListener("change", event => {
  const id = event.target?.dataset?.prepComplete;
  if(!id) return;
  persist(items => {
    const item = items.find(entry => entry.id === id);
    if(item) item.complete = event.target.checked;
  });
});

document.addEventListener("click", event => {
  const id = event.target.closest("[data-prep-remove]")?.dataset.prepRemove;
  if(!id) return;
  persist(items => {
    const index = items.findIndex(entry => entry.id === id);
    if(index >= 0) items.splice(index,1);
  });
});

$("previousWeek")?.addEventListener("click", () => {
  activeWeek = addDays(activeWeek,-7);
  requestAnimationFrame(render);
});
$("nextWeek")?.addEventListener("click", () => {
  activeWeek = addDays(activeWeek,7);
  requestAnimationFrame(render);
});
$("thisWeek")?.addEventListener("click", () => {
  activeWeek = mondayOf(new Date());
  requestAnimationFrame(render);
});

window.addEventListener("storage", event => {
  if(event.key === WEEKLY_PLANS_KEY) render();
});

render();
loadRecipes();
})();