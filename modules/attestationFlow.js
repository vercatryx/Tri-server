(function attachAttestationFlow() {
    if (window.attestationFlow) return;

    // Version check - ensure latest code is loaded
    console.log('[attestationFlow] Loading v2.1 - with date adjustment and duplicate check');
    window.__ATTESTATION_FLOW_VERSION__ = '2.1';

    function toMDY(iso) {
        // Accepts YYYY-MM-DD or already-in-M/D/YYYY, returns MM/DD/YYYY or null
        if (!iso || typeof iso !== 'string') return null;
        if (iso.includes('-')) {
            const [y,m,d] = iso.split('-');
            if (y && m && d) return `${m}/${d}/${y}`;
        }
        // already M/D/Y? sanity-check it
        if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(iso)) return iso;
        return null;
    }

    // NEW: robust normalizer -> always return ISO (YYYY-MM-DD) or null
    function toISO(any) {
        if (typeof any !== 'string') return null;
        // Already ISO?
        if (/^\d{4}-\d{2}-\d{2}$/.test(any)) return any;
        // MM/DD/YYYY -> YYYY-MM-DD
        const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
        const mmdd = mdy.exec(any);
        if (mmdd) {
            const mm = mmdd[1].padStart(2, '0');
            const dd = mmdd[2].padStart(2, '0');
            const yyyy = mmdd[3];
            return `${yyyy}-${mm}-${dd}`;
        }
        return null;
    }

    async function getSavedParams() {
        // FIRST: Check if userPageFlow.js has already adjusted dates
        const adjusted = window.__ADJUSTED_DATES__;
        if (adjusted && adjusted.startISO && adjusted.endISO) {
            console.log('[attestationFlow] Using adjusted dates from userPageFlow:', adjusted);
            return {
                chosenDate:     adjusted.startISO, // Use adjusted start as delivery
                startISO:       adjusted.startISO,
                endISO:         adjusted.endISO,
                attestationISO: toISO(new Date().toISOString().slice(0, 10)) || null,
            };
        }

        // SECOND: Prefer popup globals (if your popup wrote them into window.__ATT_POPUP_PARAMS__)
        const g = (window.__ATT_POPUP_PARAMS__ || {});
        const hasGlobals = !!(g.chosenDate || g.startISO || g.endISO || g.attestationISO);
        if (hasGlobals) {
            return {
                chosenDate:     toISO(g.chosenDate)     || null,
                startISO:       toISO(g.startISO)       || null,
                endISO:         toISO(g.endISO)         || null,
                attestationISO: toISO(g.attestationISO) || null,
            };
        }

        // THIRD: Fallback to chrome.storage.sync (your popup/Navigator UI save here)
        const sync = await new Promise((resolve) => {
            try {
                chrome.storage.sync.get(['startDate','endDate','attestationDate'], (data) => resolve(data || {}));
            } catch { resolve({}); }
        });

        return {
            // delivery day comes from the *attestation* field the user picks in UI
            chosenDate:      toISO(sync.attestationDate) || null,
            startISO:        toISO(sync.startDate)       || null,
            endISO:          toISO(sync.endDate)         || null,
            attestationISO:  toISO(sync.attestationDate) || null,
        };
    }

    function toDashMDY(iso) {
        // iso: YYYY-MM-DD -> MM-DD-YYYY (for filenames)
        if (!iso || typeof iso !== 'string' || iso.indexOf('-') < 0) return null;
        const [y,m,d] = iso.split('-');
        if (!y || !m || !d) return null;
        return `${m}-${d}-${y}`;
    }

    function todayMDY() {
        const d = new Date();
        return [
            String(d.getMonth() + 1).padStart(2, "0"),
            String(d.getDate()).padStart(2, "0"),
            d.getFullYear()
        ].join("/");
    }
    function todayISO() {
        // YYYY-MM-DD for backend payloads
        return new Date().toISOString().slice(0, 10);
    }
    function b64ToU8(b64) {
        const bin = atob(b64);
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        return u8;
    }

    function emit(onProgress, step, info = {}) {
        try { onProgress?.(step, info); } catch {}
        try { chrome.runtime.sendMessage({ type: "GEN_UPLOAD_PROGRESS", step, ...info }); } catch {}
    }

    async function postViaProxy(backendUrl, payload, onProgress) {
        emit(onProgress, "gen_upload:start");
        return new Promise((resolve) => {
            chrome.runtime.sendMessage({ type: "FETCH_ATTESTATION", backendUrl, payload }, (resp) => {
                if (resp?.ok) {
                    emit(onProgress, "gen_upload:done");
                    resolve(resp);
                } else {
                    const bodyStr = typeof resp?.body === 'string' ? resp.body.toLowerCase() : '';
                    const errorStr = typeof resp?.error === 'string' ? resp.error.toLowerCase() : '';
                    const isSignatureError = resp?.status === 400 || resp?.status === 403 || resp?.status === 422 ||
                        bodyStr.includes('signature') || bodyStr.includes('signed') ||
                        bodyStr.includes('unauthorized') || bodyStr.includes('auth') ||
                        errorStr.includes('signature') || errorStr.includes('signed') ||
                        errorStr.includes('unauthorized') || errorStr.includes('auth');
                    const error = isSignatureError
                        ? 'Upload failed: No signatures found'
                        : 'Upload failed: ' + (typeof resp?.error === 'string' ? resp.error :
                        (typeof resp?.body === 'string' ? resp.body :
                            (resp ? 'Unknown error' : 'No response from backend')));
                    emit(onProgress, "gen_upload:failed", { error });
                    resolve({ ...resp, error });
                }
            });
        });
    }

    // Helper to parse money string
    const parseMoney = (str) => {
        if (!str) return null;
        const num = Number(String(str).replace(/[^0-9.]/g, ''));
        return Number.isFinite(num) ? num : null;
    };

    // Helper to parse MDY date string
    const parseMDY = (s) => {
        const m = String(s).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (!m) return null;
        const mm = +m[1], dd = +m[2], yyyy = +m[3];
        if (mm < 1 || mm > 12) return null;
        const last = new Date(yyyy, mm, 0).getDate();
        if (dd < 1 || dd > last) return null;
        return new Date(yyyy, mm - 1, dd);
    };

    const fmtMDY = (d) => {
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const yy = d.getFullYear();
        return `${mm}/${dd}/${yy}`;
    };

    const clampRange = (reqStart, reqEnd, authStart, authEnd) => {
        const start = new Date(Math.max(reqStart.getTime(), authStart.getTime()));
        const end = new Date(Math.min(reqEnd.getTime(), authEnd.getTime()));
        if (end.getTime() < start.getTime()) return null;
        return { start, end };
    };

    const inclusiveDays = (start, end) => Math.floor((end - start) / 86400000) + 1;
    const addDays = (date, n) => { const d = new Date(date.getTime()); d.setDate(d.getDate() + n); return d; };

    // Function to read authorized dates from the page (with retry logic)
    async function readAuthorizedInfo(maxRetries = 15, delayMs = 1000) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                // Method 1: Try the xpath to the detail table
                const tableXPath = '/html/body/div[2]/div[2]/main/div/section/div/div[2]/div/div[1]/div[1]/div[2]/div[3]/div/div[1]';
                let detailTable = document.evaluate(tableXPath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;

                // Method 2: Try finding the table by ID
                if (!detailTable) {
                    detailTable = document.getElementById('basic-table')?.closest('.detail-label-content');
                }

                // Method 3: Search for the table by looking for specific text
                if (!detailTable) {
                    const tables = Array.from(document.querySelectorAll('.basic-table.basic-table--detail-page'));
                    detailTable = tables.find(t => t.textContent.includes('Authorization status'));
                }

                if (!detailTable) {
                    console.log(`[attestationFlow] Attempt ${attempt}/${maxRetries}: Detail table not found yet`);
                    if (attempt < maxRetries) {
                        await new Promise(r => setTimeout(r, delayMs));
                        continue;
                    }
                    return { ok: false, error: 'Detail table not found after retries' };
                }

                // Extract authorized amount
                let authorizedAmount = null;
                const authAmtEl = detailTable.querySelector('#basic-table-authorized-amount-value .dollar-amount, #basic-table-authorized-amount-value');
                if (authAmtEl) {
                    authorizedAmount = parseMoney(authAmtEl.textContent);
                }

                // Extract authorized date range
                let authStart = null, authEnd = null;
                const authDatesEl = detailTable.querySelector('#basic-table-authorized-service-delivery-date-s-value');
                if (authDatesEl?.textContent) {
                    const dateText = authDatesEl.textContent.trim();
                    const parts = dateText.split(/\s*-\s*/);
                    if (parts.length === 2) {
                        authStart = parseMDY(parts[0].trim());
                        authEnd = parseMDY(parts[1].trim());
                    } else if (parts.length === 1) {
                        authStart = parseMDY(parts[0].trim());
                        authEnd = authStart;
                    }
                }

                // Calculate remaining amount
                let remaining = authorizedAmount;
                if (authorizedAmount) {
                    const container = document.querySelector('main .space-y-5');
                    const xpathContainerPath = '/html/body/div[2]/div[2]/main/div/section/div/div[2]/div/div[1]/div[2]/div[2]';
                    const xpathContainer = document.evaluate(xpathContainerPath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                    const searchRoot = container || xpathContainer;

                    if (searchRoot) {
                        const cardsContainer = searchRoot.querySelector('.space-y-5') || searchRoot;
                        const amountElements = cardsContainer.querySelectorAll('[data-test-element="unit-amount-value"]');
                        let totalBilled = 0;
                        amountElements.forEach(el => {
                            const amt = parseMoney(el.textContent);
                            if (amt) totalBilled += amt;
                        });
                        remaining = authorizedAmount - totalBilled;
                    }
                }

                // Check if we have valid data
                if (authStart && authEnd && authorizedAmount !== null && remaining !== null) {
                    console.log('[attestationFlow] Successfully read authorized info:', {
                        authStart: fmtMDY(authStart),
                        authEnd: fmtMDY(authEnd),
                        authorizedAmount,
                        remaining
                    });
                    return { ok: true, authStart, authEnd, authorizedAmount, remaining };
                }

                console.log(`[attestationFlow] Attempt ${attempt}/${maxRetries}: Incomplete data`);
                if (attempt < maxRetries) {
                    await new Promise(r => setTimeout(r, delayMs));
                }
            } catch (e) {
                console.warn(`[attestationFlow] Attempt ${attempt}/${maxRetries} error:`, e);
                if (attempt < maxRetries) {
                    await new Promise(r => setTimeout(r, delayMs));
                }
            }
        }
        return { ok: false, error: 'Could not read authorized info after retries' };
    }

    async function generateAndUpload({ backendUrl, userId, onProgress } = {}) {
        console.log('[attestationFlow] ========================================');
        console.log('[attestationFlow] generateAndUpload CALLED - v2.1');
        console.log('[attestationFlow] ========================================');
        console.log('[attestationFlow] userId:', userId);

        if (!backendUrl) return { ok: false, step: "config", error: "Upload failed: Missing backend URL" };
        if (!window.personInfo?.getPerson) return { ok: false, step: "read", error: "Upload failed: Person info module not loaded" };
        if (!window.pdfUploader?.attachBytes) return { ok: false, step: "upload", error: "Upload failed: PDF uploader module not loaded" };

        emit(onProgress, "gen_upload:start");

        // Read person data from page
        let info = await window.personInfo.getPerson({ retries: 4, delayMs: 250 });
        if (!info?.ok) {
            emit(onProgress, "gen_upload:failed", { error: "Upload failed: Failed to read person info" });
            return { ok: false, step: "read", error: "Upload failed: Failed to read person info" };
        }
        let person = info.person || {};
        if (!person.name && !person.phone && !person.address) {
            await new Promise(r => setTimeout(r, 400));
            info = await window.personInfo.getPerson({ retries: 4, delayMs: 250 });
            person = info.person || {};
        }

        // Pull params (globals preferred; fall back to storage)
        const { chosenDate, startISO, endISO, attestationISO } = await getSavedParams();

        /* ========= Build ISO dates for BACKEND (YYYY-MM-DD) ========= */
        const isoOk = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

        // Service period MUST be present
        if (!isoOk(startISO) || !isoOk(endISO)) {
            const err = `Missing/invalid service period. startISO="${startISO}", endISO="${endISO}"`;
            emit(onProgress, "gen_upload:failed", { error: err });
            return { ok: false, step: "params", error: err };
        }

        // Convert ISO to Date objects for adjustment
        const reqStart = new Date(startISO);
        const reqEnd = new Date(endISO);

        // Read authorized dates from the page (with retry logic)
        console.log('[attestationFlow] Reading authorized info from page...');
        emit(onProgress, "auth_info:reading");
        const authInfo = await readAuthorizedInfo(15, 1000);

        let adjustedStart = reqStart;
        let adjustedEnd = reqEnd;

        if (authInfo.ok) {
            console.log('[attestationFlow] Adjusting dates based on authorized info');
            const { authStart, authEnd, remaining } = authInfo;

            // Intersect with authorized range
            const overlap = clampRange(reqStart, reqEnd, authStart, authEnd);
            if (overlap) {
                adjustedStart = overlap.start;
                adjustedEnd = overlap.end;
                console.log('[attestationFlow] Dates adjusted to authorized range:',
                    fmtMDY(adjustedStart), '→', fmtMDY(adjustedEnd));
            } else {
                const err = `No overlap between requested (${toISO(fmtMDY(reqStart))} - ${toISO(fmtMDY(reqEnd))}) and authorized (${toISO(fmtMDY(authStart))} - ${toISO(fmtMDY(authEnd))}) dates`;
                console.error('[attestationFlow]', err);
                emit(onProgress, "gen_upload:failed", { error: err });
                return { ok: false, step: "date_adjustment", error: err };
            }

            // Note: We don't adjust by remaining amount for attestations like we do for billing
            // Attestations are just documents, billing is where we care about remaining funds
        } else {
            console.warn('[attestationFlow] Could not read authorized info, using requested dates as-is:', authInfo.error);
            // Continue with requested dates even if we couldn't read auth info
        }

        // Convert adjusted dates back to ISO
        const startISOFinal = adjustedStart.toISOString().slice(0, 10);
        const endISOFinal = adjustedEnd.toISOString().slice(0, 10);

        console.log('[attestationFlow] Final dates for attestation:', startISOFinal, '→', endISOFinal);

        // Delivery date comes from attestation (manual-mode parity), else today
        let deliveryISO = isoOk(chosenDate) ? chosenDate : todayISO();

        // IMPORTANT: Delivery date must be within the service period
        // If it's before start date OR after end date, adjust it to start date
        const deliveryDate = new Date(deliveryISO);
        deliveryDate.setHours(0, 0, 0, 0); // Normalize to start of day for comparison
        const compareStart = new Date(adjustedStart);
        compareStart.setHours(0, 0, 0, 0); // Normalize to start of day for comparison
        const compareEnd = new Date(adjustedEnd);
        compareEnd.setHours(0, 0, 0, 0); // Normalize to start of day for comparison

        console.log('[attestationFlow] Validating delivery date:', {
            deliveryISO,
            startISOFinal,
            endISOFinal,
            isBefore: deliveryDate < compareStart,
            isAfter: deliveryDate > compareEnd
        });

        if (deliveryDate < compareStart) {
            console.warn('[attestationFlow] ⚠️ Delivery date', deliveryISO, 'is BEFORE start date', startISOFinal);
            deliveryISO = startISOFinal;
            console.log('[attestationFlow] ✓ Adjusted delivery date to start date:', deliveryISO);
        } else if (deliveryDate > compareEnd) {
            console.warn('[attestationFlow] ⚠️ Delivery date', deliveryISO, 'is AFTER end date', endISOFinal);
            deliveryISO = startISOFinal;
            console.log('[attestationFlow] ✓ Adjusted delivery date to start date:', deliveryISO);
        } else {
            console.log('[attestationFlow] ✓ Delivery date is valid (within service period)');
        }

        // Attestation date explicit or today
        const attestISOFinal = isoOk(attestationISO) ? attestationISO : todayISO();

        /* ========= MDY for filename/UI only ========= */
        const deliveryMDY   = toMDY(deliveryISO);
        const startMDY      = toMDY(startISOFinal);
        const endMDY        = toMDY(endISOFinal);
        // const attestationMDY = toMDY(attestISOFinal); // only if you want it in the filename/logs

        /* ========= EARLY DUPLICATE CHECK - before generating PDF ========= */
        console.log('[attestationFlow] ========================================');
        console.log('[attestationFlow] EARLY DUPLICATE CHECK - BEFORE GENERATING PDF');
        console.log('[attestationFlow] ========================================');

        // Calculate expected amount for duplicate check
        const days = inclusiveDays(adjustedStart, adjustedEnd);
        // Try to get rate from localStorage (same as panel.js)
        let ratePerDay = 48; // default
        try {
            const manualParams = JSON.parse(localStorage.getItem('DF_MANUAL_PARAMS') || '{}');
            const rate = Number(manualParams.ratePerDay);
            if (rate && rate > 0) ratePerDay = rate;
        } catch (e) {
            console.warn('[attestationFlow] Could not read rate from localStorage:', e);
        }
        const expectedAmount = ratePerDay * days;

        console.log('[attestationFlow] Checking for duplicates:', {
            dates: `${startMDY} → ${endMDY}`,
            days,
            ratePerDay,
            expectedAmount
        });

        emit(onProgress, "duplicate_check:start");

        let isDuplicate = false;
        try {
            if (window.invoiceScanner?.findExisting) {
                console.log('[attestationFlow] Using invoiceScanner for duplicate check');
                const out = window.invoiceScanner.findExisting({
                    start: adjustedStart,
                    end: adjustedEnd,
                    amount: expectedAmount,
                    requireTitle: null
                });
                isDuplicate = !!out?.exists;
                console.log('[attestationFlow] invoiceScanner result:', out);
                if (isDuplicate) {
                    console.warn('[attestationFlow] ⚠️ DUPLICATE FOUND:', out);
                    emit(onProgress, "duplicate_check:found", { matches: out.matches });
                } else {
                    console.log('[attestationFlow] ✓ No duplicate found');
                }
            } else {
                console.log('[attestationFlow] invoiceScanner not available, skipping duplicate check');
            }
        } catch (e) {
            console.warn('[attestationFlow] Duplicate check error:', e);
        }

        if (isDuplicate) {
            console.warn('[attestationFlow] ⚠️ Duplicate invoice detected for', `${startMDY} → ${endMDY}, $${expectedAmount}`);
            console.warn('[attestationFlow] Will proceed with upload but skip billing');
            emit(onProgress, "duplicate_check:found_continue", { message: "Duplicate found - will upload but skip billing" });
            try {
                chrome.runtime?.sendMessage?.({ type: 'DF_BILLING_DUPLICATE_FOUND' });
            } catch {}
            // Don't return early - continue with upload
        } else {
            console.log('[attestationFlow] No duplicate found, proceeding with generation');
            emit(onProgress, "duplicate_check:passed");
        }

        /* ========= Payload to backend: SNAKE_CASE + ISO ========= */
        const payload = {
            name: person.name || "",
            phone: person.phone || "",
            address: person.address || "",
            deliveryDate: deliveryISO,     // ⬅️ back to camelCase
            startDate: startISOFinal,      // ⬅️ back to camelCase
            endDate: endISOFinal,          // ⬅️ back to camelCase
            attestationDate: attestISOFinal, // ⬅️ back to camelCase
            userId: userId || null,        // ⬅️ Include userId if available
        };
        console.log('[attestationFlow] Final payload with userId:', payload);
        emit(onProgress, "payload:built", { payload });

        const resp = await postViaProxy(backendUrl, payload, onProgress);
        if (!resp?.ok) {
            emit(onProgress, "gen_upload:failed", { error: resp.error });
            return { ok: false, step: "backend", code: resp?.status, error: resp.error };
        }
        emit(onProgress, "gen_upload:done");

        // Decode bytes
        let bytesU8 = null;
        if (resp.dataB64) {
            bytesU8 = b64ToU8(resp.dataB64);
        } else if (resp.data && typeof resp.data.byteLength === "number") {
            bytesU8 = new Uint8Array(resp.data);
        } else {
            emit(onProgress, "gen_upload:failed", { error: "Upload failed: No PDF data received" });
            return { ok: false, step: "decode", error: "Upload failed: No PDF data received" };
        }

        try {
            const head = bytesU8.slice(0, 5);
            const magic = String.fromCharCode(...head);
            emit(onProgress, "pdf:inspect", { bytes: bytesU8.length, magic });
        } catch {}

        // --- Filename rule: "<Customer Name> START - END.pdf" (period, not delivery)
        const cleanName = (person.name || "Attestation")
            .replace(/\s+/g, " ").trim()
            .replace(/[\\/:*?"<>|]/g, ""); // avoid illegal filename chars
        const startDash = toDashMDY(startISOFinal) || startMDY.replaceAll("/", "-");
        const endDash   = toDashMDY(endISOFinal)   || endMDY.replaceAll("/", "-");
        const finalFilename = `${cleanName} ${startDash} - ${endDash}.pdf`;

        emit(onProgress, "upload:start", { filename: finalFilename });
        await window.pdfUploader.openModal();
        const uploaded = await window.pdfUploader.attachBytes(bytesU8, finalFilename);
        emit(onProgress, "upload:done", { uploaded });

        return { ok: true, person, upload: uploaded, duplicate: isDuplicate };
    }

    window.attestationFlow = { generateAndUpload };
})();