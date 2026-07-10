(() => {
"use strict";

const $ = id => document.getElementById(id);
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

function clean(r){
  return {
    ...r,
    tags: String(r.tags || "").split("|").map(x => x.trim()).filter(Boolean),
    total_time: Number(r.total_time) || 0,
    kirsta_rating: Number(r.kirsta_rating) || 0,
    tj_rating: Number(r.tj_rating) || 0,
    torrin_rating: Number(r.torrin_rating) || 0,
    made_count: Number(r.made_count) || 0,
    hidden: String(r.hidden).toLowerCase() === "true"
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
      recipe.tags.join(" "), recipe.notes, recipe.torrin_notes
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
  $("hideBtn").textContent = recipe.hidden ? "Restore recipe" : "Hide recipe";
  $("sourceLink").href = recipe.url || "#";
  $("pdfLink").href = pdfURL(recipe);
  $("viewer").src = "about:blank";
  $("viewer").hidden = true;
  $("viewerPlaceholder").hidden = false;
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

$("manageBtn").addEventListener("click", () => {
  $("sheetUrl").value = config.sheetCsvUrl || "";
  $("scriptUrl").value = config.appsScriptUrl || "";
  $("familyKey").value = config.sharedKey || "";
  $("manageDialog").showModal();
});
$("closeManage").addEventListener("click", () => $("manageDialog").close());
$("saveSettings").addEventListener("click", () => {
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

$("addBtn").addEventListener("click", () => $("addDialog").showModal());
$("closeAdd").addEventListener("click", () => $("addDialog").close());
$("addForm").addEventListener("submit", async event => {
  event.preventDefault();
  const recipe = extractHelloFresh($("addUrl").value.trim());
  if(!recipe){
    alert("That does not look like a HelloFresh recipe URL.");
    return;
  }

  if(await write("add", recipe, recipe)){
    $("addUrl").value = "";
    $("addDialog").close();
  }
});

$("loadCardBtn").addEventListener("click", () => {
  if(!active) return;
  $("viewerPlaceholder").hidden = true;
  $("viewer").hidden = false;
  $("viewer").src = pdfURL(active);
});

$("closeRecipe").addEventListener("click", () => {
  $("viewer").src = "about:blank";
  $("viewer").hidden = true;
  $("viewerPlaceholder").hidden = false;
  $("recipeDialog").close();
});
$("saveNotes").addEventListener("click", () => write("update", active, {notes: $("notes").value.trim()}));
$("madeBtn").addEventListener("click", () => write("update", active, {
  made_count: Number(active.made_count || 0) + 1,
  last_made: new Date().toISOString().slice(0,10)
}));
$("hideBtn").addEventListener("click", async () => {
  const ok = await write("update", active, {hidden: !active.hidden});
  if(ok) $("recipeDialog").close();
});

const days = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
$("plannerBtn").addEventListener("click", () => {
  $("plannerDays").innerHTML = days.map(day => `
    <div class="planner-day"><strong>${day}</strong><div>${(planner[day] || []).map(item => escapeHTML(item.name)).join("<br>") || "Nothing planned."}</div></div>
  `).join("");
  $("plannerDialog").showModal();
});
$("closePlanner").addEventListener("click", () => $("plannerDialog").close());

$("searchInput").addEventListener("input", render);
["kirstaFav","tjFav","torrinFav","quickOnly","showHidden"].forEach(id => $(id).addEventListener("change", render));
$("clearBtn").addEventListener("click", () => {
  $("searchInput").value = "";
  document.querySelectorAll('input[type="checkbox"]').forEach(input => input.checked = false);
  render();
});

loadRecipes();
})();
