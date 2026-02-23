// ===================== Helper: sleep =====================
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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
// Reusable login sequence function
async function performLoginSequence(tabId, email = "orit@dietfantasy.com", password = "Diet1234fantasy") {
    try {
        console.log('[background/bridge] performLoginSequence: Starting login...');
        
        // Navigate to auth page
        await chrome.tabs.update(tabId, { url: 'https://app.auth.uniteus.io/' });
        
        // Wait a bit for potential redirect
        await sleep(2000);
        
        // Check if we're already logged in (redirected to dashboard)
        const tab = await chrome.tabs.get(tabId);
        const currentUrl = tab.url || '';
        console.log('[background/bridge] performLoginSequence: Current URL after navigation:', currentUrl);
        
        // Check if we're already on dashboard (already logged in)
        if (currentUrl.includes('app.uniteus.io') && !currentUrl.includes('app.auth.uniteus.io')) {
            console.log('[background/bridge] performLoginSequence: ✓ Already logged in! Redirected to:', currentUrl);
            await sleep(2000);
            return { ok: true, loginComplete: true, alreadyLoggedIn: true };
        }
        
        // If we're still on auth page, continue with login process
        if (!currentUrl.includes('app.auth.uniteus.io')) {
            await waitForTabComplete(tabId, 30000);
        } else {
            await sleep(1000);
        }
        
        // Inject loginFlow.js
        console.log('[background/bridge] performLoginSequence: Injecting loginFlow.js...');
        await chrome.scripting.executeScript({
            target: { tabId },
            files: ['modules/loginFlow.js']
        });
        
        // Send email
        console.log('[background/bridge] performLoginSequence: Sending email to loginFlow...');
        await chrome.tabs.sendMessage(tabId, {
            type: 'LOGIN_FLOW_SETTINGS',
            email: email
        });
        
        // Wait for redirect to password page
        console.log('[background/bridge] performLoginSequence: Waiting for password page...');
        let passwordPageReached = false;
        const maxWait = 20000;
        const startTime = Date.now();
        
        while (Date.now() - startTime < maxWait && !passwordPageReached) {
            await sleep(500);
            try {
                const tab = await chrome.tabs.get(tabId);
                const currentUrl = tab.url || '';
                console.log('[background/bridge] performLoginSequence: Checking URL:', currentUrl);
                
                if (currentUrl.includes('app.auth.uniteus.io/login') || 
                    (currentUrl.includes('app.auth.uniteus.io') && currentUrl.includes('login'))) {
                    passwordPageReached = true;
                    console.log('[background/bridge] performLoginSequence: ✓ Password page detected:', currentUrl);
                    break;
                }
            } catch (e) {
                console.warn('[background/bridge] performLoginSequence: Error checking tab:', e);
            }
        }
        
        if (!passwordPageReached) {
            console.error('[background/bridge] performLoginSequence: Password page not reached after', maxWait, 'ms');
            console.log('[background/bridge] performLoginSequence: Proceeding anyway - page might be ready');
        }
        
        // Wait a bit for page elements to be ready
        console.log('[background/bridge] performLoginSequence: Waiting for password page elements to be ready...');
        await sleep(3000);
        
        // Inject step2Patch.js
        console.log('[background/bridge] performLoginSequence: Injecting step2Patch.js...');
        try {
            await chrome.scripting.executeScript({
                target: { tabId },
                files: ['modules/step2Patch.js']
            });
            console.log('[background/bridge] performLoginSequence: ✓ step2Patch.js injected');
        } catch (e) {
            console.error('[background/bridge] performLoginSequence: Failed to inject step2Patch.js:', e);
            return { ok: false, error: 'Failed to inject step2Patch: ' + e.message };
        }
        
        // Wait a bit for the script to initialize
        await sleep(1000);
        
        // Send password - try multiple times if needed
        console.log('[background/bridge] performLoginSequence: Sending password to step2Patch...');
        let messageSent = false;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                await chrome.tabs.sendMessage(tabId, {
                    type: 'STEP2_SETTINGS',
                    email: email,
                    password: password,
                    autoSubmit: true
                });
                messageSent = true;
                console.log(`[background/bridge] performLoginSequence: ✓ Password message sent (attempt ${attempt})`);
                break;
            } catch (e) {
                console.warn(`[background/bridge] performLoginSequence: Message send attempt ${attempt} failed:`, e.message);
                if (attempt < 3) {
                    await sleep(1000);
                }
            }
        }
        
        if (!messageSent) {
            console.error('[background/bridge] performLoginSequence: ❌ Failed to send password message after 3 attempts');
            // Try direct injection as fallback
            console.log('[background/bridge] performLoginSequence: Trying direct password injection as fallback...');
            try {
                await chrome.scripting.executeScript({
                    target: { tabId },
                    func: (pwd) => {
                        console.log('[DF EXTENSION] 🔐 Direct password injection fallback...');
                        
                        let passwordInput = document.querySelector('#app_1_user_password');
                        if (!passwordInput) {
                            passwordInput = document.querySelector('input[type="password"]');
                        }
                        if (!passwordInput) {
                            passwordInput = document.querySelector('input[name*="password" i]');
                        }
                        if (!passwordInput) {
                            passwordInput = document.querySelector('input[id*="password" i]');
                        }
                        
                        if (passwordInput) {
                            passwordInput.value = pwd;
                            passwordInput.focus();
                            passwordInput.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
                            passwordInput.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
                            passwordInput.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true }));
                            passwordInput.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true }));
                            console.log('[DF EXTENSION] ✓ Password filled directly');
                            
                            setTimeout(() => {
                                let signInButton = document.querySelector('#auth-1-submit-btn');
                                if (!signInButton) {
                                    signInButton = document.querySelector('input[type="submit"][value="Sign in"]');
                                }
                                if (!signInButton) {
                                    signInButton = document.querySelector('button[type="submit"]');
                                }
                                if (!signInButton) {
                                    signInButton = document.querySelector('input[type="submit"]');
                                }
                                if (!signInButton) {
                                    const buttons = Array.from(document.querySelectorAll('button, input[type="submit"]'));
                                    signInButton = buttons.find(btn => 
                                        (btn.textContent || btn.value || '').toLowerCase().includes('sign in') ||
                                        (btn.textContent || btn.value || '').toLowerCase().includes('submit')
                                    );
                                }
                                
                                if (signInButton) {
                                    console.log('[DF EXTENSION] ✓ Clicking sign in button');
                                    signInButton.focus();
                                    signInButton.click();
                                } else {
                                    console.error('[DF EXTENSION] ❌ Sign in button not found');
                                }
                            }, 500);
                        } else {
                            console.error('[DF EXTENSION] ❌ Password input not found with any selector');
                        }
                    },
                    args: [password]
                });
                console.log('[background/bridge] performLoginSequence: ✓ Direct password injection completed');
            } catch (e) {
                console.error('[background/bridge] performLoginSequence: ❌ Direct injection also failed:', e);
                return { ok: false, error: 'Failed to send password: ' + e.message };
            }
        }
        
        // Wait a bit for password to be processed
        await sleep(2000);
        
        // Wait for login to complete (redirect to dashboard)
        console.log('[background/bridge] performLoginSequence: Waiting for login to complete...');
        let loginComplete = false;
        const loginMaxWait = 30000;
        const loginStartTime = Date.now();
        
        while (Date.now() - loginStartTime < loginMaxWait && !loginComplete) {
            await sleep(1000);
            try {
                const tab = await chrome.tabs.get(tabId);
                const currentUrl = tab.url || '';
                console.log('[background/bridge] performLoginSequence: Checking login status, URL:', currentUrl);
                
                if (currentUrl && !currentUrl.includes('auth')) {
                    loginComplete = true;
                    console.log('[background/bridge] performLoginSequence: ✓ Login successful! Redirected to:', currentUrl);
                    break;
                }
                
                if (currentUrl.includes('app.uniteus.io') && !currentUrl.includes('app.auth.uniteus.io')) {
                    loginComplete = true;
                    console.log('[background/bridge] performLoginSequence: ✓ Detected dashboard/UniteUs page:', currentUrl);
                    break;
                }
            } catch (e) {
                console.warn('[background/bridge] performLoginSequence: Error checking tab:', e);
            }
        }
        
        if (loginComplete) {
            await sleep(2000);
            console.log('[background/bridge] performLoginSequence: ✓ Login complete and ready');
            return { ok: true, loginComplete: true };
        } else {
            try {
                const tab = await chrome.tabs.get(tabId);
                const finalUrl = tab.url || '';
                if (finalUrl && !finalUrl.includes('auth')) {
                    console.log('[background/bridge] performLoginSequence: ✓ Login successful on final check:', finalUrl);
                    return { ok: true, loginComplete: true };
                } else {
                    console.error('[background/bridge] performLoginSequence: ❌ Login timeout - still on auth page:', finalUrl);
                    return { ok: false, error: 'Login timeout - did not redirect from auth page' };
                }
            } catch (e) {
                console.error('[background/bridge] performLoginSequence: ❌ Login timeout - error checking final URL:', e);
                return { ok: false, error: 'Login timeout - error: ' + e.message };
            }
        }
    } catch (e) {
        console.error("[background/bridge] performLoginSequence error:", e);
        return { ok: false, error: e?.message || String(e) };
    }
}

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
    
    // Before throwing, check if we're on an auth page - if so, perform login and retry
    try {
        const tab = await chrome.tabs.get(tabId);
        const currentUrl = tab.url || '';
        if (currentUrl.toLowerCase().includes('auth')) {
            console.log(`[background/bridge] Element ${xpath} timeout detected on auth page, performing login sequence...`);
            const loginResult = await performLoginSequence(tabId);
            if (loginResult.ok) {
                console.log(`[background/bridge] Login successful, retrying wait for element...`);
                // Retry waiting for the element after login
                const retryStarted = Date.now();
                const retryTimeout = 30000; // Give it 30 seconds after login
                while (Date.now() - retryStarted < retryTimeout) {
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
                throw new Error(`Element ${xpath} never became visible/interactable after login within ${retryTimeout}ms`);
            } else {
                throw new Error(`Element ${xpath} never became visible/interactable within ${timeoutMs}ms (login attempt failed: ${loginResult.error || 'unknown'})`);
            }
        }
    } catch (e) {
        // If checking URL or login fails, throw the original error
        if (e.message.includes('never became visible/interactable')) {
            throw e;
        }
        console.warn(`[background/bridge] Error checking auth URL or performing login:`, e);
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
    // Selectors first (source of truth for elements) so other modules can use window.UNITE_SELECTORS
    await tryInject(tabId, ["modules/uniteSelectors.js"]);
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

            console.log('[🔍 DUPLICATE CHECK] Looking for:', {
                startMDY: expect.startMDY,
                endMDY: expect.endMDY,
                amount: expect.amount,
                wantCents,
                start,
                end
            });

            const cards = Array.from(document.querySelectorAll('.fee-schedule-provided-service-card'));
            console.log(`[🔍 DUPLICATE CHECK] Found ${cards.length} invoice cards on page`);

            for (let i = 0; i < cards.length; i++) {
                const card = cards[i];
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

                const centsMatch = cardCents === wantCents;
                const startMatch = sameDay(s, start);
                const endMatch = sameDay(e, end);

                console.log(`[🔍 DUPLICATE CHECK] Card ${i+1}:`, {
                    txtAmt,
                    txtRange,
                    cardCents,
                    wantCents,
                    centsMatch,
                    startMatch,
                    endMatch,
                    cardStart: s,
                    wantStart: start,
                    cardEnd: e,
                    wantEnd: end
                });

                if (Number.isFinite(cardCents) && s && e &&
                    cardCents === wantCents &&
                    sameDay(s, start) && sameDay(e, end)) {
                    console.log(`[🔍 DUPLICATE CHECK] ✅ MATCH FOUND!`);
                    return { ok: true, note: 'matched card' };
                }
            }

            console.log('[🔍 DUPLICATE CHECK] ❌ No matching card found');

            // check for error/draft banners to help debug
            const anyError = !!document.querySelector('[role="alert"], .alert, .error, .toast--error');
            return { ok: false, note: anyError ? 'page error seen' : 'no match' };
        },
        args: [expect]
    });
    return result || { ok: false, note: 'no-result' };
}

// Poll verify with short intervals; used after billing IIFE.
async function verifyBilling(tabId, expect, timeoutMs = 15000, intervalMs = 400) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const r = await runVerifyInPage(tabId, expect);
        if (r?.ok) return { ok: true, note: r.note || "matched" };
        await new Promise(r => setTimeout(r, intervalMs));
    }
    return { ok: false, note: "timeout" };
}

// Also used as a *pre-check* before billing to detect duplicates.
async function precheckDuplicate(tabId, expect) {
    const r = await runVerifyInPage(tabId, expect);
    return !!(r && r.ok);
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

            // --- Check auth info on page (uses window.UNITE_SELECTORS when present) ---
            if (msg.type === "CHECK_AUTH_INFO") {
                const tabId = await ensureHttpTab(await resolveTabId(msg.tabId, sender));
                await ensureInjected(tabId); // so window.UNITE_SELECTORS is available
                const results = await chrome.scripting.executeScript({
                    target: { tabId },
                    func: () => {
                        console.log('[AUTH CHECK] Looking for auth elements...');
                        const byXPath = (xp) => xp && document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                        const auth = (typeof window !== 'undefined' && window.UNITE_SELECTORS && window.UNITE_SELECTORS.billing && window.UNITE_SELECTORS.billing.authorizedTable) || null;
                        const aid = auth ? auth.amount.id : 'basic-table-authorized-amount-value';
                        const did = auth ? auth.date.id : 'basic-table-authorized-service-delivery-date-s-value';
                        const axp = auth && auth.amount.xpath ? auth.amount.xpath : '//*[@id="basic-table-authorized-amount-value"]';
                        const dxp = auth && auth.date.xpath ? auth.date.xpath : '/html/body/div[2]/div[2]/main/div/section/div/div[2]/div/div[1]/div[1]/div[2]/div[3]/div/div[1]/div/table/tbody/tr[3]/td[2]';
                        let amountEl = document.querySelector('#' + aid);
                        let datesEl = document.querySelector('#' + did);
                        if (!amountEl) amountEl = byXPath(axp);
                        if (!datesEl) datesEl = byXPath(dxp);
                        console.log('[AUTH CHECK] amountEl:', !!amountEl, 'datesEl:', !!datesEl);
                        if (amountEl && datesEl) {
                            const amountSpan = amountEl.querySelector('span');
                            const amountText = (amountSpan ? amountSpan.textContent : amountEl.textContent) || '';
                            const result = { found: true, authorizedAmount: amountText.trim(), authorizedDates: (datesEl.textContent || '').trim() };
                            console.log('[AUTH CHECK] ✅ Found auth info');
                            return result;
                        }
                        console.log('[AUTH CHECK] ❌ Auth elements not found');
                        return { found: false };
                    }
                });
                sendResponse({ ok: true, result: results?.[0]?.result });
                return;
            }

            // --- Execute arbitrary script in page (CSP-safe: only property access/delete) ---
            if (msg.type === "DF_EXEC_SCRIPT") {
                const tabId = await ensureHttpTab(await resolveTabId(msg.tabId, sender));
                const results = await chrome.scripting.executeScript({
                    target: { tabId },
                    func: (code) => {
                        try {
                            // Handle "delete window.foo; delete window.bar;"
                            if (code.includes('delete ')) {
                                const deleteStatements = code.split(';').map(s => s.trim()).filter(s => s.startsWith('delete '));
                                for (const stmt of deleteStatements) {
                                    const prop = stmt.replace(/^delete\s+window\./, '').replace(/;$/, '');
                                    if (prop && window.hasOwnProperty(prop)) {
                                        delete window[prop];
                                    }
                                }
                                return { ok: true, deleted: deleteStatements.length };
                            }

                            // Safe property access without eval
                            // Supports: "window.foo", "window.foo.bar", etc.
                            const path = code.replace(/^window\./, '').split('.');
                            let value = window;
                            for (const key of path) {
                                if (key === '') continue; // Handle "window" prefix
                                value = value?.[key];
                                if (value === undefined) break;
                            }
                            return value;
                        } catch (e) {
                            return { __error: e?.message || String(e) };
                        }
                    },
                    args: [msg.code || ""]
                });
                sendResponse({ ok: true, result: results?.[0]?.result });
                return;
            }

            // --- Billing page verification hooks ---
            if (msg.type === "DF_BILLING_PRECHECK") {
                const tabId = await ensureHttpTab(await resolveTabId(msg.tabId, sender));
                const exists = await precheckDuplicate(tabId, msg.expect || {});
                sendResponse({ ok: true, exists });
                return;
            }
            if (msg.type === "DF_BILLING_VERIFY") {
                const tabId = await ensureHttpTab(await resolveTabId(msg.tabId, sender));
                const out = await verifyBilling(tabId, msg.expect || {}, msg.timeoutMs || 15000, msg.intervalMs || 400);
                sendResponse(out);
                return;
            }

            // --- Cookie and browsing data deletion ---
            if (msg.type === "DF_CLEAR_COOKIES_AND_DATA") {
                try {
                    console.log('[background/bridge] DF_CLEAR_COOKIES_AND_DATA received');
                    
                    // Clear browsing data for UniteUs domains (this includes cookies, cache, localStorage, sessionStorage)
                    try {
                        await chrome.browsingData.remove({
                            "origins": [
                                "https://app.uniteus.io",
                                "https://app.auth.uniteus.io",
                                "https://uniteus.io"
                            ]
                        }, {
                            "cookies": true,
                            "cache": true,
                            "localStorage": true,
                            "sessionStorage": true
                        });
                        console.log("[background/bridge] ✓ Cleared browsing data for UniteUs domains");
                    } catch (e) {
                        console.warn("[background/bridge] Failed to clear browsing data:", e);
                    }
                    
                    // Also try to clear cookies directly for the domains
                    try {
                        const domains = ["app.uniteus.io", "app.auth.uniteus.io", "uniteus.io"];
                        for (const domain of domains) {
                            const cookies = await chrome.cookies.getAll({ domain: domain });
                            for (const cookie of cookies) {
                                try {
                                    const cookieUrl = `${cookie.secure ? 'https' : 'http'}://${cookie.domain}${cookie.path || '/'}`;
                                    await chrome.cookies.remove({
                                        url: cookieUrl,
                                        name: cookie.name
                                    });
                                } catch (e) {
                                    // Ignore individual cookie removal errors
                                }
                            }
                        }
                        console.log("[background/bridge] ✓ Cleared cookies for UniteUs domains");
                    } catch (e) {
                        console.warn("[background/bridge] Failed to clear cookies directly:", e);
                    }
                    
                    sendResponse({ ok: true });
                    return;
                } catch (e) {
                    console.error("[background/bridge] DF_CLEAR_COOKIES_AND_DATA error:", e);
                    sendResponse({ ok: false, error: e?.message || String(e) });
                    return;
                }
            }

            // --- Programmatic login sequence ---
            if (msg.type === "DF_DO_LOGIN") {
                try {
                    console.log('[background/bridge] DF_DO_LOGIN received');
                    const tabId = await ensureHttpTab(await resolveTabId(msg.tabId, sender));
                    const email = msg.email || "orit@dietfantasy.com";
                    const password = msg.password || "Diet1234fantasy";
                    
                    const loginResult = await performLoginSequence(tabId, email, password);
                    sendResponse(loginResult);
                    return;
                } catch (e) {
                    console.error("[background/bridge] DF_DO_LOGIN error:", e);
                    sendResponse({ ok: false, error: e?.message || String(e) });
                    return;
                }
            }

            // --- Billing: inject params + enterBillingDetails (selectors injected first) ---
            if (msg.type === "INJECT_BILLING_SCRIPT") {
                (async () => {
                    try {
                        const tabId = await ensureHttpTab(await resolveTabId(msg.tabId, sender));
                        await ensureInjected(tabId); // injects uniteSelectors first
                        await chrome.scripting.executeScript({
                            target: { tabId },
                            func: (incoming) => { window.__BILLING_INPUTS__ = incoming; },
                            args: [msg.billingParams || {}],
                        });
                        await chrome.scripting.executeScript({
                            target: { tabId },
                            files: ['modules/enterBillingDetails.js'],
                        });
                        let billingResp = null;
                        const t0 = Date.now();
                        while (Date.now() - t0 < 12000) {
                            const [result] = await chrome.scripting.executeScript({
                                target: { tabId },
                                func: () => window.__billingResult || null,
                            });
                            if (result?.result) {
                                billingResp = result.result;
                                await chrome.scripting.executeScript({ target: { tabId }, func: () => { delete window.__billingResult; } });
                                break;
                            }
                            await new Promise(r => setTimeout(r, 200));
                        }
                        sendResponse(billingResp || { ok: false, error: 'Billing timeout: No result after 12s' });
                    } catch (e) {
                        sendResponse({ ok: false, error: e?.message || String(e) });
                    }
                })();
                return true;
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

            sendResponse({ ok:false, error:"Unknown message type: " + (msg?.type || "undefined") });
        } catch (e) {
            sendResponse({ ok:false, error: e?.message || String(e) });
        }
    })();
    return true;
});