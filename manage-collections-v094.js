(() => {
"use strict";

const $ = id => document.getElementById(id);
const SETTINGS_KEY = "recipeVaultSettingsV031";
const base = window.RECIPE_VAULT_CONFIG || {};
const settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
const config = {...base, ...settings};
let recipes = [];

window.addEventListener("error", event => {
  const box = $("fatalError");
  if(!box) return;
  box.hidden = false;
  box.textContent = `Website error: ${event.message}`;
});

function escapeHTML(value){
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"
  })[character]);
}

function parseCSV(text){
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for(let index = 0; index < text.length; index++){
    const character = text[index];
    const next = text[index + 1];
    if(character === '"' && quoted && next === '"'){
      field += '"';
      index++;
    }else if(character === '"'){
      quoted = !quoted;
    }else if(character === "," && !quoted){
      row.push(field);
      field = "";
    }else if((character === "\n" || character === "\r") && !quoted){
      if(character === "\r" && next === "\n") index++;
      row.push(field);
      if(row.some(value => value !== "")) rows.push(row);
      row = [];
      field = "";
    }else{
      field += character;
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

function cleanRecipe(recipe){
  return {
    ...recipe,
    collections: String(recipe.collections || "")
      .split("|")
      .map(value => value.trim())
      .filter(Boolean),
    hidden: String(recipe.hidden || "").toLowerCase() === "true"
  };
}

function unique(values){
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function collectionValues(){
  return unique(recipes.flatMap(recipe => recipe.collections || []));
}


function collectionPickerMarkup(selectedValues = [], recipeId = ""){
  const selected = unique(selectedValues || []);
  const available = collectionValues().filter(value => !selected.includes(value));
  return `<div class="multi-collection-picker" data-values="${escapeHTML(selected.join("|"))}" data-recipe-id="${escapeHTML(recipeId)}">
    <div class="collection-add-row">
      <select data-collection-choice><option value="">Add a collection…</option>${available.map(value => `<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`).join("")}<option value="__new__">Add new…</option></select>
      <input data-new-collection type="text" placeholder="New collection" hidden>
      <button class="secondary collection-add-button" type="button" data-add-collection>Add</button>
    </div>
    <div class="collection-chips">${selected.length ? selected.map(value => `<button class="collection-chip" type="button" data-remove-collection="${escapeHTML(value)}">${escapeHTML(value)} ×</button>`).join("") : '<span class="muted collection-empty">No collections selected</span>'}</div>
  </div>`;
}

function pickerValues(picker){
  return unique(String(picker.dataset.values || "").split("|").map(value => value.trim()).filter(Boolean));
}

function refreshPicker(picker, values){
  const wrapper = document.createElement("div");
  wrapper.innerHTML = collectionPickerMarkup(values, picker.dataset.recipeId || "");
  picker.replaceWith(wrapper.firstElementChild);
}

function setStatus(message, type = ""){
  const element = $("collectionStatus");
  element.textContent = message;
  element.className = `import-status ${type}`.trim();
}

function collectionOptions(){
  return [
    '<option value="">Choose collection</option>',
    ...collectionValues().map(value =>
      `<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`
    ),
    '<option value="__new__">Add new…</option>'
  ].join("");
}

function render(){
  const collections = collectionValues();
  const unassigned = recipes
    .filter(recipe => !recipe.hidden && !(recipe.collections || []).length)
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));

  $("collectionCount").textContent = `${collections.length} collection${collections.length === 1 ? "" : "s"}`;
  $("collectionList").innerHTML = collections.length
    ? collections.map(collection => {
        const count = recipes.filter(recipe => (recipe.collections || []).includes(collection)).length;
        return `<div class="collection-summary-card"><strong>${escapeHTML(collection)}</strong><span>${count} recipe${count === 1 ? "" : "s"}</span></div>`;
      }).join("")
    : '<p class="muted empty-message">No collections yet. Create one while sorting a recipe below.</p>';

  $("unassignedCount").textContent = `${unassigned.length} unsorted`;
  $("unassignedGrid").innerHTML = unassigned.length
    ? unassigned.map(recipe => `
      <article class="unassigned-card" data-id="${escapeHTML(recipe.id)}">
        ${recipe.image
          ? `<img class="unassigned-image" src="${escapeHTML(recipe.image)}" alt="${escapeHTML(recipe.name || "Recipe")}">`
          : '<div class="unassigned-image unassigned-image-empty">No image</div>'}
        <div class="unassigned-content">
          <div class="meta">${escapeHTML([recipe.protein, recipe.type].filter(Boolean).join(" • "))}</div>
          <h3>${escapeHTML(recipe.name || "Untitled recipe")}</h3>
          <div class="field compact-field">Collections
            ${collectionPickerMarkup([], recipe.id)}
          </div>
          <div class="unassigned-actions">
            <button class="primary" type="button" data-save-collection>Save collection</button>
            <span class="inline-edit-status" data-card-status></span>
          </div>
        </div>
      </article>
    `).join("")
    : '<div class="all-sorted"><h3>Everything is sorted.</h3><p class="muted">Every visible recipe belongs to a collection.</p></div>';
}

async function postVault(payload){
  if(!config.appsScriptUrl || !config.sharedKey){
    throw new Error("Open Manage on the main vault page and save the Apps Script URL and family key first.");
  }

  const form = new URLSearchParams();
  form.set("payload", JSON.stringify({...payload, key: config.sharedKey}));
  const response = await fetch(config.appsScriptUrl, {
    method: "POST",
    body: form,
    redirect: "follow"
  });
  const result = await response.json();
  if(!result.success) throw new Error(result.error || "Save failed");
  return result;
}

async function loadRecipes(){
  setStatus("Loading recipes…");
  try{
    const url = config.sheetCsvUrl || "recipes.json";
    const response = await fetch(url, {cache: "no-store"});
    if(!response.ok) throw new Error(`HTTP ${response.status}`);
    recipes = config.sheetCsvUrl
      ? parseCSV(await response.text()).map(cleanRecipe)
      : (await response.json()).map(cleanRecipe);
    setStatus("");
    render();
  }catch(error){
    recipes = [];
    setStatus(`Could not load recipes: ${error.message}`, "error");
    render();
  }
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

document.addEventListener("click", async event => {
  const removeButton = event.target.closest("[data-remove-collection]");
  if(removeButton){
    const picker = removeButton.closest(".multi-collection-picker");
    refreshPicker(picker, pickerValues(picker).filter(value => value !== removeButton.dataset.removeCollection));
    return;
  }
  const addButton = event.target.closest("[data-add-collection]");
  if(addButton){
    const picker = addButton.closest(".multi-collection-picker");
    const select = picker.querySelector("[data-collection-choice]");
    const input = picker.querySelector("[data-new-collection]");
    const value = select.value === "__new__" ? input.value.trim() : select.value.trim();
    if(value) refreshPicker(picker, [...pickerValues(picker), value]);
    return;
  }

  const button = event.target.closest("[data-save-collection]");
  if(!button) return;

  const card = button.closest(".unassigned-card");
  const recipe = recipes.find(item => item.id === card.dataset.id);
  if(!recipe) return;

  const picker = card.querySelector(".multi-collection-picker");
  const status = card.querySelector("[data-card-status]");
  const collections = pickerValues(picker);

  if(!collections.length){
    status.textContent = "Choose or add at least one collection.";
    status.className = "inline-edit-status error";
    return;
  }

  button.disabled = true;
  status.textContent = "Saving…";
  status.className = "inline-edit-status";

  try{
    await postVault({
      action: "update",
      id: recipe.id,
      url: recipe.url,
      updates: {collections: collections.join("|")}
    });
    recipe.collections = collections;
    setStatus(`${recipe.name || "Recipe"} added to ${collections.join(", ")}.`, "success");
    render();
  }catch(error){
    button.disabled = false;
    status.textContent = `Could not save: ${error.message}`;
    status.className = "inline-edit-status error";
  }
});

loadRecipes();
})();
