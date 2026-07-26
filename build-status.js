(() => {
  const CURRENT = { build: 167, version: "1.6.7", label: "Description and recipe region fix" };
  const style = document.createElement("style");
  style.textContent = `
    #rv-build-badge{position:fixed;top:4px;left:5px;z-index:99999;border:1px solid rgba(70,80,58,.22);background:rgba(250,248,242,.94);color:#30342c;border-radius:999px;padding:4px 8px;font:600 11px/1.2 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.08);cursor:pointer;backdrop-filter:blur(8px)}
    #rv-build-badge[data-state="current"]::before{content:"● ";color:#5f7a4f}
    #rv-build-badge[data-state="checking"]::before{content:"● ";color:#b18a35}
    #rv-build-badge[data-state="update"]::before{content:"● ";color:#b54a3b}
    #rv-build-panel{position:fixed;top:34px;left:6px;z-index:100000;width:min(310px,calc(100vw - 12px));padding:14px;border:1px solid rgba(70,80,58,.2);border-radius:14px;background:#fffdf8;color:#30342c;box-shadow:0 10px 30px rgba(0,0,0,.16);font:14px/1.4 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    #rv-build-panel[hidden]{display:none} #rv-build-panel strong{display:block;margin-bottom:4px} #rv-build-panel p{margin:4px 0;color:#6a6d64} #rv-build-panel button{margin-top:10px;width:100%;border:0;border-radius:10px;padding:9px 12px;background:#667653;color:white;font-weight:700;cursor:pointer}
  `;
  document.head.appendChild(style);

  const badge = document.createElement("button");
  badge.id = "rv-build-badge";
  badge.type = "button";
  badge.dataset.state = "checking";
  badge.textContent = `Build ${CURRENT.build}`;
  badge.title = "Check deployed Recipe Vault version";

  const panel = document.createElement("div");
  panel.id = "rv-build-panel";
  panel.hidden = true;
  panel.innerHTML = `<strong>Recipe Vault v${CURRENT.version}</strong><p>Build ${CURRENT.build}</p><p>${CURRENT.label}</p><p id="rv-build-message">Checking deployed version…</p><button type="button" id="rv-refresh-latest">Refresh to latest</button>`;
  document.body.append(badge, panel);

  badge.addEventListener("click", () => { panel.hidden = !panel.hidden; });
  document.getElementById("rv-refresh-latest").addEventListener("click", () => {
    const url = new URL(location.href);
    url.searchParams.set("rv_build", Date.now());
    location.replace(url.toString());
  });

  async function check(){
    const msg = document.getElementById("rv-build-message");
    try{
      const res = await fetch(`build.json?check=${Date.now()}`, { cache: "no-store" });
      if(!res.ok) throw new Error("Version file unavailable");
      const live = await res.json();
      if(Number(live.build) > CURRENT.build){
        badge.dataset.state = "update";
        badge.textContent = `Update ready · ${live.build}`;
        msg.textContent = `Build ${live.build} is deployed. Refresh to load it.`;
      }else{
        badge.dataset.state = "current";
        badge.textContent = `Build ${CURRENT.build}`;
        msg.textContent = "This page is running the latest deployed build.";
      }
    }catch{
      badge.dataset.state = "checking";
      msg.textContent = "Could not verify deployment yet. Try again in a moment.";
    }
  }
  check();
  setInterval(check, 30000);
})();
