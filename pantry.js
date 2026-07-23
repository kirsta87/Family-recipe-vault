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
function splitSpeech(text){
  let cleaned=String(text||"")
    .replace(/[.!?]+/g,"\n")
    .replace(/\b(?:and then|then|also|plus|as well as)\b/gi,"\n")
    .replace(/\b(?:but|oh|actually)\s+(?=(?:we(?:'|’)re|we are|i|there(?:'|’)s|there is))/gi,"\n")
    .replace(/\b(?:and)\s+(?=(?:i\s+(?:bought|have|got|threw|tossed|finished)|we\s+(?:bought|have|got|are)|we(?:'|’)re|throw|toss|remove|delete|out of|no more|still have|half|quarter|one|two|three|four|five|six|seven|eight|nine|ten|\d|an?\s|unopened|open|frozen|some|most|a bag|a jar|a carton|a tub|a bottle|a can|a box|a block|a bunch))/gi,"\n");
  return cleaned.split(/\n|,|;/).map(x=>x.trim()).filter(Boolean);
}
function wordNumber(value){ const map={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,a:1,an:1}; return map[String(value).toLowerCase()]; }
function parsePhrase(phrase){
  let text=phrase.trim()
    .replace(/^hey\s+vault[,\s]*/i,"")
    .replace(/^(?:today|costco run today|grocery run today)[,:\s-]*/i,"")
    .replace(/^i\s+(?:still\s+)?(?:have|got|bought|picked up)\s+/i,"")
    .replace(/^we\s+(?:still\s+)?(?:have|got|bought|picked up)\s+/i,"")
    .replace(/^there(?:'|’)s\s+/i,"")
    .replace(/^there is\s+/i,"");

  const remove=/^(?:throw|toss|remove|delete|used up|finished|out of|no more|we(?:'|’)re out of|we are out of)\s+(?:out\s+)?(?:the\s+)?/i.test(text) || /\b(?:threw|tossed)\s+(?:away\s+)?(?:the\s+)?/i.test(text);
  text=text
    .replace(/^(?:throw|toss|remove|delete|used up|finished|out of|no more|we(?:'|’)re out of|we are out of)\s+(?:out\s+)?(?:the\s+)?/i,"")
    .replace(/^(?:i\s+)?(?:threw|tossed)\s+(?:away\s+)?(?:the\s+)?/i,"")
    .replace(/\s+(?:is\s+)?gone$/i,"");

  const clearlyOpen=/\b(?:opened|open|in use|left|remaining|half|quarter|three quarters|mostly gone|almost empty|nearly empty|partly used|partial)\b/i.test(text);
  let status=/\bfrozen\b/i.test(text)?"frozen":/\buse soon\b/i.test(text)?"use-soon":clearlyOpen?"open":"unopened";
  text=text.replace(/\b(?:unopened|new|sealed|opened|open|in use|frozen|use soon)\b/gi,"").trim();

  let amount="", unit="";
  const fraction=text.match(/^(half|a half|quarter|a quarter|three quarters|most|almost full|mostly full|almost empty|nearly empty|a little|some)\s+(?:of\s+)?(?:an?\s+)?/i);
  if(fraction){ amount=fraction[1].toLowerCase().replace(/^a\s+/,""); text=text.slice(fraction[0].length); status="open"; }
  const qty=text.match(/^(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|a|an|couple|a couple)\s+/i);
  if(!amount && qty){ amount=/couple/i.test(qty[1])?"2":String(wordNumber(qty[1]) ?? qty[1]); text=text.slice(qty[0].length); }
  const unitMatch=text.match(/^(cartons?|jars?|cans?|bags?|boxes?|bottles?|tubs?|containers?|packs?|packages?|blocks?|bunches?|cups?|ounces?|oz|pounds?|lbs?|pieces?|slices?)\s+(?:of\s+)?/i);
  if(unitMatch){ unit=unitMatch[1].replace(/s$/i,""); text=text.slice(unitMatch[0].length); }
  const name=normalizeName(text.replace(/^(?:of\s+|the\s+)/i,"").replace(/\s+(?:left|remaining)$/i,"").replace(/\s+(?:though|today)$/i,""));
  if(!name) return null;
  return {id:uid(),action:remove?"remove":"upsert",name:titleCase(name),amount:amount||"1",unit,status,mode:defaultMode(name)};
}
function parseText(){
  reviewUpdates=splitSpeech($("pantrySpeechText").value).map(parsePhrase).filter(Boolean);
  if(!reviewUpdates.length){ $("micStatus").textContent="I couldn't find any items. Try saying each item naturally with “and,” “also,” or a short pause."; return; }
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
render();
})();
