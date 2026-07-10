const SHEET = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
const FAMILY_KEY = "CHANGE-THIS-TO-A-PRIVATE-FAMILY-KEY";

const HEADERS = [
  "name","url","id","source","image","protein","type","cuisine","tags",
  "prep_time","cook_time","total_time","kirsta_rating","tj_rating",
  "torrin_rating","torrin_notes","notes","made_count","hidden","added","last_made"
];

function doGet() {
  return jsonResponse({success:true,message:"Recipe Vault bridge is working."});
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const data = readRequest(e);
    if (data.key !== FAMILY_KEY) return jsonResponse({success:false,error:"Unauthorized"});
    if (data.action === "add") return jsonResponse(addRecipe(data));
    if (data.action === "update") return jsonResponse(updateRecipe(data));
    return jsonResponse({success:false,error:"Unknown action"});
  } catch (error) {
    return jsonResponse({success:false,error:error.message});
  } finally {
    lock.releaseLock();
  }
}

function readRequest(e) {
  if (e.parameter && e.parameter.payload) return JSON.parse(e.parameter.payload);
  return {};
}

function addRecipe(data) {
  verifyHeaders();
  const recipe = data.updates || {};
  if (findRecipeRow(recipe.id, recipe.url)) return {success:false,error:"That recipe is already in the vault."};
  const row = HEADERS.map(h => h === "made_count" ? (recipe[h] ?? 0) :
                                h === "hidden" ? (recipe[h] ?? false) :
                                h === "added" ? (recipe[h] || new Date()) :
                                (recipe[h] ?? ""));
  SHEET.appendRow(row);
  return {success:true};
}

function updateRecipe(data) {
  verifyHeaders();
  const row = findRecipeRow(data.id, data.url);
  if (!row) return {success:false,error:"Recipe not found."};
  const map = getHeaderMap();
  Object.keys(data.updates || {}).forEach(key => {
    if (map[key]) SHEET.getRange(row, map[key]).setValue(data.updates[key]);
  });
  return {success:true};
}

function findRecipeRow(id, url) {
  const lastRow = SHEET.getLastRow();
  if (lastRow < 2) return null;
  const map = getHeaderMap();
  const values = SHEET.getRange(2,1,lastRow-1,SHEET.getLastColumn()).getValues();
  for (let i=0;i<values.length;i++) {
    const rowId = map.id ? String(values[i][map.id-1]) : "";
    const rowUrl = map.url ? String(values[i][map.url-1]) : "";
    if ((id && rowId === String(id)) || (url && rowUrl === String(url))) return i+2;
  }
  return null;
}

function getHeaderMap() {
  const headers = SHEET.getRange(1,1,1,SHEET.getLastColumn()).getValues()[0];
  const map = {};
  headers.forEach((h,i) => map[String(h).trim()] = i+1);
  return map;
}

function verifyHeaders() {
  const actual = SHEET.getRange(1,1,1,HEADERS.length).getValues()[0].map(v => String(v).trim());
  const missing = HEADERS.filter(h => !actual.includes(h));
  if (missing.length) throw new Error("Missing columns: " + missing.join(", "));
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
