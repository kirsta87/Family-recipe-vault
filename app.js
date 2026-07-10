const $ = id => document.getElementById(id);
const SETTINGS_KEY = "recipeVaultSettings";
const PLANNER_KEY = "recipeVaultPlanner";
const baseConfig = window.RECIPE_VAULT_CONFIG || {};
let settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
let config = {...baseConfig, ...settings};
let recipes = [];
let activeRecipe = null;
let planner = JSON.parse(localStorage.getItem(PLANNER_KEY) || "{}");

function parseCSV(text){
  const rows = [];
  let row = [], field = "", quoted = false;

  for(let i = 0; i < text.length; i++){
    const char = text[i];
    const next = text[i + 1];

    if(char === '"' && quoted && next === '"'){
      field += '"';
      i++;
    } else if(char === '"'){
      quoted = !quoted;
    } else if(char === "," && !quoted){
      row.push(field);
      field = "";
    } else if((char === "\n" || char === "\r") && !quoted){
      if(char === "\r" && next === "\n") i++;
      row.push(field);
      if(row.some(value => value !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if(field || row.length){
    row.push(field);
    rows.push(row);
  }

  if(rows.length < 2) return [];
  const headers = rows.shift().map(h => h.trim().toLowerCase());

  return rows.map(cols => {
    const obj = {};
    headers.forEach((header, index) => obj[header] = cols[index] ?? "");
    return obj;
  });
}

function tags(value){
  return String(value || "").split("|").map(x => x.trim()).filter(Boolean);
}

function clean(r){
  return {
    ...r,
    tags: tags(r.tags),
    total_time: Number(r.total_time) || 0,
    kirsta_rating: Number(r.kirsta_rating) || 0,
    tj_rating: Number(r.tj_rating) || 0,
    torrin_rating: Number(r.torrin_rating) || 0,
    made_count: Number(r.made_count) || 0,
    hidden: String(r.hidden).toLowerCase() === "true"
  };
}

async function loadRecipes(){
  $("syncStatus").textContent = "Loading…";
  try{
    const url = config.sheetCsvUrl || "recipes.json";
    const response = await fetch(url, {cache:"no-store"});
    if(!response.ok) throw new Error(`HTTP ${response.status}`);
    recipes = url.endsWith(".json")
      ? (await response.json()).map(clean)
      : parseCSV(await response.text()).map(clean);

    $("syncStatus").textContent = config.sheetCsvUrl ? "• synced from family sheet" : "• starter mode";
  }catch(error){
    recipes = [];
    $("syncStatus").textContent = `• load error: ${error.message}`;
  }
  renderFilters();
  renderRecipes();
}

function unique(values){
  return [...new Set(values.filter(Boolean))].sort();
}

function renderFilters(){
  const make = (target, field) => {
    $(target).innerHTML = unique(recipes.map(r => r[field])).map(value =>
      `<label class="check"><input type="checkbox" data-field="${field}" value="${value}"> ${value}</label>`
    ).join("");
  };
  make("proteinFilters","protein");
  make("typeFilters","type");
  document.querySelectorAll("[data-field]").forEach(el => el.addEventListener("change", renderRecipes));
}

function checked(field){
  return [...document.querySelectorAll(`[data-field="${field}"]:checked`)].map(el => el.value);
}

function renderRecipes(){
  const query = $("searchInput").value.trim().toLowerCase();
  const proteins = checked("protein");
  const types = checked("type");
  const showHidden = $("showHidden").checked;

  const visible = recipes.filter(r => {
    const haystack = [r.name,r.protein,r.type,r.cuisine,r.source,(r.tags||[]).join(" "),r.notes].join(" ").toLowerCase();
    return (!query || haystack.includes(query))
      && (!proteins.length || proteins.includes(r.protein))
      && (!types.length || types.includes(r.type))
      && (!$("kirstaFavorites").checked || r.kirsta_rating >= 4)
      && (!$("tjFavorites").checked || r.tj_rating >= 4)
      && (!$("torrinFavorites").checked || r.torrin_rating >= 4)
      && (!$("quickOnly").checked || (r.total_time > 0 && r.total_time <= 30))
      && (showHidden ? r.hidden : !r.hidden);
  }).sort((a,b) => String(a.name).localeCompare(String(b.name)));

  $("resultCount").textContent = `${visible.length} recipe${visible.length === 1 ? "" : "s"}`;
  $("recipeGrid").innerHTML = visible.map(r => `
    <article class="card">
      <div class="meta">${[r.protein,r.type,r.source].filter(Boolean).join(" • ")}</div>
      <h2>${escapeHTML(r.name || "Untitled")}</h2>
      <p class="notes">${escapeHTML(r.notes || "")}</p>
      <button class="primary" data-open="${r.id}">View recipe</button>
    </article>
  `).join("");

  document.querySelectorAll("[data-open]").forEach(btn => {
    btn.onclick = () => openRecipe(recipes.find(r => r.id === btn.dataset.open));
  });
}

function escapeHTML(value){
  return String(value || "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  })[c]);
}

function pdfURL(recipe){
  return `https://www.hellofresh.com/recipecards/card/${recipe.id}.pdf`;
}

function openRecipe(recipe){
  activeRecipe = recipe;
  $("recipeTitle").textContent = recipe.name;
  $("recipeMeta").textContent = [recipe.protein,recipe.type,recipe.cuisine,recipe.total_time ? `${recipe.total_time} min` : ""].filter(Boolean).join(" • ");
  $("notesInput").value = recipe.notes || "";
  $("hideBtn").textContent = recipe.hidden ? "Restore recipe" : "Hide recipe";
  $("recipePageLink").href = recipe.url;
  $("pdfLink").href = pdfURL(recipe);
  $("pdfViewer").src = `https://docs.google.com/gview?embedded=1&url=${encodeURIComponent(pdfURL(recipe))}`;
  renderStars("kirstaStars","kirsta_rating");
  renderStars("tjStars","tj_rating");
  renderStars("torrinStars","torrin_rating");
  $("recipeDialog").showModal();
}

function renderStars(target, field){
  $(target).innerHTML = "";
  for(let value = 1; value <= 5; value++){
    const button = document.createElement("button");
    button.className = "star";
    button.textContent = value <= Number(activeRecipe[field] || 0) ? "★" : "☆";
    button.onclick = async () => {
      if(await writeUpdate({[field]:value})){
        activeRecipe[field] = value;
        renderStars(target, field);
      }
    };
    $(target).appendChild(button);
  }
}

async function writeRequest(action, recipe, updates){
  if(!config.appsScriptUrl || !config.sharedKey){
    alert("Open Manage and add the Apps Script URL and family write key first.");
    return false;
  }

  const body = new URLSearchParams();
  body.set("payload", JSON.stringify({
    action,
    key: config.sharedKey,
    id: recipe.id,
    url: recipe.url,
    updates
  }));

  try{
    const response = await fetch(config.appsScriptUrl, {method:"POST", body});
    const result = await response.json();
    if(!result.success) throw new Error(result.error || "Save failed");
    await loadRecipes();
    return true;
  }catch(error){
    alert(`Could not save: ${error.message}`);
    return false;
  }
}

function writeUpdate(updates){
  return writeRequest("update", activeRecipe, updates);
}

function extractHelloFresh(url){
  try{
    const parsed = new URL(url);
    const slug = parsed.pathname.split("/").filter(Boolean).pop();
    const parts = slug.split("-");
    const id = parts.pop();
    if(!/^[a-f0-9]{24}$/i.test(id)) throw new Error();
    const name = parts.map(w => w.charAt(0).toUpperCase()+w.slice(1)).join(" ");
    return {
      name,url,id,source:"HelloFresh",image:"",protein:"",type:"",cuisine:"",
      tags:"",prep_time:"",cook_time:"",total_time:"",
      kirsta_rating:"",tj_rating:"",torrin_rating:"",torrin_notes:"",
      notes:"",made_count:0,hidden:false,added:new Date().toISOString().slice(0,10),last_made:""
    };
  }catch{
    return null;
  }
}

$("manageBtn").onclick = () => {
  $("sheetUrlInput").value = config.sheetCsvUrl || "";
  $("appsScriptUrlInput").value = config.appsScriptUrl || "";
  $("sharedKeyInput").value = config.sharedKey || "";
  $("manageDialog").showModal();
};
$("closeManageBtn").onclick = () => $("manageDialog").close();
$("saveSharedSettingsBtn").onclick = () => {
  settings = {
    sheetCsvUrl:$("sheetUrlInput").value.trim(),
    appsScriptUrl:$("appsScriptUrlInput").value.trim(),
    sharedKey:$("sharedKeyInput").value.trim()
  };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  config = {...baseConfig,...settings};
  $("manageDialog").close();
  loadRecipes();
};

$("addRecipeBtn").onclick = () => $("addDialog").showModal();
$("closeAddBtn").onclick = () => $("addDialog").close();
$("addForm").onsubmit = async event => {
  event.preventDefault();
  const recipe = extractHelloFresh($("recipeUrlInput").value.trim());
  if(!recipe) return alert("That does not look like a HelloFresh recipe URL.");
  if(await writeRequest("add", recipe, recipe)){
    $("recipeUrlInput").value = "";
    $("addDialog").close();
  }
};

$("closeRecipeBtn").onclick = () => {
  $("pdfViewer").src = "about:blank";
  $("recipeDialog").close();
};
$("saveNotesBtn").onclick = () => writeUpdate({notes:$("notesInput").value.trim()});
$("madeBtn").onclick = () => writeUpdate({
  made_count:Number(activeRecipe.made_count || 0)+1,
  last_made:new Date().toISOString().slice(0,10)
});
$("hideBtn").onclick = async () => {
  const next = !activeRecipe.hidden;
  if(await writeUpdate({hidden:next})) $("recipeDialog").close();
};

const DAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
$("plannerBtn").onclick = () => {
  $("plannerDays").innerHTML = DAYS.map(day => `
    <div class="planner-day"><strong>${day}</strong><div>${(planner[day]||[]).map(x=>escapeHTML(x.name)).join("<br>") || "Nothing planned."}</div></div>
  `).join("");
  $("plannerDialog").showModal();
};
$("closePlannerBtn").onclick = () => $("plannerDialog").close();

["searchInput","kirstaFavorites","tjFavorites","torrinFavorites","quickOnly","showHidden"].forEach(id => {
  $(id).addEventListener(id === "searchInput" ? "input" : "change", renderRecipes);
});
$("clearFiltersBtn").onclick = () => {
  $("searchInput").value = "";
  document.querySelectorAll("input[type=checkbox]").forEach(el => el.checked = false);
  renderRecipes();
};

loadRecipes();
