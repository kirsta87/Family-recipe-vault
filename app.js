const baseConfig = window.RECIPE_VAULT_CONFIG || {};
const SETTINGS_KEY = 'familyRecipeVaultSharedSettings';
const LOCAL_KEY = 'familyRecipeVaultLocalRecipes';
const FAVORITES_KEY = 'familyRecipeVaultFavorites';
const RATINGS_KEY = 'familyRecipeVaultRatings';
const PLANNER_KEY = 'familyRecipeVaultMealPlanner';
const PDF = id => `https://www.hellofresh.com/recipecards/card/${id}.pdf`;
const VIEWER = id => `https://docs.google.com/gview?embedded=1&url=${encodeURIComponent(PDF(id))}`;
const $ = id => document.getElementById(id);

let recipes = [];
let favorites = new Set(JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]'));
let ratings = JSON.parse(localStorage.getItem(RATINGS_KEY) || '{}');
let planner = JSON.parse(localStorage.getItem(PLANNER_KEY) || '{}');
let activeRecipe = null;
let sharedSettings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
let config = {...baseConfig, ...sharedSettings};

const normalizeTags = value => Array.isArray(value)
  ? value
  : String(value || '').split(/[,|;]/).map(x => x.trim()).filter(Boolean);

const uniq = values => [...new Set(values.filter(Boolean))].sort((a,b) => a.localeCompare(b));

function slugTitle(slug){
  const words = slug.split('-');
  if (/^[a-f0-9]{24}$/i.test(words.at(-1))) words.pop();
  return words.map(w => w ? w[0].toUpperCase() + w.slice(1) : '').join(' ');
}

function detectProtein(lower){
  if (lower.includes('chicken')) return 'Chicken';
  if (lower.includes('beef') || lower.includes('steak') || lower.includes('meatball')) return 'Beef';
  if (lower.includes('pork') || lower.includes('sausage') || lower.includes('bacon')) return 'Pork';
  if (lower.includes('turkey')) return 'Turkey';
  if (lower.includes('shrimp') || lower.includes('salmon') || lower.includes('fish')) return 'Seafood';
  if (lower.includes('veggie') || lower.includes('vegetarian') || lower.includes('tofu')) return 'Vegetarian';
  return 'Other';
}

function detectType(lower){
  if (lower.includes('taco')) return 'Tacos';
  if (lower.includes('pasta') || lower.includes('spaghetti') || lower.includes('ravioli') || lower.includes('linguine')) return 'Pasta';
  if (lower.includes('burger')) return 'Burgers';
  if (lower.includes('bowl')) return 'Bowls';
  if (lower.includes('flatbread') || lower.includes('pizza')) return 'Flatbread';
  if (lower.includes('soup') || lower.includes('stew') || lower.includes('chowder')) return 'Soup';
  if (lower.includes('sandwich') || lower.includes('melt')) return 'Sandwiches';
  if (lower.includes('one-pan') || lower.includes('one-pot')) return 'One Pan';
  return 'Other';
}

function extractFromUrl(raw){
  try{
    const u = new URL(raw.trim());
    const slug = u.pathname.split('/').filter(Boolean).pop() || '';
    const id = slug.split('-').at(-1);
    if(!/^[a-f0-9]{24}$/i.test(id)) throw new Error('No recipe ID found');
    const lower = slug.toLowerCase();
    return {
      name: slugTitle(slug), url: u.href, id,
      protein: detectProtein(lower), type: detectType(lower),
      tags: [], time: '', rating: 0, favorite: false, notes: '',
      added: new Date().toISOString()
    };
  }catch{
    return null;
  }
}

function parseCsv(text){
  const rows=[]; let row=[], field='', quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i], n=text[i+1];
    if(c === '"' && quoted && n === '"'){field += '"'; i++;}
    else if(c === '"'){quoted = !quoted;}
    else if(c === ',' && !quoted){row.push(field); field='';}
    else if((c === '\n' || c === '\r') && !quoted){
      if(c === '\r' && n === '\n') i++;
      row.push(field);
      if(row.some(x => x !== '')) rows.push(row);
      row=[]; field='';
    } else field += c;
  }
  if(field || row.length){row.push(field); rows.push(row);}
  if(!rows.length) return [];
  const headers = rows.shift().map(h => h.trim().toLowerCase());
  return rows.map(cols => Object.fromEntries(headers.map((h,i) => [h, cols[i] ?? ''])));
}

function cleanRecipe(r){
  const inferred = r.url ? extractFromUrl(r.url) : null;
  return {
    name: r.name || inferred?.name || 'Untitled recipe',
    url: r.url || inferred?.url || '',
    id: r.id || inferred?.id || '',
    protein: r.protein || inferred?.protein || 'Other',
    type: r.type || inferred?.type || 'Other',
    tags: normalizeTags(r.tags),
    time: r.time || '',
    rating: Number(r.rating) || 0,
    favorite: String(r.favorite).toLowerCase() === 'true',
    notes: r.notes || '',
    added: r.added || ''
  };
}

async function loadRecipes(){
  $('syncStatus').textContent = 'Loading…';
  let base = [];
  try{
    if(config.sheetCsvUrl){
      const response = await fetch(config.sheetCsvUrl, {cache:'no-store'});
      if(!response.ok) throw new Error('Sheet unavailable');
      base = parseCsv(await response.text()).map(cleanRecipe);
      $('syncStatus').textContent = '• synced from family sheet';
    }else{
      const response = await fetch('recipes.json');
      base = (await response.json()).map(cleanRecipe);
      $('syncStatus').textContent = '• starter/local mode';
    }
  }catch{
    try{
      const response = await fetch('recipes.json');
      base = (await response.json()).map(cleanRecipe);
    }catch{}
    $('syncStatus').textContent = '• offline/local mode';
  }

  const local = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]').map(cleanRecipe);
  const map = new Map();
  [...base, ...local].forEach(r => r.id && map.set(r.id, r));
  recipes = [...map.values()];
  renderFilters();
  render();
}

function selected(field){
  return [...document.querySelectorAll(`[data-filter="${field}"]:checked`)].map(x => x.value);
}

function renderFilters(){
  const make = (field, values, target) => {
    $(target).innerHTML = uniq(values).map(v =>
      `<label class="check"><input type="checkbox" data-filter="${field}" value="${escapeHtml(v)}"> ${escapeHtml(v)}</label>`
    ).join('');
  };
  make('protein', recipes.map(r => r.protein), 'proteinFilters');
  make('type', recipes.map(r => r.type), 'typeFilters');
  make('tags', recipes.flatMap(r => r.tags), 'tagFilters');
  document.querySelectorAll('[data-filter]').forEach(x => x.addEventListener('change', render));
}

function escapeHtml(value){
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[char]));
}

function emojiFor(recipe){
  return ({
    Chicken:'🐔', Beef:'🥩', Pork:'🌮', Turkey:'🦃',
    Seafood:'🍤', Vegetarian:'🥦'
  }[recipe.protein] || '🍽️');
}

function render(){
  const query = $('searchInput').value.trim().toLowerCase();
  const proteins = selected('protein');
  const types = selected('type');
  const tags = selected('tags');
  const favoritesOnly = $('favoritesOnly').checked;

  let visible = recipes.filter(recipe => {
    const haystack = [
      recipe.name, recipe.protein, recipe.type,
      recipe.tags.join(' '), recipe.notes
    ].join(' ').toLowerCase();

    return (!query || haystack.includes(query))
      && (!proteins.length || proteins.includes(recipe.protein))
      && (!types.length || types.includes(recipe.type))
      && (!tags.length || tags.every(tag => recipe.tags.includes(tag)))
      && (!favoritesOnly || favorites.has(recipe.id) || recipe.favorite);
  });

  const sort = $('sortSelect').value;
  visible.sort((a,b) => sort === 'rating'
    ? Number(ratings[b.id] || b.rating || 0) - Number(ratings[a.id] || a.rating || 0)
    : sort === 'newest'
      ? String(b.added).localeCompare(String(a.added))
      : a.name.localeCompare(b.name)
  );

  $('resultCount').textContent = `${visible.length} recipe${visible.length === 1 ? '' : 's'}`;
  $('emptyState').hidden = visible.length > 0;
  const grid = $('recipeGrid');
  grid.innerHTML = '';

  visible.forEach(recipe => {
    const node = $('recipeCardTemplate').content.cloneNode(true);
    node.querySelector('.recipe-art span').textContent = emojiFor(recipe);
    node.querySelector('.recipe-meta').textContent =
      [recipe.protein, recipe.type, recipe.time].filter(Boolean).join(' • ');
    node.querySelector('.recipe-title').textContent = recipe.name;
    node.querySelector('.tags').innerHTML = recipe.tags.slice(0,5)
      .map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('');

    const notes = node.querySelector('.recipe-notes');
    notes.textContent = recipe.notes;
    notes.hidden = !recipe.notes;

    const favoriteButton = node.querySelector('.favorite');
    const isFavorite = favorites.has(recipe.id) || recipe.favorite;
    favoriteButton.textContent = isFavorite ? '★' : '☆';
    favoriteButton.classList.toggle('on', isFavorite);
    favoriteButton.onclick = () => {
      favorites.has(recipe.id) ? favorites.delete(recipe.id) : favorites.add(recipe.id);
      localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites]));
      render();
    };

    node.querySelector('.view-button').onclick = () => openRecipe(recipe);
    grid.appendChild(node);
  });
}

function renderRating(recipe){
  const container = $('ratingStars');
  container.innerHTML = '';
  const current = Number(ratings[recipe.id] || recipe.rating || 0);
  for(let value=1; value<=5; value++){
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = value <= current ? '★' : '☆';
    button.setAttribute('aria-label', `${value} star rating`);
    button.onclick = () => {
      ratings[recipe.id] = value;
      localStorage.setItem(RATINGS_KEY, JSON.stringify(ratings));
      renderRating(recipe);
      render();
    };
    container.appendChild(button);
  }
}

function openRecipe(recipe){
  $('dialogTitle').textContent = recipe.name;
  $('dialogMeta').textContent = [recipe.protein, recipe.type, recipe.time].filter(Boolean).join(' • ');
  $('dialogTags').innerHTML = recipe.tags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('');
  $('pdfViewer').src = VIEWER(recipe.id);
  $('recipePageLink').href = recipe.url;
  $('directPdfLink').href = PDF(recipe.id);
  activeRecipe = recipe;
  renderRating(recipe);
  $('recipeDialog').showModal();
}

function saveLocalRecipes(items){
  const current = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]');
  const byId = new Map(current.map(item => [item.id, item]));
  items.forEach(item => item?.id && byId.set(item.id, item));
  localStorage.setItem(LOCAL_KEY, JSON.stringify([...byId.values()]));
}

function downloadFile(filename, text, type){
  const blob = new Blob([text], {type});
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvEscape(value){
  const text = Array.isArray(value) ? value.join('|') : String(value ?? '');
  return `"${text.replaceAll('"','""')}"`;
}

$('closeDialogBtn').onclick = () => {
  $('pdfViewer').src = 'about:blank';
  $('recipeDialog').close();
};
$('recipeDialog').addEventListener('click', event => {
  if(event.target === $('recipeDialog')) $('closeDialogBtn').click();
});

$('searchInput').addEventListener('input', render);
$('favoritesOnly').addEventListener('change', render);
$('sortSelect').addEventListener('change', render);
$('clearFiltersBtn').onclick = () => {
  $('searchInput').value = '';
  $('favoritesOnly').checked = false;
  document.querySelectorAll('[data-filter]').forEach(x => x.checked = false);
  render();
};

$('addRecipeBtn').onclick = () => {
  if(config.googleFormUrl){
    window.open(config.googleFormUrl, '_blank', 'noopener');
  }else{
    $('addDialog').showModal();
  }
};
$('closeAddBtn').onclick = () => $('addDialog').close();

document.querySelectorAll('.tab').forEach(button => {
  button.onclick = () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(x => x.classList.remove('active'));
    button.classList.add('active');
    $(button.dataset.tab === 'single' ? 'singleAddForm' : 'bulkAddForm').classList.add('active');
  };
});

$('singleAddForm').onsubmit = event => {
  event.preventDefault();
  const recipe = extractFromUrl($('recipeUrlInput').value);
  if(!recipe) return alert('That does not look like a HelloFresh recipe URL.');
  if($('proteinInput').value !== 'Auto-detect') recipe.protein = $('proteinInput').value;
  if($('typeInput').value !== 'Auto-detect') recipe.type = $('typeInput').value;
  recipe.tags = normalizeTags($('tagsInput').value);
  saveLocalRecipes([recipe]);
  $('singleAddForm').reset();
  $('addDialog').close();
  loadRecipes();
};

$('bulkAddForm').onsubmit = event => {
  event.preventDefault();
  const lines = $('bulkUrlsInput').value.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const parsed = lines.map(extractFromUrl).filter(Boolean);
  saveLocalRecipes(parsed);
  $('bulkResult').textContent = `Imported ${parsed.length} of ${lines.length} lines.`;
  $('bulkUrlsInput').value = '';
  loadRecipes();
};

$('manageBtn').onclick = () => {
  $('sheetUrlInput').value = config.sheetCsvUrl || '';
  $('formUrlInput').value = config.googleFormUrl || '';
  $('manageDialog').showModal();
};
$('closeManageBtn').onclick = () => $('manageDialog').close();

$('saveSharedSettingsBtn').onclick = () => {
  sharedSettings = {
    sheetCsvUrl: $('sheetUrlInput').value.trim(),
    googleFormUrl: $('formUrlInput').value.trim()
  };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(sharedSettings));
  config = {...baseConfig, ...sharedSettings};
  $('manageDialog').close();
  loadRecipes();
};

$('exportJsonBtn').onclick = () => {
  const backup = {
    exportedAt: new Date().toISOString(),
    recipes: JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'),
    favorites: [...favorites],
    settings: sharedSettings
  };
  downloadFile('recipe-vault-backup.json', JSON.stringify(backup, null, 2), 'application/json');
};

$('exportCsvBtn').onclick = () => {
  const headers = ['name','url','id','protein','type','tags','time','rating','favorite','notes','added'];
  const rows = [headers.join(',')].concat(
    recipes.map(recipe => headers.map(header => csvEscape(recipe[header])).join(','))
  );
  downloadFile('recipe-vault-recipes.csv', rows.join('\n'), 'text/csv');
};

$('importJsonInput').onchange = async event => {
  const file = event.target.files?.[0];
  if(!file) return;
  try{
    const backup = JSON.parse(await file.text());
    if(Array.isArray(backup.recipes)) localStorage.setItem(LOCAL_KEY, JSON.stringify(backup.recipes));
    if(Array.isArray(backup.favorites)){
      favorites = new Set(backup.favorites);
      localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites]));
    }
    if(backup.settings && typeof backup.settings === 'object'){
      sharedSettings = backup.settings;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(sharedSettings));
      config = {...baseConfig, ...sharedSettings};
    }
    alert('Backup imported.');
    loadRecipes();
  }catch{
    alert('That backup file could not be read.');
  }
};

$('familyEyebrow').textContent = (config.familyName || 'The Glaister Family').toUpperCase();

if('serviceWorker' in navigator){
  navigator.serviceWorker.register('./service-worker.js').catch(() => {});
}

loadRecipes();


const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

function savePlanner(){
  localStorage.setItem(PLANNER_KEY, JSON.stringify(planner));
}

function renderPlanner(){
  const wrap = $('plannerDays');
  wrap.innerHTML = '';
  DAYS.forEach(day => {
    const section = document.createElement('section');
    section.className = 'planner-day';
    const title = document.createElement('h3');
    title.textContent = day;
    section.appendChild(title);

    const items = planner[day] || [];
    if(!items.length){
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'Nothing planned.';
      section.appendChild(empty);
    } else {
      items.forEach((item, index) => {
        const row = document.createElement('div');
        row.className = 'planner-item';
        const name = document.createElement('span');
        name.textContent = item.name;
        const remove = document.createElement('button');
        remove.textContent = 'Remove';
        remove.onclick = () => {
          planner[day].splice(index,1);
          savePlanner();
          renderPlanner();
        };
        row.append(name, remove);
        section.appendChild(row);
      });
    }
    wrap.appendChild(section);
  });
}

$('plannerBtn').onclick = () => {
  renderPlanner();
  $('plannerDialog').showModal();
};
$('closePlannerBtn').onclick = () => $('plannerDialog').close();

$('addToPlannerBtn').onclick = () => {
  if(!activeRecipe) return;
  const day = prompt(`Add "${activeRecipe.name}" to which day?\n\n${DAYS.join(', ')}`);
  if(!day) return;
  const matched = DAYS.find(d => d.toLowerCase() === day.trim().toLowerCase());
  if(!matched){
    alert('Please type a weekday, such as Monday.');
    return;
  }
  planner[matched] = planner[matched] || [];
  planner[matched].push({id:activeRecipe.id, name:activeRecipe.name});
  savePlanner();
  alert(`Added to ${matched}.`);
};

$('clearPlannerBtn').onclick = () => {
  planner = {};
  savePlanner();
  renderPlanner();
};

$('exportPlannerBtn').onclick = () => {
  const lines = ['Glaister Family Meal Plan',''];
  DAYS.forEach(day => {
    const names = (planner[day] || []).map(item => item.name);
    lines.push(`${day}: ${names.length ? names.join(', ') : '—'}`);
  });
  downloadFile('weekly-meal-plan.txt', lines.join('\n'), 'text/plain');
};
