(() => {
    const API_URL = "https://dietfantasy-nkw6.vercel.app/api/ext/users";
    const BILLINGS_URL = "https://dietfantasy-nkw6.vercel.app/api/ext/billings";
    const UNITE_URL = (caseId, clientId) =>
        `https://app.uniteus.io/dashboard/cases/open/${encodeURIComponent(caseId)}/contact/${encodeURIComponent(clientId)}`;

    // UniteUs “ready” XPath
    const READY_XP = '//*[@id="container"]/div[2]/main/div/section/div';

    // Timings
    const BILLING_GRACE_MS = 2500;         // short grace after injection
    const VERIFY_TIMEOUT_MS = 15000;       // verify window
    const VERIFY_INTERVAL_MS = 400;        // poll rate

    // ----- DOM -----
    const tabAuto   = document.getElementById("tabAuto");
    const tabManual = document.getElementById("tabManual");
    const autoWrap  = document.getElementById("autoWrap");
    const manualWrap= document.getElementById("manualWrap");

    const listEl      = document.getElementById("list");
    const logEl       = document.getElementById("log");
    const btnClearLog = document.getElementById("btnClearLog");
    const btnErrors   = document.getElementById("btnErrors");
    const btnRefresh  = document.getElementById("btnRefresh");
    const btnStart    = document.getElementById("btnStart");
    const btnPause    = document.getElementById("btnPause");
    const btnStop     = document.getElementById("btnStop");
    const btnClose    = document.getElementById("btnClose");

    const btnUpload = document.getElementById("btnUpload");
    const btnBilling= document.getElementById("btnBilling");
    const inpDeliv  = document.getElementById("inpDeliveryDate");
    const inpStart  = document.getElementById("inpStartDate");
    const inpEnd    = document.getElementById("inpEndDate");
    const inpSearch = document.getElementById("inpSearch");

    const countFoot = document.getElementById("countFoot");

    // ----- State -----
    const MODE_KEY="df_panel_mode", LOG_KEY="df_panel_log", SKIPS_KEY="df_panel_skips",
        OPTS_KEY="df_panel_opts", SEARCH_KEY="df_panel_search", ERRORS_KEY="df_panel_errors_only",
        MANUAL_PARAMS_KEY="df_manual_params";
    let mode=localStorage.getItem(MODE_KEY)||"auto";
    let users=[], filtered=[], perUserState=new Map();
    let q = localStorage.getItem(SEARCH_KEY) || "";
    let errorsOnly = localStorage.getItem(ERRORS_KEY) === "1";

    // Auto-run flags
    let isRunning=false, isPaused=false, stopRequested=false, lockedTabId=null;

    // ----- Helpers -----
    const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
    const stamp=()=>new Date().toLocaleTimeString();
    // const log=(line,obj)=>{ const msg=`[${stamp()}] ${line}${obj?(" "+JSON.stringify(obj)):""}\n`; logEl.textContent+=msg; logEl.scrollTop=logEl.scrollHeight; const c=localStorage.getItem(LOG_KEY)||""; localStorage.setItem(LOG_KEY,c+msg); };
    const log = (line, obj) => {
        const msg = `[${stamp()}] ${line}${obj ? " " + JSON.stringify(obj, null, 2) : ""}\n`;
        logEl.textContent += msg + "\n";
        logEl.scrollTop = logEl.scrollHeight;
        const c = localStorage.getItem(LOG_KEY) || "";
        localStorage.setItem(LOG_KEY, c + msg + "\n");
    };
    const restoreLog=()=>{ const c=localStorage.getItem(LOG_KEY); if(c){ logEl.textContent=c; logEl.scrollTop=logEl.scrollHeight; } };

    const defaultOpts=()=>{ const t=new Date().toISOString().slice(0,10); return { attemptUpload:true, attemptBilling:true, dates:{ delivery:t, start:t, end:t } }; };
    const loadOpts=()=>{ try{ const o=JSON.parse(localStorage.getItem(OPTS_KEY)||""); return o && o.dates ? o : defaultOpts(); } catch{ return defaultOpts(); } };
    const saveOpts=(o)=>localStorage.setItem(OPTS_KEY, JSON.stringify(o));
    const reflectOptsToUI=(o)=>{
        const uploadOn = !!o.attemptUpload;
        const billingOn = !!o.attemptBilling;
        btnUpload.classList.toggle('active', uploadOn);
        btnUpload.dataset.checked = uploadOn;
        btnBilling.classList.toggle('active', billingOn);
        btnBilling.dataset.checked = billingOn;
        inpDeliv.value=o.dates?.delivery||"";
        inpStart.value=o.dates?.start||"";
        inpEnd.value=o.dates?.end||"";
    };
    const readOptsFromUI=()=>{
        const o={
            attemptUpload: btnUpload.dataset.checked === 'true',
            attemptBilling: btnBilling.dataset.checked === 'true',
            dates:{ delivery:inpDeliv.value||"", start:inpStart.value||"", end:inpEnd.value||"" }
        };
        saveOpts(o);
        return o;
    };

    const saveSkips=()=>{ const s={}; users.forEach(u=>{ if(u.skip) s[u.id]=true; }); localStorage.setItem(SKIPS_KEY, JSON.stringify(s)); };
    function restoreSkips() {
        try { const s = JSON.parse(localStorage.getItem(SKIPS_KEY)||"{}"); users.forEach(u => u.skip = !!s[u.id]); } catch {}
    }

    // Read rate per day from manual mode settings (shared app setting)
    const getRatePerDay = () => {
        try {
            const manualParams = JSON.parse(localStorage.getItem(MANUAL_PARAMS_KEY) || "{}");
            const rate = Number(manualParams.ratePerDay);
            return (rate > 0) ? rate : 48; // default to 48 if not set or invalid
        } catch {
            return 48;
        }
    };

    const norm = s => (s||"").toUpperCase().replace(/\s+/g," ").trim();
    const matches = (u, query) => !query || norm(u.name).includes(norm(query));

    const statusIconHtml=(st)=> {
        const base = !st||st.status==="pending" ? 'status pending' :
            st.status==="ok"           ? 'status ok'      :
                st.status==="warn"         ? 'status warn'    : 'status bad';
        const glyph = st?.status==="ok" ? "✓" : st?.status==="warn" ? "!" : st?.status==="bad" ? "✕" : "";
        return `<span class="${base}" role="button" title="Open UniteUs page">${glyph}</span>`;
    };
    const sigPill=(u)=>u.hasSignature?`<span class="pill">S</span>`:"";
    const skipPill=(u)=>u.skip?`<span class="pill">SKIP</span>`:"";
    const subline=(st)=>st&&st.error?st.error:"";

    function reflectTabs(){
        const isAuto=(mode==="auto");
        tabAuto.setAttribute("aria-selected", String(isAuto));
        tabManual.setAttribute("aria-selected", String(!isAuto));
        autoWrap.style.display = isAuto ? "flex" : "none";
        manualWrap.style.display = !isAuto ? "flex" : "none";
    }

    function isError(u) {
        const st = perUserState.get(u.id);
        return u.invalid || (st && (st.status === "bad" || !!st.error));
    }

    function buildFiltered(){
        const valid   = users.filter(u=>!u.invalid);
        const invalid = users.filter(u=>u.invalid);
        const all     = [...valid, ...invalid];
        filtered = all.filter(u => matches(u, q) && (!errorsOnly || isError(u)));
    }

    function renderList(){
        listEl.innerHTML="";
        const frag=document.createDocumentFragment();

        filtered.forEach((u,idx)=>{
            const st=perUserState.get(u.id)||{status:u.invalid?"bad":"pending"};
            const li=document.createElement("div"); li.className="row";
            li.innerHTML=`
        <div class="num">${idx+1}</div>
        ${statusIconHtml(st)}
        <div class="name" title="${u.name||""}">${(u.name||"").toUpperCase()}</div>
        <div class="pills">${sigPill(u)} ${skipPill(u)} ${u.paused?`<span class="pill">PAUSED</span>`:""}</div>
      `;
            const sub=subline(st); if(sub){ const s=document.createElement("div"); s.className="sub"; s.textContent=sub; li.appendChild(s); }

            li.addEventListener("click", async (e) => {
                const url = UNITE_URL(u.caseId, u.clientId);
                const statusEl = e.target.closest('.status');

                // colored icon → SAME TAB (never require lock for manual open)
                if (statusEl && !u.invalid) {
                    await sendBg({ type: "DF_NAVIGATE", url, readyXPath: READY_XP }, { useLock: false });
                    return;
                }
                // Cmd/Ctrl anywhere → new tab
                if (e.metaKey || e.ctrlKey) {
                    if (!u.invalid) chrome.tabs.create({ url });
                    return;
                }
                // Else toggle skip
                if (u.invalid) return;
                u.skip = !u.skip;
                saveSkips(); buildFiltered(); renderList();
            });

            frag.appendChild(li);
        });

        listEl.appendChild(frag);
        countFoot.textContent = `${filtered.length} / ${users.length} users`;
        btnErrors.classList.toggle("active", errorsOnly);
    }

    async function fetchUsers(){
        listEl.innerHTML="<div style='padding:10px 12px;'>Loading…</div>";
        const r=await fetch(API_URL,{credentials:"omit"});
        if(!r.ok) throw new Error(`HTTP ${r.status}`);
        const data=await r.json();

        users = (Array.isArray(data) ? data : []).map(u => {
            let reason = null;
            if (u.paused) reason = "Paused";
            else if (u.bill === false) reason = "Billing disabled";
            else if (!u.caseId && !u.clientId) reason = "Missing link: caseId & clientId";
            else if (!u.caseId) reason = "Missing link: caseId";
            else if (!u.clientId) reason = "Missing link: clientId";
            return { ...u, invalid: !!reason, invalidReason: reason };
        });

        restoreSkips();
        perUserState.clear();

        users.forEach(u => {
            if (u.invalid) perUserState.set(u.id, { status: "bad", error: u.invalidReason });
            else           perUserState.set(u.id, { status: "pending" });
        });

        users.sort((a, b) => (a.invalid?1:0) - (b.invalid?1:0));
        buildFiltered();
        renderList();
        log("Loaded users from server (filtered paused/billing=false).");
    }

    // ----- background messaging (lock-aware) -----
    async function getActiveTabId() {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (!tab?.id) throw new Error("No active tab");
        return tab.id;
    }

    async function sendBg(msg, { useLock = isRunning } = {}) {
        let tabId = null;
        if (useLock && lockedTabId) tabId = lockedTabId;
        else {
            const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
            tabId = tab?.id || null;
        }
        if (!tabId) return { ok:false, error:"No suitable tab to message" };
        return new Promise((resolve) =>
            chrome.runtime.sendMessage({ ...msg, tabId }, resolve)
        );
    }

    // ----- Billing helpers -----
    const toMDY = (iso)=> {
        if (!iso) return "";
        const [y,m,d]=iso.split("-");
        return `${Number(m)}/${Number(d)}/${y}`;
    };

    async function setBillingArgsOnPage({ startISO, endISO, ratePerDay=48, userId }) {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (!tab?.id) throw new Error("No active tab");
        const args = { start: toMDY(startISO), end: toMDY(endISO), ratePerDay: Number(ratePerDay)||48, userId: Number(userId)||null };
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: (incoming)=>{ window.__BILLING_INPUTS__ = incoming; },
            args: [args]
        });
    }

    async function injectBillingModuleIIFE() {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (!tab?.id) throw new Error("No active tab");
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["modules/enterBillingDetails.js"] });
    }

    // DOM-based verify/precheck via background (never assume success)
    function expectFrom(u, opts) {
        const startMDY = toMDY(opts.dates.start);
        const endMDY   = toMDY(opts.dates.end);
        const start = new Date(opts.dates.start);
        const end   = new Date(opts.dates.end);
        const days  = Math.max(1, Math.floor((end - start)/86400000) + 1);
        const ratePerDay = getRatePerDay(); // read from manual mode settings
        const amount = ratePerDay * days;
        return { startMDY, endMDY, amount };
    }

    async function recordBillingSuccess(u, opts, extraMeta = {}) {
        const payload = {
            userId: u.id,
            startDate: opts.dates.start,
            endDate: opts.dates.end,
            source: "auto:panel",
            meta: {
                name: u.name,
                caseId: u.caseId || null,
                clientId: u.clientId || null,
                when: new Date().toISOString(),
                ...extraMeta
            }
        };

        const r = await fetch(BILLINGS_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        const ct = r.headers.get("content-type") || "";
        const body = /application\/json/i.test(ct) ? await r.json() : { ok:false, status:r.status, error:"Unexpected content-type" };

        if (!r.ok || !body?.ok) {
            log("Record billing failed", body || { status: r.status });
            return { ok: false, error: body?.error || `HTTP ${r.status}` };
        }
        log("Recorded billing", { userId: body.userId, total: body.totalBillings });
        return { ok: true };
    }

    // ----- Auto run core -----
    function setRunningUI(running) {
        isRunning = running;
        btnStart.disabled = running;
        btnPause.disabled = !running;
        btnStop.disabled  = !running;
    }

    function mark(u, status, error) {
        const s = perUserState.get(u.id) || {};
        s.status = status;
        s.error = error || "";
        perUserState.set(u.id, s);
        buildFiltered(); renderList();
    }

    async function processUser(u, opts) {
        if (u.invalid) { mark(u, "bad", u.invalidReason || "Invalid"); return; }
        if (u.skip)   { mark(u, "warn", "Skipped by user"); return; }

        const url = UNITE_URL(u.caseId, u.clientId);
        log(`Navigating → ${u.name}`, { url });

        const nav = await sendBg({ type:"DF_NAVIGATE", url, readyXPath: READY_XP });
        if (!nav?.ok) { mark(u, "bad", `Navigate failed: ${nav?.error||"unknown"}`); return; }

        const setRes = await sendBg({ type:"DF_SET_RUN_OPTS", opts });
        if (!setRes?.ok) { log(`Warning: could not sync run opts`, setRes); }

        let anyBad=false, anyWarn=false;
        let reasons=[];

        // --- Upload attestation (if signature) ---
        if (opts.attemptUpload) {
            if (u.hasSignature) {
                log(`Generating & uploading attestation…`, { user:u.name });
                const resp = await sendBg({
                    type: "GENERATE_AND_UPLOAD",
                    chosenDate: opts.dates.delivery,
                    startISO:   opts.dates.start,
                    endISO:     opts.dates.end,
                    backendUrl: "https://dietfantasy-nkw6.vercel.app/api/ext/attestation"
                });
                if (!resp?.ok) {
                    anyBad = true;
                    const reason = resp?.error || resp?.body || resp?.contentType || resp?.code || "unknown";
                    reasons.push(`Upload: ${reason}`);
                    log(`Generate/Upload failed`, resp);
                } else {
                    log(`Upload OK for ${u.name}`);
                }
            } else {
                anyWarn = true;
                reasons.push("Upload skipped (no signature)");
                log(`No signature — skipping upload`, { user:u.name });
            }
        }

        // --- Billing (strict confirm) ---
        // --- Billing (strict confirm + retry 5×) ---
        if (opts.attemptBilling) {
            try {
                const expect = expectFrom(u, opts);

                // 0) duplicate precheck
                const pre = await sendBg({ type: "DF_BILLING_PRECHECK", expect });
                if (pre?.ok && pre.exists) {
                    log(`Billing already exists`, { user: u.name });
                    const rec = await recordBillingSuccess(u, opts, { exists: true });
                    if (!rec.ok) { anyWarn = true; reasons.push("Already existed · record failed"); }
                    else { reasons.push("Already existed"); }
                    mark(u, "ok", reasons.join(" · "));
                    return;
                }

                let confirmed = false;
                for (let attempt = 1; attempt <= 5 && !confirmed; attempt++) {
                    log(`Billing attempt ${attempt}/5`, { user: u.name });

                    await setBillingArgsOnPage({
                        startISO: opts.dates.start,
                        endISO: opts.dates.end,
                        ratePerDay: getRatePerDay(),
                        userId: u.id
                    });

                    await injectBillingModuleIIFE();
                    log(`Billing script injected`, { user: u.name, attempt });
                    await sleep(BILLING_GRACE_MS);

                    const ver = await sendBg({
                        type: "DF_BILLING_VERIFY",
                        expect,
                        timeoutMs: VERIFY_TIMEOUT_MS,
                        intervalMs: VERIFY_INTERVAL_MS
                    });

                    if (ver?.ok) {
                        confirmed = true;
                        const rec = await recordBillingSuccess(u, opts, { verified: true, attempt });
                        if (!rec.ok) { anyWarn = true; reasons.push("Verified · record failed"); }
                        else { log(`✅ Billing verified OK for ${u.name} on attempt ${attempt}`); }
                        break;
                    }

                    log(`Billing attempt ${attempt} did not confirm`, { note: ver?.note || "unknown" });
                    if (attempt < 5) await sleep(3000); // wait 3 s before next attempt
                }

                if (!confirmed) {
                    anyWarn = true;
                    reasons.push("Could not confirm billing after 5 attempts");
                    log(`❌ Billing not confirmed after 5 attempts`, { user: u.name });
                }
            } catch (e) {
                anyBad = true;
                const msg = e?.message || String(e);
                reasons.push(`Billing: ${msg}`);
                log(`Billing exception`, { error: msg });
            }
        }

        if (anyBad) mark(u, "bad", reasons.join(" · ") || "One or more steps failed");
        else if (anyWarn) mark(u, "warn", reasons.join(" · ") || "Upload skipped (no signature)");
        else mark(u, "ok");
    }

    async function runAuto() {
        if (isRunning) return;
        setRunningUI(true);
        isPaused=false; stopRequested=false;

        // lock to current tab for the whole run
        const lockResp = await sendBg({ type: "DF_LOCK_TAB" }, { useLock:false });
        if (lockResp?.ok && lockResp.tabId) {
            lockedTabId = lockResp.tabId;
            log("Locked to tab", { tabId: lockedTabId });
        } else {
            log("Failed to lock tab", lockResp || {});
        }

        const opts = readOptsFromUI();
        const ratePerDay = getRatePerDay();
        log(`Auto run started`, { upload:opts.attemptUpload, billing:opts.attemptBilling, dates:opts.dates, ratePerDay });

        const queue = filtered.slice();

        for (let i=0; i<queue.length; i++) {
            if (stopRequested) { log(`Stopped by user.`); break; }
            while (isPaused)   { await sleep(120); if (stopRequested) break; }
            if (stopRequested) break;

            const u = queue[i];
            try { await processUser(u, opts); }
            catch (e) {
                mark(u, "bad", e?.message || String(e));
                log(`Unhandled error processing ${u.name}`, { error: e?.message || String(e) });
            }

            await sleep(300); // tiny settle gap
        }

        // unlock when completely done
        await sendBg({ type: "DF_UNLOCK_TAB" }, { useLock:false });
        lockedTabId = null;
        log("Unlocked (no locked tab).");

        setRunningUI(false);
        log(`Auto run finished.`);
    }

    // ----- Wire UI -----
    tabAuto.onclick   = ()=>{ mode="auto";   localStorage.setItem(MODE_KEY,mode); reflectTabs(); };
    tabManual.onclick = ()=>{ mode="manual"; localStorage.setItem(MODE_KEY,mode); reflectTabs(); };

    btnRefresh.onclick  = ()=>fetchUsers().catch(e=>log("Refresh failed: "+e));
    btnClearLog.onclick = ()=>{ localStorage.removeItem(LOG_KEY); logEl.textContent=`[${stamp()}] (logs cleared)\n`; localStorage.setItem(LOG_KEY,logEl.textContent); };
    btnErrors.onclick   = ()=>{ errorsOnly = !errorsOnly; localStorage.setItem(ERRORS_KEY, errorsOnly ? "1" : "0"); buildFiltered(); renderList(); };
    btnClose.onclick    = async()=>{ const[tab]=await chrome.tabs.query({active:true,currentWindow:true}); if(tab?.id) await chrome.sidePanel.setOptions({tabId:tab.id,enabled:false}); };

    btnStart.onclick = ()=> runAuto();
    btnPause.onclick = ()=> { if (!isRunning) return; isPaused = !isPaused; btnPause.textContent = isPaused ? "Resume" : "Pause"; };
    btnStop.onclick  = async ()=> {
        if (!isRunning) return;
        stopRequested = true; isPaused=false; btnPause.textContent = "Pause";
        try { await sendBg({ type: "DF_UNLOCK_TAB" }, { useLock:false }); } catch {}
        lockedTabId = null;
    };

    // Toggle buttons
    btnUpload.onclick = () => {
        const isActive = btnUpload.classList.toggle('active');
        btnUpload.dataset.checked = isActive;
        readOptsFromUI();
    };
    btnBilling.onclick = () => {
        const isActive = btnBilling.classList.toggle('active');
        btnBilling.dataset.checked = isActive;
        readOptsFromUI();
    };

    [inpDeliv,inpStart,inpEnd].forEach(el=>el.onchange=()=>readOptsFromUI());

    // Search
    inpSearch.value = q;
    let t=null;
    inpSearch.addEventListener("input", ()=>{
        clearTimeout(t);
        t=setTimeout(()=>{ q = inpSearch.value || ""; localStorage.setItem(SEARCH_KEY, q); buildFiltered(); renderList(); }, 120);
    });

    // ----- Boot -----
    (async()=>{
        reflectTabs(); restoreLog(); reflectOptsToUI(loadOpts());
        try{ await fetchUsers(); }catch(e){ listEl.innerHTML=`<div style='padding:10px 12px;'>Load failed: ${e}`; }
        setRunningUI(false);
    })();
})();