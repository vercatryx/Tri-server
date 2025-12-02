(() => {
    const API_URL = "https://dietfantasy-nkw6.vercel.app/api/ext/users";
    const BILLINGS_URL = "https://dietfantasy-nkw6.vercel.app/api/ext/billings";
    const UNITE_URL = (caseId, clientId) =>
        `https://app.uniteus.io/dashboard/cases/open/${encodeURIComponent(caseId)}/contact/${encodeURIComponent(clientId)}`;

    // UniteUs “ready” XPath
    const READY_XP = '//*[@id="container"]/div[2]/main/div/section/div';

    // Timings
    const BILLING_GRACE_MS = 1500;         // short grace after injection (1.5s)
    const VERIFY_TIMEOUT_MS = 3000;       // verify window
    const VERIFY_INTERVAL_MS = 400;        // poll rate

    // ----- DOM -----
    const tabAuto   = document.getElementById("tabAuto");
    const tabManual = document.getElementById("tabManual");
    const autoWrap  = document.getElementById("autoWrap");
    const manualWrap= document.getElementById("manualWrap");

    const listEl      = document.getElementById("list");
    const logEl       = document.getElementById("log");
    const btnClearLog = document.getElementById("btnClearLog");
    const btnResetSkips = document.getElementById("btnResetSkips");
    const btnSomeMode = document.getElementById("btnSomeMode");
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
        MANUAL_PARAMS_KEY="df_manual_params", UNITEUS_STORE_KEY="df_uniteus_creds",
        SOME_MODE_KEY="df_panel_some_mode", SELECTED_USERS_KEY="df_panel_selected_users";
    let mode=localStorage.getItem(MODE_KEY)||"auto";
    let users=[], filtered=[], perUserState=new Map();
    let q = localStorage.getItem(SEARCH_KEY) || "";
    let errorsOnly = localStorage.getItem(ERRORS_KEY) === "1";
    let someMode = localStorage.getItem(SOME_MODE_KEY) === "1";
    let selectedUsers = new Set(); // Set of user IDs selected in "Some" mode

    // Auto-run flags
    let isRunning=false, isPaused=false, stopRequested=false, lockedTabId=null, duplicateFoundInBilling = false;

    // Listen for duplicate found message from content script
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg?.type === 'DF_BILLING_DUPLICATE_FOUND') {
            log('Duplicate found message received from content script.');
            duplicateFoundInBilling = true;
        }
    });

    // ----- Helpers -----
    const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
    const stamp=()=>new Date().toLocaleTimeString();
    // const log=(line,obj)=>{ const msg=`[${stamp()}] ${line}${obj?(" "+JSON.stringify(obj)):""}\n`; logEl.textContent+=msg; logEl.scrollTop=logEl.scrollHeight; const c=localStorage.getItem(LOG_KEY)||""; localStorage.setItem(LOG_KEY,c+msg); };
    const log = (line, obj) => {
        const msg = `\n[${stamp()}] ${line}${obj ? " " + JSON.stringify(obj, null, 2) : ""}`;
        logEl.textContent += msg;
        logEl.scrollTop = logEl.scrollHeight;
        const c = localStorage.getItem(LOG_KEY) || "";
        localStorage.setItem(LOG_KEY, c + msg);
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

    const saveSelectedUsers=()=>{ localStorage.setItem(SELECTED_USERS_KEY, JSON.stringify(Array.from(selectedUsers))); };
    function restoreSelectedUsers() {
        try { const arr = JSON.parse(localStorage.getItem(SELECTED_USERS_KEY)||"[]"); selectedUsers = new Set(arr); } catch {}
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

    function updateStartButtonText() {
        if (someMode && selectedUsers.size > 0) {
            btnStart.textContent = `Start (${selectedUsers.size})`;
        } else {
            btnStart.textContent = "Start";
        }
    }

    function renderList(){
        listEl.innerHTML="";
        const frag=document.createDocumentFragment();

        filtered.forEach((u,idx)=>{
            const st=perUserState.get(u.id)||{status:u.invalid?"bad":"pending"};
            const li=document.createElement("div"); li.className="row";

            // In Some mode, add checkbox before the number
            const checkboxHtml = someMode ? `<input type="checkbox" class="user-checkbox" data-user-id="${u.id}" ${selectedUsers.has(u.id) ? 'checked' : ''} style="margin-right: 8px;">` : '';

            li.innerHTML=`
        ${checkboxHtml}
        <div class="num">${idx+1}</div>
        ${statusIconHtml(st)}
        <div class="name" title="${u.name||""}">${(u.name||"").toUpperCase()}</div>
        <div class="pills">${sigPill(u)} ${skipPill(u)} ${u.paused?`<span class="pill">PAUSED</span>`:""}</div>
      `;
            const sub=subline(st); if(sub){ const s=document.createElement("div"); s.className="sub"; s.textContent=sub; li.appendChild(s); }

            // Handle checkbox clicks in Some mode
            if (someMode) {
                const checkbox = li.querySelector('.user-checkbox');
                if (checkbox) {
                    checkbox.addEventListener('click', (e) => {
                        e.stopPropagation(); // Prevent row click
                        if (checkbox.checked) {
                            selectedUsers.add(u.id);
                        } else {
                            selectedUsers.delete(u.id);
                        }
                        saveSelectedUsers();
                        updateStartButtonText();
                    });
                }
            }

            li.addEventListener("click", async (e) => {
                const url = UNITE_URL(u.caseId, u.clientId);
                const statusEl = e.target.closest('.status');

                // colored icon → SAME TAB (works in both normal and Some mode)
                if (statusEl && !u.invalid) {
                    await sendBg({ type: "DF_NAVIGATE", url, readyXPath: READY_XP }, { useLock: false });
                    return;
                }

                // In Some mode, clicking anywhere (except status icon) toggles the checkbox selection
                if (someMode) {
                    const checkbox = li.querySelector('.user-checkbox');
                    if (checkbox && e.target !== checkbox) {
                        checkbox.checked = !checkbox.checked;
                        if (checkbox.checked) {
                            selectedUsers.add(u.id);
                        } else {
                            selectedUsers.delete(u.id);
                        }
                        saveSelectedUsers();
                        updateStartButtonText();
                    }
                    return;
                }

                // Normal mode behavior (not Some mode)
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
        updateStartButtonText();
    }

    async function fetchUsers(){
        listEl.innerHTML="<div style='padding:10px 12px;'>Loading…</div>";
        const r=await fetch(API_URL,{credentials:"omit"});
        if(!r.ok) throw new Error(`HTTP ${r.status}`);
        const data=await r.json();

        // Log first user from API to see structure
        if (Array.isArray(data) && data.length > 0) {
            log(`Sample user from API (first user):`, data[0]);
            log(`First user ID fields: id=${data[0].id}, _id=${data[0]._id}`);
        }

        users = (Array.isArray(data) ? data : []).map(u => {
            let reason = null;
            if (u.bill === false) reason = "Billing disabled";
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

        log(`Processing user: ${u.name}`, { id: u.id });

        const url = UNITE_URL(u.caseId, u.clientId);
        log(`Navigating → ${u.name}`, { url });

        const nav = await sendBg({ type:"DF_NAVIGATE", url, readyXPath: READY_XP });
        if (!nav?.ok) { mark(u, "bad", `Navigate failed: ${nav?.error||"unknown"}`); return; }

        let anyBad=false, anyWarn=false;
        let reasons=[];

        // ===== NEW CLEAN FLOW: Inject flow module and wait for completion =====
        try {
            log(`Starting user page flow for ${u.name}`);

            // Clear previous flow result
            await sendBg({
                type: "DF_EXEC_SCRIPT",
                code: "delete window.__USER_PAGE_FLOW_RESULT__; delete window.__USER_PAGE_INPUTS__; delete window.__ADJUSTED_DATES__;"
            });

            // Set inputs for the flow
            await chrome.scripting.executeScript({
                target: { tabId: (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id },
                func: (inputs) => {
                    window.__USER_PAGE_INPUTS__ = inputs;
                },
                args: [{
                    startISO: opts.dates.start,
                    endISO: opts.dates.end,
                    ratePerDay: getRatePerDay(),
                    attemptUpload: opts.attemptUpload,
                    attemptBilling: opts.attemptBilling,
                    hasSignature: u.hasSignature
                }]
            });

            // Inject the flow module
            await chrome.scripting.executeScript({
                target: { tabId: (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id },
                files: ['modules/userPageFlow.js']
            });

            log(`User page flow injected for ${u.name}, waiting for completion...`);

            // Poll for flow completion (up to 30 seconds)
            let flowResult = null;
            let pollAttempts = 0;
            const maxPollAttempts = 30;

            while (pollAttempts < maxPollAttempts) {
                await sleep(1000);
                pollAttempts++;

                const result = await sendBg({
                    type: "DF_EXEC_SCRIPT",
                    code: "window.__USER_PAGE_FLOW_RESULT__"
                });

                if (result?.result && typeof result.result === 'object') {
                    flowResult = result.result;
                    log(`Flow completed for ${u.name} after ${pollAttempts}s`, flowResult);
                    break;
                }
            }

            if (!flowResult) {
                anyBad = true;
                reasons.push('Flow timeout - no response after 30s');
                mark(u, "bad", reasons.join(" · "));
                return;
            }

            if (!flowResult.ok) {
                anyBad = true;
                reasons.push(`Flow error: ${flowResult.error}`);
                mark(u, "bad", reasons.join(" · "));
                return;
            }

            // Check if duplicate was found
            if (flowResult.duplicate) {
                reasons.push('⚠️ Duplicate invoice found');
                mark(u, "ok", reasons.join(" · "));
                return;
            }

            // Flow succeeded, now execute upload and billing if pending
            const adjustedDates = flowResult.adjustedDates;
            log(`Proceeding with adjusted dates`, adjustedDates);

        } catch (e) {
            anyBad = true;
            const msg = e?.message || String(e);
            reasons.push(`Flow exception: ${msg}`);
            log(`User page flow exception`, { error: msg });
            mark(u, "bad", reasons.join(" · "));
            return;
        }

        // --- Upload attestation (if signature and requested) ---
        if (opts.attemptUpload && u.hasSignature) {
            log(`Generating & uploading attestation with adjusted dates…`, { user:u.name, userId:u.id });

            // Get adjusted dates from flow
            const adjResult = await sendBg({
                type: "DF_EXEC_SCRIPT",
                code: "window.__ADJUSTED_DATES__"
            });
            const adjustedDates = adjResult?.result;

            // Validate that we have proper ISO dates
            if (!adjustedDates?.startISO || !adjustedDates?.endISO) {
                anyBad = true;
                const reason = "Upload: Missing adjusted dates from flow";
                reasons.push(reason);
                log(`Cannot upload - adjusted dates not available`, { adjResult });
                mark(u, "bad", reasons.join(" · "));
                return;
            }

            const uploadMsg = {
                type: "GENERATE_AND_UPLOAD",
                chosenDate: opts.dates.delivery,
                startISO:   adjustedDates.startISO,
                endISO:     adjustedDates.endISO,
                userId:     u.id,
                backendUrl: "https://dietfantasy-nkw6.vercel.app/api/ext/attestation"
            };
            log(`GENERATE_AND_UPLOAD message with adjusted dates:`, uploadMsg);
            const resp = await sendBg(uploadMsg);
            if (!resp?.ok) {
                anyBad = true;
                const reason = resp?.error || resp?.body || resp?.contentType || resp?.code || "unknown";
                reasons.push(`Upload: ${reason}`);
                log(`Generate/Upload failed`, resp);
            } else {
                log(`Upload OK for ${u.name}`);
            }
        } else if (opts.attemptUpload && !u.hasSignature) {
            anyWarn = true;
            reasons.push("Upload skipped (no signature)");
            log(`No signature — skipping upload`, { user:u.name });
        }

        // --- Billing (using adjusted dates only) ---
        if (opts.attemptBilling) {
            try {
                log(`Starting billing with adjusted dates`, { user: u.name });

                // Get adjusted dates from flow
                const adjResult = await sendBg({
                    type: "DF_EXEC_SCRIPT",
                    code: "window.__ADJUSTED_DATES__"
                });

                if (!adjResult?.result) {
                    anyBad = true;
                    reasons.push("Billing: Adjusted dates not available");
                    log(`❌ Adjusted dates not found`, { user: u.name });
                    mark(u, "bad", reasons.join(" · "));
                    return;
                }

                const adjustedDates = adjResult.result;
                log(`Using adjusted dates for billing`, adjustedDates);

                // Retry logic for billing injection (up to 5 attempts)
                let billingResult = null;
                const maxBillingAttempts = 5;

                for (let billingAttempt = 1; billingAttempt <= maxBillingAttempts; billingAttempt++) {
                    if (billingAttempt > 1) {
                        log(`Billing attempt ${billingAttempt}/${maxBillingAttempts} for ${u.name}`);
                        await sleep(1000); // Wait 1 second between retries
                    }

                    // Clear any previous billing result
                    await sendBg({
                        type: "DF_EXEC_SCRIPT",
                        code: "delete window.__billingResult; delete window.__BILLING_INPUTS__;"
                    });

                    // Set billing args with adjusted dates
                    await setBillingArgsOnPage({
                        startISO: adjustedDates.startISO,
                        endISO: adjustedDates.endISO,
                        ratePerDay: getRatePerDay(),
                        userId: u.id
                    });

                    // Inject billing module
                    await injectBillingModuleIIFE();
                    log(`Billing script injected for ${u.name} (attempt ${billingAttempt})`);

                    // Poll for billing completion (up to 15 seconds per attempt)
                    let pollAttempts = 0;
                    const maxPollAttempts = 15;

                    while (pollAttempts < maxPollAttempts) {
                        await sleep(1000);
                        pollAttempts++;

                        const result = await sendBg({
                            type: "DF_EXEC_SCRIPT",
                            code: "window.__billingResult"
                        });

                        if (result?.result && typeof result.result === 'object') {
                            billingResult = result.result;
                            log(`Billing script completed for ${u.name} after ${pollAttempts}s (attempt ${billingAttempt})`, billingResult);
                            break;
                        }
                    }

                    // Check if billing succeeded
                    if (billingResult && billingResult.ok) {
                        log(`✅ Billing succeeded on attempt ${billingAttempt}`);
                        break; // Success! Exit retry loop
                    } else if (billingResult && billingResult.duplicate) {
                        log(`Duplicate detected on attempt ${billingAttempt} - no retry needed`);
                        break; // Duplicate is a definitive result, don't retry
                    } else if (billingResult && billingResult.error) {
                        const errorLower = billingResult.error.toLowerCase();
                        const isElementNotFound = errorLower.includes('not found') ||
                                                 errorLower.includes('missing') ||
                                                 errorLower.includes('add button') ||
                                                 errorLower.includes('form elements');

                        if (isElementNotFound && billingAttempt < maxBillingAttempts) {
                            log(`⚠️ Elements not found, will retry (attempt ${billingAttempt}/${maxBillingAttempts})`);
                            billingResult = null; // Clear result to retry
                            continue; // Retry
                        } else {
                            log(`❌ Billing error (no retry): ${billingResult.error}`);
                            break; // Other errors or max attempts reached
                        }
                    } else if (!billingResult) {
                        log(`⚠️ Billing timeout on attempt ${billingAttempt}/${maxBillingAttempts}`);
                        if (billingAttempt < maxBillingAttempts) {
                            continue; // Retry on timeout
                        }
                    }
                }

                // Handle final result after all retries
                if (!billingResult) {
                    anyWarn = true;
                    reasons.push("Billing script timeout after retries");
                    log(`⚠️ Billing script did not complete after ${maxBillingAttempts} attempts`, { user: u.name });
                } else if (billingResult.duplicate) {
                    // Duplicate detected by billing script itself (early guard)
                    reasons.push("⚠️ Duplicate invoice (caught by billing script)");
                    log(`⚠️ Duplicate found during billing execution`, { user: u.name });
                } else if (!billingResult.ok) {
                    anyWarn = true;
                    reasons.push(`Billing: ${billingResult.error || 'unknown error'}`);
                    log(`❌ Billing failed after ${maxBillingAttempts} attempts`, billingResult);
                } else {
                    // Verify the billing was successful
                    await sleep(2000); // Wait for invoice to appear

                    const ver = await sendBg({
                        type: "DF_BILLING_VERIFY",
                        expect: {
                            startMDY: adjustedDates.startMDY,
                            endMDY: adjustedDates.endMDY,
                            amount: adjustedDates.amount
                        },
                        timeoutMs: VERIFY_TIMEOUT_MS,
                        intervalMs: VERIFY_INTERVAL_MS
                    });

                    if (ver?.ok) {
                        const rec = await recordBillingSuccess(u, {
                            dates: {
                                start: adjustedDates.startISO,
                                end: adjustedDates.endISO
                            }
                        }, { verified: true });
                        if (!rec.ok) {
                            anyWarn = true;
                            reasons.push("Verified · record failed");
                        } else {
                            log(`✅ Billing verified and recorded for ${u.name}`);
                        }
                    } else {
                        anyWarn = true;
                        reasons.push("Could not verify billing on page");
                        log(`⚠️ Billing verification failed`, { note: ver?.note || "unknown" });
                    }
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

        // Validate dates are filled if upload or billing is enabled
        if ((opts.attemptUpload || opts.attemptBilling) && (!opts.dates.start || !opts.dates.end)) {
            log("ERROR: Start and End dates are required");
            alert("Please fill in Start Date and End Date before running");
            setRunningUI(false);
            stopRequested = false;
            isPaused = false;
            return;
        }

        log(`Auto run started`, { upload:opts.attemptUpload, billing:opts.attemptBilling, dates:opts.dates, ratePerDay });

        // In Some mode, only process selected users
        let queue = filtered.slice();
        if (someMode) {
            queue = queue.filter(u => selectedUsers.has(u.id));
            log(`Some mode: processing ${queue.length} selected users out of ${filtered.length} total`);
        }

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

    // ----- UnitedUs Login -----
    const btnUnitedUsLogin = document.getElementById("btnUnitedUsLogin");

    async function loadUniteusCredentials() {
        try {
            const result = await chrome.storage.sync.get([UNITEUS_STORE_KEY]);
            if (result[UNITEUS_STORE_KEY]) {
                return result[UNITEUS_STORE_KEY];
            }
            // Return defaults
            return { email: "orit@dietfantasy.com", password: "Diet1234fantasy", autoSubmit: true };
        } catch (e) {
            log("Failed to load UnitedUs credentials", { error: e?.message || String(e) });
            return { email: "orit@dietfantasy.com", password: "Diet1234fantasy", autoSubmit: true };
        }
    }

    btnUnitedUsLogin.onclick = async () => {
        try {
            log("Starting UnitedUs login flow...");

            // Load credentials
            const creds = await loadUniteusCredentials();
            const email = creds.email || "orit@dietfantasy.com";
            const password = creds.password || "Diet1234fantasy";

            // Get current tab
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab?.id) throw new Error("No active tab");

            // Navigate to UnitedUs auth page
            await chrome.tabs.update(tab.id, { url: 'https://app.auth.uniteus.io/' });
            log("Navigating to UnitedUs auth page...");

            // Wait a moment for navigation
            await sleep(1000);

            // Inject loginFlow.js
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['modules/loginFlow.js']
            });

            // Send settings to loginFlow
            await chrome.tabs.sendMessage(tab.id, {
                type: 'LOGIN_FLOW_SETTINGS',
                email: email
            });
            log("Injected login flow script", { email });

            // Set up listener for step 2 (when redirected to password page)
            const listener = async (tabId, changeInfo, updatedTab) => {
                if (tabId === tab.id && changeInfo.status === 'complete') {
                    // Check if we're on the password page
                    if (updatedTab.url && updatedTab.url.includes('app.auth.uniteus.io/login')) {
                        log("Detected password page, injecting step2 script...");

                        // Wait a moment for page to fully load
                        await sleep(500);

                        // Inject step2Patch.js
                        await chrome.scripting.executeScript({
                            target: { tabId: tab.id },
                            files: ['modules/step2Patch.js']
                        });

                        // Send step 2 settings
                        await chrome.tabs.sendMessage(tab.id, {
                            type: 'STEP2_SETTINGS',
                            email: email,
                            password: password,
                            autoSubmit: true
                        });

                        // Remove listener after step 2 is handled
                        chrome.tabs.onUpdated.removeListener(listener);

                        log("UnitedUs login flow completed");
                    }
                }
            };

            chrome.tabs.onUpdated.addListener(listener);

        } catch (e) {
            log("UnitedUs login failed", { error: e?.message || String(e) });
        }
    };

    // ----- Wire UI -----
    tabAuto.onclick   = ()=>{ mode="auto";   localStorage.setItem(MODE_KEY,mode); reflectTabs(); };
    tabManual.onclick = ()=>{ mode="manual"; localStorage.setItem(MODE_KEY,mode); reflectTabs(); };

    btnRefresh.onclick  = ()=>fetchUsers().catch(e=>log("Refresh failed: "+e));
    btnClearLog.onclick = ()=>{ localStorage.removeItem(LOG_KEY); logEl.textContent=`[${stamp()}] (logs cleared)\n`; localStorage.setItem(LOG_KEY,logEl.textContent); };
    btnResetSkips.onclick = ()=>{
        // Clear all skips
        users.forEach(u => u.skip = false);
        localStorage.removeItem(SKIPS_KEY);
        buildFiltered();
        renderList();
        log("All skips cleared");
    };
    btnSomeMode.onclick = ()=>{
        someMode = !someMode;
        localStorage.setItem(SOME_MODE_KEY, someMode ? "1" : "0");
        btnSomeMode.classList.toggle('active', someMode);

        // When leaving Some mode, clear all selections
        if (!someMode) {
            selectedUsers.clear();
            localStorage.removeItem(SELECTED_USERS_KEY);
            log("Some mode disabled - selections cleared");
        } else {
            log("Some mode enabled - select users to process");
        }

        renderList();
        updateStartButtonText();
    };
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
        restoreSelectedUsers();
        btnSomeMode.classList.toggle('active', someMode);
        btnErrors.classList.toggle('active', errorsOnly);
        try{ await fetchUsers(); }catch(e){ listEl.innerHTML=`<div style='padding:10px 12px;'>Load failed: ${e}`; }
        setRunningUI(false);
    })();
})();