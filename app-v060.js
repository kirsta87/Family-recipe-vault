(() => {
"use strict";

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
const PLANNER_KEY = "recipeVaultPlannerV031";
const base = window.RECIPE_VAULT_CONFIG || {};
let settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
let config = {...base, ...settings};
let recipes = [];
let active = null;
let planner = JSON.parse(localStorage.getItem(PLANNER_KEY) || "{}");

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
    last_made: String(r.last_made || "")
  };
}

async function loadRecipes(){
  $("status").textContent = "Loading…";
  try{
    const url = config.sheetCsvUrl || "recipes.json";
    const response = await fetch(url, {cache: "no-store"});
    if(!response.ok) throw new Error(`HTTP ${response.status}`);

    if(config.sheetCsvUrl){
      recipes = parseCSV(await response.text()).map(clean);
      $("status").textContent = "• synced from family sheet";
    } else {
      recipes = (await response.json()).map(clean);
      $("status").textContent = "• starter mode";
    }
  } catch(error){
    recipes = [];
    $("status").textContent = `• load failed: ${error.message}`;
  }

  renderFilters();
  render();
}

function unique(values){
  return [...new Set(values.filter(Boolean))].sort((a,b) => a.localeCompare(b));
}

function renderFilters(){
  const make = (target, field) => {
    $(target).innerHTML = unique(recipes.map(recipe => recipe[field])).map(value =>
      `<label class="check"><input type="checkbox" data-filter="${field}" value="${escapeHTML(value)}"> ${escapeHTML(value)}</label>`
    ).join("");
  };

  make("proteinFilters", "protein");
  make("typeFilters", "type");
  document.querySelectorAll("[data-filter]").forEach(input => input.addEventListener("change", render));
}

function checked(field){
  return [...document.querySelectorAll(`[data-filter="${field}"]:checked`)].map(input => input.value);
}

function escapeHTML(value){
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"
  })[c]);
}

function render(){
  const query = $("searchInput").value.trim().toLowerCase();
  const proteins = checked("protein");
  const types = checked("type");
  const hiddenOnly = $("showHidden").checked;

  const visible = recipes.filter(recipe => {
    const haystack = [
      recipe.name, recipe.protein, recipe.type, recipe.cuisine, recipe.source,
      recipe.tags.join(" "), recipe.notes, recipe.torrin_notes, recipe.ingredients.join(" "), recipe.instructions.join(" ")
    ].join(" ").toLowerCase();

    return (!query || haystack.includes(query))
      && (!proteins.length || proteins.includes(recipe.protein))
      && (!types.length || types.includes(recipe.type))
      && (!$("kirstaFav").checked || recipe.kirsta_rating >= 4)
      && (!$("tjFav").checked || recipe.tj_rating >= 4)
      && (!$("torrinFav").checked || recipe.torrin_rating >= 4)
      && (!$("quickOnly").checked || (recipe.total_time > 0 && recipe.total_time <= 30))
      && (hiddenOnly ? recipe.hidden : !recipe.hidden);
  }).sort((a,b) => String(a.name).localeCompare(String(b.name)));

  $("count").textContent = `${visible.length} recipe${visible.length === 1 ? "" : "s"}`;
  $("grid").innerHTML = visible.map(recipe => `
    <article class="card">
      ${recipe.image ? `<img class="recipe-card-image" src="${escapeHTML(recipe.image)}" alt="${escapeHTML(recipe.name || "Recipe")}">` : ""}
      <div class="meta">${escapeHTML([recipe.protein, recipe.type, recipe.source].filter(Boolean).join(" • "))}</div>
      <h2>${escapeHTML(recipe.name || "Untitled recipe")}</h2>
      <p>${escapeHTML(recipe.notes || "")}</p>
      <button class="primary" data-id="${escapeHTML(recipe.id)}">View recipe</button>
    </article>
  `).join("");

  document.querySelectorAll("[data-id]").forEach(button => {
    button.addEventListener("click", () => openRecipe(recipes.find(recipe => recipe.id === button.dataset.id)));
  });
}

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
    ? recipe.instructions.map(item => `<li>${escapeHTML(item)}</li>`).join("")
    : "<li>Cooking steps have not been imported for this recipe yet.</li>";

  $("nutritionText").textContent = recipe.nutrition || "Nutrition details have not been imported.";
  $("hideBtn").textContent = recipe.hidden ? "Restore recipe" : "Hide recipe";
  $("sourceLink").href = recipe.url || "#";
  $("pdfLink").href = recipe.pdf_url || pdfURL(recipe);
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

function switchAddTab(tabName){
  document.querySelectorAll(".add-tab").forEach(button => {
    button.classList.toggle("active", button.dataset.addTab === tabName);
  });

  ["url","bulk","manual"].forEach(name => {
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
  const rawUrl = $("importUrl").value.trim();

  setImportStatus("urlImportStatus", "Importing recipe…");

  try{
    const result = await postVault({
      action: "importUrl",
      url: rawUrl
    });

    if(!result) return;

    $("importUrl").value = "";
    setImportStatus(
      "urlImportStatus",
      `${result.action === "refreshed" ? "Refreshed" : "Imported"} ${result.recipe?.name || "recipe"}.`,
      "success"
    );
    await loadRecipes();
  }catch(error){
    setImportStatus("urlImportStatus", `Could not import: ${error.message}`, "error");
  }
});

on("bulkImportForm", "submit", async event => {
  event.preventDefault();

  const urls = $("bulkUrls").value
    .split(/\r?\n/)
    .map(value => value.trim())
    .filter(Boolean);

  if(!urls.length){
    setImportStatus("bulkProgress", "Paste at least one HelloFresh URL.", "error");
    return;
  }

  $("bulkResults").innerHTML = "";
  setImportStatus("bulkProgress", `Importing 0 of ${urls.length}…`);

  let successful = 0;

  for(let index = 0; index < urls.length; index++){
    const url = urls[index];
    let item;

    try{
      const result = await postVault({
        action: "importHelloFresh",
        url
      });

      if(!result) return;

      successful++;
      item = document.createElement("div");
      item.className = "bulk-result success";
      item.textContent = `✓ ${result.action === "refreshed" ? "Refreshed" : "Imported"}: ${result.recipe?.name || url}`;
    }catch(error){
      item = document.createElement("div");
      item.className = "bulk-result error";
      item.textContent = `✕ ${url} — ${error.message}`;
    }

    $("bulkResults").appendChild(item);
    setImportStatus("bulkProgress", `Importing ${index + 1} of ${urls.length}…`);
  }

  setImportStatus(
    "bulkProgress",
    `Finished: ${successful} of ${urls.length} imported or refreshed.`,
    successful === urls.length ? "success" : ""
  );

  await loadRecipes();
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
    protein: $("manualProtein").value.trim(),
    type: $("manualType").value.trim(),
    cuisine: $("manualCuisine").value.trim(),
    tags: $("manualTags").value
      .split(/[|,]/)
      .map(value => value.trim())
      .filter(Boolean)
      .join("|"),
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

    $("manualRecipeForm").reset();
    $("manualSource").value = "Family Recipe";
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
  $("editProtein").value = recipe.protein || "";
  $("editType").value = recipe.type || "";
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
    protein: $("editProtein").value.trim(),
    type: $("editType").value.trim(),
    cuisine: $("editCuisine").value.trim(),
    prep_time: $("editPrep").value.trim(),
    cook_time: $("editCook").value.trim(),
    total_time: $("editTotal").value.trim(),
    tags: $("editTags").value
      .split(/[|,]/)
      .map(value => value.trim())
      .filter(Boolean)
      .join("|"),
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

on("closeRecipe", "click", () => {
  $("recipeDialog").close();
});
on("saveNotes", "click", () => write("update", active, {notes: $("notes").value.trim()}));
on("madeBtn", "click", () => write("update", active, {
  made_count: Number(active.made_count || 0) + 1,
  last_made: new Date().toISOString().slice(0,10)
}));
on("hideBtn", "click", async () => {
  const ok = await write("update", active, {hidden: !active.hidden});
  if(ok) $("recipeDialog").close();
});

const days = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
on("plannerBtn", "click", () => {
  $("plannerDays").innerHTML = days.map(day => `
    <div class="planner-day"><strong>${day}</strong><div>${(planner[day] || []).map(item => escapeHTML(item.name)).join("<br>") || "Nothing planned."}</div></div>
  `).join("");
  $("plannerDialog").showModal();
});
on("closePlanner", "click", () => $("plannerDialog").close());

on("searchInput", "input", render);
["kirstaFav","tjFav","torrinFav","quickOnly","showHidden"].forEach(id => on(id, "change", render));
on("clearBtn", "click", () => {
  $("searchInput").value = "";
  document.querySelectorAll('input[type="checkbox"]').forEach(input => input.checked = false);
  render();
});

loadRecipes();
})();
