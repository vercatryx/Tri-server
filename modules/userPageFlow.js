// modules/userPageFlow.js
// Clean, sequential flow for processing a user page
// Now reports progress for better tracking

(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const byXPath = (xp) =>
        document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue || null;

    // Progress reporting
    const reportProgress = (step, details = {}) => {
        window.__USER_PAGE_FLOW_PROGRESS__ = { step, ...details, timestamp: Date.now() };
        console.log(`[USER PAGE FLOW] ${step}:`, details);
    };

    // ===== STEP 1: Wait for auth elements (up to 20 tries, 1.2s between) =====
    reportProgress('step1_start', { message: 'Waiting for auth elements...' });

    let authInfo = null;
    const MAX_AUTH_ATTEMPTS = 20;
    const AUTH_RETRY_DELAY_MS = 1200;

    for (let attempt = 1; attempt <= MAX_AUTH_ATTEMPTS; attempt++) {
        reportProgress('step1_checking', { attempt, maxAttempts: MAX_AUTH_ATTEMPTS });
        await sleep(AUTH_RETRY_DELAY_MS);

        // Try to find auth elements
        let amountEl = document.querySelector('#basic-table-authorized-amount-value');
        let datesEl = document.querySelector('#basic-table-authorized-service-delivery-date-s-value');
        // NEW: Also read "Date Opened" to use as billing start date
        let dateOpenedEl = document.querySelector('#basic-table-date-opened-value');

        if (!amountEl) {
            amountEl = byXPath('//*[@id="basic-table-authorized-amount-value"]');
        }
        if (!datesEl) {
            datesEl = byXPath('/html/body/div[2]/div[2]/main/div/section/div/div[2]/div/div[1]/div[1]/div[2]/div[3]/div/div[1]/div/table/tbody/tr[3]/td[2]');
        }
        if (!dateOpenedEl) {
            // Backup XPath for Date Opened
            dateOpenedEl = byXPath('/html/body/div[2]/div[2]/main/div/section/div/div[2]/div/div[1]/div[1]/div[2]/div[1]/div[1]/div/table/tbody/tr[3]/td[2]');
        }

        const found = {
            amountEl: !!amountEl,
            datesEl: !!datesEl,
            dateOpenedEl: !!dateOpenedEl
        };
        reportProgress('step1_check_result', { attempt, found });

        if (amountEl && datesEl && dateOpenedEl) {
            const amountSpan = amountEl.querySelector('span');
            const amountText = amountSpan ? amountSpan.textContent : amountEl.textContent;

            // Extract date from the <p> tag inside dateOpenedEl
            const dateOpenedP = dateOpenedEl.querySelector('p.service-case-program-entry__text');
            const dateOpenedText = dateOpenedP ? dateOpenedP.textContent.trim() : dateOpenedEl.textContent.trim();

            authInfo = {
                authorizedAmount: amountText.trim(),
                authorizedDates: datesEl.textContent.trim(),
                dateOpened: dateOpenedText
            };

            reportProgress('step1_success', { authInfo });
            break;
        }
    }

    if (!authInfo) {
        const error = 'Auth elements not found after 20 attempts';
        reportProgress('step1_failed', { error });
        window.__USER_PAGE_FLOW_RESULT__ = { 
            ok: false, 
            error,
            needsRelogin: true // Signal that relogin might help
        };
        return;
    }

    // ===== STEP 2: Calculate adjusted dates from auth + requested =====
    reportProgress('step2_start', { message: 'Calculating adjusted dates...' });

    const inputs = window.__USER_PAGE_INPUTS__ || {};
    const reqStartISO = inputs.startISO || '';
    const reqEndISO = inputs.endISO || '';
    const ratePerDay = Number(inputs.ratePerDay || 48);

    if (!reqStartISO || !reqEndISO) {
        const error = 'Missing requested start/end dates';
        reportProgress('step2_failed', { error });
        window.__USER_PAGE_FLOW_RESULT__ = { ok: false, error };
        return;
    }

    // Parse authorized dates (MM/DD/YYYY - MM/DD/YYYY) to get the END date
    const authDatesMatch = authInfo.authorizedDates.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s*-\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!authDatesMatch) {
        const error = `Could not parse authorized dates: ${authInfo.authorizedDates}`;
        reportProgress('step2_failed', { error });
        window.__USER_PAGE_FLOW_RESULT__ = { ok: false, error };
        return;
    }

    // Parse Date Opened (MM/DD/YYYY) - this REPLACES the authorized START date
    const dateOpenedMatch = authInfo.dateOpened.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!dateOpenedMatch) {
        const error = `Could not parse Date Opened: ${authInfo.dateOpened}`;
        reportProgress('step2_failed', { error });
        window.__USER_PAGE_FLOW_RESULT__ = { ok: false, error };
        return;
    }

    // Parse dates in UTC to avoid timezone issues (YYYY, MM-1, DD)
    const dateOpened = new Date(Date.UTC(+dateOpenedMatch[3], +dateOpenedMatch[1] - 1, +dateOpenedMatch[2]));
    const authEnd = new Date(Date.UTC(+authDatesMatch[6], +authDatesMatch[4] - 1, +authDatesMatch[5]));

    // Parse requested ISO dates in UTC
    const [reqY, reqM, reqD] = reqStartISO.split('-').map(Number);
    const [reqEndY, reqEndM, reqEndD] = reqEndISO.split('-').map(Number);
    const reqStart = new Date(Date.UTC(reqY, reqM - 1, reqD));
    const reqEnd = new Date(Date.UTC(reqEndY, reqEndM - 1, reqEndD));

    reportProgress('step2_date_comparison', {
        requested: {
            start: reqStartISO,
            end: reqEndISO,
            startParsed: reqStart.toISOString().split('T')[0],
            endParsed: reqEnd.toISOString().split('T')[0]
        },
        authorized: {
            dateOpened: authInfo.dateOpened,
            dateOpenedParsed: dateOpened.toISOString().split('T')[0],
            authEndRaw: authInfo.authorizedDates.split(' - ')[1],
            authEndParsed: authEnd.toISOString().split('T')[0]
        }
    });

    // Calculate intersection using Date Opened as start, authorized end as end
    // Same logic as before, but authStart is replaced with dateOpened
    const adjustedStart = reqStart > dateOpened ? reqStart : dateOpened;
    const adjustedEnd = reqEnd < authEnd ? reqEnd : authEnd;

    if (adjustedEnd < adjustedStart) {
        const error = 'No overlap between requested dates and authorized range (Date Opened to Auth End)';
        reportProgress('step2_failed', { error });
        window.__USER_PAGE_FLOW_RESULT__ = { ok: false, error };
        return;
    }

    // Helper to format dates consistently in UTC
    const toMDY = (date) => {
        const m = date.getUTCMonth() + 1;
        const d = date.getUTCDate();
        const y = date.getUTCFullYear();
        return `${m}/${d}/${y}`;
    };

    const toISO = (date) => {
        const y = date.getUTCFullYear();
        const m = String(date.getUTCMonth() + 1).padStart(2, '0');
        const d = String(date.getUTCDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    };

    const adjustedStartMDY = toMDY(adjustedStart);
    const adjustedEndMDY = toMDY(adjustedEnd);
    const days = Math.floor((adjustedEnd - adjustedStart) / 86400000) + 1;
    const adjustedAmount = ratePerDay * days;

    const adjustedDates = {
        startMDY: adjustedStartMDY,
        endMDY: adjustedEndMDY,
        amount: adjustedAmount,
        startISO: toISO(adjustedStart),
        endISO: toISO(adjustedEnd)
    };

    // Log adjustment details
    const wasAdjusted = (reqStartISO !== adjustedDates.startISO) || (reqEndISO !== adjustedDates.endISO);
    if (wasAdjusted) {
        reportProgress('step2_dates_adjusted', {
            requested: { start: reqStartISO, end: reqEndISO },
            adjusted: { start: adjustedDates.startISO, end: adjustedDates.endISO },
            dateOpened: dateOpened.toISOString().split('T')[0],
            authEnd: authEnd.toISOString().split('T')[0]
        });
    } else {
        reportProgress('step2_no_adjustment_needed', { message: 'Requested dates are within authorized range' });
    }

    reportProgress('step2_success', { adjustedDates });

    // Store adjusted dates for other modules to use
    window.__ADJUSTED_DATES__ = adjustedDates;

    // ===== STEP 3: Check for duplicates (with adjusted dates only) =====
    reportProgress('step3_start', { message: 'Checking for duplicates...' });

    const checkDuplicate = (startMDY, endMDY, amount) => {
        const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
        const cents = (v) => {
            if (typeof v === 'number') return Math.round(v * 100);
            const n = Number(String(v).replace(/[^\d.]/g, ''));
            return Number.isFinite(n) ? Math.round(n * 100) : NaN;
        };
        const sameDay = (a, b) => a && b && a.getTime() === b.getTime();
        const parseMDY = (s) => {
            const m = String(s).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
            if (!m) return null;
            const mm = +m[1], dd = +m[2], yyyy = +m[3];
            if (mm < 1 || mm > 12) return null;
            const last = new Date(yyyy, mm, 0).getDate();
            if (dd < 1 || dd > last) return null;
            return new Date(yyyy, mm - 1, dd);
        };

        const start = parseMDY(startMDY);
        const end = parseMDY(endMDY);
        const wantCents = cents(amount);

        const cards = Array.from(document.querySelectorAll('.fee-schedule-provided-service-card'));
        reportProgress('step3_checking_cards', { cardCount: cards.length });

        for (const card of cards) {
            const amtEl = card.querySelector('[data-test-element="unit-amount-value"]');
            const rngEl = card.querySelector('[data-test-element="service-dates-value"], [data-test-element="service-start-date-value"]');

            const cardCents = cents(norm(amtEl?.textContent));
            const txt = norm(rngEl?.textContent);

            let s = null, e = null;
            if (txt) {
                const parts = txt.split(/\s*-\s*/);
                if (parts.length === 2) {
                    s = new Date(parts[0]);
                    e = new Date(parts[1]);
                } else {
                    s = new Date(txt);
                    e = s;
                }
                s && s.setHours(0, 0, 0, 0);
                e && e.setHours(0, 0, 0, 0);
            }

            if (Number.isFinite(cardCents) && s && e &&
                cardCents === wantCents &&
                sameDay(s, start) && sameDay(e, end)) {
                reportProgress('step3_duplicate_found', { startMDY, endMDY, amount });
                return true;
            }
        }

        return false;
    };

    const isDuplicate = checkDuplicate(adjustedDates.startMDY, adjustedDates.endMDY, adjustedDates.amount);

    if (isDuplicate) {
        reportProgress('step3_duplicate_detected', { message: 'Will upload but skip billing' });
        // Don't return early - continue with upload but skip billing
    } else {
        reportProgress('step3_no_duplicate', { message: 'Proceeding with upload and billing' });
    }

    // ===== STEP 4: Upload (if requested, with adjusted dates only) =====
    if (inputs.attemptUpload && inputs.hasSignature) {
        reportProgress('step4_upload_pending', { message: 'Upload will use adjusted dates' });
        // Upload module will read from window.__ADJUSTED_DATES__
        window.__UPLOAD_PENDING__ = true;
    } else {
        reportProgress('step4_upload_skipped', { reason: !inputs.attemptUpload ? 'Upload not requested' : 'No signature' });
    }

    // ===== STEP 5: Billing (if requested, with adjusted dates only) =====
    // Skip billing if duplicate is found
    if (inputs.attemptBilling && !isDuplicate) {
        reportProgress('step5_billing_pending', { message: 'Billing will use adjusted dates' });
        // Billing module will read from window.__ADJUSTED_DATES__
        window.__BILLING_PENDING__ = true;
    } else {
        if (isDuplicate) {
            reportProgress('step5_billing_skipped', { reason: 'Duplicate detected' });
        } else {
            reportProgress('step5_billing_skipped', { reason: 'Billing not requested' });
        }
    }

    reportProgress('flow_completed', { 
        duplicate: isDuplicate,
        uploadPending: !!window.__UPLOAD_PENDING__,
        billingPending: !!window.__BILLING_PENDING__
    });

    window.__USER_PAGE_FLOW_RESULT__ = {
        ok: true,
        duplicate: isDuplicate,
        adjustedDates,
        uploadPending: !!window.__UPLOAD_PENDING__,
        billingPending: !!window.__BILLING_PENDING__,
        message: isDuplicate ? 'Duplicate invoice found - uploaded but skipped billing' : null
    };
})();
