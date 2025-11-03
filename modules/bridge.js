// background/bridge.js

// ---------- utils ----------
function ab2b64(buf) {
    const bytes = new Uint8Array(buf);
    const chunk = 0x8000;
    let binary = "";
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}

async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab");
    return tab;
}

// ---------- auto-inject content scripts (from modules/) ----------
const INJECT_FILES = [
    "modules/personInfo.js",
    "modules/uploadpdf.js",
    "modules/attestationFlow.js",
    "modules/invoiceScanner.js",   // 👈 NEW
    "modules/navigatorAgent.js",
    "modules/dispatcher.js",
];

async function ensureInjected(tabId) {
    // Ping content. If it fails, inject our modules and ping again.
    try {
        const ping = await chrome.tabs.sendMessage(tabId, { type: "PING" });
        if (ping?.ok) return; // already there
    } catch {
        // will inject
    }

    await chrome.scripting.executeScript({
        target: { tabId, allFrames: false }, // top frame only to avoid duplicates
        files: INJECT_FILES,
    });

    await new Promise(r => setTimeout(r, 60));

    // Verify injection
    try {
        const ping2 = await chrome.tabs.sendMessage(tabId, { type: "PING" });
        if (!ping2?.ok) throw new Error("Post-inject PING failed");
    } catch (e) {
        throw new Error(
            "Injection failed. Confirm manifest.json exposes 'modules/*' under web_accessible_resources and files exist."
        );
    }
}

// ---------- message router ----------
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || !msg.type) return;

    // Background ping
    if (msg.type === "PING") {
        sendResponse({ ok: true, from: "background" });
        return;
    }

    // Progress events: quiet ack
    if (msg.type === "GEN_UPLOAD_PROGRESS" || msg.type === "NAV_PROGRESS") {
        sendResponse({ ok: true });
        return;
    }
    // Handle Generate+Upload end-to-end from background
    if (msg.type === "GENERATE_AND_UPLOAD") {
        (async () => {
            try {
                const tab = await getActiveTab();
                await ensureInjected(tab.id);

                // Normalize to ISO YYYY-MM-DD (accepts ISO or MM/DD/YYYY)
                const toISO = (s) => {
                    if (typeof s !== "string") return null;
                    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; // already ISO
                    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
                    if (m) {
                        const mm = m[1].padStart(2, "0");
                        const dd = m[2].padStart(2, "0");
                        const yyyy = m[3];
                        return `${yyyy}-${mm}-${dd}`;
                    }
                    return null;
                };

                const chosenISO     = toISO(msg.chosenDate)     || msg.chosenDate     || null;
                const attestISO     = toISO(msg.attestationISO) || chosenISO          || null;
                const startISO      = toISO(msg.startISO)       || null;
                const endISO        = toISO(msg.endISO)         || null;
                const backendUrl    = msg.backendUrl;

                // Make params available in page (content script reads these)
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: (p) => { window.__ATT_POPUP_PARAMS__ = p; },
                    args: [{
                        chosenDate: chosenISO,        // delivery day
                        attestationISO: attestISO,    // explicit attestation
                        startISO,                     // service period start
                        endISO                        // service period end
                    }],
                });

                // Ensure generator is present (safe; your ensureInjected already loads modules/*)
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: ["modules/attestationFlow.js"],
                });

                // Call generator in the page; return its result
                const [res] = await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: async (url) => {
                        try {
                            if (!window.attestationFlow?.generateAndUpload) {
                                return { ok: false, step: "content", error: "attestationFlow not loaded" };
                            }
                            return await window.attestationFlow.generateAndUpload({ backendUrl: url });
                        } catch (e) {
                            return { ok: false, step: "content", error: (e && e.message) || String(e) };
                        }
                    },
                    args: [backendUrl],
                });

                sendResponse(res?.result ?? res ?? { ok: false, error: "No result" });
            } catch (e) {
                sendResponse({ ok: false, step: "bg", error: e?.message || String(e) });
            }
        })();
        return true; // async
    }
    // ADD this block above the generic "forward everything else" section
    if (msg.type === "NAV_START") {
        (async () => {
            try {
                const tab = await getActiveTab();
                await ensureInjected(tab.id);

                // Expose skip keys to the page context so navigatorAgent can read them
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: (keys) => { window.__SKIP_KEYS__ = Array.isArray(keys) ? keys : []; },
                    args: [msg.skipKeys || []],
                });

                // Now forward NAV_START to the content-side dispatcher / agent
                const resp = await chrome.tabs.sendMessage(tab.id, msg);
                sendResponse(resp || { ok: true });
            } catch (e) {
                sendResponse({ ok: false, error: e?.message || String(e) });
            }
        })();
        return true; // async
    }

    // NEW: Background fetch of public PDFs (bypass page CSP)
    if (msg.type === "FETCH_FILE_BYTES") {
        (async () => {
            try {
                const { url, filename } = msg;
                const res = await fetch(url, { credentials: "omit" });
                if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);

                // Try to use provided filename, content-disposition, or URL
                const cd = res.headers.get("content-disposition") || "";
                let name = filename || "";
                const m = /filename\*?=(?:UTF-8''|")?([^\";]+)/i.exec(cd);
                if (m && m[1]) name = decodeURIComponent(m[1].replace(/"/g, ""));
                if (!name) {
                    try { name = new URL(url).pathname.split('/').filter(Boolean).pop() || 'download'; }
                    catch { name = 'download'; }
                }
                if (!/\.pdf$/i.test(name)) name += ".pdf"; // ensure .pdf extension

                const ab = await res.arrayBuffer();
                const bytes = Array.from(new Uint8Array(ab)); // structured-clone friendly

                // Force PDF MIME for the site validators
                sendResponse({ ok: true, bytes, mime: "application/pdf", filename: name });
            } catch (e) {
                sendResponse({ ok: false, error: e?.message || String(e) });
            }
        })();
        return true; // async
    }

    // Server proxy: generate attestation PDF and return as base64
    if (msg.type === "FETCH_ATTESTATION") {
        (async () => {
            try {
                const { backendUrl, payload } = msg;
                const res = await fetch(backendUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                    cache: "no-store",
                    redirect: "follow"
                });

                const status = res.status;
                const contentType = res.headers.get("content-type") || "";

                if (status === 200) {
                    const buf = await res.arrayBuffer();
                    const b64 = ab2b64(buf);
                    sendResponse({ ok: true, status, contentType, dataB64: b64 });
                } else {
                    let body = null;
                    try { body = await res.json(); } catch { body = await res.text(); }
                    sendResponse({ ok: false, status, contentType, body });
                }
            } catch (e) {
                sendResponse({ ok: false, error: e?.message || String(e) });
            }
        })();
        return true; // async
    }

    // NEW: Inject billing script and set billing inputs
// background/bridge.js (REPLACE the whole INJECT_BILLING_SCRIPT block)
    if (msg.type === "INJECT_BILLING_SCRIPT") {
        (async () => {
            try {
                const tab = await getActiveTab();
                await ensureInjected(tab.id); // includes invoiceScanner.js now

                // Stash billing params in page
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: (incoming) => { window.__BILLING_INPUTS__ = incoming; },
                    args: [msg.billingParams],
                });

                // --- Duplicate precheck ---
                const toDate = (s) => {
                    if (!s) return null;
                    const d = new Date(s);
                    return isNaN(d) ? null : d;
                };
                const inclusiveDays = (a, b) => {
                    const d0 = new Date(a.getFullYear(), a.getMonth(), a.getDate());
                    const d1 = new Date(b.getFullYear(), b.getMonth(), b.getDate());
                    return Math.floor((d1 - d0) / 86400000) + 1;
                };

                const p = msg.billingParams || {};
                const startD = toDate(p.start);
                const endD   = toDate(p.end) || startD;
                const rpd    = Number(p.ratePerDay || 48) || 48;

                let duplicate = false;
                let matched = null;

                if (startD && endD) {
                    const days = Math.max(1, inclusiveDays(startD, endD));
                    const plannedAmount = rpd * days;

                    // 1) Same dates + same amount
                    const [scan1] = await chrome.scripting.executeScript({
                        target: { tabId: tab.id },
                        func: (args) => {
                            try {
                                if (!window.invoiceScanner?.findExisting) return { ok:false, error:"invoiceScanner missing" };
                                const out = window.invoiceScanner.findExisting(args);
                                return { ok:true, out };
                            } catch (e) { return { ok:false, error: e?.message || String(e) }; }
                        },
                        args: [{ start: startD, end: endD, amount: plannedAmount, requireTitle: null }],
                    });
                    const res1 = scan1?.result;
                    if (res1?.ok && res1.out?.exists) {
                        duplicate = true;
                        matched = (res1.out.matches || [])[0] || null;
                    }

                    // 2) If not, dates-only (ignore amount) — safer “don’t even try”
                    if (!duplicate) {
                        const [scan2] = await chrome.scripting.executeScript({
                            target: { tabId: tab.id },
                            func: (args) => {
                                try {
                                    const norm = (s) => String(s||"").replace(/\s+/g," ").trim();
                                    const sameDay = (a,b)=>a&&b&&a.getTime()===b.getTime();
                                    const toD = (v)=>{ const d=new Date(v); if(isNaN(d))return null; d.setHours(0,0,0,0); return d; };

                                    const cards = Array.from(document.querySelectorAll(".fee-schedule-provided-service-card"));
                                    const tS = toD(args.start), tE = toD(args.end);

                                    let matches = [];
                                    for (const card of cards) {
                                        const rangeEl = card.querySelector('[data-test-element="service-dates-value"], [data-test-element="service-start-date-value"]');
                                        const txt = norm(rangeEl?.textContent);
                                        if (!txt) continue;
                                        let s=null, e=null;
                                        const parts = txt.split(/\s*-\s*/);
                                        if (parts.length === 2) { s = toD(parts[0]); e = toD(parts[1]); }
                                        else { s = toD(txt); e = s; }
                                        if (sameDay(s,tS) && sameDay(e,tE)) {
                                            matches.push({ datesText: txt });
                                        }
                                    }
                                    return { ok:true, exists: matches.length>0, matches };
                                } catch (e) { return { ok:false, error: e?.message || String(e) }; }
                            },
                            args: [{ start: startD, end: endD }],
                        });
                        const res2 = scan2?.result;
                        if (res2?.ok && res2.exists) {
                            duplicate = true;
                            matched = (res2.matches || [])[0] || null;
                        }
                    }
                }

                if (duplicate) {
                    // Close any open billing shelf (best-effort)
                    await chrome.scripting.executeScript({
                        target: { tabId: tab.id },
                        func: () => {
                            try {
                                const byXP = (xp) => document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue || null;
                                const CANCEL_ID = 'fee-schedule-provided-service-cancel-btn';
                                const CANCEL_XP = '/html/body/div[2]/div[2]/main/div/section/div/div[2]/div/div[1]/div[2]/div[2]/div[2]/div/form/div[10]/button';
                                const form = document.querySelector('form.payments-track-service');
                                const isOpen = !!form && (form.offsetParent !== null || (form.getClientRects?.().length||0) > 0);
                                if (isOpen) {
                                    const btn = document.getElementById(CANCEL_ID) || byXP(CANCEL_XP);
                                    btn?.click();
                                }
                            } catch {}
                            // Also tag a result so any polling sees it
                            window.__billingResult = { ok:false, duplicate:true, error:'Duplicate invoice' };
                        },
                    });

                    // Surface as a normal error to Navigator
                    try {
                        chrome.runtime.sendMessage({
                            type: "NAV_PROGRESS",
                            event: "billing:error",
                            key: p.key || null,
                            name: p.name || null,
                            error: "Duplicate invoice detected (precheck)",
                        });
                    } catch {}

                    sendResponse({ ok:false, duplicate:true, match: matched || null, error:"Duplicate invoice" });
                    return;
                }

                // --- No duplicate → proceed as before ---
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: ['modules/enterBillingDetails.js'],
                });

                // Poll page for result
                let billingResp = null;
                const t0 = Date.now();
                while (Date.now() - t0 < 20000) {
                    const [result] = await chrome.scripting.executeScript({
                        target: { tabId: tab.id },
                        func: () => window.__billingResult || null,
                    });
                    if (result?.result) {
                        billingResp = result.result;
                        await chrome.scripting.executeScript({
                            target: { tabId: tab.id },
                            func: () => { delete window.__billingResult; },
                        });
                        break;
                    }
                    await new Promise(r => setTimeout(r, 250));
                }
                if (!billingResp) throw new Error('Billing timeout: No result after 20s');
                sendResponse(billingResp);
            } catch (e) {
                sendResponse({ ok:false, error: e?.message || String(e) });
            }
        })();
        return true; // async
    }

    // NEW: Dynamic file injection handler
    if (msg.type === "INJECT_FILE") {
        (async () => {
            try {
                const tab = await getActiveTab();
                await ensureInjected(tab.id);
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: [msg.file],
                });
                sendResponse({ ok: true });
            } catch (e) {
                sendResponse({ ok: false, error: e?.message || String(e) });
            }
        })();
        return true; // async
    }

    // For all other commands: ensure content injected, then forward to content (dispatcher)
    (async () => {
        try {
            const tab = await getActiveTab();
            await ensureInjected(tab.id);
            const resp = await chrome.tabs.sendMessage(tab.id, msg);
            sendResponse(resp || { ok: true });
        } catch (e) {
            sendResponse({
                ok: false,
                error: e?.message || String(e),
                hint: "If the error mentions a path, confirm files are under /modules and manifest.json has web_accessible_resources -> modules/*."
            });
        }
    })();

    return true; // async
});