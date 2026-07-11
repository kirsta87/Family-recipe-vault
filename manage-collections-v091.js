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
          <label class="field compact-field">Collection
            <select data-collection-select>${collectionOptions()}</select>
            <input data-new-collection class="new-category-input" type="text" placeholder="New collection" hidden>
          </label>
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
  const select = event.target.closest("[data-collection-select]");
  if(!select) return;
  const card = select.closest(".unassigned-card");
  const input = card.querySelector("[data-new-collection]");
  const show = select.value === "__new__";
  input.hidden = !show;
  if(show) input.focus();
  if(!show) input.value = "";
});

document.addEventListener("click", async event => {
  const button = event.target.closest("[data-save-collection]");
  if(!button) return;

  const card = button.closest(".unassigned-card");
  const recipe = recipes.find(item => item.id === card.dataset.id);
  if(!recipe) return;

  const select = card.querySelector("[data-collection-select]");
  const newInput = card.querySelector("[data-new-collection]");
  const status = card.querySelector("[data-card-status]");
  const collection = select.value === "__new__"
    ? newInput.value.trim()
    : select.value.trim();

  if(!collection){
    status.textContent = "Choose or add a collection.";
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
      updates: {collections: collection}
    });
    recipe.collections = [collection];
    setStatus(`${recipe.name || "Recipe"} added to ${collection}.`, "success");
    render();
  }catch(error){
    button.disabled = false;
    status.textContent = `Could not save: ${error.message}`;
    status.className = "inline-edit-status error";
  }
});

loadRecipes();
})();
