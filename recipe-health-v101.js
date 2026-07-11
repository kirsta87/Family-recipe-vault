(() => {
"use strict";

const $ = id => document.getElementById(id);
const SETTINGS_KEY = "recipeVaultSettingsV031";
const COLLECTION_OVERRIDE_KEY = "recipeVaultCollectionOverridesV098";
const COLLECTION_OVERRIDE_TTL_MS = 15 * 60 * 1000;
const base = window.RECIPE_VAULT_CONFIG || {};
let settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
let config = {...base, ...settings};
let recipes = [];
let activeIssue = "all";

const ISSUE_DEFS = [
  {key:"protein", label:"Missing protein", test:r => !String(r.protein || "").trim()},
  {key:"type", label:"Missing meal type", test:r => !String(r.type || "").trim()},
  {key:"collections", label:"Missing collection", test:r => !(r.collections || []).length},
  {key:"image", label:"Missing image", test:r => !String(r.image || "").trim()},
  {key:"time", label:"Missing cooking time", test:r => Number(r.total_time || 0) <= 0},
  {key:"ingredients", label:"Missing ingredients", test:r => !(r.ingredients || []).length},
  {key:"instructions", label:"Missing instructions", test:r => !(r.instructions || []).length},
  {key:"nutrition", label:"Missing nutrition", test:r => !String(r.nutrition || "").trim()}
];

window.addEventListener("error", event => {
  const box = $("fatalError");
  box.hidden = false;
  box.textContent = `Website error: ${event.message}`;
});

function escapeHTML(value){
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"
  })[c]);
}

function parseCSV(text){
  const rows = [];
  let row = [], field = "", quoted = false;
  for(let i = 0; i < text.length; i++){
    const c = text[i], n = text[i + 1];
    if(c === '"' && quoted && n === '"'){ field += '"'; i++; }
    else if(c === '"') quoted = !quoted;
    else if(c === "," && !quoted){ row.push(field); field = ""; }
    else if((c === "\n" || c === "\r") && !quoted){
      if(c === "\r" && n === "\n") i++;
      row.push(field);
      if(row.some(value => value !== "")) rows.push(row);
      row = []; field = "";
    }else field += c;
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

function parseStoredList(value){
  const text = String(value || "").trim();
  if(!text) return [];
  try{
    const parsed = JSON.parse(text);
    if(Array.isArray(parsed)) return parsed.map(String);
  }catch(error){}
  return text.split(/\r?\n|\|/).map(item => item.trim()).filter(Boolean);
}

function readCollectionOverrides(){
  try{
    const stored = JSON.parse(localStorage.getItem(COLLECTION_OVERRIDE_KEY) || "{}");
    const now = Date.now();
    const current = {};
    Object.entries(stored).forEach(([id, entry]) => {
      if(entry && now - Number(entry.savedAt || 0) < COLLECTION_OVERRIDE_TTL_MS) current[id] = entry;
    });
    localStorage.setItem(COLLECTION_OVERRIDE_KEY, JSON.stringify(current));
    return current;
  }catch(error){ return {}; }
}

function rememberCollectionOverride(recipeId, collections){
  if(!recipeId) return;
  const overrides = readCollectionOverrides();
  overrides[String(recipeId)] = {collections:[...new Set(collections.filter(Boolean))], savedAt:Date.now()};
  localStorage.setItem(COLLECTION_OVERRIDE_KEY, JSON.stringify(overrides));
}

function clean(r){
  return {
    ...r,
    collections:String(r.collections || "").split("|").map(x => x.trim()).filter(Boolean),
    total_time:Number(r.total_time) || 0,
    ingredients:parseStoredList(r.ingredients),
    instructions:parseStoredList(r.instructions),
    nutrition:String(r.nutrition || "")
  };
}

function applyCollectionOverrides(items){
  const overrides = readCollectionOverrides();
  items.forEach(recipe => {
    const entry = overrides[String(recipe.id || "")];
    if(entry) recipe.collections = [...new Set(entry.collections || [])];
  });
  return items;
}

function freshDataUrl(url){
  try{
    const fresh = new URL(url);
    fresh.searchParams.set("rv", String(Date.now()));
    return fresh.toString();
  }catch(error){ return `${url}${url.includes("?") ? "&" : "?"}rv=${Date.now()}`; }
}

function issueKeys(recipe){
  return ISSUE_DEFS.filter(issue => issue.test(recipe)).map(issue => issue.key);
}

function unique(values){
  return [...new Set(values.filter(Boolean))].sort((a,b) => a.localeCompare(b));
}

function allCollections(){
  return unique(recipes.flatMap(recipe => recipe.collections || []));
}

function renderSummary(){
  const complete = recipes.filter(recipe => issueKeys(recipe).length === 0).length;
  $("healthComplete").textContent = `${complete} of ${recipes.length} complete`;

  const buttons = [
    {key:"all", label:"All incomplete", count:recipes.filter(r => issueKeys(r).length).length},
    ...ISSUE_DEFS.map(issue => ({
      key:issue.key,
      label:issue.label,
      count:recipes.filter(issue.test).length
    }))
  ];

  $("healthIssueButtons").innerHTML = buttons.map(item => `
    <button type="button" class="health-issue-button ${activeIssue === item.key ? "active" : ""}" data-health-issue="${item.key}">
      <span>${escapeHTML(item.label)}</span>
      <strong>${item.count}</strong>
    </button>
  `).join("");
}

function collectionPickerMarkup(recipe){
  const selected = recipe.collections || [];
  const options = allCollections().filter(value => !selected.includes(value));
  return `
    <div class="health-collection-picker" data-health-collection-picker>
      <div class="health-collection-row">
        <select data-health-collection-select>
          <option value="">Add collection…</option>
          ${options.map(value => `<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`).join("")}
          <option value="__new__">Add new…</option>
        </select>
        <button type="button" class="secondary compact" data-health-add-collection>Add</button>
      </div>
      <input type="text" data-health-new-collection placeholder="New collection name" hidden>
      <div class="collection-chip-list" data-health-collection-chips>
        ${selected.length ? selected.map(value => `<button type="button" class="collection-chip" data-health-remove-collection="${escapeHTML(value)}">${escapeHTML(value)} ×</button>`).join("") : '<span class="muted collection-empty">No collections selected</span>'}
      </div>
    </div>
  `;
}

function healthCard(recipe){
  const issues = issueKeys(recipe);
  return `
    <article class="health-card" data-health-id="${escapeHTML(recipe.id)}">
      <div class="health-card-head">
        ${recipe.image ? `<img src="${escapeHTML(recipe.image)}" alt="">` : '<div class="health-image-placeholder">No image</div>'}
        <div>
          <h3>${escapeHTML(recipe.name || "Untitled recipe")}</h3>
          <div class="health-badges">${issues.map(key => `<span>${escapeHTML(ISSUE_DEFS.find(x => x.key === key).label)}</span>`).join("")}</div>
        </div>
      </div>
      <form class="health-edit-form">
        <div class="health-form-grid">
          <label class="field">Protein<input name="protein" value="${escapeHTML(recipe.protein || "")}" placeholder="Chicken"></label>
          <label class="field">Meal type<input name="type" value="${escapeHTML(recipe.type || "")}" placeholder="Pasta"></label>
          <label class="field">Total minutes<input name="total_time" type="number" min="0" value="${recipe.total_time || ""}"></label>
          <label class="field health-image-field">Image URL<input name="image" type="url" value="${escapeHTML(recipe.image || "")}" placeholder="https://..."></label>
        </div>
        <label class="field">Collections${collectionPickerMarkup(recipe)}</label>
        <label class="field">Ingredients — one per line<textarea name="ingredients" rows="5">${escapeHTML((recipe.ingredients || []).join("\n"))}</textarea></label>
        <label class="field">Instructions — one step per line<textarea name="instructions" rows="5">${escapeHTML((recipe.instructions || []).join("\n"))}</textarea></label>
        <label class="field">Nutrition<textarea name="nutrition" rows="3">${escapeHTML(recipe.nutrition || "")}</textarea></label>
        <div class="health-card-actions">
          <button class="primary" type="submit">Save fixes</button>
          <span class="import-status" data-health-save-status aria-live="polite"></span>
        </div>
      </form>
    </article>
  `;
}

function renderResults(){
  const issue = ISSUE_DEFS.find(item => item.key === activeIssue);
  const visible = recipes.filter(recipe => {
    const keys = issueKeys(recipe);
    return activeIssue === "all" ? keys.length > 0 : keys.includes(activeIssue);
  });

  $("healthResultsTitle").textContent = issue ? issue.label : "All incomplete recipes";
  $("healthResultsCount").textContent = `${visible.length} recipe${visible.length === 1 ? "" : "s"}`;
  $("healthGrid").innerHTML = visible.length
    ? visible.map(healthCard).join("")
    : '<div class="health-clear-state"><h3>Nothing to fix here 🎉</h3><p>This category is complete.</p></div>';
}

function render(){ renderSummary(); renderResults(); }

async function postVault(payload){
  if(!config.appsScriptUrl || !config.sharedKey) throw new Error("Open Manage on the main vault and save the Apps Script URL and family key first.");
  const form = new URLSearchParams();
  form.set("payload", JSON.stringify({...payload, key:config.sharedKey}));
  const response = await fetch(config.appsScriptUrl, {method:"POST", body:form, redirect:"follow"});
  const result = await response.json();
  if(!result.success) throw new Error(result.error || "Save failed");
  return result;
}

async function loadRecipes(){
  $("healthStatus").textContent = "Loading recipes…";
  try{
    const response = await fetch(freshDataUrl(config.sheetCsvUrl), {cache:"no-store"});
    if(!response.ok) throw new Error(`HTTP ${response.status}`);
    recipes = applyCollectionOverrides(parseCSV(await response.text()).map(clean));
    $("healthStatus").textContent = "";
    render();
  }catch(error){
    $("healthStatus").textContent = `Could not load recipes: ${error.message}`;
    $("healthStatus").className = "import-status error";
  }
}

document.addEventListener("click", event => {
  const issueButton = event.target.closest("[data-health-issue]");
  if(issueButton){ activeIssue = issueButton.dataset.healthIssue; render(); return; }

  const picker = event.target.closest("[data-health-collection-picker]");
  if(!picker) return;
  const select = picker.querySelector("[data-health-collection-select]");
  const newInput = picker.querySelector("[data-health-new-collection]");

  if(event.target.closest("[data-health-add-collection]")){
    let value = select.value;
    if(value === "__new__"){
      newInput.hidden = false;
      newInput.focus();
      value = newInput.value.trim();
      if(!value) return;
    }
    if(!value) return;
    const chips = picker.querySelector("[data-health-collection-chips]");
    chips.querySelector(".collection-empty")?.remove();
    if(![...chips.querySelectorAll("[data-health-remove-collection]")].some(chip => chip.dataset.healthRemoveCollection === value)){
      chips.insertAdjacentHTML("beforeend", `<button type="button" class="collection-chip" data-health-remove-collection="${escapeHTML(value)}">${escapeHTML(value)} ×</button>`);
    }
    select.value = "";
    newInput.value = "";
    newInput.hidden = true;
  }

  const remove = event.target.closest("[data-health-remove-collection]");
  if(remove){
    remove.remove();
    const chips = picker.querySelector("[data-health-collection-chips]");
    if(!chips.querySelector("[data-health-remove-collection]")) chips.innerHTML = '<span class="muted collection-empty">No collections selected</span>';
  }
});

document.addEventListener("change", event => {
  const select = event.target.closest("[data-health-collection-select]");
  if(!select) return;
  const picker = select.closest("[data-health-collection-picker]");
  const input = picker.querySelector("[data-health-new-collection]");
  input.hidden = select.value !== "__new__";
  if(!input.hidden) input.focus();
});

document.addEventListener("submit", async event => {
  const form = event.target.closest(".health-edit-form");
  if(!form) return;
  event.preventDefault();
  const card = form.closest("[data-health-id]");
  const recipe = recipes.find(item => String(item.id) === card.dataset.healthId);
  const status = form.querySelector("[data-health-save-status]");
  const picker = form.querySelector("[data-health-collection-picker]");
  const collections = [...picker.querySelectorAll("[data-health-remove-collection]")].map(chip => chip.dataset.healthRemoveCollection);
  const lines = name => form.elements[name].value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
  const updates = {
    protein:form.elements.protein.value.trim(),
    type:form.elements.type.value.trim(),
    total_time:form.elements.total_time.value.trim(),
    image:form.elements.image.value.trim(),
    collections:collections.join("|"),
    ingredients:lines("ingredients"),
    instructions:lines("instructions"),
    nutrition:form.elements.nutrition.value.trim()
  };
  status.textContent = "Saving…";
  status.className = "import-status";
  try{
    await postVault({action:"update", id:recipe.id, url:recipe.url, updates});
    Object.assign(recipe, updates, {collections, total_time:Number(updates.total_time) || 0, ingredients:updates.ingredients, instructions:updates.instructions});
    rememberCollectionOverride(recipe.id, collections);
    status.textContent = "Saved.";
    status.className = "import-status success";
    setTimeout(render, 450);
  }catch(error){
    status.textContent = `Could not save: ${error.message}`;
    status.className = "import-status error";
  }
});

loadRecipes();
})();
