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
let saveChain = Promise.resolve();

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

async function persist(mutator){
  const {plans,key,plan} = currentPlan();
  plan.mealPrep = plan.mealPrep.map(normalizePrepItem).filter(Boolean);
  mutator(plan.mealPrep);
  plan.updatedAt = new Date().toISOString();
  plan.pendingSync = true;
  plans[key] = plan;
  savePlans(plans);
  render();
  setStatus("Saving meal prep…");

  const snapshot = JSON.parse(JSON.stringify(plan));
  const task = async () => {
    try{
      await plannerPost({action:"saveMealPlan", weekKey:key, plan:snapshot});
      const latest = readPlans();
      if(latest[key] && latest[key].updatedAt === snapshot.updatedAt){
        latest[key].pendingSync = false;
        savePlans(latest);
      }
      setStatus("Meal prep saved.", "success");
    }catch(error){
      setStatus("Saved on this device; shared sync will retry with the next change.", "warning");
      console.warn("Meal prep shared save:", error);
    }
  };
  const promise = saveChain.catch(() => undefined).then(task);
  saveChain = promise.then(() => undefined, () => undefined);
  return promise;
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