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
let linkedRecipeOpened = false;

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
    collections: String(r.collections || "").split("|").map(x => x.trim()).filter(Boolean),
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

const DEFAULT_PROTEINS = [
  "Chicken",
  "Beef",
  "Pork",
  "Turkey",
  "Seafood",
  "Vegetarian",
  "Other"
];

const DEFAULT_MEAL_TYPES = [
  "Breakfast",
  "Burgers",
  "Bowls",
  "Casserole",
  "Dessert",
  "Flatbread",
  "Pasta",
  "Pizza",
  "Salad",
  "Sandwiches",
  "Soup",
  "Tacos",
  "Other"
];

function categoryValues(field, defaults){
  return unique([
    ...defaults,
    ...recipes.map(recipe => recipe[field])
  ]);
}

function fillCategorySelect(id, values, selectedValue = ""){
  const select = $(id);
  if(!select) return;

  const cleanValues = unique(values.filter(value => value && value !== "__new__"));

  select.innerHTML = [
    '<option value="">Select one</option>',
    ...cleanValues.map(value =>
      `<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`
    ),
    '<option value="__new__">Add new…</option>'
  ].join("");

  if(selectedValue && cleanValues.includes(selectedValue)){
    select.value = selectedValue;
  }else if(selectedValue){
    select.value = "__new__";
  }else{
    select.value = "";
  }
}

function setupNewCategory(selectId, inputId){
  const select = $(selectId);
  const input = $(inputId);
  if(!select || !input) return;

  const updateVisibility = () => {
    const show = select.value === "__new__";
    input.hidden = !show;
    if(show) input.focus();
    if(!show) input.value = "";
  };

  select.addEventListener("change", updateVisibility);
  updateVisibility();
}

function selectedCategory(selectId, inputId){
  const select = $(selectId);
  const input = $(inputId);

  if(!select) return "";

  if(select.value === "__new__"){
    return String(input?.value || "").trim();
  }

  return select.value;
}

function refreshEntryCategoryMenus(){
  const proteins = categoryValues("protein", DEFAULT_PROTEINS);
  const mealTypes = categoryValues("type", DEFAULT_MEAL_TYPES);

  fillCategorySelect("manualProtein", proteins);
  fillCategorySelect("manualType", mealTypes);
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
  refreshEntryCategoryMenus();
  render();
  openLinkedRecipe();
}

function unique(values){
  return [...new Set(values.filter(Boolean))].sort((a,b) => a.localeCompare(b));
}

function renderFilters(){
  populateSelect("proteinSelect", unique(recipes.map(r => r.protein)));
  populateSelect("typeSelect", unique(recipes.map(r => r.type)));
  populateSelect("cuisineSelect", unique(recipes.map(r => r.cuisine)));
  populateSelect("collectionSelect", unique(recipes.flatMap(r => r.collections || [])));
}

function populateSelect(id, values){
  const select = $(id);
  if(!select) return;

  const current = select.value;
  const first = select.options[0].outerHTML;

  select.innerHTML =
    first +
    values.map(value =>
      `<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`
    ).join("");

  if(values.includes(current)){
    select.value = current;
  }
}

function escapeHTML(value){
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"
  })[c]);
}

function searchScore(recipe, query){
  if(!query) return {score:0, reason:""};

  const needle = query.toLowerCase();
  const buckets = [
    {weight:100, label:"ingredient match", values:recipe.ingredients || []},
    {weight:80, label:"title match", values:[recipe.name]},
    {weight:60, label:"category match", values:[recipe.protein, recipe.type, recipe.cuisine, ...(recipe.tags || []), ...(recipe.collections || [])]},
    {weight:35, label:"family note match", values:[recipe.notes, recipe.torrin_notes]},
    {weight:15, label:"instruction match", values:recipe.instructions || []}
  ];

  let bestScore = 0;
  let bestReason = "";

  buckets.forEach(bucket => {
    const combined = bucket.values.filter(Boolean).join(" ").toLowerCase();
    if(!combined.includes(needle)) return;

    let score = bucket.weight;
    if(combined === needle) score += 25;
    else if(combined.startsWith(needle)) score += 10;

    if(score > bestScore){
      bestScore = score;
      bestReason = bucket.label;
    }
  });

  return {score:bestScore, reason:bestReason};
}

function parseDateValue(value){
  const text = String(value || "").trim();
  if(!text) return 0;

  const parsed = new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(text)
      ? `${text}T12:00:00`
      : text
  );

  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function render(){
  const query = $("searchInput").value.trim().toLowerCase();
  const protein = $("proteinSelect").value;
  const type = $("typeSelect").value;
  const cuisine = $("cuisineSelect").value;
  const collection = $("collectionSelect").value;
  const hiddenOnly = $("showHidden").checked;
  const sortMode = $("sortSelect").value;

  let visible = recipes
    .map(recipe => {
      const match = searchScore(recipe, query);
      return {recipe, score:match.score, reason:match.reason};
    })
    .filter(item => {
      const recipe = item.recipe;

      return (!query || item.score > 0)
        && (!protein || recipe.protein === protein)
        && (!type || recipe.type === type)
        && (!cuisine || recipe.cuisine === cuisine)
        && (!collection || (recipe.collections || []).includes(collection))
        && (!$("kirstaFav" ).checked || recipe.kirsta_rating >= 4)
        && (!$("tjFav").checked || recipe.tj_rating >= 4)
        && (!$("torrinFav").checked || recipe.torrin_rating >= 4)
        && (!$("quickOnly").checked || (recipe.total_time > 0 && recipe.total_time <= 30))
        && (hiddenOnly ? recipe.hidden : !recipe.hidden);
    });

  visible.sort((a,b) => {
    if(sortMode === "newest"){
      return parseDateValue(b.recipe.added) - parseDateValue(a.recipe.added);
    }
    if(sortMode === "az"){
      return String(a.recipe.name).localeCompare(String(b.recipe.name));
    }
    if(sortMode === "lastMade"){
      return parseDateValue(b.recipe.last_made) - parseDateValue(a.recipe.last_made);
    }
    if(query && b.score !== a.score){
      return b.score - a.score;
    }
    return String(a.recipe.name).localeCompare(String(b.recipe.name));
  });

  $("count").textContent =
    `${visible.length} recipe${visible.length === 1 ? "" : "s"}`;

  $("grid").innerHTML = visible.map(item => {
    const recipe = item.recipe;

    return `
      <article class="card" data-id="${escapeHTML(recipe.id)}" role="button" tabindex="0" aria-label="Open ${escapeHTML(recipe.name || "recipe")}">
        <button class="card-quick-edit" type="button" data-quick-edit-id="${escapeHTML(recipe.id)}" aria-label="Quick edit ${escapeHTML(recipe.name || "recipe")}">Edit</button>
        ${recipe.image ? `<img class="recipe-card-image" src="${escapeHTML(recipe.image)}" alt="${escapeHTML(recipe.name || "Recipe")}">` : ""}
        <div class="meta">${escapeHTML([recipe.protein, recipe.type, recipe.source].filter(Boolean).join(" • "))}</div>
        <h2>${escapeHTML(recipe.name || "Untitled recipe")}</h2>
        ${query && item.reason ? `<p class="match-reason">${escapeHTML(item.reason)}</p>` : ""}
        <p>${escapeHTML(recipe.notes || "")}</p>
      </article>
    `;
  }).join("");

  document.querySelectorAll(".card[data-id]").forEach(card => {
    const openCard = () => {
      openRecipe(
        recipes.find(recipe => recipe.id === card.dataset.id)
      );
    };

    card.addEventListener("click", event => {
      if(event.target.closest("[data-quick-edit-id]")) return;
      openCard();
    });
    card.addEventListener("keydown", event => {
      if(event.key === "Enter" || event.key === " "){
        event.preventDefault();
        openCard();
      }
    });
  });
}

let quickEditRecipe = null;

function openQuickEdit(recipe){
  quickEditRecipe = recipe;

  $("quickEditName").value = recipe.name || "";

  const proteins = categoryValues("protein", DEFAULT_PROTEINS);
  const mealTypes = categoryValues("type", DEFAULT_MEAL_TYPES);

  fillCategorySelect(
    "quickEditProtein",
    proteins,
    recipe.protein || ""
  );

  fillCategorySelect(
    "quickEditType",
    mealTypes,
    recipe.type || ""
  );

  $("quickEditProteinNew").value =
    recipe.protein && !proteins.includes(recipe.protein)
      ? recipe.protein
      : "";

  $("quickEditTypeNew").value =
    recipe.type && !mealTypes.includes(recipe.type)
      ? recipe.type
      : "";

  $("quickEditProteinNew").hidden =
    $("quickEditProtein").value !== "__new__";

  $("quickEditTypeNew").hidden =
    $("quickEditType").value !== "__new__";

  setImportStatus("quickEditStatus", "");
  $("quickEditDialog").showModal();
}

document.addEventListener("click", event => {
  const button = event.target.closest("[data-quick-edit-id]");
  if(!button) return;

  event.preventDefault();
  event.stopPropagation();

  const recipe = recipes.find(
    item => item.id === button.dataset.quickEditId
  );

  if(recipe) openQuickEdit(recipe);
});

on("closeQuickEdit", "click", () => {
  $("quickEditDialog").close();
});

on("quickEditForm", "submit", async event => {
  event.preventDefault();

  if(!quickEditRecipe) return;

  const updates = {
    name: $("quickEditName").value.trim(),
    protein: selectedCategory(
      "quickEditProtein",
      "quickEditProteinNew"
    ),
    type: selectedCategory(
      "quickEditType",
      "quickEditTypeNew"
    )
  };

  if(!updates.name){
    setImportStatus(
      "quickEditStatus",
      "Recipe title is required.",
      "error"
    );
    return;
  }

  setImportStatus("quickEditStatus", "Saving…");

  try{
    const result = await postVault({
      action: "update",
      id: quickEditRecipe.id,
      url: quickEditRecipe.url,
      updates
    });

    if(!result) return;

    $("quickEditDialog").close();
    quickEditRecipe = null;
    await loadRecipes();
  }catch(error){
    setImportStatus(
      "quickEditStatus",
      `Could not save: ${error.message}`,
      "error"
    );
  }
});

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


let pendingDuplicateRequest = null;

function normalizeDuplicateUrl(value){
  try{
    const url = new URL(String(value || "").trim());
    url.hash = "";
    [
      "utm_source","utm_medium","utm_campaign","utm_term","utm_content",
      "fbclid","gclid","mc_cid","mc_eid"
    ].forEach(name => url.searchParams.delete(name));
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return `${url.hostname}${url.pathname}${url.search}`.toLowerCase();
  }catch(error){
    return String(value || "").trim().toLowerCase().replace(/\/+$/, "");
  }
}

function normalizeDuplicateTitle(value){
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(best|easy|homemade|recipe)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findLocalDuplicate(existing){
  if(!existing) return null;
  return recipes.find(recipe => existing.id && recipe.id === existing.id)
    || recipes.find(recipe => existing.url && normalizeDuplicateUrl(recipe.url) === normalizeDuplicateUrl(existing.url))
    || recipes.find(recipe => normalizeDuplicateTitle(recipe.name) === normalizeDuplicateTitle(existing.name));
}


function openLinkedRecipe(){
  if(linkedRecipeOpened || !recipes.length) return;

  const params = new URLSearchParams(window.location.search);
  const recipeId = params.get("recipe");
  if(!recipeId) return;

  const recipe = recipes.find(item => item.id === recipeId);
  if(!recipe) return;

  linkedRecipeOpened = true;
  openRecipe(recipe);
}

function openRecipeInNewTab(recipe){
  if(!recipe?.id){
    alert("The existing recipe could not be opened. Refresh the page and try again.");
    return;
  }

  const url = new URL(window.location.href);
  url.searchParams.set("recipe", recipe.id);
  url.hash = "";

  const link = document.createElement("a");
  link.href = url.toString();
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function showDuplicateDialog(result, request){
  pendingDuplicateRequest = {result, request};
  const existing = result.existing || {};
  const exact = result.matchType === "url" || result.matchType === "id";

  $("duplicateHeading").textContent = exact
    ? "This recipe is already in your vault"
    : "This looks like a possible duplicate";
  $("duplicateMessage").textContent = exact
    ? "Choose whether to open the saved recipe, refresh it from the source, or keep another copy."
    : "The title is very similar to a recipe already saved. Check the existing recipe before deciding.";
  $("duplicateExistingName").textContent = existing.name || "Existing recipe";
  $("duplicateExistingMeta").textContent = [existing.source, existing.url].filter(Boolean).join(" • ");
  $("duplicateDialog").showModal();
}

async function submitDuplicateChoice(choice){
  if(!pendingDuplicateRequest) return;

  const {result, request} = pendingDuplicateRequest;
  const existing = result.existing || {};

  if(choice === "open"){
    const recipe = findLocalDuplicate(existing);
    openRecipeInNewTab(recipe);
    return;
  }

  if(choice === "cancel"){
    $("duplicateDialog").close();
    pendingDuplicateRequest = null;
    return;
  }

  $("duplicateRefresh").disabled = true;
  $("duplicateKeepBoth").disabled = true;
  $("duplicateOpen").disabled = true;

  try{
    const nextRequest = {
      ...request,
      duplicateAction: choice,
      duplicateRow: result.row
    };
    const saved = await postVault(nextRequest);
    if(!saved) return;

    $("duplicateDialog").close();
    pendingDuplicateRequest = null;
    await loadRecipes();

    if(request.action === "addManual"){
      $("manualRecipeForm").reset();
      $("manualSource").value = "Family Recipe";
      refreshEntryCategoryMenus();
      setImportStatus("manualStatus", `${choice === "refresh" ? "Refreshed" : "Saved another copy of"} ${saved.recipe?.name || "recipe"}.`, "success");
    }else{
      $("importUrl").value = "";
      setImportStatus("urlImportStatus", `${choice === "refresh" ? "Refreshed" : "Imported another copy of"} ${saved.recipe?.name || "recipe"}.`, "success");
    }
  }catch(error){
    alert(`Could not save: ${error.message}`);
  }finally{
    $("duplicateRefresh").disabled = false;
    $("duplicateKeepBoth").disabled = false;
    $("duplicateOpen").disabled = false;
  }
}

on("duplicateOpen", "click", () => submitDuplicateChoice("open"));
on("duplicateRefresh", "click", () => submitDuplicateChoice("refresh"));
on("duplicateKeepBoth", "click", () => submitDuplicateChoice("keep"));
on("duplicateCancel", "click", () => submitDuplicateChoice("cancel"));
on("closeDuplicate", "click", () => submitDuplicateChoice("cancel"));

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

  const localDuplicate = recipes.find(recipe =>
    recipe.url && normalizeDuplicateUrl(recipe.url) === normalizeDuplicateUrl(rawUrl)
  );

  if(localDuplicate){
    setImportStatus("urlImportStatus", "Duplicate found. Choose what to do next.");
    showDuplicateDialog({
      action: "duplicate",
      matchType: "url",
      row: "",
      existing: {
        name: localDuplicate.name || "Existing recipe",
        id: localDuplicate.id || "",
        url: localDuplicate.url || "",
        source: localDuplicate.source || ""
      }
    }, {
      action: "importUrl",
      url: rawUrl
    });
    return;
  }

  setImportStatus("urlImportStatus", "Importing recipe…");

  try{
    const result = await postVault({
      action: "importUrl",
      url: rawUrl
    });

    if(!result) return;

    if(result.action === "duplicate"){
      setImportStatus("urlImportStatus", "Duplicate found. Choose what to do next.");
      showDuplicateDialog(result, {
        action: "importUrl",
        url: rawUrl
      });
      return;
    }

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
    protein: selectedCategory("manualProtein", "manualProteinNew"),
    type: selectedCategory("manualType", "manualTypeNew"),
    cuisine: $("manualCuisine").value.trim(),
    tags: $("manualTags").value
      .split(/[|,]/)
      .map(value => value.trim())
      .filter(Boolean)
      .join("|"),
    collections: $("manualCollections").value
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

    if(result.action === "duplicate"){
      setImportStatus("manualStatus", "Possible duplicate found. Choose what to do next.");
      showDuplicateDialog(result, {
        action: "addManual",
        recipe
      });
      return;
    }

    $("manualRecipeForm").reset();
    $("manualSource").value = "Family Recipe";
    $("manualProteinNew").hidden = true;
    $("manualTypeNew").hidden = true;
    refreshEntryCategoryMenus();
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
  const proteinValues = categoryValues("protein", DEFAULT_PROTEINS);
  const mealTypeValues = categoryValues("type", DEFAULT_MEAL_TYPES);

  fillCategorySelect("editProtein", proteinValues, recipe.protein || "");
  fillCategorySelect("editType", mealTypeValues, recipe.type || "");

  $("editProteinNew").value =
    recipe.protein && !proteinValues.includes(recipe.protein)
      ? recipe.protein
      : "";

  $("editTypeNew").value =
    recipe.type && !mealTypeValues.includes(recipe.type)
      ? recipe.type
      : "";

  $("editProteinNew").hidden = $("editProtein").value !== "__new__";
  $("editTypeNew").hidden = $("editType").value !== "__new__";
  $("editCuisine").value = recipe.cuisine || "";
  $("editPrep").value = recipe.prep_time || "";
  $("editCook").value = recipe.cook_time || "";
  $("editTotal").value = recipe.total_time || "";
  $("editTags").value = Array.isArray(recipe.tags)
    ? recipe.tags.join(" | ")
    : String(recipe.tags || "");
  $("editCollections").value = Array.isArray(recipe.collections)
    ? recipe.collections.join(" | ")
    : String(recipe.collections || "");
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
    protein: selectedCategory("editProtein", "editProteinNew"),
    type: selectedCategory("editType", "editTypeNew"),
    cuisine: $("editCuisine").value.trim(),
    prep_time: $("editPrep").value.trim(),
    cook_time: $("editCook").value.trim(),
    total_time: $("editTotal").value.trim(),
    tags: $("editTags").value
      .split(/[|,]/)
      .map(value => value.trim())
      .filter(Boolean)
      .join("|"),
    collections: $("editCollections").value
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

on("toggleSearchBtn", "click", () => {
  const panel = $("searchPanel");
  const button = $("toggleSearchBtn");
  const isOpen = button.getAttribute("aria-expanded") === "true";

  button.setAttribute("aria-expanded", String(!isOpen));
  panel.classList.toggle("collapsed", isOpen);
});

on("searchInput", "input", render);

[
  "proteinSelect",
  "typeSelect",
  "cuisineSelect",
  "collectionSelect",
  "sortSelect",
  "kirstaFav",
  "tjFav",
  "torrinFav",
  "quickOnly",
  "showHidden"
].forEach(id => on(id, "change", render));

on("clearBtn", "click", () => {
  $("searchInput").value = "";
  $("proteinSelect").value = "";
  $("typeSelect").value = "";
  $("cuisineSelect").value = "";
  $("collectionSelect").value = "";
  $("sortSelect").value = "relevance";

  [
    "kirstaFav",
    "tjFav",
    "torrinFav",
    "quickOnly",
    "showHidden"
  ].forEach(id => {
    $(id).checked = false;
  });

  render();
});

setupNewCategory("manualProtein", "manualProteinNew");
setupNewCategory("manualType", "manualTypeNew");
setupNewCategory("editProtein", "editProteinNew");
setupNewCategory("editType", "editTypeNew");
setupNewCategory("quickEditProtein", "quickEditProteinNew");
setupNewCategory("quickEditType", "quickEditTypeNew");

document.querySelectorAll("dialog").forEach(dialog => {
  dialog.addEventListener("click", event => {
    if(event.target !== dialog) return;
    dialog.close();
  });
});

loadRecipes();
})();
