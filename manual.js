document.addEventListener('DOMContentLoaded', () => {
    // ---------- DOM (Manual screen) ----------
    const statusDiv = document.getElementById('status');
    const out = document.getElementById('out');
    const btnGenUpload = document.getElementById('btnGenAndUpload');
    const btnUploadPDF = document.getElementById('btnUploadPDF');
    const enterBillingBtn = document.getElementById('enterBillingBtn');
    const startDateInput = document.getElementById('startDate');
    const endDateInput = document.getElementById('endDate');
    const attDateInput = document.getElementById('attestationDate');
    const ratePerDayInput = document.getElementById('ratePerDay');

    // Identify strip
    const identifySection = document.querySelector('.identify');
    const idSearch = document.getElementById('idSearch');
    const idList   = document.getElementById('idList');
    const btnLinkCurrent = document.getElementById('btnLinkCurrent');

    // Screen containers
    const screenManual = document.getElementById('screenManual');
    const screenCreate = document.getElementById('screenCreate');
    const btnCreateUser = document.getElementById('btnCreateUser');
    const btnClearLog = document.getElementById('btnClearLog');

    // ---------- CONSTS ----------
    const API_BASE      = "https://dietfantasy-nkw6.vercel.app";
    const API_URL       = `${API_BASE}/api/ext/users`;
    const IDENTIFY_URL  = `${API_BASE}/api/ext/identify`;
    const STORE_KEY     = "df_manual_params";
    const IDQ_KEY       = "df_manual_identify_q";

    // ---------- State ----------
    let params = { startDate:"", endDate:"", ratePerDay:"48", attestationDate:"" };
    let missingUsers = []; // [{id,name,caseId?,clientId?}, ...] only those missing one/both
    let filteredMissing = [];
    let selId = null;
    let idQ = localStorage.getItem(IDQ_KEY) || "";

    // ---------- Helpers ----------
    const setStatus = (msg, tone='') => {
        statusDiv.textContent = msg || '';
        statusDiv.style.color = tone === 'error' ? '#fca5a5'
            : tone === 'success' ? '#86efac' : '#9ca3af';
    };
    const log = (msg, obj) => {
        const line = `[${new Date().toLocaleTimeString()}] ${msg}${obj ? ' ' + JSON.stringify(obj) : ''}\n`;
        out.textContent = line + out.textContent;
    };
    const toMDY = (iso) => {
        if (!iso) return "";
        const [y,m,d] = iso.split("-");
        return `${Number(m)}/${Number(d)}/${y}`;
    };

    async function getActiveTab() {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) throw new Error('No active tab');
        return tab;
    }
    async function sendBg(msg) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        return new Promise((resolve) => chrome.runtime.sendMessage({ ...msg, tabId: tab.id }, resolve));
    }
    async function setBillingArgsOnPage(args) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: (incoming)=>{ window.__BILLING_INPUTS__ = incoming; },
            args: [args]
        });
    }
    async function injectFile(path) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [path] });
    }

    // ---------- Persist params ----------
    function loadParams() {
        const todayISO = new Date().toISOString().slice(0,10);
        const startDate = new Date(); startDate.setDate(startDate.getDate() - 7);
        const startISO = startDate.toISOString().slice(0,10);

        try {
            const raw = localStorage.getItem(STORE_KEY);
            params = raw ? JSON.parse(raw) : {
                startDate: startISO, endDate: todayISO, ratePerDay: "48", attestationDate: todayISO
            };
        } catch {
            params = { startDate: startISO, endDate: todayISO, ratePerDay: "48", attestationDate: todayISO };
        }

        startDateInput.value  = params.startDate;
        endDateInput.value    = params.endDate;
        ratePerDayInput.value = params.ratePerDay;
        attDateInput.value    = params.attestationDate;
    }
    function saveParams() {
        params = {
            startDate: startDateInput.value || "",
            endDate: endDateInput.value || "",
            ratePerDay: String(ratePerDayInput.value || "48"),
            attestationDate: attDateInput.value || ""
        };
        localStorage.setItem(STORE_KEY, JSON.stringify(params));
    }
    [startDateInput, endDateInput, ratePerDayInput, attDateInput].forEach(el => {
        el.addEventListener('change', saveParams);
    });

    // ---------- Identify strip ----------
    function buildMissing(users) {
        return (users || []).filter(u => !u.caseId || !u.clientId);
    }
    function updateIdentifySectionVisibility() {
        if (identifySection) {
            identifySection.style.display = (missingUsers.length > 0) ? '' : 'none';
        }
    }
    function applyIdentifyFilter() {
        filteredMissing = (missingUsers || []).filter(u =>
            !idQ || (u.name || '').toUpperCase().includes(idQ.toUpperCase().trim())
        );
        if (selId && !filteredMissing.some(x => x.id === selId)) selId = null;
    }
    function renderIdentify() {
        idList.innerHTML = "";
        if (!filteredMissing.length) {
            idList.innerHTML = `<div style="padding:6px 8px; color:#9ca3af;">No users missing links.</div>`;
            return;
        }
        const frag = document.createDocumentFragment();
        filteredMissing.slice(0, 200).forEach(u => {
            const div = document.createElement("div");
            div.className = "item" + (u.id === selId ? " sel" : "");
            div.textContent = u.name || "";
            div.title = u.name || "";
            div.addEventListener("click", () => {
                selId = (selId === u.id) ? null : u.id;
                renderIdentify();
            });
            frag.appendChild(div);
        });
        idList.appendChild(frag);
    }

    async function fetchUsers() {
        try {
            const r = await fetch(API_URL, { credentials: "omit" });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const data = await r.json();
            missingUsers = buildMissing(Array.isArray(data) ? data : []);
            updateIdentifySectionVisibility();
            applyIdentifyFilter(); renderIdentify();
            log("Loaded missing users.", { count: missingUsers.length });
        } catch (e) {
            log("Failed to load users", { error: e?.message || String(e) });
        }
    }

    idSearch.value = idQ;
    idSearch.addEventListener("input", () => {
        idQ = idSearch.value || "";
        localStorage.setItem(IDQ_KEY, idQ);
        applyIdentifyFilter(); renderIdentify();
    });

    btnLinkCurrent.addEventListener("click", async () => {
        try {
            if (!selId) { setStatus("Pick a user first", "error"); log("Identify: pick a user first"); return; }
            const sel = (filteredMissing || []).find(x => x.id === selId);
            if (!sel) { setStatus("Selection not found", "error"); log("Identify: selection not found"); return; }

            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab?.url) { setStatus("No active tab URL", "error"); log("Identify: no active tab URL"); return; }
            const url = tab.url;

            // Try parse IDs client-side too
            let caseId = null, clientId = null;
            try {
                const m = /\/cases\/open\/([0-9a-fA-F-]{10,})\/contact\/([0-9a-fA-F-]{10,})/.exec(new URL(url).pathname);
                if (m) { caseId = m[1]; clientId = m[2]; }
            } catch {}

            const payload = { userId: sel.id, name: sel.name, url, caseId, clientId };

            const r = await fetch(IDENTIFY_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            const ct = r.headers.get("content-type") || "";
            const isJson = /application\/json/i.test(ct);
            const body = isJson ? await r.json() : { ok:false, status:r.status, error:"Unexpected content-type" };

            if (!r.ok || !body?.ok) {
                setStatus(body?.message || body?.error || `Identify failed (HTTP ${r.status})`, 'error');
                log("Identify failed", body || { status: r.status });
                return;
            }

            setStatus("Identify saved", 'success');
            log("Identify saved", body);

            // Remove from missing list locally
            missingUsers = missingUsers.filter(u => u.id !== sel.id);
            selId = null;
            updateIdentifySectionVisibility();
            applyIdentifyFilter(); renderIdentify();
        } catch (e) {
            setStatus(e?.message || String(e), 'error');
            log("Identify exception", { error: e?.message || String(e) });
        }
    });

    // ---------- Buttons ----------
    // Clear log
    btnClearLog.addEventListener('click', () => {
        out.textContent = '';
        statusDiv.textContent = '';
    });

    // Upload Dummy PDF
    btnUploadPDF.addEventListener('click', async () => {
        try {
            setStatus('Uploading dummy PDF…');
            const resp = await sendBg({ type: "UPLOAD_PDF" });
            if (!resp?.ok) throw new Error(resp?.error || 'Upload failed');
            setStatus('Dummy uploaded', 'success');
            log('Dummy upload complete.', resp);
        } catch (e) {
            setStatus(e.message, 'error'); log('Dummy upload failed', { error: e.message });
        }
    });

    // Generate + Upload
    btnGenUpload.addEventListener('click', async () => {
        const startISO = startDateInput.value;
        const endISO = endDateInput.value;
        const deliveryISO = attDateInput.value;
        if (!startISO || !endISO || !deliveryISO) {
            setStatus('Fill all date fields.', 'error');
            return;
        }
        try {
            setStatus('Generating PDF…');
            const resp = await sendBg({
                type: "GENERATE_AND_UPLOAD",
                chosenDate: deliveryISO,
                startISO, endISO,
                backendUrl: `${API_BASE}/api/ext/attestation`
            });
            if (!resp?.ok) throw new Error(resp?.error || 'Upload failed');
            setStatus('Upload complete', 'success'); log('Upload successful.', resp);
        } catch (e) {
            setStatus(e.message, 'error'); log('Generate/Upload failed', { error: e.message });
        }
    });

    // Enter Billing
    enterBillingBtn.addEventListener('click', async () => {
        const startISO = startDateInput.value;
        const endISO   = endDateInput.value;
        const ratePerDay = ratePerDayInput.value || 48;
        if (!startISO || !endISO) { setStatus('Pick start and end dates.', 'error'); return; }
        try {
            setStatus('Injecting billing script…');
            await setBillingArgsOnPage({ start: toMDY(startISO), end: toMDY(endISO), ratePerDay });
            await injectFile('modules/enterBillingDetails.js');
            setStatus('Billing injected', 'success');
            log('Billing injected successfully.');
        } catch (e) {
            setStatus(e.message, 'error'); log('Billing injection failed', { error: e.message });
        }
    });

    // Toggle → Create User screen
    btnCreateUser.addEventListener('click', async () => {
        try {
            // Load external HTML (kept separate) and then its JS
            const htmlRes = await fetch('create-user.html', { cache: 'no-store' });
            if (!htmlRes.ok) throw new Error(`Failed to load create-user.html (HTTP ${htmlRes.status})`);
            const html = await htmlRes.text();
            screenCreate.innerHTML = html;

            // Reveal create screen, hide manual
            screenManual.classList.add('hidden');
            screenCreate.classList.remove('hidden');

            // Load the separate JS file for the creator
            const s = document.createElement('script');
            s.src = 'create-user.js';
            s.onload = () => {
                // Provide API base and a callback so the create screen can return here
                if (window.__CreateUserMount) {
                    window.__CreateUserMount({
                        apiBase: API_BASE,
                        onDone: () => {
                            // back to manual screen
                            screenCreate.classList.add('hidden');
                            screenManual.classList.remove('hidden');
                            // refresh missing list after a creation
                            fetchUsers();
                        }
                    });
                }
            };
            s.onerror = () => console.error('Failed to load create-user.js');
            document.body.appendChild(s);
        } catch (e) {
            setStatus(e.message || 'Failed to open create user screen', 'error');
            log('Create user screen error', { error: e?.message || String(e) });
        }
    });

    // ---------- Boot ----------
    updateIdentifySectionVisibility(); // Initially hide until we know if there are missing users
    loadParams();
    fetchUsers();
});