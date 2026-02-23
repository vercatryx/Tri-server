const { performLoginSequence } = require('./auth');
const axios = require('axios');
const { executeBillingOnPage } = require('./billingActions');
const { getPage, restartBrowser } = require('./browser');
const uniteSelectors = require('../uniteSelectors');
const fs = require('fs');
const path = require('path');

require('dotenv').config();

const EMAIL = process.env.UNITEUS_EMAIL;
const PASSWORD = process.env.UNITEUS_PASSWORD;

// --- API CONFIG DEFAULTS ---
const DEFAULT_API_BASE_URL = process.env.EXTENSION_API_BASE_URL || 'http://localhost:3000';
const DEFAULT_API_KEY = process.env.EXTENSION_API_KEY || 'justtomakesureicanlockyouout';

/** Parse structured error message from billing flow. Returns { step, type, details } for clear logging. */
function parseBillingError(message) {
    const msg = String(message || '');
    const stepMatch = msg.match(/\[STEP:([^\]]+)\]/);
    const typeMatch = msg.match(/\[TYPE:([^\]]+)\]/);
    let details = msg
        .replace(/\[STEP:[^\]]+\]\s*/, '')
        .replace(/\[TYPE:[^\]]+\]\s*/, '')
        .trim();
    const step = stepMatch ? stepMatch[1] : (msg.includes('closed') || msg.includes('page.goto') ? 'navigation' : 'unknown');
    const type = typeMatch ? typeMatch[1] : (msg.includes('closed') || msg.includes('has been closed') ? 'BROWSER_CLOSED' : (msg.includes('timeout') ? 'TIMEOUT' : 'UNKNOWN'));
    return { step, type, details: details || msg };
}

// --- Helpers for API ---
async function fetchRequestsFromApi(config) {
    const baseUrl = config?.baseUrl || DEFAULT_API_BASE_URL;
    const key = config?.key || DEFAULT_API_KEY;

    // Mask key for logging: show first 4 chars
    const maskedKey = key.length > 4 ? `${key.substring(0, 4)}...` : '(empty)';
    console.log(`[API] GET ${baseUrl}/api/extension/billing-requests`);
    console.log(`[API] Using Token: Bearer ${maskedKey}`);

    try {
        const res = await axios.get(`${baseUrl}/api/extension/billing-requests`, {
            headers: { 'Authorization': `Bearer ${key}` }
        });

        if (!Array.isArray(res.data)) {
            console.error('[API] Unexpected response format:', typeof res.data);
            if (typeof res.data === 'string' && res.data.trim().startsWith('<')) {
                throw new Error('Received HTML instead of JSON. Check API URL.');
            }
            throw new Error(`Expected array, got ${typeof res.data}`);
        }

        return res.data;
    } catch (err) {
        console.error('[API] Fetch Error:', err.message);
        if (err.response) {
            console.error('[API] Response Status:', err.response.status);
            console.error('[API] Response Data:', JSON.stringify(err.response.data).substring(0, 200));
        }
        throw err;
    }
}

/**
 * Scrapes authorization details (Date Opened, Authorized End Date, Max Amount) from the UniteUs page.
 */
async function fetchAuthDetailsFromPage(page) {
    console.log('[Worker] Scraping auth details from page...');
    const authSel = uniteSelectors.billing.authorizedTable;
    try {
        const auth = await page.evaluate((authSel) => {
            const byXPath = (xp) =>
                document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue || null;
            const norm = (s) => String(s || "").trim();

            let datesEl = document.querySelector('#' + authSel.date.id);
            if (!datesEl && authSel.date.xpath) datesEl = byXPath(authSel.date.xpath);

            let dateOpenedEl = document.querySelector('#' + authSel.dateOpened.id);
            if (!dateOpenedEl && authSel.dateOpened.xpath) dateOpenedEl = byXPath(authSel.dateOpened.xpath);

            let amountEl = document.querySelector('#' + authSel.amount.id);
            if (!amountEl && authSel.amount.xpath) amountEl = byXPath(authSel.amount.xpath);

            const datesText = norm(datesEl?.textContent);
            const dateOpenedP = dateOpenedEl?.querySelector('p.service-case-program-entry__text');
            const dateOpenedText = norm(dateOpenedP ? dateOpenedP.textContent : dateOpenedEl?.textContent);
            const amountText = norm(amountEl?.textContent);

            return {
                authorizedDates: datesText,
                dateOpened: dateOpenedText,
                authorizedAmount: amountText
            };
        }, authSel);
        console.log('[Worker] Scraped auth details:', auth);
        return auth;
    } catch (err) {
        console.error('[Worker] Failed to scrape auth details:', err.message);
        return { authorizedDates: "", dateOpened: "", authorizedAmount: "" };
    }
}

/**
 * Scrapes client details (name, phone, address) from the UniteUs page.
 * Ported from personInfo.js logic.
 */
async function fetchClientDetailsFromPage(page) {
    console.log('[Worker] Scraping client details from page...');
    try {
        // Wait for name to appear at least
        try {
            await page.waitForSelector('.contact-column__name', { timeout: 10000 });
        } catch (e) {
            console.warn('[Worker] Name selector not found, attempting to scrape anyway.');
        }

        const details = await page.evaluate(() => {
            const norm = (s) => String(s || "").trim();
            const digits = (s) => String(s || "").replace(/\D+/g, "");

            function parseName() {
                const h = document.querySelector(".contact-column__name");
                return norm(h?.textContent) || "";
            }

            function parsePhone() {
                const span = document.querySelector("[data-test-element='phone-numbers_number_0']");
                let raw = norm(span?.textContent);
                if (!raw) {
                    const a = document.querySelector(".ui-contact-information__compact-phone a[href^='tel:']");
                    raw = norm(a?.textContent || a?.getAttribute?.("href")?.replace(/^tel:/, ""));
                }
                const d = digits(raw);
                if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
                if (d.length === 11 && d.startsWith("1")) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
                return raw || "";
            }

            function parseAddress() {
                const details = document.querySelector(".address .address__details");
                if (details) {
                    const ps = Array.from(details.querySelectorAll("p")).map(p => norm(p.textContent)).filter(Boolean);
                    const filtered = ps.filter(line => !/^primary$/i.test(line) && !/county$/i.test(line));
                    return filtered.join(", ").replace(/\s{2,}/g, " ").replace(/\s,/, ",");
                }
                const addrEl = document.querySelector(".address");
                return norm(addrEl?.textContent).replace(/\s{2,}/g, " ") || "";
            }

            return {
                name: parseName(),
                phone: parsePhone(),
                address: parseAddress()
            };
        });
        console.log('[Worker] Scraped details:', details);
        return details;
    } catch (err) {
        console.error('[Worker] Failed to scrape client details:', err.message);
        return { name: "", phone: "", address: "" };
    }
}

/**
 * Generates a proof URL (PDF as Data URI) using the Diet Fantasy API.
 */
async function generateProofUrl(clientDetails, requestData, config) {
    const baseUrl = config?.baseUrl || DEFAULT_API_BASE_URL;
    const url = `${baseUrl}/api/ext/attestation`;

    console.log(`[API] Generating attestation at ${url}`);

    const payload = {
        name: clientDetails.name || requestData.name || "Attestation",
        phone: clientDetails.phone || "",
        address: clientDetails.address || "",
        deliveryDate: requestData.start, // Use start date as delivery date
        startDate: requestData.start,
        endDate: requestData.end,
        attestationDate: new Date().toISOString().slice(0, 10),
        userId: requestData.userId || requestData['client#'] || null,
        clientId: requestData['client#'] || null
    };

    try {
        const res = await axios.post(url, payload, {
            responseType: 'arraybuffer'
        });

        const contentType = res.headers['content-type'] || 'application/pdf';
        const base64 = Buffer.from(res.data).toString('base64');
        return `data:${contentType};base64,${base64}`;
    } catch (err) {
        if (err.response && err.response.status === 404) {
            console.error('[API] Attestation Generation: No file found (404). skipping.');
            const error = new Error('[API] No attestation file available for this client');
            error.code = 'NO_ATTESTATION_FILE';
            throw error;
        }
        if (err.response && err.response.status === 409) {
            console.error('[API] Attestation Generation: Conflict/No Signature (409). skipping.');
            const error = new Error('[API] No signature available / Conflict detected');
            error.code = 'NO_SIGNATURE';
            throw error;
        }
        if (err.response && err.response.status === 422) {
            let detail = 'Invalid request data';
            try {
                // If response is arraybuffer, we might need to decode it to see JSON error
                if (err.response.data instanceof ArrayBuffer || Buffer.isBuffer(err.response.data)) {
                    const str = Buffer.from(err.response.data).toString();
                    const parsed = JSON.parse(str);
                    detail = parsed.error || parsed.message || detail;
                } else {
                    detail = err.response.data?.error || err.response.data?.message || detail;
                }
            } catch (e) { /* ignore parse error */ }

            console.error(`[API] Attestation Generation: Validation Error (422): ${detail}. skipping.`);
            const error = new Error(`[API] Validation Failed: ${detail}`);
            error.code = 'VALIDATION_ERROR';
            throw error;
        }
        console.error('[API] Attestation Generation Error:', err.message);
        throw err;
    }
}

async function updateOrderStatus(orderNumber, status, config) {
    if (!orderNumber) return;
    const baseUrl = config?.baseUrl || DEFAULT_API_BASE_URL;
    const key = config?.key || DEFAULT_API_KEY;

    console.log(`[API] Updating Order #${orderNumber} -> ${status}`);
    try {
        await axios.post(`${baseUrl}/api/extension/update-status`, {
            orderNumber: orderNumber,
            status: status
        }, {
            headers: {
                'Authorization': `Bearer ${key}`,
                'Content-Type': 'application/json'
            }
        });
        console.log(`[API] Status updated.`);
    } catch (err) {
        console.error(`[API] Update Failed for #${orderNumber}:`, err.message);
    }
}

/**
 * Main worker entry point.
 * @param {Array} requests - (Legacy) requests if passed directly, or null if using internal fetch
 * @param {function} emitEvent - Function to emit socket events
 * @param {string} source - 'file' (default) or 'api'
 */
async function billingWorker(initialRequests, emitEvent, source = 'file', apiConfig = null) {
    if (!EMAIL || !PASSWORD) {
        emitEvent('log', { message: '[AUTH] Missing UNITEUS_EMAIL or UNITEUS_PASSWORD in env.', type: 'error' });
        return;
    }

    emitEvent('log', { message: `Initializing Billing Cycle (Source: ${source})...` });

    // --- Load Requests based on Source ---
    let requests = initialRequests || [];
    if (!initialRequests || initialRequests.length === 0) {
        try {
            if (source === 'api') {
                requests = await fetchRequestsFromApi(apiConfig);
                if (!requests || requests.length === 0) {
                    emitEvent('log', { message: 'No pending requests found from API.' });
                    return;
                }
            } else {
                // Default: File loading logic (if not passed in)
                // If called from server.js with data, this block is skipped. 
                // But if we want to reload, we can. For now assume server.js passed it if 'file'.
                if (!requests || requests.length === 0) {
                    emitEvent('log', { message: 'No requests provided for file mode.' });
                    return;
                }
            }
        } catch (err) {
            emitEvent('error', { message: `Failed to load requests: ${err.message}` });
            return;
        }
    }

    emitEvent('log', { message: `Processing ${requests.length} requests...` });

    // --- Browser Setup ---
    let page = await getPage();

    // Helper to setup console logging on a page
    const setupPageLogging = (p) => {
        p.on('console', msg => {
            const text = msg.text();
            if (text.startsWith('[Injected]')) {
                console.log(`[Browser] ${text}`);
            } else if (msg.type() === 'error') {
                console.error(`[Browser Error] ${text}`);
            }
        });
    };
    setupPageLogging(page);

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    const isLoggedIn = async () => {
        try {
            const currentUrl = page.url();
            return currentUrl.includes('uniteus.io') && !currentUrl.includes('auth');
        } catch (e) { return false; }
    };

    // --- Processing Loop ---
    for (let i = 0; i < requests.length; i++) {
        const req = requests[i];

        req.status = 'processing';
        req.message = 'Starting...';
        emitEvent('queue', requests);
        emitEvent('log', { message: `Processing ${req.name} (${i + 1}/${requests.length})` });

        // API Status Tracking
        let resultSourceStatus = 'unknown';

        if (req.skip) {
            req.status = 'skipped';
            emitEvent('log', { message: 'Skipped by config.', type: 'warning' });
            emitEvent('queue', requests);
            continue;
        }

        // --- Base Date Calculation (Initial 7-day window) ---
        try {
            const [year, month, day] = req.date.split('-').map(Number);
            const reqStart = new Date(Date.UTC(year, month - 1, day));
            const reqEnd = new Date(reqStart);
            reqEnd.setUTCDate(reqEnd.getUTCDate() + 6); // 7 days inclusive

            const toISO = (d) => d.toISOString().split('T')[0];

            req.start = toISO(reqStart);
            req.end = toISO(reqEnd);

            emitEvent('log', { message: `Requested range: ${req.start} to ${req.end}` });
        } catch (e) {
            req.status = 'failed';
            emitEvent('log', { message: `[MISC] Invalid date: ${e.message}`, type: 'error' });
            if (source === 'api') updateOrderStatus(req.orderNumber, 'billing_failed', apiConfig);
            continue;
        }

        // --- Recursive Retry Logic (5 refreshes per session, 2 restarts per client) ---
        let restartAttempt = 0;
        const MAX_RESTARTS = 2; // Try up to 2 fresh browser sessions
        let success = false;
        let lastRefreshError = null;

        while (restartAttempt < MAX_RESTARTS && !success) {
            let refreshAttempt = 0;
            const MAX_REFRESHES = 5; // Try up to 5 refreshes per session

            while (refreshAttempt < MAX_REFRESHES && !success) {
                try {
                    // --- Login Check ---
                    if (!(await isLoggedIn())) {
                        emitEvent('log', { message: 'Logging in...' });
                        const loginOk = await performLoginSequence(EMAIL, PASSWORD);
                        if (!loginOk) {
                            throw new Error('[AUTH] Login failed');
                        }
                        await sleep(2000);
                    }

                    // --- Navigation and Refinement ---
                    if (!req.url) {
                        req.status = 'failed';
                        emitEvent('log', { message: '[NAV] Missing URL', type: 'error' });
                        if (source === 'api') updateOrderStatus(req.orderNumber, 'billing_failed', apiConfig);
                        success = true; // Break loop
                        break;
                    }

                    const attemptLabel = `(S${restartAttempt + 1}/R${refreshAttempt + 1})`;
                    emitEvent('log', { message: `Navigating to ${req.url} ${attemptLabel}...` });
                    await page.goto(req.url, { waitUntil: 'networkidle', timeout: 60000 });
                    await sleep(3000);

                    // Scrape Auth Info for Clamping
                    const authInfo = await fetchAuthDetailsFromPage(page);

                    // Clamping Logic
                    const parseMDY = (s) => {
                        const match = String(s || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
                        if (!match) return null;
                        return new Date(Date.UTC(+match[3], +match[1] - 1, +match[2]));
                    };

                    const dateOpened = parseMDY(authInfo.dateOpened);
                    const authDatesMatch = authInfo.authorizedDates.match(/(\d{1,2})\/\d{1,2}\/\d{4}\s*-\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/);
                    const authEnd = authDatesMatch ? new Date(Date.UTC(+authDatesMatch[4], +authDatesMatch[2] - 1, +authDatesMatch[3])) : null;

                    if (dateOpened || authEnd) {
                        const currentStart = new Date(req.start + 'T00:00:00Z');
                        const currentEnd = new Date(req.end + 'T00:00:00Z');
                        let finalStart = currentStart;
                        let finalEnd = currentEnd;

                        if (dateOpened && currentStart < dateOpened) {
                            emitEvent('log', { message: `[Clamping] Start date ${req.start} is before Date Opened ${authInfo.dateOpened}. Adjusting...` });
                            finalStart = dateOpened;
                        }
                        if (authEnd && currentEnd > authEnd) {
                            emitEvent('log', { message: `[Clamping] End date ${req.end} is after Auth End ${authInfo.authorizedDates.split('-')[1]}. Adjusting...` });
                            finalEnd = authEnd;
                        }

                        if (finalEnd < finalStart) {
                            const toISO = (d) => d.toISOString().split('T')[0];
                            const reqRange = `${req.start} to ${req.end}`;
                            const authRange = `${authInfo.dateOpened || 'N/A'} to ${authInfo.authorizedDates.split('-')[1] || 'N/A'}`;
                            const error = new Error(`[LIMITS] No overlap: Requested (${reqRange}) is outside authorized window (${authRange.trim()})`);
                            error.code = 'NO_OVERLAP';
                            throw error;
                        }

                        const toISO = (d) => d.toISOString().split('T')[0];
                        req.start = toISO(finalStart);
                        req.end = toISO(finalEnd);

                        const diffDays = Math.floor((finalEnd - finalStart) / (1000 * 60 * 60 * 24)) + 1;
                        emitEvent('log', { message: `Final adjusted range: ${req.start} to ${req.end} (${diffDays} days)` });

                        // Amount Refinement (48/day)
                        if (!req.amount || req.amount === 0) {
                            req.amount = diffDays * 48;
                            emitEvent('log', { message: `Calculated amount: $${req.amount} (48 * ${diffDays})` });
                        }
                    }

                    // --- Proof URL Fallback ---
                    if (!req.proofURL) {
                        const clientDetails = await fetchClientDetailsFromPage(page);
                        req.proofURL = await generateProofUrl(clientDetails, req, apiConfig);

                        const cleanName = (clientDetails.name || req.name || "Attestation")
                            .replace(/\s+/g, " ").trim()
                            .replace(/[\\/:*?"<>|]/g, "");
                        const toDashMDY = (iso) => {
                            const [y, m, d] = iso.split('-');
                            return `${m}-${d}-${y}`;
                        };
                        req.fileName = `${cleanName} ${toDashMDY(req.start)} - ${toDashMDY(req.end)}.pdf`;
                        emitEvent('log', { message: `Generated proof URL: ${req.fileName}` });
                    }

                    const result = await executeBillingOnPage(page, req);

                    // --- Handle Result ---
                    if (result.ok) {
                        if (result.verified) {
                            req.status = 'success';
                            req.message = `Billed: $${result.amount || req.amount}`;
                            emitEvent('log', { message: `✅ Success!`, type: 'success' });
                            resultSourceStatus = 'billing_successful';
                        } else {
                            req.status = 'warning';
                            req.message = 'Submitted but verification failed';
                            emitEvent('log', { message: `⚠️ Submitted, unverified.`, type: 'warning' });
                            resultSourceStatus = 'billing_successful';
                        }
                    } else {
                        if (result.duplicate) {
                            req.status = 'skipped';
                            req.message = 'Duplicate';
                            emitEvent('log', { message: `⏭️ Duplicate found.`, type: 'info' });
                            resultSourceStatus = 'billing_already_exists';
                            success = true; // Definitive result
                        } else {
                            // UI Error (e.g. [SHELF], [UPLOAD], etc.)
                            // Throwing here triggers the catch block below for refresh/restart retries
                            throw new Error(result.error || 'Unknown UI Error');
                        }
                    }

                    success = true; // Exit loops on definitive result

                } catch (e) {
                    const shouldSkip = e.code === 'NO_ATTESTATION_FILE' ||
                        e.code === 'NO_SIGNATURE' ||
                        e.code === 'VALIDATION_ERROR' ||
                        e.code === 'NO_OVERLAP' ||
                        (e.message && (e.message.includes('[LIMITS]') || e.message.includes('[CONFIG]')));

                    if (shouldSkip) {
                        req.status = 'failed';
                        req.message = e.message;
                        emitEvent('log', { message: `❌ Skip Client: ${e.message}`, type: 'error' });
                        resultSourceStatus = 'billing_failed';
                        success = true; // Break both loops
                        break;
                    }

                    refreshAttempt++;
                    if (refreshAttempt >= MAX_REFRESHES) {
                        emitEvent('log', { message: `Refresh limit reached (${MAX_REFRESHES}).`, type: 'warning' });
                        break; // Fall through to restart logic
                    }
                    lastRefreshError = e.message;
                    const { step, type, details } = parseBillingError(e.message);
                    emitEvent('log', { message: `Refresh attempt ${refreshAttempt} failed | Step: ${step} | Type: ${type} | ${details}`, type: 'warning' });
                    await page.reload({ waitUntil: 'networkidle' }).catch(() => { });
                    await sleep(2000);
                }
            }

            if (!success) {
                restartAttempt++;
                const { step, type } = parseBillingError(lastRefreshError || '');
                if (restartAttempt < MAX_RESTARTS) {
                    emitEvent('log', { message: `Session failed (last failure: Step: ${step}, Type: ${type}). Restarting browser (Attempt ${restartAttempt + 1}/${MAX_RESTARTS})...`, type: 'warning' });
                    page = await restartBrowser();
                    setupPageLogging(page);
                } else {
                    req.status = 'failed';
                    req.message = '[TIMEOUT] All retry attempts failed';
                    emitEvent('log', { message: `❌ [TIMEOUT] Final attempt failed after ${MAX_RESTARTS} browser sessions.`, type: 'error' });
                    resultSourceStatus = 'billing_failed';
                    await page.screenshot({ path: `error_${i}_final.png` });
                }
            }
        }

        // --- API Update ---
        if (source === 'api' && req.orderNumber) {
            await updateOrderStatus(req.orderNumber, resultSourceStatus, apiConfig);
        }

        emitEvent('queue', requests);
        await sleep(1000);
    }

    emitEvent('log', { message: 'Billing Cycle Completed.' });
}

module.exports = { billingWorker, fetchRequestsFromApi };
