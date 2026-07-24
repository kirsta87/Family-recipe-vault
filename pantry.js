(() => {
"use strict";
const $ = id => document.getElementById(id);
const PANTRY_KEY = "recipeVaultPantryV130";
const CHECKIN_KEY = "recipeVaultPantryCheckinV130";
let pantry = readPantry();
let reviewUpdates = [];

window.addEventListener("error", event => { const box=$("fatalError"); box.hidden=false; box.textContent=`Pantry error: ${event.message}`; });
function escapeHTML(value){ return String(value ?? "").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"})[c]); }
function slug(value){ return String(value||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim(); }
function readPantry(){ try{ const data=JSON.parse(localStorage.getItem(PANTRY_KEY)||"[]"); return Array.isArray(data)?data:[]; }catch(e){ return []; } }
function savePantry(){ localStorage.setItem(PANTRY_KEY,JSON.stringify(pantry)); localStorage.setItem(CHECKIN_KEY,new Date().toISOString()); render(); }
function uid(){ return `pantry-${Date.now()}-${Math.random().toString(36).slice(2,8)}`; }
function titleCase(value){ return String(value||"").trim().replace(/\b\w/g,c=>c.toUpperCase()); }
function defaultMode(name){ const n=slug(name); if(/salt|pepper|flour|sugar|oil|seasoning|spice|rice/.test(n)) return "staple"; if(/sauce|broth|stock|pasta|beans|tomato|rotel|soup|tortilla/.test(n)) return "stocked"; return "perishable"; }
function normalizeName(name){ return String(name||"").replace(/^(?:some|the|about|roughly|approximately)\s+/i,"").replace(/\s+/g," ").trim(); }
const PACKAGE_UNITS = "cartons?|jars?|cans?|bags?|box(?:es)?|bottles?|tubs?|containers?|packs?|packages?|blocks?|bunch(?:es)?|heads?|loaf|loaves|cups?|ounces?|oz|pounds?|lbs?|pieces?|slices?|trays?|tubes?|rolls?|dozens?";
const NUMBER_WORDS = "one|two|three|four|five|six|seven|eight|nine|ten|a|an|couple|a couple";
const FRACTION_WORDS = "half|a half|quarter|a quarter|three quarters|most|almost full|mostly full|almost empty|nearly empty|a little|some";
const ACTION_MARKER = /\b(i\s+(?:bought|picked up|got|have|still have|threw away|tossed|finished|used up|used)|we\s+(?:bought|picked up|got|have|still have|are out of|used)|we(?:'|’)re\s+out\s+of|there(?:'|’)s|there\s+is|out\s+of|no\s+more|threw\s+away|throw\s+away|picked\s+up|used\s+up|bought|grabbed|got|tossed|finished|toss|remove|delete|used)\b/gi;
const COMMON_ITEMS = [
  "heavy cream","sour cream","cream cheese","cheddar cheese","mozzarella cheese","parmesan cheese","black beans","kidney beans","pinto beans","refried beans","green beans","chicken broth","beef broth","vegetable broth","chicken stock","beef stock","vegetable stock","pasta sauce","tomato sauce","tomato paste","diced tomatoes","crushed tomatoes","coconut milk","evaporated milk","condensed milk","olive oil","vegetable oil","brown sugar","powdered sugar","all purpose flour","bread flour","corn starch","baking soda","baking powder","peanut butter","maple syrup","soy sauce","hot sauce","worcestershire sauce","bbq sauce","ranch dressing","poppyseed dressing","taco seasoning","italian seasoning","baby spinach","romaine lettuce","iceberg lettuce","green onions","yellow onions","red onions","bell peppers","black pepper","garlic powder","onion powder",
  "cilantro","tortillas","spinach","lettuce","broccoli","cauliflower","carrots","celery","onions","garlic","potatoes","tomatoes","avocado","avocados","limes","lemons","apples","bananas","berries","strawberries","blueberries","raspberries","grapes","watermelon","milk","butter","eggs","yogurt","cheese","mozzarella","parmesan","cheddar","rice","pasta","flour","sugar","salt","pepper","beans","corn","salsa","bread","buns","crackers","cereal","oats","chicken","beef","pork","turkey","bacon","sausage"
].sort((a,b)=>b.split(" ").length-a.split(" ").length);

function cleanLeadIn(text){
  return String(text||"")
    .replace(/^hey\s+vault[,\s]*/i,"")
    .replace(/^(?:today|costco run today|grocery run today)[,:\s-]*/i,"")
    .trim();
}
function actionForMarker(marker){
  return /out\s+of|no\s+more|threw\s+away|tossed|finished|used(?:\s+up)?|throw\s+away|remove|delete/i.test(marker||"") ? "remove" : "upsert";
}
function splitActionEvents(text){
  const cleaned=cleanLeadIn(text).replace(/[.!?;]+/g,"\n").replace(/\s+/g," ").trim();
  if(!cleaned) return [];
  const events=[];
  let currentAction="upsert", cursor=0, match;
  ACTION_MARKER.lastIndex=0;
  while((match=ACTION_MARKER.exec(cleaned))){
    const before=cleaned.slice(cursor,match.index).replace(/^[,\s]+|[,\s]+$/g,"").replace(/(?:\s+|^)(?:and|also|plus|then)$/i,"").trim();
    if(before) events.push({action:currentAction,text:before});
    currentAction=actionForMarker(match[0]);
    cursor=ACTION_MARKER.lastIndex;
  }
  const tail=cleaned.slice(cursor).replace(/^[,\s]+|[,\s]+$/g,"").replace(/^(?:and|also|plus|then)\s+/i,"").trim();
  if(tail) events.push({action:currentAction,text:tail});
  return events.length?events:[{action:"upsert",text:cleaned}];
}
function hasStructuredStart(text){
  const pattern=new RegExp(`^(?:${FRACTION_WORDS}|\\d+(?:\\.\\d+)?|${NUMBER_WORDS})\\s+(?:(?:of\\s+)?(?:a|an)\\s+)?(?:${PACKAGE_UNITS})\\b`,"i");
  return pattern.test(text.trim());
}
function splitKnownPrefix(text){
  let rest=text.trim(), out=[];
  while(rest && !hasStructuredStart(rest)){
    const normalized=slug(rest);
    let found=null;
    for(const item of COMMON_ITEMS){
      if(normalized===item || normalized.startsWith(item+" ")){ found=item; break; }
    }
    if(!found) break;
    out.push(found);
    rest=rest.slice(found.length).trim();
  }
  return {items:out,rest};
}
function splitByStructuredStarts(text){
  const startPattern=new RegExp(`(?:^|\\s)(?:${FRACTION_WORDS}|\\d+(?:\\.\\d+)?|${NUMBER_WORDS})\\s+(?:(?:of\\s+)?(?:a|an)\\s+)?(?:${PACKAGE_UNITS})\\b`,"gi");
  const starts=[]; let match;
  while((match=startPattern.exec(text))){ starts.push(match.index+(match[0].match(/^\\s/) ? 1 : 0)); }
  if(!starts.length) return [text.trim()];
  if(starts.length===1 && starts[0]===0) return [text.trim()];
  const out=[];
  if(starts[0]>0) out.push(text.slice(0,starts[0]).trim());
  for(let i=0;i<starts.length;i++) out.push(text.slice(starts[i],starts[i+1]??text.length).trim());
  return out.filter(Boolean);
}
function splitStructuredKnownTail(part){
  const prefixMatch=part.match(new RegExp(`^((?:${FRACTION_WORDS}|\\d+(?:\\.\\d+)?|${NUMBER_WORDS})\\s+(?:(?:of\\s+)?(?:a|an)\\s+)?(?:${PACKAGE_UNITS})\\s+(?:of\\s+)?)`,"i"));
  if(!prefixMatch) return [part];
  const prefix=prefixMatch[1], tail=part.slice(prefix.length).trim();
  const known=splitKnownPrefix(tail);
  if(!known.items.length) return [part];
  const first=prefix+known.items[0];
  const rest=[...known.items.slice(1)];
  if(known.rest) rest.push(known.rest);
  return [first,...rest];
}
function splitEventItems(event){
  let text=event.text.replace(/\s+/g," ").trim();
  if(!text) return [];
  const explicit=text.split(/\s*(?:\n|,|;)\s*/).filter(Boolean);
  const pieces=[];
  for(const chunkRaw of explicit){
    let chunk=chunkRaw.trim().replace(/^(?:and|also|plus|then)\s+/i,"");
    const conjunctionStart=new RegExp(`\\s+(?:and|also|plus|then)\\s+(?=(?:${FRACTION_WORDS}|\\d+(?:\\.\\d+)?|${NUMBER_WORDS})\\s+(?:(?:of\\s+)?(?:a|an)\\s+)?(?:${PACKAGE_UNITS})\\b)`,"gi");
    chunk=chunk.replace(conjunctionStart," ");
    for(const structuredPart of splitByStructuredStarts(chunk)){
      const prefix=splitKnownPrefix(structuredPart);
      pieces.push(...prefix.items);
      if(prefix.rest) pieces.push(...splitStructuredKnownTail(prefix.rest));
    }
  }
  return pieces.map(text=>({action:event.action,text}));
}
function wordNumber(value){ const map={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,a:1,an:1}; return map[String(value).toLowerCase()]; }
function parsePhrase(input){
  const event=typeof input==="string"?{action:"upsert",text:input}:input;
  let text=String(event.text||"").trim()
    .replace(/^(?:and|also|plus|then)\s+/i,"")
    .replace(/^(?:the\s+)/i,"");
  const remove=event.action==="remove";
  const clearlyOpen=/\b(?:opened|open|in use|left|remaining|half|quarter|three quarters|mostly gone|almost empty|nearly empty|partly used|partial)\b/i.test(text);
  let status=/\bfrozen\b/i.test(text)?"frozen":/\buse soon\b/i.test(text)?"use-soon":clearlyOpen?"open":"unopened";
  text=text.replace(/\b(?:unopened|new|sealed|opened|open|in use|frozen|use soon)\b/gi,"").trim();

  let amount="", unit="";
  const fraction=text.match(new RegExp(`^(${FRACTION_WORDS})\\s+(?:of\\s+)?(?:an?\\s+)?`,"i"));
  if(fraction){ amount=fraction[1].toLowerCase().replace(/^a\s+/,""); text=text.slice(fraction[0].length); status="open"; }
  const qty=text.match(new RegExp(`^(\\d+(?:\\.\\d+)?|${NUMBER_WORDS})\\s+`,"i"));
  if(!amount && qty){ amount=/couple/i.test(qty[1])?"2":String(wordNumber(qty[1]) ?? qty[1]); text=text.slice(qty[0].length); }
  const unitMatch=text.match(new RegExp(`^(${PACKAGE_UNITS})\\s+(?:of\\s+)?`,"i"));
  if(unitMatch){ unit=unitMatch[1].replace(/(?:es|s)$/i,m=>/ss$/i.test(unitMatch[1])?m:""); text=text.slice(unitMatch[0].length); }
  const name=normalizeName(text.replace(/^(?:of\s+|the\s+)/i,"").replace(/\s+(?:left|remaining)$/i,"").replace(/\s+(?:though|today)$/i,""));
  if(!name) return null;
  return {id:uid(),action:remove?"remove":"upsert",name:titleCase(name),amount:amount||"1",unit,status,mode:defaultMode(name)};
}
function parsePantryInput(text){
  return splitActionEvents(text).flatMap(splitEventItems).map(parsePhrase).filter(Boolean);
}
function parseText(){
  reviewUpdates=parsePantryInput($("pantrySpeechText").value);
  if(!reviewUpdates.length){ $("micStatus").textContent="I couldn't find any items. Try naming the items naturally. Quantities, package words, and phrases like “we’re out of” help separate them."; return; }
  $("pantryReview").hidden=false;
  renderReview();
}
function renderReview(){
  $("pantryReviewRows").innerHTML=reviewUpdates.map((item,index)=>`<div class="pantry-review-row" data-review-index="${index}">
    <label class="check"><input type="checkbox" data-review-include checked> Include</label>
    <input data-review-name value="${escapeHTML(item.name)}" aria-label="Item name">
    <input data-review-amount value="${escapeHTML(item.amount)}" aria-label="Amount">
    <input data-review-unit value="${escapeHTML(item.unit)}" aria-label="Unit">
    <select data-review-action aria-label="Update action"><option value="upsert" ${item.action==="upsert"?"selected":""}>Add / update</option><option value="remove" ${item.action==="remove"?"selected":""}>Remove</option></select>
  </div>`).join("");
}
function applyReview(){
  document.querySelectorAll("[data-review-index]").forEach(row=>{
    if(!row.querySelector("[data-review-include]").checked) return;
    const index=Number(row.dataset.reviewIndex), original=reviewUpdates[index];
    const name=normalizeName(row.querySelector("[data-review-name]").value), key=slug(name), action=row.querySelector("[data-review-action]").value;
    if(!name) return;
    const existing=pantry.find(item=>slug(item.name)===key);
    if(action==="remove"){ pantry=pantry.filter(item=>slug(item.name)!==key); return; }
    const next={...(existing||{}),id:existing?.id||uid(),name:titleCase(name),amount:row.querySelector("[data-review-amount]").value.trim()||"1",unit:row.querySelector("[data-review-unit]").value.trim(),status:original.status||existing?.status||"unopened",mode:existing?.mode||original.mode||defaultMode(name),updatedAt:new Date().toISOString()};
    if(existing) Object.assign(existing,next); else pantry.push(next);
  });
  $("pantrySpeechText").value=""; $("pantryReview").hidden=true; reviewUpdates=[]; savePantry(); $("micStatus").textContent="Pantry updated.";
}
function modeLabel(mode){ return mode==="stocked"?"Keep stocked":mode==="staple"?"Pantry staple":"Use it up"; }
function render(){
  const query=slug($("pantrySearch")?.value), mode=$("pantryModeFilter")?.value||"";
  const visible=pantry.filter(item=>(!query||slug(item.name).includes(query))&&(!mode||item.mode===mode)).sort((a,b)=>String(a.name).localeCompare(String(b.name)));
  const useSoon=pantry.filter(x=>x.status==="use-soon"||x.mode==="perishable").length;
  $("pantrySummary").innerHTML=`<span><strong>${pantry.length}</strong> items tracked</span><span><strong>${useSoon}</strong> use-it-up items</span><span><strong>${pantry.filter(x=>x.mode==="stocked").length}</strong> kept stocked</span>`;
  $("pantryItems").innerHTML=visible.length?visible.map(item=>`<article class="pantry-item-card" data-edit-pantry="${escapeHTML(item.id)}">
    <div><h3>${escapeHTML(item.name)}</h3><p>${escapeHTML([item.amount,item.unit,item.status==="unopened"?"unopened":item.status==="frozen"?"frozen":item.status==="use-soon"?"use soon":"open"].filter(Boolean).join(" · "))}</p></div>
    <div class="pantry-item-meta"><span class="pantry-mode-badge">${escapeHTML(modeLabel(item.mode))}</span>${item.mode==="stocked"&&item.targetStock?`<small>Keep ${escapeHTML(item.targetStock)} on hand</small>`:""}${item.packageSize?`<small>${escapeHTML(item.packageSize)} ${escapeHTML(item.packageUnit||"")} package</small>`:""}</div>
    <button class="secondary" type="button">Edit</button>
  </article>`).join(""):'<p class="muted">No pantry items match this view.</p>';
  document.querySelectorAll("[data-edit-pantry]").forEach(card=>card.addEventListener("click",()=>openItem(card.dataset.editPantry)));
  checkReminder();
}
function openItem(id=""){
  const item=pantry.find(x=>x.id===id)||{};
  $("pantryItemDialogTitle").textContent=id?"Edit pantry item":"Add pantry item"; $("pantryItemId").value=id;
  $("pantryItemName").value=item.name||""; $("pantryItemAmount").value=item.amount||""; $("pantryItemUnit").value=item.unit||""; $("pantryItemStatus").value=item.status||"unopened"; $("pantryItemMode").value=item.mode||"perishable"; $("pantryItemTarget").value=item.targetStock||""; $("pantryItemPackageSize").value=item.packageSize||""; $("pantryItemPackageUnit").value=item.packageUnit||""; $("pantryItemStore").value=item.store||""; $("pantryItemBrand").value=item.brand||""; $("pantryItemNotes").value=item.notes||""; $("deletePantryItem").hidden=!id; $("pantryItemDialog").showModal();
}
function saveItem(event){ event.preventDefault(); const id=$("pantryItemId").value, existing=pantry.find(x=>x.id===id); const item={id:id||uid(),name:titleCase($("pantryItemName").value),amount:$("pantryItemAmount").value.trim(),unit:$("pantryItemUnit").value.trim(),status:$("pantryItemStatus").value,mode:$("pantryItemMode").value,targetStock:$("pantryItemTarget").value,packageSize:$("pantryItemPackageSize").value,packageUnit:$("pantryItemPackageUnit").value.trim(),store:$("pantryItemStore").value.trim(),brand:$("pantryItemBrand").value.trim(),notes:$("pantryItemNotes").value.trim(),updatedAt:new Date().toISOString()}; if(existing) Object.assign(existing,item); else pantry.push(item); savePantry(); $("pantryItemDialog").close(); }
function checkReminder(){ const last=Date.parse(localStorage.getItem(CHECKIN_KEY)||""); $("pantryReminder").hidden=Number.isFinite(last)&&Date.now()-last<30*86400000; }
let recognition=null;
function startMic(){
  const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SpeechRecognition){ $("micStatus").textContent="Microphone dictation isn't supported in this browser. The big text box still works perfectly."; return; }
  if(recognition){ recognition.stop(); return; }
  recognition=new SpeechRecognition(); recognition.continuous=true; recognition.interimResults=true; recognition.lang="en-US";
  const baseText=$("pantrySpeechText").value.trim();
  let committed="";
  recognition.onstart=()=>{ $("pantryMic").textContent="Stop microphone"; $("micStatus").textContent="Listening… talk naturally."; };
  recognition.onresult=event=>{
    let interim="";
    for(let i=event.resultIndex;i<event.results.length;i++){
      const spoken=event.results[i][0].transcript.trim();
      if(event.results[i].isFinal){ committed+=(committed?" ":"")+spoken; }
      else interim=spoken;
    }
    const parts=[baseText,committed,interim].filter(Boolean);
    $("pantrySpeechText").value=parts.join(baseText&&parts.length>1?" ":"");
  };
  recognition.onend=()=>{ recognition=null; $("pantryMic").textContent="Start microphone"; $("micStatus").textContent="Done listening. Review the text, then turn it into a list."; };
  recognition.onerror=e=>{ recognition=null; $("pantryMic").textContent="Start microphone"; $("micStatus").textContent=`Microphone stopped: ${e.error}. You can type instead.`; };
  recognition.start();
}
$("pantryMic").addEventListener("click",startMic); $("parsePantry").addEventListener("click",parseText); $("clearPantryText").addEventListener("click",()=>{$("pantrySpeechText").value="";$("pantryReview").hidden=true;}); $("savePantryReview").addEventListener("click",applyReview); $("pantrySearch").addEventListener("input",render); $("pantryModeFilter").addEventListener("change",render); $("addPantryItem").addEventListener("click",()=>openItem()); $("closePantryItem").addEventListener("click",()=>$("pantryItemDialog").close()); $("pantryItemForm").addEventListener("submit",saveItem); $("deletePantryItem").addEventListener("click",()=>{ pantry=pantry.filter(x=>x.id!==$("pantryItemId").value); savePantry(); $("pantryItemDialog").close(); }); $("dismissReminder").addEventListener("click",()=>{localStorage.setItem(CHECKIN_KEY,new Date().toISOString());checkReminder();});
document.querySelectorAll("dialog").forEach(d=>d.addEventListener("click",e=>{if(e.target===d)d.close();}));
window.__pantryParserTest=parsePantryInput;
render();
})();
