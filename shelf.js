(() => {
    const API_URL = "https://dietfantasy-nkw6.vercel.app/api/ext/users"; // new endpoint for AUTO
    const SHELF_ID = "df-shelf-root";
    const SHIM_ID = "df-shelf-shim";
    const WIDTH = 360;

    // Keep-alive observer
    let keepAliveObs = null;
    let keepAliveEnabled = false;

    // Current mode ("auto"|"manual") tracked here too
    let currentMode = "auto";

    async function initialSync() {
        try {
            const openRes = await chrome.runtime.sendMessage({ type: "DF_QUERY_OPEN" });
            const modeRes = await chrome.runtime.sendMessage({ type: "DF_QUERY_MODE" });
            currentMode = (modeRes?.mode === "manual" ? "manual" : "auto");
            sync(!!openRes?.open);
            // Ensure the shelf body reflects the mode we got
            if (openRes?.open) applyMode(currentMode);
        } catch {}
    }

    function sync(open) {
        if (open) {
            ensureShim();
            if (!document.getElementById(SHELF_ID)) mountShelf();
            applyMode(currentMode);
        } else {
            keepAliveEnabled = false;
            if (keepAliveObs) { keepAliveObs.disconnect(); keepAliveObs = null; }
            unmountShelf();
            removeShim();
        }
    }

    // ---- Reflow shim ----
    function ensureShim() {
        if (document.getElementById(SHIM_ID)) return;
        const shim = document.createElement("div");
        shim.id = SHIM_ID;
        shim.style.cssText = `
      all: initial;
      float: right;
      width: ${WIDTH}px;
      min-height: 100vh;
      visibility: hidden;
      pointer-events: none;
    `;
        const target = document.body || document.documentElement;
        target.insertBefore(shim, target.firstChild);
    }
    function removeShim() {
        const shim = document.getElementById(SHIM_ID);
        if (shim) shim.remove();
    }

    // ---- Shelf host ----
    function unmountShelf() {
        const host = document.getElementById(SHELF_ID);
        if (host) host.remove();
    }

    function mountShelf() {
        const host = document.createElement("div");
        host.id = SHELF_ID;
        host.style.all = "initial";
        host.style.position = "fixed";
        host.style.top = "0";
        host.style.right = "0";
        host.style.height = "100vh";
        host.style.width = WIDTH + "px";
        host.style.zIndex = "2147483647";

        const shadow = host.attachShadow({ mode: "open" });

        const style = document.createElement("style");
        style.textContent = `
      :host { all: initial; }
      * { box-sizing: border-box; }
      .panel {
        height: 100vh; display: flex; flex-direction: column;
        background: #0f172a; color: #e5e7eb;
        border-left: 1px solid #1f2937;
        font: 14px/1.3 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      }
      .head { padding: 12px 14px; font-weight: 600; border-bottom: 1px solid #1f2937; }
      .tabs { display:flex; gap:8px; padding: 8px 12px; border-bottom: 1px solid #1f2937; }
      .tab {
        all: unset; cursor: pointer; padding: 6px 10px; border-radius: 8px; 
        background: #1f2937; color: #e5e7eb;
      }
      .tab[aria-selected="true"] { background: #2563eb; }
      .body { display: flex; flex-direction: column; height: calc(100vh - 92px); }
      .list { overflow: auto; padding: 8px 0; }
      .row { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid #111827; }
      .row:hover { background: #111827; }
      .name { letter-spacing: .2px; }
      .pill { width: 18px; height: 18px; display: inline-grid; place-items: center; border-radius: 6px; }
      .dot { width: 12px; height: 12px; border-radius: 999px; background: #3b82f6; display: inline-block; }
      .check { width: 18px; height: 18px; background: #10b981; color: #062a22; border-radius: 6px; display: inline-grid; place-items: center; font-weight: 900; font-size: 12px; }
      .muted { color: #9ca3af; }
      .foot { margin-top: auto; padding: 10px 14px; border-top: 1px solid #1f2937; display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: #9ca3af; }
      button { all: unset; cursor: pointer; padding: 6px 10px; background: #1f2937; border-radius: 8px; color: #e5e7eb; }
      button:hover { background: #334155; }
      .loading, .error { padding: 10px 14px; color: #9ca3af; }
    `;

        const panel = document.createElement("div");
        panel.className = "panel";
        panel.innerHTML = `
      
      <div class="tabs">
        <button class="tab" id="tabAuto" aria-selected="true">Auto</button>
        <button class="tab" id="tabManual" aria-selected="false">Manual</button>
      </div>
      <div id="body" class="body">
        <div class="loading" style="padding:10px 14px;">Loading…</div>
      </div>
    `;

        shadow.appendChild(style);
        shadow.appendChild(panel);
        document.documentElement.appendChild(host);

        // Tab switching
        const tabAuto = shadow.getElementById("tabAuto");
        const tabManual = shadow.getElementById("tabManual");
        tabAuto.addEventListener("click", () => setModeFromShelf("auto"));
        tabManual.addEventListener("click", () => setModeFromShelf("manual"));

        // Keep attached across SPA changes
        keepAliveEnabled = true;
        keepAliveObs = new MutationObserver(() => {
            if (!keepAliveEnabled) return;
            if (!document.getElementById(SHELF_ID)) document.documentElement.appendChild(host);
            if (!document.getElementById(SHIM_ID)) ensureShim();
        });
        keepAliveObs.observe(document.documentElement, { childList: true, subtree: true });
    }

    // Update tabs’ aria-selected
    function reflectTabs(shadow) {
        const tabAuto = shadow.getElementById("tabAuto");
        const tabManual = shadow.getElementById("tabManual");
        if (!tabAuto || !tabManual) return;
        tabAuto.setAttribute("aria-selected", String(currentMode === "auto"));
        tabManual.setAttribute("aria-selected", String(currentMode === "manual"));
    }

    async function setModeFromShelf(mode) {
        currentMode = (mode === "manual") ? "manual" : "auto";
        try { await chrome.runtime.sendMessage({ type: "DF_SET_MODE", mode: currentMode }); } catch {}
        applyMode(currentMode);
    }

    // Load the mode HTML and wire its events
    async function applyMode(mode) {
        const host = document.getElementById(SHELF_ID);
        if (!host) return;
        const shadow = host.shadowRoot;
        reflectTabs(shadow);

        const bodyEl = shadow.getElementById("body");
        if (!bodyEl) return;

        const url = chrome.runtime.getURL(`modes/${mode}.html`);
        try {
            bodyEl.innerHTML = `<div class="loading" style="padding:10px 14px;">Loading ${mode}…</div>`;
            const html = await (await fetch(url)).text();
            bodyEl.innerHTML = html;
        } catch (e) {
            bodyEl.innerHTML = `<div class="error">Failed to load ${mode} mode: ${String(e)}</div>`;
            return;
        }

        // Wire the Close button (exists in both mode files)
        const closeBtn = bodyEl.querySelector("#closeBtn");
        if (closeBtn) {
            closeBtn.addEventListener("click", async () => {
                try { await chrome.runtime.sendMessage({ type: "DF_SET_OPEN", open: false }); } catch {}
                keepAliveEnabled = false;
                if (keepAliveObs) { keepAliveObs.disconnect(); keepAliveObs = null; }
                unmountShelf();
                removeShim();
            });
        }

        // If AUTO: fetch and render users
        if (mode === "auto") {
            renderAutoList(bodyEl);
        }
    }

    async function renderAutoList(bodyEl) {
        const listEl = bodyEl.querySelector("#autoList");
        const countEl = bodyEl.querySelector("#autoCount");
        if (!listEl || !countEl) return;

        try {
            listEl.innerHTML = `<div class="loading">Loading users…</div>`;
            const res = await fetch(API_URL, { credentials: "omit" });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const users = await res.json();

            countEl.textContent = `${users.length} users`;
            listEl.innerHTML = "";
            const frag = document.createDocumentFragment();

            // Visuals: green ✓ if hasSignature true, blue dot otherwise
            users.forEach(u => {
                const row = document.createElement("div");
                row.className = "row";
                const icon = u.hasSignature ? `<span class="check">✓</span>` : `<span class="dot"></span>`;
                const name = (u.name || "").toUpperCase();
                row.innerHTML = `<span class="pill">${icon}</span><span class="name">${name}</span>`;
                frag.appendChild(row);
            });

            listEl.appendChild(frag);
        } catch (err) {
            listEl.innerHTML = `<div class="error">Failed to load: ${String(err)}</div>`;
            if (countEl) countEl.textContent = "";
        }
    }

    // Messages from background
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        if (msg?.type === "DF_SHELF_SYNC") {
            sync(!!msg.open);
            sendResponse?.({ ok: true });
            return true;
        }
        if (msg?.type === "DF_MODE_SYNC") {
            currentMode = msg.mode === "manual" ? "manual" : "auto";
            applyMode(currentMode);
            sendResponse?.({ ok: true });
            return true;
        }
    });

    // Boot & SPA navs
    initialSync();
    ["popstate", "hashchange"].forEach(evt =>
        window.addEventListener(evt, () => initialSync())
    );
})();