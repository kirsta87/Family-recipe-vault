(() => {
  const script = document.currentScript;
  const scriptUrl = new URL(script?.src || location.href, location.href);
  const metaBuild = Number(document.querySelector('meta[name="recipe-vault-build"]')?.content);
  const CURRENT_BUILD = metaBuild || Number(scriptUrl.searchParams.get("v")) || 181;
  const style = document.createElement("style");
  style.textContent = `
    #rv-build-badge{position:fixed;top:4px;left:5px;z-index:99999;border:1px solid rgba(70,80,58,.22);background:rgba(250,248,242,.96);color:#30342c;border-radius:999px;padding:5px 10px;font:700 12px/1.2 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.08);cursor:pointer;backdrop-filter:blur(8px)}
    #rv-build-badge[data-state="current"]::before{content:"● ";color:#2f8b3a} #rv-build-badge[data-state="checking"]::before{content:"● ";color:#b18a35} #rv-build-badge[data-state="update"]::before{content:"● ";color:#c14d3f} #rv-build-badge[data-state="error"]::before{content:"● ";color:#777}
    #rv-build-panel{position:fixed;top:38px;left:6px;z-index:100000;width:min(330px,calc(100vw - 12px));padding:14px;border:1px solid rgba(70,80,58,.2);border-radius:14px;background:#fffdf8;color:#30342c;box-shadow:0 10px 30px rgba(0,0,0,.16);font:14px/1.4 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    #rv-build-panel[hidden]{display:none} #rv-build-panel strong{display:block;margin-bottom:4px} #rv-build-panel p{margin:5px 0;color:#62665d} #rv-build-panel code{font-size:12px} #rv-build-panel button{margin-top:10px;width:100%;border:0;border-radius:10px;padding:10px 12px;background:#667653;color:white;font-weight:700;cursor:pointer} #rv-build-panel button.secondary{background:#eceee7;color:#394033}
  `;
  document.head.appendChild(style);

  const badge = document.createElement("button");
  badge.id = "rv-build-badge"; badge.type = "button"; badge.dataset.state = "checking";
  badge.textContent = `Checking · ${CURRENT_BUILD}`; badge.title = "Recipe Vault deployment status";
  const panel = document.createElement("div"); panel.id = "rv-build-panel"; panel.hidden = true;
  panel.innerHTML = `<strong id="rv-build-title">Recipe Vault Build ${CURRENT_BUILD}</strong><p id="rv-build-label">Checking deployment…</p><p id="rv-build-message">Verifying the live build and browser cache.</p><p id="rv-engine-info"></p><button type="button" id="rv-refresh-latest">Clear cache & refresh to latest</button><button type="button" class="secondary" id="rv-check-again">Check again</button>`;
  document.body.append(badge, panel);
  let liveBuild = null;

  function engineText(meta={}){
    const engines=window.RECIPE_VAULT_ENGINES||{};
    const cookbook=engines.cookbook||meta.cookbookEngine;
    const parser=engines.parser||meta.parser;
    return [cookbook&&`Cookbook Engine ${cookbook}`, parser].filter(Boolean).join(" · ");
  }
  async function clearAndReload(){
    const msg=document.getElementById("rv-build-message");
    msg.textContent="Clearing old app files…";
    try{
      if("serviceWorker" in navigator){
        const regs=await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r=>r.unregister()));
      }
      if("caches" in window){
        const keys=await caches.keys();
        await Promise.all(keys.filter(k=>k.startsWith("recipe-vault-")).map(k=>caches.delete(k)));
      }
    }catch(err){ console.warn("Recipe Vault cache cleanup:",err); }
    const url=new URL(location.href); url.searchParams.set("rv_build",liveBuild?.build||Date.now());
    location.replace(url.toString());
  }
  badge.addEventListener("click",()=>{panel.hidden=!panel.hidden; if(!panel.hidden) check();});
  document.getElementById("rv-refresh-latest").addEventListener("click",clearAndReload);
  document.getElementById("rv-check-again").addEventListener("click",check);

  async function check(){
    const msg=document.getElementById("rv-build-message"), label=document.getElementById("rv-build-label"), engine=document.getElementById("rv-engine-info");
    badge.dataset.state="checking"; badge.textContent=`Checking · ${CURRENT_BUILD}`;
    try{
      const res=await fetch(`build.json?check=${Date.now()}`,{cache:"no-store",headers:{"Cache-Control":"no-cache"}});
      if(!res.ok) throw new Error("Version file unavailable");
      liveBuild=await res.json(); const deployed=Number(liveBuild.build)||0;
      document.getElementById("rv-build-title").textContent=`Recipe Vault Build ${CURRENT_BUILD}`;
      label.textContent=liveBuild.label||`Deployed build ${deployed}`; engine.textContent=engineText(liveBuild);
      if(deployed>CURRENT_BUILD){
        badge.dataset.state="update"; badge.textContent=`Update ready · ${deployed}`;
        msg.textContent=`This tab is Build ${CURRENT_BUILD}; Build ${deployed} is deployed.`;
      }else if(deployed===CURRENT_BUILD){
        badge.dataset.state="current"; badge.textContent=`Build ${CURRENT_BUILD} · Up to date`;
        msg.textContent="The loaded page matches the latest deployed build.";
      }else{
        badge.dataset.state="checking"; badge.textContent=`Build ${CURRENT_BUILD} · Deploying`;
        msg.textContent=`This tab is Build ${CURRENT_BUILD}, while the deployment currently reports Build ${deployed}.`;
      }
    }catch(err){
      badge.dataset.state="error"; badge.textContent=`Build ${CURRENT_BUILD} · Check failed`;
      msg.textContent="Could not verify the deployment. The site may still be rebuilding."; engine.textContent=engineText();
    }
  }
  check(); setInterval(check,30000);
})();
