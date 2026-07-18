(() => {
"use strict";

const $ = id => document.getElementById(id);
const SETTINGS_KEY = "recipeVaultSettingsV031";
const COLLECTION_OVERRIDE_KEY = "recipeVaultCollectionOverridesV098";
const COLLECTION_OVERRIDE_TTL_MS = 15 * 60 * 1000;
const COMPLETENESS_DISMISS_KEY = "recipeVaultCompletenessDismissalsV145";
const INTELLIGENCE_DISMISS_KEY = "recipeVaultIngredientIntelligenceDismissalsV145";
const CATEGORY_DISMISS_KEY = "recipeVaultCategoryDismissalsV145";
const CUSTOM_CATEGORY_KEY = "recipeVaultCustomCategoryValuesV145";
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
    present:text => /\b(tortillas?|taco shells?|hard shells?|soft shells?)\b/i.test(text),
    ingredient:"8 tortillas",
    reason:"This looks like a taco recipe, but no tortillas or taco shells were found."
  },
  {
    key:"burger-buns",
    matches:recipe => /\b(burgers?|hamburgers?)\b/i.test(`${recipe.name || ""} ${recipe.type || ""}`),
    present:text => /\b(burger buns?|buns?|rolls?)\b/i.test(text),
    ingredient:"4 burger buns",
    reason:"This looks like a burger recipe, but no buns were found."
  },
  {
    key:"slider-buns",
    matches:recipe => /\bsliders?\b/i.test(`${recipe.name || ""} ${recipe.type || ""}`),
    present:text => /\b(slider buns?|hawaiian rolls?|rolls?|buns?)\b/i.test(text),
    ingredient:"12 slider buns",
    reason:"This looks like a slider recipe, but no slider buns or rolls were found."
  },
  {
    key:"quesadilla-tortillas",
    matches:recipe => /\bquesadillas?\b/i.test(`${recipe.name || ""} ${recipe.type || ""}`),
    present:text => /\btortillas?\b/i.test(text),
    ingredient:"8 tortillas",
    reason:"This looks like a quesadilla recipe, but no tortillas were found."
  },
  {
    key:"burrito-tortillas",
    matches:recipe => /\bburritos?\b/i.test(`${recipe.name || ""} ${recipe.type || ""}`),
    present:text => /\btortillas?\b/i.test(text),
    ingredient:"8 large flour tortillas",
    reason:"This looks like a burrito recipe, but no tortillas were found."
  },
  {
    key:"sandwich-bread",
    matches:recipe => /\b(sandwich|sandwiches|grilled cheese)\b/i.test(`${recipe.name || ""} ${recipe.type || ""}`),
    present:text => /\b(bread|rolls?|buns?|croissants?|pitas?)\b/i.test(text),
    ingredient:"8 slices bread",
    reason:"This looks like a sandwich recipe, but no bread or rolls were found."
  },
  {
    key:"french-dip-rolls",
    matches:recipe => /\bfrench dip\b/i.test(`${recipe.name || ""} ${recipe.type || ""}`),
    present:text => /\b(hoagie rolls?|sub rolls?|french rolls?|rolls?|buns?)\b/i.test(text),
    ingredient:"4 hoagie rolls",
    reason:"This looks like a French dip recipe, but no rolls were found."
  },
  {
    key:"nacho-chips",
    matches:recipe => /\bnachos?\b/i.test(`${recipe.name || ""} ${recipe.type || ""}`),
    present:text => /\b(tortilla chips?|corn chips?|chips?)\b/i.test(text),
    ingredient:"1 bag tortilla chips",
    reason:"This looks like a nacho recipe, but no tortilla chips were found."
  },
  {
    key:"pizza-dough",
    matches:recipe => /\bpizzas?\b/i.test(`${recipe.name || ""} ${recipe.type || ""}`),
    present:text => /\b(pizza dough|pizza crust|flatbread|naan)\b/i.test(text),
    ingredient:"1 pizza crust",
    reason:"This looks like a pizza recipe, but no crust or dough was found."
  },
  {
    key:"lasagna-noodles",
    matches:recipe => /\blasagnas?\b/i.test(`${recipe.name || ""} ${recipe.type || ""}`),
    present:text => /\b(lasagna noodles?|lasagne sheets?)\b/i.test(text),
    ingredient:"12 lasagna noodles",
    reason:"This looks like a lasagna recipe, but no lasagna noodles were found."
  },
  {
    key:"alfredo-pasta",
    matches:recipe => /\balfredo\b/i.test(`${recipe.name || ""} ${recipe.type || ""}`),
    present:text => /\b(pasta|fettuccine|linguine|spaghetti|penne|noodles?)\b/i.test(text),
    ingredient:"12 oz pasta",
    reason:"This looks like an Alfredo recipe, but no pasta was found."
  },
  {
    key:"pot-pie-crust",
    matches:recipe => /\bpot pie\b/i.test(`${recipe.name || ""} ${recipe.type || ""}`),
    present:text => /\b(pie crust|puff pastry|biscuits?|crescent rolls?)\b/i.test(text),
    ingredient:"1 refrigerated pie crust",
    reason:"This looks like a pot pie recipe, but no crust or topping was found."
  }
];

const INGREDIENT_STANDARDIZATION_RULES = [
  {key:"evoo", aliases:["evoo"], replacement:"olive oil", reason:"Common abbreviation", confidence:"High"},
  {key:"extra-virgin-olive-oil", aliases:["extra virgin olive oil","extra-virgin olive oil"], replacement:"olive oil", reason:"Standard pantry name", confidence:"High"},
  {key:"confectioners-sugar", aliases:["confectioners sugar","confectioner's sugar","confectioners' sugar","icing sugar"], replacement:"powdered sugar", reason:"Common synonym", confidence:"High"},
  {key:"veggie-stock", aliases:["veggie stock"], replacement:"vegetable stock", reason:"Expands “veggie”; keeps stock as stock", confidence:"High"},
  {key:"veggie-broth", aliases:["veggie broth"], replacement:"vegetable broth", reason:"Expands “veggie”; keeps broth as broth", confidence:"High"},
  {key:"all-purpose-flour", aliases:["all purpose flour","a.p. flour","ap flour"], replacement:"all-purpose flour", reason:"Common spelling or abbreviation", confidence:"High"},
  {key:"garlic-clove-wording", aliases:["clove of garlic"], replacement:"garlic clove", reason:"Equivalent wording", confidence:"High"},
  {key:"garlic-cloves-wording", aliases:["cloves of garlic"], replacement:"garlic cloves", reason:"Equivalent wording", confidence:"High"}
];

const ANIMAL_PROTEIN_PATTERN = /\b(chicken|turkey|pork|bacon|ham|sausage|prosciutto|beef|steak|hamburger|ground beef|roast|shrimp|salmon|fish|tuna|cod|tilapia|crab|lobster|lamb)\b/i;

const CATEGORY_RULES = {
  protein:[
    {value:"Chicken", test:text => /\b(chicken|rotisserie chicken)\b/i.test(text)},
    {value:"Turkey", test:text => /\bturkey\b/i.test(text)},
    {value:"Pork", test:text => /\b(pork|bacon|ham|sausage|prosciutto)\b/i.test(text)},
    {value:"Beef", test:text => /\b(beef|steak|hamburger|ground beef|roast)\b/i.test(text)},
    {value:"Seafood", test:text => /\b(shrimp|salmon|fish|tuna|cod|tilapia|crab|lobster)\b/i.test(text)},
    {value:"Lamb", test:text => /\blamb\b/i.test(text)},
    {value:"Vegetarian", test:text => !ANIMAL_PROTEIN_PATTERN.test(text)}
  ],
  type:[
    {value:"Tacos", test:text => /\btacos?\b/i.test(text)},
    {value:"Burritos", test:text => /\bburritos?\b/i.test(text)},
    {value:"Quesadillas", test:text => /\bquesadillas?\b/i.test(text)},
    {value:"Pasta", test:text => /\b(pasta|spaghetti|fettuccine|linguine|penne|lasagna|alfredo|mac and cheese|noodles)\b/i.test(text)},
    {value:"Soup", test:text => /\b(soup|chowder|bisque)\b/i.test(text)},
    {value:"Stew", test:text => /\bstew\b/i.test(text)},
    {value:"Casserole", test:text => /\b(casserole|bake)\b/i.test(text)},
    {value:"Sandwiches", test:text => /\b(sandwich|burger|slider|french dip|grilled cheese)\b/i.test(text)},
    {value:"Salad", test:text => /\bsalad\b/i.test(text)},
    {value:"Bowls", test:text => /\b(bowl|bowls)\b/i.test(text)},
    {value:"Pizza", test:text => /\bpizzas?\b/i.test(text)},
    {value:"Sheet Pan", test:text => /\bsheet pan\b/i.test(text)},
    {value:"Slow Cooker", test:text => /\b(slow cooker|crockpot|crock pot)\b/i.test(text)}
  ],
  cuisine:[
    {value:"Mexican-inspired", test:text => /\b(taco|burrito|quesadilla|enchilada|salsa|tortilla|fajita|nacho)\b/i.test(text)},
    {value:"Italian-inspired", test:text => /\b(pasta|lasagna|alfredo|parmesan|mozzarella|marinara|pizza|risotto)\b/i.test(text)},
    {value:"Asian-inspired", test:text => /\b(soy sauce|teriyaki|sesame|ginger|ramen|stir fry|fried rice|gochujang)\b/i.test(text)},
    {value:"Mediterranean-inspired", test:text => /\b(feta|tzatziki|pita|hummus|greek|mediterranean)\b/i.test(text)},
    {value:"American", test:text => /\b(burger|slider|meatloaf|mac and cheese|barbecue|bbq|pot pie)\b/i.test(text)}
  ],
  collections:[
    {value:"Meatless Meals", test:(text, recipe) => !ANIMAL_PROTEIN_PATTERN.test(ingredientAndTitleText(recipe))},
    {value:"Crockpot", test:text => /\b(slow cooker|crockpot|crock pot)\b/i.test(text)},
    {value:"Quick Meals", test:(text, recipe) => Number(recipe.total_time || 0) > 0 && Number(recipe.total_time) <= 30},
    {value:"Pasta Night", test:text => /\b(pasta|spaghetti|fettuccine|linguine|penne|lasagna|alfredo|noodles)\b/i.test(text)},
    {value:"Taco Night", test:text => /\b(taco|burrito|quesadilla|enchilada|fajita|nacho)\b/i.test(text)},
    {value:"Soups & Stews", test:text => /\b(soup|stew|chowder|bisque|chili)\b/i.test(text)}
  ]
};


const DEFAULT_CATEGORY_VALUES = {
  protein:["Chicken","Beef","Pork","Turkey","Seafood","Vegetarian","Other"],
  type:["Breakfast","Burgers","Bowls","Casserole","Dessert","Flatbread","Pasta","Pizza","Salad","Sandwiches","Soup","Tacos","Other"],
  cuisine:["American","Asian-inspired","Italian-inspired","Mediterranean-inspired","Mexican-inspired","Other"]
};


function readCustomCategories(){
  try{
    const parsed = JSON.parse(localStorage.getItem(CUSTOM_CATEGORY_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  }catch(error){ return {}; }
}

function rememberCustomCategory(field, value){
  const cleanValue = String(value || "").trim();
  if(!cleanValue) return;
  const stored = readCustomCategories();
  const existing = Array.isArray(stored[field]) ? stored[field] : [];
  stored[field] = unique([...existing, cleanValue]);
  localStorage.setItem(CUSTOM_CATEGORY_KEY, JSON.stringify(stored));
}

function addOptionToVisibleCategorySelects(field, value){
  document.querySelectorAll(`[data-health-category-select="${field}"], [data-category-field="${field}"] [data-category-value-select]`).forEach(select => {
    if([...select.options].some(option => sameCategoryValue(option.value, value))) return;
    const option = new Option(value, value);
    const addNew = select.querySelector('option[value="__new__"]');
    if(addNew) select.insertBefore(option, addNew);
    else select.appendChild(option);
  });
}

function categoryOptions(field, currentValue="", suggestedValue=""){
  return unique([
    ...(DEFAULT_CATEGORY_VALUES[field] || []),
    ...(readCustomCategories()[field] || []),
    ...recipes.map(recipe => String(recipe[field] || "").trim()),
    currentValue,
    suggestedValue
  ]);
}

function categorySelectOptions(field, currentValue="", suggestedValue=""){
  const values = categoryOptions(field, currentValue, suggestedValue);
  return [
    ...values.map(value => `<option value="${escapeHTML(value)}"${sameCategoryValue(value, suggestedValue) ? " selected" : ""}>${escapeHTML(value)}</option>`),
    '<option value="__new__">Add new…</option>'
  ].join("");
}

function selectedHealthCategory(form, field){
  const select = form.querySelector(`[data-health-category-select="${field}"]`);
  const input = form.querySelector(`[data-health-category-new="${field}"]`);
  if(!select) return String(form.elements[field]?.value || "").trim();
  return select.value === "__new__" ? String(input?.value || "").trim() : select.value.trim();
}

function recipePageUrl(recipe){
  return `index.html?recipe=${encodeURIComponent(String(recipe.id || ""))}`;
}

const ISSUE_DEFS = [
  {key:"completeness", label:"Possible missing ingredients", test:r => completenessSuggestions(r).length > 0},
  {key:"intelligence", label:"Ingredient cleanup", test:r => ingredientIntelligenceSuggestions(r).length > 0},
  {key:"categorization", label:"Smart categorization", test:r => categorizationSuggestions(r).length > 0},
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

function readDismissals(storageKey){
  try{
    const parsed = JSON.parse(localStorage.getItem(storageKey) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  }catch(error){ return {}; }
}

function genericSuggestionId(recipe, suggestionKey){
  return `${String(recipe.id || recipe.url || recipe.name || "recipe")}::${suggestionKey}`;
}

function isGenericDismissed(storageKey, recipe, suggestionKey){
  return Boolean(readDismissals(storageKey)[genericSuggestionId(recipe, suggestionKey)]);
}

function dismissGeneric(storageKey, recipe, suggestionKey){
  const dismissed = readDismissals(storageKey);
  dismissed[genericSuggestionId(recipe, suggestionKey)] = Date.now();
  localStorage.setItem(storageKey, JSON.stringify(dismissed));
}

function replaceIngredientAlias(line, alias, replacement){
  let result = String(line);
  const needle = String(alias).toLowerCase();
  if(!needle) return result;

  let searchFrom = 0;
  while(searchFrom < result.length){
    const lower = result.toLowerCase();
    const index = lower.indexOf(needle, searchFrom);
    if(index === -1) break;

    const before = index > 0 ? lower[index - 1] : "";
    const afterIndex = index + needle.length;
    const after = afterIndex < lower.length ? lower[afterIndex] : "";
    const beforeIsWord = /[a-z0-9]/i.test(before);
    const afterIsWord = /[a-z0-9]/i.test(after);

    if(!beforeIsWord && !afterIsWord){
      result = result.slice(0, index) + replacement + result.slice(afterIndex);
      searchFrom = index + replacement.length;
    }else{
      searchFrom = index + needle.length;
    }
  }
  return result;
}

function ingredientComparisonText(value){
  return String(value || "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[.,;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function ingredientIntelligenceSuggestions(recipe){
  const suggestions = [];
  (recipe.ingredients || []).forEach((line, index) => {
    const original = String(line).trim();
    let standardized = original;
    const matchedRules = [];

    INGREDIENT_STANDARDIZATION_RULES.forEach(rule => {
      const before = standardized;
      rule.aliases.forEach(alias => {
        standardized = replaceIngredientAlias(standardized, alias, rule.replacement);
      });
      if(ingredientComparisonText(standardized) !== ingredientComparisonText(before)){
        matchedRules.push(rule);
      }
    });

    standardized = standardized.replace(/\s+/g, " ").trim();
    const meaningfulChange =
      matchedRules.length &&
      ingredientComparisonText(standardized) !== ingredientComparisonText(original);

    if(!meaningfulChange) return;

    const key = `ingredient-${index}-${matchedRules.map(rule => rule.key).join("-")}`;
    if(!isGenericDismissed(INTELLIGENCE_DISMISS_KEY, recipe, key)){
      suggestions.push({
        key,
        index,
        current:original,
        replacement:standardized,
        ruleKeys:matchedRules.map(rule => rule.key),
        reason:matchedRules.map(rule => rule.reason).filter(Boolean).join(" + "),
        confidence:matchedRules.every(rule => rule.confidence === "High") ? "High" : "Review"
      });
    }
  });
  return suggestions;
}

function ingredientAndTitleText(recipe){
  return [
    recipe.name,
    ...(recipe.ingredients || []),
    ...(recipe.instructions || [])
  ].filter(Boolean).join(" ");
}

function recipeCategoryText(recipe){
  return [
    recipe.name,
    recipe.type,
    recipe.cuisine,
    ...(recipe.ingredients || []),
    ...(recipe.instructions || [])
  ].filter(Boolean).join(" ");
}

function categoryDetectionText(field, recipe){
  if(field === "protein") return ingredientAndTitleText(recipe);
  if(field === "type"){
    return [recipe.name, ...(recipe.ingredients || []), ...(recipe.instructions || [])].filter(Boolean).join(" ");
  }
  if(field === "cuisine"){
    return [recipe.name, ...(recipe.ingredients || []), ...(recipe.instructions || [])].filter(Boolean).join(" ");
  }
  return recipeCategoryText(recipe);
}

function suggestedCategoryValue(field, recipe){
  const text = categoryDetectionText(field, recipe);
  const rule = (CATEGORY_RULES[field] || []).find(item => item.test(text, recipe));
  return rule ? rule.value : "";
}

function sameCategoryValue(a, b){
  return normalizedText(a) === normalizedText(b);
}

function categorizationSuggestions(recipe){
  const suggestions = [];
  const fields = [
    {field:"protein", label:"Protein"},
    {field:"type", label:"Meal type"},
    {field:"cuisine", label:"Cuisine"}
  ];

  fields.forEach(item => {
    const current = String(recipe[item.field] || "").trim();
    const value = suggestedCategoryValue(item.field, recipe);
    if(!value || sameCategoryValue(current, value)) return;

    const key = `${item.field}-${normalizedText(current || "missing")}-${normalizedText(value)}`;
    if(!isGenericDismissed(CATEGORY_DISMISS_KEY, recipe, key)){
      suggestions.push({
        key,
        field:item.field,
        label:item.label,
        current,
        value,
        mismatch:Boolean(current)
      });
    }
  });

  const existingCollections = recipe.collections || [];
  (CATEGORY_RULES.collections || []).forEach(rule => {
    if(!rule.test(recipeCategoryText(recipe), recipe) || existingCollections.some(item => sameCategoryValue(item, rule.value))) return;
    const key = `collection-${normalizedText(rule.value)}`;
    if(!isGenericDismissed(CATEGORY_DISMISS_KEY, recipe, key)){
      suggestions.push({
        key,
        field:"collections",
        label:"Collection",
        current:"",
        value:rule.value,
        mismatch:false
      });
    }
  });

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


function allIngredientIntelligenceSuggestions(){
  return recipes.flatMap(recipe =>
    ingredientIntelligenceSuggestions(recipe).map(suggestion => ({recipe, suggestion}))
  );
}

function globalIngredientGroups(){
  const groups = new Map();
  allIngredientIntelligenceSuggestions().forEach(item => {
    const key = item.suggestion.ruleKeys.join("|");
    if(!groups.has(key)){
      groups.set(key, {
        key,
        reason:item.suggestion.reason,
        confidence:item.suggestion.confidence,
        label:item.suggestion.ruleKeys.map(ruleKey => {
          const rule = INGREDIENT_STANDARDIZATION_RULES.find(candidate => candidate.key === ruleKey);
          return rule?.replacement || ruleKey;
        }).join(" + "),
        items:[]
      });
    }
    groups.get(key).items.push(item);
  });
  return [...groups.values()].sort((a,b) => b.items.length - a.items.length);
}

function globalIngredientMarkup(){
  const groups = globalIngredientGroups();
  if(!groups.length){
    return '<div class="health-clear-state compact-clear"><strong>No meaningful ingredient aliases found.</strong><span>Capitalization-only differences are ignored.</span></div>';
  }

  return `
    <div class="global-intelligence-list">
      ${groups.map(group => `
        <details class="global-intelligence-group" data-global-intelligence="${escapeHTML(group.key)}">
          <summary>
            <span>
              <span class="confidence-badge">${escapeHTML(group.confidence)} confidence</span>
              <strong>${escapeHTML(group.label)}</strong>
              <small>${group.items.length} recipe${group.items.length === 1 ? "" : "s"} · ${escapeHTML(group.reason || "Safe alias")}</small>
            </span>
            <span class="review-group-count">Review ${group.items.length}</span>
          </summary>

          <div class="global-review-list">
            ${group.items.map(({recipe, suggestion}, itemIndex) => `
              <article class="global-review-item">
                <label class="global-review-check">
                  <input type="checkbox" data-global-review-checkbox data-recipe-id="${escapeHTML(recipe.id)}" data-suggestion-key="${escapeHTML(suggestion.key)}" checked>
                  <span>Apply this change</span>
                </label>

                <div class="global-review-title-row">
                  <strong>${escapeHTML(recipe.title || "Untitled recipe")}</strong>
                  <a class="secondary compact open-recipe-link" href="${escapeHTML(recipePageUrl(recipe))}" target="_blank" rel="noopener">Open Recipe ↗</a>
                </div>

                <div class="ingredient-change-preview">
                  <div>
                    <small>Current</small>
                    <p>${escapeHTML(suggestion.current)}</p>
                  </div>
                  <div>
                    <small>Suggested</small>
                    <p>${escapeHTML(suggestion.replacement)}</p>
                  </div>
                </div>
              </article>
            `).join("")}
          </div>

          <div class="global-review-actions">
            <button type="button" class="secondary compact" data-select-review="all">Select all</button>
            <button type="button" class="secondary compact" data-select-review="none">Select none</button>
            <button type="button" class="primary compact" data-apply-selected>Apply selected</button>
          </div>
        </details>
      `).join("")}
    </div>`;
}

function renderGlobalIngredientPanel(){
  const panel = $("globalIngredientPanel");
  if(!panel) return;
  const suggestions = allIngredientIntelligenceSuggestions();
  const safeCount = suggestions.filter(item => item.suggestion.confidence === "High").length;
  const reviewCount = suggestions.length - safeCount;

  panel.innerHTML = `
    <div class="section-heading">
      <div>
        <p class="eyebrow">INGREDIENT CLEANUP</p>
        <h2>Review changes by recipe</h2>
      </div>
      <strong>${suggestions.length} suggestion${suggestions.length === 1 ? "" : "s"}</strong>
    </div>

    <div class="ingredient-health-counts">
      <span><strong>${safeCount}</strong> safe</span>
      <span><strong>${reviewCount}</strong> review</span>
      <span><strong>0</strong> risky</span>
    </div>

    <p class="muted global-intelligence-note">
      Every recipe keeps its own quantity and unit. Stock stays stock; broth stays broth.
      Open any recipe before approving it, then apply only the checked changes.
    </p>

    ${globalIngredientMarkup()}
    <p class="import-status" id="globalIngredientStatus" aria-live="polite"></p>`;
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

function intelligenceMarkup(recipe){
  const suggestions = ingredientIntelligenceSuggestions(recipe);
  if(!suggestions.length) return "";
  return `
    <section class="health-smart-panel" aria-label="Ingredient cleanup suggestions">
      <div class="health-smart-heading">
        <strong>Ingredient cleanup</strong>
        <span>${suggestions.length} meaningful suggestion${suggestions.length === 1 ? "" : "s"}</span>
      </div>
      <div class="health-smart-list">
        ${suggestions.map(item => `
          <div class="health-smart-row" data-intelligence-key="${escapeHTML(item.key)}" data-ingredient-index="${item.index}">
            <div>
              <div class="confidence-badge">${escapeHTML(item.confidence)} confidence</div>
              <small>Current</small>
              <p>${escapeHTML(item.current)}</p>
              <small>Standard</small>
              <input type="text" value="${escapeHTML(item.replacement)}" data-intelligence-value>
              <small class="intelligence-reason">${escapeHTML(item.reason || "Safe alias")}</small>
            </div>
            <div class="health-suggestion-actions">
              <a class="secondary compact open-recipe-link" href="${escapeHTML(recipePageUrl(recipe))}" target="_blank" rel="noopener">Open Recipe ↗</a>
              <button type="button" class="primary compact" data-apply-intelligence>Apply</button>
              <button type="button" class="secondary compact" data-dismiss-intelligence>Dismiss</button>
            </div>
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

function categorizationMarkup(recipe){
  const suggestions = categorizationSuggestions(recipe);
  if(!suggestions.length) return "";
  return `
    <section class="health-smart-panel" aria-label="Smart categorization suggestions">
      <div class="health-smart-heading">
        <strong>Smart categorization</strong>
        <span>${suggestions.length} suggestion${suggestions.length === 1 ? "" : "s"}</span>
      </div>
      <div class="health-category-list">
        ${suggestions.map(item => `
          <div class="health-category-row" data-category-key="${escapeHTML(item.key)}" data-category-field="${escapeHTML(item.field)}">
            <div class="health-category-copy">
              <small>${escapeHTML(item.label)}</small>
              ${item.current ? `<p class="health-current-value"><span>Current</span>${escapeHTML(item.current)}</p>` : ""}
              <div class="health-category-choice">
                <label>
                  <span>${item.current ? "Suggested" : "Suggestion"}</span>
                  ${item.field === "collections"
                    ? `<select data-category-value-select>
                        ${allCollections().map(name => `<option value="${escapeHTML(name)}"${sameCategoryValue(name, item.value) ? " selected" : ""}>${escapeHTML(name)}</option>`).join("")}
                        <option value="__new__">Add new…</option>
                      </select>`
                    : `<select data-category-value-select>
                        ${categorySelectOptions(item.field, item.current, item.value)}
                      </select>`
                  }
                </label>
                <div class="health-category-new-row" data-category-new-row hidden>
                  <input type="text" placeholder="New ${escapeHTML(item.label.toLowerCase())}" data-category-new-input>
                  <button type="button" class="secondary compact" data-add-category-option>Add</button>
                </div>
              </div>
            </div>
            <div class="health-suggestion-actions">
              <button type="button" class="primary compact" data-apply-category>Apply</button>
              <button type="button" class="secondary compact" data-dismiss-category>Dismiss</button>
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
        <div class="health-card-title-copy">
          <h3>${escapeHTML(recipe.name || "Untitled recipe")}</h3>
          <a class="health-open-recipe" href="${escapeHTML(recipePageUrl(recipe))}" target="_blank" rel="noopener">Open recipe ↗</a>
          <div class="health-badges">${issues.map(key => `<span>${escapeHTML(ISSUE_DEFS.find(x => x.key === key).label)}</span>`).join("")}</div>
        </div>
      </div>
      <form class="health-edit-form">
        ${completenessMarkup(recipe)}
        ${intelligenceMarkup(recipe)}
        ${categorizationMarkup(recipe)}
        <div class="health-form-grid">
          <label class="field">Protein
            <select name="protein" data-health-category-select="protein">
              ${categorySelectOptions("protein", recipe.protein || "", recipe.protein || "")}
            </select>
            <div class="health-inline-add" hidden>
              <input type="text" data-health-category-new="protein" placeholder="New protein">
              <button type="button" class="secondary compact" data-health-add-category="protein">Add</button>
            </div>
          </label>
          <label class="field">Meal type
            <select name="type" data-health-category-select="type">
              ${categorySelectOptions("type", recipe.type || "", recipe.type || "")}
            </select>
            <div class="health-inline-add" hidden>
              <input type="text" data-health-category-new="type" placeholder="New meal type">
              <button type="button" class="secondary compact" data-health-add-category="type">Add</button>
            </div>
          </label>
          <label class="field">Cuisine
            <select name="cuisine" data-health-category-select="cuisine">
              ${categorySelectOptions("cuisine", recipe.cuisine || "", recipe.cuisine || "")}
            </select>
            <div class="health-inline-add" hidden>
              <input type="text" data-health-category-new="cuisine" placeholder="New cuisine">
              <button type="button" class="secondary compact" data-health-add-category="cuisine">Add</button>
            </div>
          </label>
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

function render(){ renderSummary(); renderGlobalIngredientPanel(); renderResults(); }

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

function collectUpdates(form, recipe){
  const picker = form.querySelector("[data-health-collection-picker]");
  const collections = [...picker.querySelectorAll("[data-health-remove-collection]")].map(chip => chip.dataset.healthRemoveCollection);
  const lines = name => form.elements[name].value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
  return {
    collections,
    updates:{
      protein:selectedHealthCategory(form, "protein"),
      type:selectedHealthCategory(form, "type"),
      cuisine:selectedHealthCategory(form, "cuisine") || String(recipe?.cuisine || ""),
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
  const {collections, updates} = collectUpdates(form, recipe);
  status.textContent = "Saving…";
  status.className = "import-status";
  try{
    ["protein","type","cuisine"].forEach(field => rememberCustomCategory(field, updates[field]));
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

  const addSuggestionOption = event.target.closest("[data-add-category-option]");
  if(addSuggestionOption){
    const row = addSuggestionOption.closest("[data-category-key]");
    const select = row.querySelector("[data-category-value-select]");
    const input = row.querySelector("[data-category-new-input]");
    const value = String(input?.value || "").trim();
    if(!value) return;
    const field = row.dataset.categoryField;
    rememberCustomCategory(field, value);
    addOptionToVisibleCategorySelects(field, value);
    select.value = [...select.options].find(option => sameCategoryValue(option.value, value))?.value || value;
    input.value = "";
    row.querySelector("[data-category-new-row]").hidden = true;
    return;
  }

  const addFormCategory = event.target.closest("[data-health-add-category]");
  if(addFormCategory){
    const form = addFormCategory.closest(".health-edit-form");
    const field = addFormCategory.dataset.healthAddCategory;
    const select = form.querySelector(`[data-health-category-select="${field}"]`);
    const input = form.querySelector(`[data-health-category-new="${field}"]`);
    const value = String(input?.value || "").trim();
    if(!value) return;
    rememberCustomCategory(field, value);
    addOptionToVisibleCategorySelects(field, value);
    select.value = [...select.options].find(option => sameCategoryValue(option.value, value))?.value || value;
    input.value = "";
    input.closest(".health-inline-add").hidden = true;
    return;
  }


  const selectionButton = event.target.closest("[data-select-review]");
  if(selectionButton){
    const groupElement = selectionButton.closest("[data-global-intelligence]");
    const shouldCheck = selectionButton.dataset.selectReview === "all";
    groupElement.querySelectorAll("[data-global-review-checkbox]").forEach(box => box.checked = shouldCheck);
    return;
  }

  const applySelectedButton = event.target.closest("[data-apply-selected]");
  if(applySelectedButton){
    const groupElement = applySelectedButton.closest("[data-global-intelligence]");
    const group = globalIngredientGroups().find(item => item.key === groupElement.dataset.globalIntelligence);
    if(!group) return;

    const selectedKeys = new Set(
      [...groupElement.querySelectorAll("[data-global-review-checkbox]:checked")]
        .map(box => `${box.dataset.recipeId}::${box.dataset.suggestionKey}`)
    );
    const selected = group.items.filter(({recipe, suggestion}) =>
      selectedKeys.has(`${recipe.id}::${suggestion.key}`)
    );

    const status = $("globalIngredientStatus");
    if(!selected.length){
      status.textContent = "Select at least one recipe first.";
      status.className = "import-status error";
      return;
    }

    const ok = window.confirm(`Apply ${selected.length} reviewed ingredient change${selected.length === 1 ? "" : "s"}? Each recipe keeps its own quantity and unit.`);
    if(!ok) return;

    applySelectedButton.disabled = true;
    let saved = 0;
    let failed = 0;

    for(const {recipe, suggestion} of selected){
      const updatedIngredients = [...(recipe.ingredients || [])];
      updatedIngredients[suggestion.index] = suggestion.replacement;
      status.textContent = `Saving ${saved + failed + 1} of ${selected.length}…`;

      try{
        await postVault({
          action:"update",
          id:recipe.id,
          url:recipe.url,
          updates:{ingredients:updatedIngredients}
        });
        recipe.ingredients = updatedIngredients;
        saved++;
      }catch(error){
        failed++;
      }
    }

    status.textContent = failed
      ? `Finished: ${saved} updated, ${failed} could not be saved.`
      : `Finished: ${saved} reviewed change${saved === 1 ? "" : "s"} saved.`;
    status.className = failed ? "import-status error" : "import-status success";
    setTimeout(render, 1000);
    return;
  }

  const intelligenceRow = event.target.closest("[data-intelligence-key]");
  if(intelligenceRow){
    const card = intelligenceRow.closest("[data-health-id]");
    const form = intelligenceRow.closest(".health-edit-form");
    const recipe = recipes.find(item => String(item.id) === card.dataset.healthId);
    const key = intelligenceRow.dataset.intelligenceKey;

    if(event.target.closest("[data-dismiss-intelligence]")){
      dismissGeneric(INTELLIGENCE_DISMISS_KEY, recipe, key);
      render();
      return;
    }

    if(event.target.closest("[data-apply-intelligence]")){
      const index = Number(intelligenceRow.dataset.ingredientIndex);
      const value = intelligenceRow.querySelector("[data-intelligence-value]").value.trim();
      const lines = form.elements.ingredients.value.split(/\r?\n/).map(item => item.trim()).filter(Boolean);
      if(Number.isInteger(index) && lines[index] && value){
        lines[index] = value;
        form.elements.ingredients.value = lines.join("\n");
        intelligenceRow.remove();
        const status = form.querySelector("[data-health-save-status]");
        status.textContent = "Suggestion applied. Click Save fixes to keep it.";
        status.className = "import-status success";
      }
      return;
    }
  }

  const categoryRow = event.target.closest("[data-category-key]");
  if(categoryRow){
    const card = categoryRow.closest("[data-health-id]");
    const form = categoryRow.closest(".health-edit-form");
    const recipe = recipes.find(item => String(item.id) === card.dataset.healthId);
    const key = categoryRow.dataset.categoryKey;
    const field = categoryRow.dataset.categoryField;

    if(event.target.closest("[data-dismiss-category]")){
      dismissGeneric(CATEGORY_DISMISS_KEY, recipe, key);
      render();
      return;
    }

    const apply = event.target.closest("[data-apply-category]");
    if(apply){
      const select = categoryRow.querySelector("[data-category-value-select]");
      const newInput = categoryRow.querySelector("[data-category-new-input]");
      const value = select?.value === "__new__" ? String(newInput?.value || "").trim() : String(select?.value || "").trim();
      if(!value) return;
      if(field === "collections"){
        const picker = form.querySelector("[data-health-collection-picker]");
        const chips = picker.querySelector("[data-health-collection-chips]");
        chips.querySelector(".collection-empty")?.remove();
        if(![...chips.querySelectorAll("[data-health-remove-collection]")].some(chip => chip.dataset.healthRemoveCollection === value)){
          chips.insertAdjacentHTML("beforeend", `<button type="button" class="collection-chip" data-health-remove-collection="${escapeHTML(value)}">${escapeHTML(value)} ×</button>`);
        }
      }else{
        const targetSelect = form.querySelector(`[data-health-category-select="${field}"]`);
        if(targetSelect){
          if(![...targetSelect.options].some(option => sameCategoryValue(option.value, value))){
            const option = new Option(value, value);
            targetSelect.insertBefore(option, targetSelect.querySelector('option[value="__new__"]'));
          }
          targetSelect.value = [...targetSelect.options].find(option => sameCategoryValue(option.value, value))?.value || value;
        }
      }
      categoryRow.remove();
      const status = form.querySelector("[data-health-save-status]");
      status.textContent = "Suggestion applied. Click Save fixes to keep it.";
      status.className = "import-status success";
      return;
    }
  }

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
  const suggestionSelect = event.target.closest("[data-category-value-select]");
  if(suggestionSelect){
    const row = suggestionSelect.closest("[data-category-key]");
    const addRow = row.querySelector("[data-category-new-row]");
    addRow.hidden = suggestionSelect.value !== "__new__";
    if(!addRow.hidden) addRow.querySelector("input")?.focus();
    return;
  }

  const healthCategorySelect = event.target.closest("[data-health-category-select]");
  if(healthCategorySelect){
    const addRow = healthCategorySelect.closest(".field").querySelector(".health-inline-add");
    addRow.hidden = healthCategorySelect.value !== "__new__";
    if(!addRow.hidden) addRow.querySelector("input")?.focus();
    return;
  }

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