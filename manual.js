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

    // UnitedUs Login elements
    const uniteusEmailInput = document.getElementById('uniteus_email');
    const uniteusPasswordInput = document.getElementById('uniteus_password');
    const btnUnitedUsLogin = document.getElementById('btnUnitedUsLogin');
    const uniteusStatusDiv = document.getElementById('uniteus_status');

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

    // Test buttons
    const btnTestAttach = document.getElementById('btnTestAttach');
    const btnTestDirect = document.getElementById('btnTestDirect');
    const btnTestSingleDate = document.getElementById('btnTestSingleDate');

    // ---------- CONSTS ----------
    const API_BASE      = "https://dietfantasy-nkw6.vercel.app";
    const API_URL       = `${API_BASE}/api/ext/users`;
    const IDENTIFY_URL  = `${API_BASE}/api/ext/identify`;
    const STORE_KEY     = "df_manual_params";
    const IDQ_KEY       = "df_manual_identify_q";
    const UNITEUS_STORE_KEY = "df_uniteus_creds";

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

    // Test Attach (assumes dialog is already open)
    btnTestAttach.addEventListener('click', async () => {
        try {
            setStatus('Testing attach with open dialog…');
            log('Injecting uploadpdf.js module...');

            // Inject uploadpdf module
            await injectFile('modules/uploadpdf.js');
            await new Promise(r => setTimeout(r, 200));

            log('Creating minimal test PDF...');
            // Create a minimal valid PDF (just a few bytes for testing)
            // This is a minimal PDF structure
            const pdfContent = '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Length 44 >>\nstream\nBT\n/F1 12 Tf\n100 700 Td\n(Test PDF) Tj\nET\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f\n0000000009 00000 n\n0000000058 00000 n\n0000000115 00000 n\n0000000317 00000 n\ntrailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n408\n%%EOF';

            log(`Created test PDF (${pdfContent.length} bytes), calling attachBytes...`);

            // Set the PDF content on the page first
            await sendBg({
                type: "DF_EXEC_SCRIPT",
                code: `window.__TEST_PDF_CONTENT__ = ${JSON.stringify(pdfContent)};`
            });

            // Then call attachBytes in a separate script execution
            const result = await sendBg({
                type: "DF_EXEC_SCRIPT",
                code: `
                    (async function() {
                        try {
                            if (!window.pdfUploader) {
                                console.error('[Test] pdfUploader not loaded');
                                return { ok: false, error: 'pdfUploader not loaded' };
                            }
                            const pdfText = window.__TEST_PDF_CONTENT__;
                            const bytes = new TextEncoder().encode(pdfText);
                            console.log('[Test] Calling attachBytes with', bytes.length, 'bytes');
                            const result = await window.pdfUploader.attachBytes(bytes, 'test-attach.pdf');
                            console.log('[Test] attachBytes returned:', result);
                            return result;
                        } catch (err) {
                            console.error('[Test] Error:', err);
                            return { ok: false, error: err.message || String(err) };
                        }
                    })()
                `
            });

            log('attachBytes result:', result);

            if (result?.result?.ok) {
                setStatus('Test attach complete!', 'success');
                log('Attach successful:', result.result);
            } else {
                const error = result?.result?.error || 'attach failed - check browser console for details';
                throw new Error(error);
            }
        } catch (e) {
            setStatus(e.message, 'error');
            log('Test attach failed', { error: e.message });
        }
    });

    // Test Direct Upload - simpler approach that directly injects and runs in page context
    btnTestDirect.addEventListener('click', async () => {
        try {
            log('=== Test Direct Upload clicked ===');
            setStatus('Testing direct upload…');

            // Get active tab
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab?.id) throw new Error('No active tab');
            log('Active tab ID:', tab.id);

            // Always inject uploadpdf (module has its own guard)
            log('Injecting uploadpdf.js module...');
            await injectFile('modules/uploadpdf.js');
            await new Promise(r => setTimeout(r, 300));

            log('Injecting test script directly into page...');

            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: async () => {
                    // This runs directly in the page context
                    console.log('[DirectTest] Starting test upload...');

                    if (!window.pdfUploader) {
                        console.error('[DirectTest] pdfUploader not loaded!');
                        return { ok: false, error: 'pdfUploader not loaded' };
                    }

                    // Create minimal PDF
                    const pdfContent = '%PDF-1.4\n1 0 obj\n<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj\n<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj\n<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\nxref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n0000000052 00000 n\n0000000101 00000 n\ntrailer\n<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF';
                    const bytes = new TextEncoder().encode(pdfContent);

                    console.log('[DirectTest] Created PDF:', bytes.length, 'bytes');
                    console.log('[DirectTest] Calling attachBytes...');

                    try {
                        const result = await window.pdfUploader.attachBytes(bytes, 'direct-test.pdf');
                        console.log('[DirectTest] Result:', result);
                        return result;
                    } catch (err) {
                        console.error('[DirectTest] Error in attachBytes:', err);
                        return { ok: false, error: err.message };
                    }
                }
            });

            setStatus('Direct test complete - check console', 'success');
            log('Direct test executed. Check browser console for [DirectTest] and [uploadPDF] logs.');

        } catch (e) {
            setStatus(e.message, 'error');
            log('Direct test failed', { error: e.message });
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

    // Test Single Day Calendar (calendar only, no form opening)
    btnTestSingleDate.addEventListener('click', async () => {
        const startISO = startDateInput.value;
        
        if (!startISO) { 
            setStatus('Pick a start date to test.', 'error'); 
            return; 
        }
        
        try {
            setStatus('Testing single day calendar…');
            log('Test Single Day Calendar: Testing calendar interaction only');
            
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab?.id) throw new Error('No active tab');
            
            // Inject a minimal test script that only tests the calendar
            const result = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: async (testDateISO) => {
                    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
                    const fire = (el, type) => el && el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
                    const mouse = (el, type) => el && el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
                    const pointer = (el, type) => el && el.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: 'mouse', isPrimary: true, bubbles: true, cancelable: true }));
                    
                    console.groupCollapsed('[🧪 TEST] Single Day Calendar Test');
                    console.log('Test date:', testDateISO);
                    
                    // Parse the date
                    const [year, month, day] = testDateISO.split('-').map(Number);
                    const testDate = new Date(year, month - 1, day);
                    console.log('Parsed date:', testDate);
                    
                    // Find the single date input field
                    const dateInput = document.getElementById('provided-service-date');
                    if (!dateInput) {
                        console.error('[TEST] ❌ provided-service-date input not found');
                        return { ok: false, error: 'Date input field not found' };
                    }
                    
                    console.log('[TEST] ✅ Found date input:', dateInput);
                    
                    // Scroll into view
                    dateInput.scrollIntoView({ block: 'center', inline: 'center' });
                    await sleep(200);
                    
                    // Click to open calendar
                    console.log('[TEST] Opening calendar...');
                    dateInput.focus();
                    await sleep(100);
                    
                    // Try clicking the input or calendar icon
                    const calendarIcon = dateInput.parentElement?.querySelector('.ui-date-field__calendar-icon');
                    if (calendarIcon) {
                        console.log('[TEST] Clicking calendar icon');
                        pointer(calendarIcon, 'pointerdown');
                        mouse(calendarIcon, 'mousedown');
                        pointer(calendarIcon, 'pointerup');
                        mouse(calendarIcon, 'mouseup');
                        mouse(calendarIcon, 'click');
                    } else {
                        console.log('[TEST] Clicking date input');
                        dateInput.click();
                    }
                    
                    await sleep(500);
                    
                    // Check if calendar dropdown is open
                    const dropdown = dateInput.parentElement?.querySelector('.ui-date-field__dropdown');
                    const isOpen = dropdown && (dropdown.style.display !== 'none' || dropdown.offsetParent !== null);
                    
                    if (!isOpen) {
                        console.warn('[TEST] ⚠️ Calendar dropdown not visible, trying alternative approach...');
                        // Try clicking the input again
                        dateInput.click();
                        await sleep(500);
                    }
                    
                    // Find the calendar dropdown
                    const calendarDropdown = dateInput.parentElement?.querySelector('.ui-date-field__dropdown');
                    if (!calendarDropdown) {
                        console.error('[TEST] ❌ Calendar dropdown not found');
                        return { ok: false, error: 'Calendar dropdown not found' };
                    }
                    
                    console.log('[TEST] ✅ Calendar dropdown found');
                    
                    // Find the calendar table
                    const calendar = calendarDropdown.querySelector('.ui-calendar');
                    if (!calendar) {
                        console.error('[TEST] ❌ Calendar table not found');
                        return { ok: false, error: 'Calendar table not found' };
                    }
                    
                    console.log('[TEST] ✅ Calendar table found');
                    
                    // Navigate to the correct month/year
                    const yearInput = calendarDropdown.querySelector('#provided-service-date-year-input');
                    const prevBtn = calendarDropdown.querySelector('a[role="button"]:first-of-type');
                    const nextBtn = calendarDropdown.querySelector('a[role="button"]:last-of-type');
                    
                    if (yearInput) {
                        console.log('[TEST] Setting year to:', year);
                        yearInput.value = year;
                        fire(yearInput, 'input');
                        fire(yearInput, 'change');
                        await sleep(300);
                    }
                    
                    // Navigate to correct month
                    const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
                    const targetMonth = month - 1; // 0-indexed
                    
                    // Get current month from the calendar
                    const monthSpan = calendarDropdown.querySelector('.ui-date-field__controls div span');
                    let currentMonthText = monthSpan?.textContent?.trim() || '';
                    console.log('[TEST] Current month text:', currentMonthText);
                    
                    // Try to navigate to the correct month
                    let attempts = 0;
                    while (attempts < 24) { // Max 24 months (2 years)
                        const monthText = monthSpan?.textContent?.trim() || '';
                        const currentMonthIdx = monthNames.findIndex(m => monthText.toLowerCase().includes(m));
                        
                        if (currentMonthIdx === targetMonth) {
                            console.log('[TEST] ✅ Correct month reached');
                            break;
                        }
                        
                        if (currentMonthIdx < targetMonth || currentMonthIdx === -1) {
                            console.log('[TEST] Clicking next month button');
                            if (nextBtn) {
                                mouse(nextBtn, 'click');
                                await sleep(200);
                            }
                        } else {
                            console.log('[TEST] Clicking previous month button');
                            if (prevBtn) {
                                mouse(prevBtn, 'click');
                                await sleep(200);
                            }
                        }
                        attempts++;
                    }
                    
                    await sleep(300);
                    
                    // Find and click the day
                    const dayButtons = Array.from(calendar.querySelectorAll('.ui-calendar__day:not(.ui-calendar__day--out-of-month) div[role="button"]'));
                    const targetDayBtn = dayButtons.find(btn => {
                        const btnText = (btn.textContent || '').trim();
                        return btnText === String(day);
                    });
                    
                    if (!targetDayBtn) {
                        console.error('[TEST] ❌ Day button not found for day:', day);
                        return { ok: false, error: `Day ${day} not found in calendar` };
                    }
                    
                    console.log('[TEST] ✅ Found day button, clicking...');
                    targetDayBtn.scrollIntoView({ block: 'center', inline: 'center' });
                    await sleep(100);
                    
                    pointer(targetDayBtn, 'pointerdown');
                    mouse(targetDayBtn, 'mousedown');
                    pointer(targetDayBtn, 'pointerup');
                    mouse(targetDayBtn, 'mouseup');
                    mouse(targetDayBtn, 'click');
                    
                    await sleep(300);
                    
                    // Check if date was set
                    const finalValue = dateInput.value || '';
                    console.log('[TEST] Final input value:', finalValue);
                    
                    // Format expected value as MM/DD/YYYY
                    const expectedValue = `${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}/${year}`;
                    
                    if (finalValue.includes(String(day)) && finalValue.includes(String(year))) {
                        console.log('[TEST] ✅ Date appears to be set correctly');
                        console.groupEnd();
                        return { ok: true, value: finalValue, expected: expectedValue };
                    } else {
                        console.warn('[TEST] ⚠️ Date may not be set correctly. Value:', finalValue, 'Expected:', expectedValue);
                        console.groupEnd();
                        return { ok: true, value: finalValue, expected: expectedValue, warning: 'Value may not match expected format' };
                    }
                },
                args: [startISO]
            });
            
            const testResult = result[0]?.result;
            
            if (testResult?.ok) {
                setStatus('Calendar test completed!', 'success');
                log('Single day calendar test successful', testResult);
            } else {
                setStatus('Calendar test failed - check console', 'error');
                log('Single day calendar test failed', testResult);
            }
        } catch (e) {
            setStatus(e.message, 'error'); 
            log('Single day calendar test failed', { error: e.message });
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

    // ---------- UnitedUs Login ----------
    // Load saved credentials or use defaults
    async function loadUniteusCredentials() {
        try {
            const result = await chrome.storage.sync.get([UNITEUS_STORE_KEY]);
            if (result[UNITEUS_STORE_KEY]) {
                const { email, password } = result[UNITEUS_STORE_KEY];
                // Only override if we have saved values
                if (email) uniteusEmailInput.value = email;
                if (password) uniteusPasswordInput.value = password;
            }
            // If no saved values, the HTML defaults will be used (orit@dietfantasy.com / Diet1234fantasy)
        } catch (e) {
            console.error('Failed to load UnitedUs credentials:', e);
        }
    }

    // Save credentials
    async function saveUniteusCredentials(email, password) {
        try {
            await chrome.storage.sync.set({
                [UNITEUS_STORE_KEY]: { email, password, autoSubmit: true }
            });
        } catch (e) {
            console.error('Failed to save UnitedUs credentials:', e);
        }
    }

    // Auto-save when credentials are edited
    uniteusEmailInput.addEventListener('change', () => {
        saveUniteusCredentials(uniteusEmailInput.value, uniteusPasswordInput.value);
    });
    uniteusPasswordInput.addEventListener('change', () => {
        saveUniteusCredentials(uniteusEmailInput.value, uniteusPasswordInput.value);
    });

    // UnitedUs login button handler
    btnUnitedUsLogin.addEventListener('click', async () => {
        const email = uniteusEmailInput.value.trim();
        const password = uniteusPasswordInput.value;

        if (!email) {
            uniteusStatusDiv.textContent = 'Please enter an email address';
            uniteusStatusDiv.style.color = '#fca5a5';
            return;
        }

        try {
            uniteusStatusDiv.textContent = 'Logging in to UnitedUs...';
            uniteusStatusDiv.style.color = '#9ca3af';

            // Save credentials
            await saveUniteusCredentials(email, password);
            log('UnitedUs credentials saved', { email });

            // Get current tab
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

            // Navigate to UnitedUs auth page
            await chrome.tabs.update(tab.id, { url: 'https://app.auth.uniteus.io/' });

            // Wait a moment for navigation
            await new Promise(resolve => setTimeout(resolve, 1000));

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

            // Set up listener for step 2 (when redirected to password page)
            const listener = async (tabId, changeInfo, updatedTab) => {
                if (tabId === tab.id && changeInfo.status === 'complete') {
                    // Check if we're on the password page (https://app.auth.uniteus.io/login)
                    if (updatedTab.url && updatedTab.url.includes('app.auth.uniteus.io/login')) {
                        console.log('[UnitedUs] Detected password page, injecting step2Patch.js');

                        // Wait a moment for page to fully load
                        await new Promise(resolve => setTimeout(resolve, 500));

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

                        uniteusStatusDiv.textContent = 'Login flow completed';
                        uniteusStatusDiv.style.color = '#86efac';
                        log('UnitedUs login flow completed');
                    }
                }
            };

            chrome.tabs.onUpdated.addListener(listener);

            uniteusStatusDiv.textContent = 'Navigating to UnitedUs...';
            log('UnitedUs login flow started');

        } catch (e) {
            uniteusStatusDiv.textContent = e.message || 'Login failed';
            uniteusStatusDiv.style.color = '#fca5a5';
            log('UnitedUs login failed', { error: e.message });
        }
    });

    // ---------- Boot ----------
    updateIdentifySectionVisibility(); // Initially hide until we know if there are missing users
    loadParams();
    loadUniteusCredentials(); // Load saved UnitedUs credentials
    fetchUsers();
});