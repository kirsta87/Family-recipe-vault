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

window.addEventListener("error", event => {
  const box = $("fatalError");
  box.hidden = false;
  box.textContent = `Planner error: ${event.message}`;
});

function escapeHTML(value){
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"
  })[c]);
}

function parseCSV(text){
  const rows=[]; let row=[]; let field=""; let quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i], n=text[i+1];
    if(c==='"' && quoted && n==='"'){ field+='"'; i++; }
    else if(c==='"'){ quoted=!quoted; }
    else if(c==="," && !quoted){ row.push(field); field=""; }
    else if((c==="\n" || c==="\r") && !quoted){
      if(c==="\r" && n==="\n") i++;
      row.push(field);
      if(row.some(value => value !== "")) rows.push(row);
      row=[]; field="";
    }else field+=c;
  }
  if(field || row.length){ row.push(field); rows.push(row); }
  if(rows.length<2) return [];
  const headers=rows.shift().map(value => value.trim().toLowerCase());
  return rows.map(columns => {
    const item={}; headers.forEach((header,index) => item[header]=columns[index] ?? ""); return item;
  });
}

function readPlans(){
  try{
    const parsed=JSON.parse(localStorage.getItem(WEEKLY_PLANS_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  }catch(error){ return {}; }
}

function savePlans(){
  localStorage.setItem(WEEKLY_PLANS_KEY, JSON.stringify(plans));
}

function mondayOf(date){
  const copy=new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  const day=copy.getDay();
  const offset=day===0 ? -6 : 1-day;
  copy.setDate(copy.getDate()+offset);
  return copy;
}

function addDays(date, amount){
  const copy=new Date(date); copy.setDate(copy.getDate()+amount); return copy;
}

function weekKey(date){
  const y=date.getFullYear();
  const m=String(date.getMonth()+1).padStart(2,"0");
  const d=String(date.getDate()).padStart(2,"0");
  return `${y}-${m}-${d}`;
}

function formatDate(date, includeYear=false){
  return date.toLocaleDateString(undefined, {
    month:"short", day:"numeric", ...(includeYear ? {year:"numeric"} : {})
  });
}

function weekLabel(date){
  const end=addDays(date,6);
  const sameYear=date.getFullYear()===end.getFullYear();
  return `${formatDate(date,!sameYear)} – ${formatDate(end,true)}`;
}

function planForActiveWeek(){
  const key=weekKey(activeWeek);
  if(!plans[key]) plans[key]={days:{}, updatedAt:null};
  if(!plans[key].days) plans[key].days={};
  return plans[key];
}

function recipeById(id){
  return recipes.find(recipe => String(recipe.id)===String(id));
}

function recipeOptions(selectedId=""){
  return [
    '<option value="">Choose a recipe…</option>',
    ...recipes.map(recipe => `<option value="${escapeHTML(recipe.id)}" ${String(recipe.id)===String(selectedId)?"selected":""}>${escapeHTML(recipe.name || "Untitled recipe")}</option>`)
  ].join("");
}

function renderPlanner(){
  const plan=planForActiveWeek();
  $("weekTitle").textContent=weekLabel(activeWeek);
  $("plannerGrid").innerHTML=days.map((day,index) => {
    const date=addDays(activeWeek,index);
    const selectedId=plan.days[day] || "";
    const recipe=recipeById(selectedId);
    return `
      <article class="planner-day-card">
        <div class="planner-day-header">
          <div><strong>${day}</strong><span>${formatDate(date)}</span></div>
          ${selectedId ? `<button class="planner-clear" type="button" data-clear-day="${day}">Clear</button>` : ""}
        </div>
        ${recipe?.image ? `<img class="planner-recipe-image" src="${escapeHTML(recipe.image)}" alt="">` : ""}
        <label class="field planner-recipe-select">Recipe
          <select data-plan-day="${day}">${recipeOptions(selectedId)}</select>
        </label>
        ${recipe ? `
          <a class="planner-recipe-link" href="index.html?recipe=${encodeURIComponent(recipe.id)}">
            ${escapeHTML(recipe.name || "Open recipe")}
          </a>
          <p class="planner-recipe-meta">${escapeHTML([recipe.protein,recipe.type,recipe.total_time ? `${recipe.total_time} min` : ""].filter(Boolean).join(" • "))}</p>
        ` : `<p class="muted planner-empty">Nothing planned yet.</p>`}
      </article>`;
  }).join("");

  document.querySelectorAll("[data-plan-day]").forEach(select => {
    select.addEventListener("change", () => setDay(select.dataset.planDay, select.value));
  });
  document.querySelectorAll("[data-clear-day]").forEach(button => {
    button.addEventListener("click", () => setDay(button.dataset.clearDay, ""));
  });
  renderHistory();
}

function setDay(day, recipeId){
  const key=weekKey(activeWeek);
  const plan=planForActiveWeek();
  if(recipeId) plan.days[day]=recipeId;
  else delete plan.days[day];
  plan.updatedAt=new Date().toISOString();
  plans[key]=plan;
  savePlans();
  $("weekStatus").textContent="Saved automatically.";
  renderPlanner();
  window.setTimeout(() => { if($("weekStatus").textContent==="Saved automatically.") $("weekStatus").textContent=""; },1500);
}

function renderHistory(){
  const keys=Object.keys(plans)
    .filter(key => Object.keys(plans[key]?.days || {}).length)
    .sort((a,b) => b.localeCompare(a));
  if(!keys.length){
    $("savedWeeks").innerHTML='<p class="muted">No saved weeks yet. Your first planned meal will create one.</p>';
    return;
  }
  $("savedWeeks").innerHTML=keys.map(key => {
    const start=mondayOf(new Date(`${key}T12:00:00`));
    const count=Object.keys(plans[key].days || {}).length;
    return `<button class="saved-week-button ${key===weekKey(activeWeek)?"active":""}" type="button" data-week-key="${key}">
      <strong>${escapeHTML(weekLabel(start))}</strong><span>${count} meal${count===1?"":"s"}</span>
    </button>`;
  }).join("");
  document.querySelectorAll("[data-week-key]").forEach(button => {
    button.addEventListener("click", () => {
      activeWeek=mondayOf(new Date(`${button.dataset.weekKey}T12:00:00`));
      renderPlanner();
      window.scrollTo({top:0,behavior:"smooth"});
    });
  });
}

async function loadRecipes(){
  $("weekStatus").textContent="Loading recipes…";
  try{
    const source=config.sheetCsvUrl || "recipes.json";
    const url=new URL(source, window.location.href);
    if(config.sheetCsvUrl) url.searchParams.set("rv",String(Date.now()));
    const response=await fetch(url.toString(),{cache:"no-store"});
    if(!response.ok) throw new Error(`HTTP ${response.status}`);
    recipes=config.sheetCsvUrl ? parseCSV(await response.text()) : await response.json();
    recipes=recipes
      .filter(recipe => String(recipe.hidden).toLowerCase() !== "true")
      .sort((a,b) => String(a.name).localeCompare(String(b.name)));
    $("weekStatus").textContent="";
    renderPlanner();
  }catch(error){
    $("weekStatus").textContent=`Could not load recipes: ${error.message}`;
    recipes=[];
    renderPlanner();
  }
}

$("previousWeek").addEventListener("click", () => { activeWeek=addDays(activeWeek,-7); renderPlanner(); });
$("nextWeek").addEventListener("click", () => { activeWeek=addDays(activeWeek,7); renderPlanner(); });
$("thisWeek").addEventListener("click", () => { activeWeek=mondayOf(new Date()); renderPlanner(); });

loadRecipes();
})();
