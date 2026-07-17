(() => {
"use strict";

const $ = id => document.getElementById(id);
const SETTINGS_KEY = "recipeVaultSettingsV031";
const COLLECTION_OVERRIDE_KEY = "recipeVaultCollectionOverridesV098";
const COLLECTION_OVERRIDE_TTL_MS = 15 * 60 * 1000;
const COMPLETENESS_DISMISS_KEY = "recipeVaultCompletenessDismissalsV130";
const base = window.RECIPE_VAULT_CONFIG || {};
let settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
let config = {...base, ...settings};
let recipes = [];
let activeIssue = "all";

const INSTRUCTION_INGREDIENT_RULES = [
  {key:"garlic", label:"garlic", aliases:["garlic","garlic clove","garlic cloves"]},
  {key:"onion", label:"onion", aliases:["onion","onions"]},
  {key:"butter", label:"butter", aliases:["butter"]},
  {key:"olive-oil", label:"olive oil", aliases:["olive oil","extra virgin olive oil","evoo"]},
  {key:"salt", label:"salt", aliases:["salt"]},
  {key:"pepper", label:"black pepper", aliases:["black pepper","pepper"]},
  {key:"broth", label:"broth", aliases:["chicken broth","beef broth","vegetable broth","stock"]},
  {key:"milk", label:"milk", aliases:["milk"]},
  {key:"cream", label:"cream", aliases:["heavy cream","cream"]},
  {key:"cheese", label:"cheese", aliases:["cheese","cheddar","mozzarella","parmesan"]},
  {key:"rice", label:"rice", aliases:["rice"]},
  {key:"pasta", label:"pasta", aliases:["pasta","spaghetti","penne","noodles"]},
  {key:"cilantro", label:"cilantro", aliases:["cilantro"]},
  {key:"lime", label:"lime", aliases:["lime","lime juice"]},
  {key:"lemon", label:"lemon", aliases:["lemon","lemon juice"]}
];

const EXPECTED_COMPONENT_RULES = [
  {
    key:"taco-tortillas",
    matches:recipe => /\btacos?\b/i.test(`${recipe.name || ""} ${recipe.type || ""}`),
    present:ingredientText => /\b(tortillas?|taco shells?|hard shells?|soft shells?)\b/i.test(ingredientText),
    ingredient:"8 tortillas",
    label:"tortillas or taco shells",
    reason:"This looks like a taco recipe, but no tortillas or taco shells were found in the ingredient list."
  },
  {
    key:"burger-buns",
    matches:recipe => /\b(burgers?|hamburgers?|sliders?)\b/i.test(`${recipe.name || ""} ${recipe.type || ""}`),
    present:ingredientText => /\b(buns?|rolls?|bread)\b/i.test(ingredientText),
    ingredient:"4 burger buns",
    label:"burger buns",
    reason:"This looks like a burger recipe, but no buns were found in the ingredient list."
  },
  {
    key:"sandwich-bread",
    matches:recipe => /\b(sandwich|sandwiches|grilled cheese)\b/i.test(`${recipe.name || ""} ${recipe.type || ""}`),
    present:ingredientText => /\b(bread|rolls?|buns?|croissants?|pitas?)\b/i.test(ingredientText),
    ingredient:"8 slices bread",
    label:"bread",
    reason:"This looks like a sandwich recipe, but no bread or rolls were found in the ingredient list."
  },
  {
    key:"quesadilla-tortillas",
    matches:recipe => /\bquesadillas?\b/i.test(`${recipe.name || ""} ${recipe.type || ""}`),
    present:ingredientText => /\btortillas?\b/i.test(ingredientText),
    ingredient:"8 tortillas",
    label:"tortillas",
    reason:"This looks like a quesadilla recipe, but no tortillas were found in the ingredient list."
  }
];

const ISSUE_DEFS = [
  {key:"completeness", label:"Possible missing ingredients", test:r => completenessSuggestions(r).length > 0},
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

function normalizedText(value){
  return String(value || "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readCompletenessDismissals(){
  try{
    const parsed = JSON.parse(localStorage.getItem(COMPLETENESS_DISMISS_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  }catch(error){ return {}; }
}

function dismissalId(recipe, suggestionKey){
  return `${String(recipe.id || recipe.url || recipe.name || "recipe")}::${suggestionKey}`;
}

function isSuggestionDismissed(recipe, suggestionKey){
  return Boolean(readCompletenessDismissals()[dismissalId(recipe, suggestionKey)]);
}

function dismissSuggestion(recipe, suggestionKey){
  const dismissed = readCompletenessDismissals();
  dismissed[dismissalId(recipe, suggestionKey)] = Date.now();
  localStorage.setItem(COMPLETENESS_DISMISS_KEY, JSON.stringify(dismissed));
}

function ingredientContains(ingredientText, aliases){
  return aliases.some(alias => {
    const normalized = normalizedText(alias);
    return new RegExp(`\\b${normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}\\b`, "i").test(ingredientText);
  });
}

function completenessSuggestions(recipe){
  if(!(recipe.ingredients || []).length) return [];
  const ingredientText = normalizedText((recipe.ingredients || []).join(" "));
  const instructionText = normalizedText((recipe.instructions || []).join(" "));
  const suggestions = [];

  EXPECTED_COMPONENT_RULES.forEach(rule => {
    if(rule.matches(recipe) && !rule.present(ingredientText) && !isSuggestionDismissed(recipe, rule.key)){
      suggestions.push({
        key:rule.key,
        ingredient:rule.ingredient,
        label:rule.label,
        reason:rule.reason,
        kind:"expected"
      });
    }
  });

  if(instructionText){
    INSTRUCTION_INGREDIENT_RULES.forEach(rule => {
      const appearsInInstructions = ingredientContains(instructionText, rule.aliases);
      const appearsInIngredients = ingredientContains(ingredientText, rule.aliases);
      if(appearsInInstructions && !appearsInIngredients){
        const key = `instruction-${rule.key}`;
        if(!isSuggestionDismissed(recipe, key)){
          suggestions.push({
            key,
            ingredient:rule.label,
            label:rule.label,
            reason:`The instructions mention ${rule.label}, but it was not found in the ingredient list.`,
            kind:"instruction"
          });
        }
      }
    });
  }

  return suggestions;
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

function completenessMarkup(recipe){
  const suggestions = completenessSuggestions(recipe);
  if(!suggestions.length) return "";
  return `
    <section class="health-completeness-panel" aria-label="Possible missing ingredients">
      <div class="health-completeness-heading">
        <strong>Possible missing ingredients</strong>
        <span>${suggestions.length} suggestion${suggestions.length === 1 ? "" : "s"}</span>
      </div>
      <div class="health-suggestion-list">
        ${suggestions.map(suggestion => `
          <div class="health-suggestion" data-suggestion-key="${escapeHTML(suggestion.key)}">
            <p>${escapeHTML(suggestion.reason)}</p>
            <label>
              Suggested ingredient
              <input type="text" value="${escapeHTML(suggestion.ingredient)}" data-suggestion-ingredient>
            </label>
            <div class="health-suggestion-actions">
              <button type="button" class="primary compact" data-add-suggestion>Add to recipe</button>
              <button type="button" class="secondary compact" data-dismiss-suggestion>Dismiss</button>
            </div>
          </div>
        `).join("")}
      </div>
    </section>
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
        ${completenessMarkup(recipe)}
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
  if(!config.appsScriptUrl || !config.sharedKey) throw new Error("Open Settings on the main vault and save the Apps Script URL and family key first.");
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

function collectUpdates(form){
  const picker = form.querySelector("[data-health-collection-picker]");
  const collections = [...picker.querySelectorAll("[data-health-remove-collection]")].map(chip => chip.dataset.healthRemoveCollection);
  const lines = name => form.elements[name].value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
  return {
    collections,
    updates:{
      protein:form.elements.protein.value.trim(),
      type:form.elements.type.value.trim(),
      total_time:form.elements.total_time.value.trim(),
      image:form.elements.image.value.trim(),
      collections:collections.join("|"),
      ingredients:lines("ingredients"),
      instructions:lines("instructions"),
      nutrition:form.elements.nutrition.value.trim()
    }
  };
}

async function saveHealthForm(form, recipe, successMessage="Saved."){
  const status = form.querySelector("[data-health-save-status]");
  const {collections, updates} = collectUpdates(form);
  status.textContent = "Saving…";
  status.className = "import-status";
  try{
    await postVault({action:"update", id:recipe.id, url:recipe.url, updates});
    Object.assign(recipe, updates, {
      collections,
      total_time:Number(updates.total_time) || 0,
      ingredients:updates.ingredients,
      instructions:updates.instructions
    });
    rememberCollectionOverride(recipe.id, collections);
    status.textContent = successMessage;
    status.className = "import-status success";
    setTimeout(render, 650);
    return true;
  }catch(error){
    status.textContent = `Could not save: ${error.message}`;
    status.className = "import-status error";
    return false;
  }
}

document.addEventListener("click", async event => {
  const issueButton = event.target.closest("[data-health-issue]");
  if(issueButton){ activeIssue = issueButton.dataset.healthIssue; render(); return; }

  const suggestionRow = event.target.closest("[data-suggestion-key]");
  if(suggestionRow){
    const card = suggestionRow.closest("[data-health-id]");
    const form = suggestionRow.closest(".health-edit-form");
    const recipe = recipes.find(item => String(item.id) === card.dataset.healthId);
    const suggestionKey = suggestionRow.dataset.suggestionKey;

    if(event.target.closest("[data-dismiss-suggestion]")){
      dismissSuggestion(recipe, suggestionKey);
      render();
      return;
    }

    if(event.target.closest("[data-add-suggestion]")){
      const input = suggestionRow.querySelector("[data-suggestion-ingredient]");
      const ingredient = input.value.trim();
      if(!ingredient){
        input.focus();
        return;
      }
      const textarea = form.elements.ingredients;
      const existing = textarea.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
      if(!existing.some(value => normalizedText(value) === normalizedText(ingredient))){
        existing.push(ingredient);
        textarea.value = existing.join("\n");
      }
      const button = event.target.closest("[data-add-suggestion]");
      button.disabled = true;
      const saved = await saveHealthForm(form, recipe, `Added “${ingredient}” and saved.`);
      if(!saved) button.disabled = false;
      return;
    }
  }

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
  await saveHealthForm(form, recipe);
});

loadRecipes();
})();