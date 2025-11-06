// ===================== Side panel behavior =====================
async function enablePanelBehavior() {
    try {
        if (chrome.sidePanel?.setPanelBehavior) {
            await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
        }
    } catch (err) {
        console.warn("[DF Panel] setPanelBehavior failed:", err);
    }
}
chrome.runtime.onInstalled.addListener(enablePanelBehavior);

chrome.action.onClicked.addListener(async (tab) => {
    if (!tab?.id) return;
    if (!/^https?:\/\//.test(tab.url || "")) return;
    try {
        await chrome.sidePanel.setOptions({ tabId: tab.id, path: "panel.html", enabled: true });
        await chrome.sidePanel.open({ tabId: tab.id });
    } catch (err) {
        console.warn("[DF Panel] open fallback failed:", err);
    }
});

// ===================== Robust tab resolution & lock =====================
let LOCKED_TAB_ID = null;

async function resolveTabId(preferredTabId, sender) {
    if (preferredTabId) return preferredTabId;            // 1) explicit
    if (LOCKED_TAB_ID) return LOCKED_TAB_ID;              // 2) locked (auto-run)
    if (sender?.tab?.id) return sender.tab.id;            // 3) sender tab
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id) return tab.id;
    const tabs = await chrome.tabs.query({ active: true });
    if (tabs.length && tabs[0].id) return tabs[0].id;
    throw new Error("No active tab found");
}

function isHttpUrl(u) { return /^https?:\/\//i.test(u || ""); }

async function ensureHttpTab(tabId) {
    const tab = await chrome.tabs.get(tabId);
    if (!isHttpUrl(tab?.url)) {
        throw new Error(`Active tab is not an http(s) page: ${tab?.url || "(unknown)"}`);
    }
    return tabId;
}

// ===================== Page readiness helpers =====================
async function waitForTabComplete(tabId, timeoutMs = 60000) {
    const done = await new Promise((resolve) => {
        const listener = (changedTabId, info) => {
            if (changedTabId === tabId && info.status === "complete") {
                chrome.tabs.onUpdated.removeListener(listener);
                resolve(true);
            }
        };
        chrome.tabs.onUpdated.addListener(listener);
        setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve(false);
        }, timeoutMs);
    });
    if (!done) throw new Error("Page load timeout");
}

async function waitForXPathVisibleAndStable(tabId, xpath, timeoutMs = 45000, intervalMs = 250) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        const [{ result }] = await chrome.scripting.executeScript({
            target: { tabId },
            func: (xp) => {
                try {
                    const el = document.evaluate(
                        xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
                    ).singleNodeValue;
                    if (!el) return { ok: false, reason: "not-found" };
                    const style = window.getComputedStyle(el);
                    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0")
                        return { ok: false, reason: "hidden" };
                    const rect = el.getBoundingClientRect();
                    if (!rect.width || !rect.height) return { ok: false, reason: "zero-size" };
                    const cx = rect.left + rect.width / 2;
                    const cy = rect.top + rect.height / 2;
                    const elAtPoint = document.elementFromPoint(cx, cy);
                    const interactable = elAtPoint && (el === elAtPoint || el.contains(elAtPoint));
                    return { ok: interactable, reason: interactable ? "interactable" : "covered" };
                } catch (e) { return { ok: false, reason: String(e) }; }
            },
            args: [xpath]
        });
        if (result?.ok) { await new Promise(r => setTimeout(r, 500)); return; }
        await new Promise(r => setTimeout(r, intervalMs));
    }
    throw new Error(`Element ${xpath} never became visible/interactable within ${timeoutMs}ms`);
}

// Navigate IF url is provided; otherwise just wait for readyXPath if given.
async function navigateActiveTab(url, readyXPath, tabIdHint, sender) {
    const tabId = await ensureHttpTab(await resolveTabId(tabIdHint, sender));
    if (url) {
        await chrome.tabs.update(tabId, { url });
        await waitForTabComplete(tabId, 60000);
    }
    if (readyXPath) await waitForXPathVisibleAndStable(tabId, readyXPath, 45000, 250);
    return tabId;
}

// ===================== Injection helpers (isolated world) =====================
async function tryInject(tabId, candidates) {
    for (const p of candidates) {
        try {
            await chrome.scripting.executeScript({ target: { tabId }, files: [p] });
            return true;
        } catch (_) {}
    }
    return false;
}

async function ensureInjected(tabId) {
    await ensureHttpTab(tabId);
    // Router first
    await tryInject(tabId, ["modules/dispatcher.js", "dispatcher.js"]);
    // Person info reader
    await tryInject(tabId, ["modules/personInfo.js", "personInfo.js"]);
    // Uploader + attestation flow
    await tryInject(tabId, ["modules/uploadpdf.js", "uploadpdf.js"]);
    await tryInject(tabId, ["modules/attestationFlow.js", "attestationFlow.js"]);
    // Optional billing bridge
    await tryInject(tabId, ["modules/enterBillingBridge.js", "enterBillingBridge.js"]);
}

async function injectFiles(tabId, files) {
    for (const file of files) {
        await chrome.scripting.executeScript({ target: { tabId }, files: [file] });
    }
}

// ===================== Run options sync (legacy + new) =====================
async function setRunOptsOnPage(opts, tabIdHint, sender) {
    const attestationDate = (opts?.dates?.delivery) || "";
    const startDate       = (opts?.dates?.start)    || "";
    const endDate         = (opts?.dates?.end)      || "";

    try { await chrome.storage.sync.set({ attestationDate, startDate, endDate }); }
    catch (e) { console.warn("[DF] storage.sync.set failed:", e); }

    const tabId = await ensureHttpTab(await resolveTabId(tabIdHint, sender));
    await chrome.scripting.executeScript({
        target: { tabId },
        func: (injected, legacy) => {
            window.DF_RUN_OPTS = Object.assign({}, window.DF_RUN_OPTS || {}, injected);
            try { localStorage.setItem("DF_RUN_OPTS", JSON.stringify(window.DF_RUN_OPTS)); } catch {}
            window.__ATT_POPUP_PARAMS__ = Object.assign(
                {}, window.__ATT_POPUP_PARAMS__ || {},
                { chosenDate: legacy.attestationDate, startISO: legacy.startDate, endISO: legacy.endDate, attestationISO: legacy.attestationDate }
            );
            try {
                localStorage.setItem("attestationDate", legacy.attestationDate || "");
                localStorage.setItem("startDate",       legacy.startDate || "");
                localStorage.setItem("endDate",         legacy.endDate || "");
            } catch {}
        },
        args: [opts, { attestationDate, startDate, endDate }]
    });
    return { ok: true };
}

// ===================== Bytes helper for dummy =====================
function ab2b64(buf) {
    const bytes = new Uint8Array(buf);
    const chunk = 0x8000;
    let binary = "";
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}

const TINY_PDF_B64 =
    "JVBERi0xLjQKJcTl8uXrp/Og0MTGCjEgMCBvYmoKPDwvVHlwZS9DYXRhbG9nL1BhZ2VzIDIgMCBS" +
    "Pj4KZW5kb2JqCjIgMCBvYmoKPDwvVHlwZS9QYWdlcy9Db3VudCAxL0tpZHNbMyAwIFJdPj4KZW5k" +
    "b2JqCjMgMCBvYmoKPDwvVHlwZS9QYWdlL1BhcmVudCAyIDAgUi9NZWRpYUJveFswIDAgNjEyIDc5" +
    "Ml0vQ29udGVudHMgNCAwIFI+PgplbmRvYmoKNCAwIG9iago8PC9MZW5ndGggMTAgPj4Kc3RyZWFt" +
    "CkJUCmVuZHN0cmVhbQplbmRzdHJlYW0KZW5kb2JqCnhyZWYKMCA1CjAwMDAwMDAwMDAgNjU1MzUg" +
    "ZiAKMDAwMDAwMDA5MyAwMDAwMCBuIAowMDAwMDAwMTY5IDAwMDAwIG4gCjAwMDAwMDAyNjkgMDAw" +
    "MDAgbiAKMDAwMDAwMDM2NyAwMDAwMCBuIAp0cmFpbGVyCjw8L1Jvb3QgMSAwIFIvU2l6ZSA1Pj4K" +
    "c3RhcnR4cmVmCjQ4NQolJUVPRg==";

async function fetchBytes(url) {
    try {
        const r = await fetch(url, { credentials: "omit" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const ab = await r.arrayBuffer();
        return ab2b64(ab);
    } catch (e) {
        console.warn("[DF] FETCH_FILE_BYTES fallback:", e?.message || e);
        return TINY_PDF_B64;
    }
}

// ===================== Billing verification runner =====================
// Runs in page to check if a provided-service card exists matching dates & amount.
async function runVerifyInPage(tabId, expect) {
    const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId },
        func: (expect) => {
            console.log('[🔍 runVerifyInPage] Checking for duplicates...', { expect });

            // First check if billing module already detected a duplicate
            const billingResult = window.__billingResult;
            console.log('[🔍 runVerifyInPage] window.__billingResult =', billingResult);

            if (billingResult && typeof billingResult === 'object') {
                if (billingResult.duplicate) {
                    console.log('[🔍 runVerifyInPage] ✅ Billing module previously detected duplicate!');
                    // Return ok: true so precheck knows duplicate exists
                    return { ok: true, note: 'duplicate detected by billing module' };
                }
                // If billing failed for other reasons, report it
                if (billingResult.ok === false && billingResult.error) {
                    console.log('[🔍 runVerifyInPage] ❌ Billing failed:', billingResult.error);
                    return { ok: false, note: billingResult.error };
                }
            }

            const norm = (s) => String(s||'').replace(/\s+/g,' ').trim();
            const cents = (v) => {
                if (typeof v === 'number') return Math.round(v*100);
                const n = Number(String(v).replace(/[^\d.]/g,''));
                return Number.isFinite(n) ? Math.round(n*100) : NaN;
            };
            const sameDay = (a,b) => a && b && a.getTime()===b.getTime();
            const parseMDY = (s) => {
                const m = String(s).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
                if (!m) return null;
                const mm = +m[1], dd = +m[2], yyyy = +m[3];
                if (mm < 1 || mm > 12) return null;
                const last = new Date(yyyy, mm, 0).getDate();
                if (dd < 1 || dd > last) return null;
                return new Date(yyyy, mm - 1, dd);
            };

            const start = parseMDY(expect.startMDY);
            const end   = parseMDY(expect.endMDY);
            const wantCents = Math.round((expect.amount || 0) * 100);

            console.log('[🔍 runVerifyInPage] Looking for:', { start, end, wantCents });

            const cards = Array.from(document.querySelectorAll('.fee-schedule-provided-service-card'));
            console.log('[🔍 runVerifyInPage] Found', cards.length, 'invoice cards on page');

            for (const card of cards) {
                const amtEl = card.querySelector('[data-test-element="unit-amount-value"]');
                const rngEl = card.querySelector('[data-test-element="service-dates-value"], [data-test-element="service-start-date-value"]');

                const txtAmt = norm(amtEl?.textContent);
                const cardCents = cents(txtAmt);

                const txtRange = norm(rngEl?.textContent);
                let s=null,e=null;
                if (txtRange) {
                    const parts = txtRange.split(/\s*-\s*/);
                    if (parts.length===2) { s = new Date(parts[0]); e = new Date(parts[1]); }
                    else { s = new Date(txtRange); e = s; }
                    s && s.setHours(0,0,0,0);
                    e && e.setHours(0,0,0,0);
                }

                const match = Number.isFinite(cardCents) && s && e &&
                    cardCents === wantCents &&
                    sameDay(s, start) && sameDay(e, end);

                if (match) {
                    console.log('[🔍 runVerifyInPage] ✅ DUPLICATE FOUND! Card matches:', { txtAmt, txtRange });
                    return { ok: true, note: 'matched card' };
                }
            }

            // check for error/draft banners to help debug
            const anyError = !!document.querySelector('[role="alert"], .alert, .error, .toast--error');
            console.log('[🔍 runVerifyInPage] ❌ No match found among', cards.length, 'cards');
            return { ok: false, note: anyError ? 'page error seen' : 'no match' };
        },
        args: [expect]
    });
    return result || { ok: false, note: 'no-result' };
}

// Check ONLY for duplicate flag (doesn't verify card creation)
async function checkDuplicateOnly(tabId, timeoutMs = 3000, intervalMs = 200) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const [{ result }] = await chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
                const billingResult = window.__billingResult;
                if (billingResult && typeof billingResult === 'object') {
                    if (billingResult.duplicate) {
                        return { duplicate: true, note: billingResult.error || 'duplicate detected' };
                    }
                    if (billingResult.ok === true) {
                        return { duplicate: false, note: 'billing completed' };
                    }
                    if (billingResult.ok === false && !billingResult.duplicate) {
                        return { duplicate: false, error: billingResult.error || 'billing failed' };
                    }
                }
                return null; // Still running
            }
        });

        if (result?.duplicate) {
            return { duplicate: true, note: result.note };
        }
        if (result?.duplicate === false) {
            return { duplicate: false, note: result.note, error: result.error };
        }

        await new Promise(r => setTimeout(r, intervalMs));
    }
    return { duplicate: false, note: "timeout waiting for billing result" };
}

// Poll verify with short intervals; used after billing IIFE.
async function verifyBilling(tabId, expect, timeoutMs = 15000, intervalMs = 400) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const r = await runVerifyInPage(tabId, expect);
        if (r?.ok) return { ok: true, note: r.note || "matched" };
        // If duplicate detected, stop retrying immediately
        if (r?.duplicate || r?.skipRetry) {
            return { ok: false, duplicate: true, note: r.note || "duplicate", skipRetry: true };
        }
        await new Promise(r => setTimeout(r, intervalMs));
    }
    return { ok: false, note: "timeout" };
}

// Also used as a *pre-check* before billing to detect duplicates.
async function precheckDuplicate(tabId, expect) {
    // Log to page console so user can see it
    await chrome.scripting.executeScript({
        target: { tabId },
        func: (attempt) => console.log(`[BACKGROUND->PAGE] ========== PRECHECK STARTING ==========`),
        args: []
    });

    // First quick check - see if billing module already detected duplicate
    const quickCheck = await runVerifyInPage(tabId, expect);

    await chrome.scripting.executeScript({
        target: { tabId },
        func: (result) => console.log(`[BACKGROUND->PAGE] Quick check result:`, result),
        args: [quickCheck]
    });

    if (quickCheck && quickCheck.ok) {
        await chrome.scripting.executeScript({
            target: { tabId },
            func: () => console.log(`[BACKGROUND->PAGE] ✓ DUPLICATE FOUND immediately!`),
            args: []
        });
        return true;
    }

    // Wait for page to load cards - retry with exponential backoff
    const delays = [500, 1000, 2000]; // Total ~3.5s wait

    for (let i = 0; i < delays.length; i++) {
        await new Promise(r => setTimeout(r, delays[i]));

        const r = await runVerifyInPage(tabId, expect);

        await chrome.scripting.executeScript({
            target: { tabId },
            func: (i, delay, result) => console.log(`[BACKGROUND->PAGE] Attempt ${i+1} (after ${delay}ms):`, result),
            args: [i, delays[i], r]
        });

        if (r && r.ok) {
            await chrome.scripting.executeScript({
                target: { tabId },
                func: (i) => console.log(`[BACKGROUND->PAGE] ✓ DUPLICATE FOUND on attempt ${i+1}!`),
                args: [i]
            });
            return true; // Found matching card
        }
    }

    await chrome.scripting.executeScript({
        target: { tabId },
        func: (count) => console.log(`[BACKGROUND->PAGE] No duplicate found after ${count} attempts`),
        args: [delays.length]
    });

    return false; // No duplicate found after retries
}

// ===================== Message Bridge =====================
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async () => {
        try {
            if (!msg || !msg.type) { sendResponse({ ok:false, error:"Missing message type" }); return; }

            // --- Lock control ---
            if (msg.type === "DF_LOCK_TAB") {
                const tabId = await ensureHttpTab(await resolveTabId(msg.tabId, sender));
                LOCKED_TAB_ID = tabId;
                sendResponse({ ok: true, tabId });
                return;
            }
            if (msg.type === "DF_UNLOCK_TAB") {
                LOCKED_TAB_ID = null;
                sendResponse({ ok: true });
                return;
            }

            // --- DF_* control messages ---
            if (msg.type === "DF_NAVIGATE") {
                const tabId = await navigateActiveTab(msg.url, msg.readyXPath, msg.tabId, sender);
                sendResponse({ ok: true, tabId }); return;
            }
            if (msg.type === "DF_WAIT_READY") {
                const tabId = await ensureHttpTab(await resolveTabId(msg.tabId, sender));
                if (!msg.readyXPath) { sendResponse({ ok:false, error:"Missing readyXPath" }); return; }
                await waitForXPathVisibleAndStable(tabId, msg.readyXPath, 45000, 250);
                sendResponse({ ok:true, tabId }); return;
            }

            if (msg.type === "DF_INJECT_MODULES") {
                const tabId = await ensureHttpTab(await resolveTabId(msg.tabId, sender));
                await injectFiles(tabId, msg.files || []);
                sendResponse({ ok: true }); return;
            }

            if (msg.type === "DF_SET_RUN_OPTS") {
                const res = await setRunOptsOnPage(msg.opts || {}, msg.tabId, sender);
                sendResponse(res); return;
            }

            // --- helper for dummy upload ---
            if (msg.type === "FETCH_FILE_BYTES") {
                const b64 = await fetchBytes(msg.url || "");
                const filename = msg.filename || "file.pdf";
                sendResponse({ ok: true, bytes: b64, filename }); return;
            }

            // --- Real attestation fetch (backend proxy) ---
            if (msg.type === "FETCH_ATTESTATION") {
                const backendUrl = msg.backendUrl;
                const payload    = msg.payload || {};
                if (!backendUrl) { sendResponse({ ok:false, error:"Missing backendUrl" }); return; }

                try {
                    const r = await fetch(backendUrl, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(payload),
                    });

                    const ct = r.headers.get("content-type") || "";

                    if (r.ok && /application\/pdf/i.test(ct)) {
                        const ab = await r.arrayBuffer();
                        const b64 = ab2b64(ab);
                        sendResponse({ ok: true, status: r.status, dataB64: b64, contentType: ct });
                        return;
                    }

                    let bodyText = "";
                    try { bodyText = await r.text(); } catch (_) {}
                    let bodyJson = null;
                    try { bodyJson = JSON.parse(bodyText); } catch (_) {}

                    if (!r.ok) {
                        sendResponse({
                            ok: false,
                            status: r.status,
                            error: bodyJson?.error || bodyText || `HTTP ${r.status}`,
                            body: bodyText
                        });
                        return;
                    }

                    sendResponse({
                        ok: false,
                        status: r.status,
                        error: "Unexpected content-type from backend",
                        contentType: ct,
                        body: bodyText
                    });
                    return;
                } catch (e) {
                    sendResponse({ ok:false, error: e?.message || String(e) });
                    return;
                }
            }

            // --- Execute arbitrary script in page ---
            if (msg.type === "DF_EXEC_SCRIPT") {
                const tabId = await ensureHttpTab(await resolveTabId(msg.tabId, sender));
                await chrome.scripting.executeScript({
                    target: { tabId },
                    func: (code) => { eval(code); },
                    args: [msg.code]
                });
                sendResponse({ ok: true });
                return;
            }

            // --- Billing page verification hooks ---
            if (msg.type === "DF_BILLING_PRECHECK") {
                const tabId = await ensureHttpTab(await resolveTabId(msg.tabId, sender));
                const exists = await precheckDuplicate(tabId, msg.expect || {});
                sendResponse({ ok: true, exists });
                return;
            }
            if (msg.type === "DF_BILLING_CHECK_DUPLICATE") {
                const tabId = await ensureHttpTab(await resolveTabId(msg.tabId, sender));
                const out = await checkDuplicateOnly(tabId, msg.timeoutMs || 3000, msg.intervalMs || 200);
                sendResponse(out);
                return;
            }
            if (msg.type === "DF_BILLING_VERIFY") {
                const tabId = await ensureHttpTab(await resolveTabId(msg.tabId, sender));
                const out = await verifyBilling(tabId, msg.expect || {}, msg.timeoutMs || 15000, msg.intervalMs || 400);
                sendResponse(out);
                return;
            }

            // --- manual actions: ensure inject + forward to page ---
            if (msg.type === "READ_PERSON_INFO" ||
                msg.type === "UPLOAD_PDF" ||
                msg.type === "GENERATE_AND_UPLOAD" ||
                msg.type === "UPLOAD_PDF_OPEN" ||
                msg.type === "ENTER_BILLING" ||
                msg.type === "PING") {
                const tabId = await ensureHttpTab(await resolveTabId(msg.tabId, sender));
                await ensureInjected(tabId);
                const resp = await chrome.tabs.sendMessage(tabId, msg);
                sendResponse(resp || { ok: true });
                return;
            }

            sendResponse({ ok:false, error:"Unknown message type" });
        } catch (e) {
            sendResponse({ ok:false, error: e?.message || String(e) });
        }
    })();
    return true;
});