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
                console.log('[bridge.js] GENERATE_AND_UPLOAD received:', msg);
                console.log('[bridge.js] msg.userId =', msg.userId);

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
                const userId        = msg.userId || null;

                console.log('[bridge.js] Extracted userId:', userId, 'from msg.userId:', msg.userId);

                // Make params available in page (content script reads these)
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: (p) => { window.__ATT_POPUP_PARAMS__ = p; },
                    args: [{
                        chosenDate: chosenISO,        // delivery day
                        attestationISO: attestISO,    // explicit attestation
                        startISO,                     // service period start
                        endISO,                       // service period end
                        userId                        // user ID from database
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
                    func: async (url, uid) => {
                        try {
                            if (!window.attestationFlow?.generateAndUpload) {
                                return { ok: false, step: "content", error: "attestationFlow not loaded" };
                            }
                            return await window.attestationFlow.generateAndUpload({ backendUrl: url, userId: uid });
                        } catch (e) {
                            return { ok: false, step: "content", error: (e && e.message) || String(e) };
                        }
                    },
                    args: [backendUrl, userId],
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

                // Duplicate check now happens inside enterBillingDetails.js with actual billing dates
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: ['modules/enterBillingDetails.js'],
                });

                // Poll page for result
                let billingResp = null;
                const t0 = Date.now();
                while (Date.now() - t0 < 12000) {  // Reduced from 20s to 12s
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
                    await new Promise(r => setTimeout(r, 200));  // Reduced from 250ms to 200ms for faster detection
                }
                if (!billingResp) throw new Error('Billing timeout: No result after 12s');
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