(function attachAttestationFlow() {
    if (window.attestationFlow) return;

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
        // Prefer popup globals (if your popup wrote them into window.__ATT_POPUP_PARAMS__)
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

        // Fallback to chrome.storage.sync (your popup/Navigator UI save here)
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

    async function generateAndUpload({ backendUrl, onProgress } = {}) {
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

        // Delivery date comes from attestation (manual-mode parity), else today
        const deliveryISO = isoOk(chosenDate) ? chosenDate : todayISO();

        // Service period MUST be present — do NOT collapse to delivery
        if (!isoOk(startISO) || !isoOk(endISO)) {
            const err = `Missing/invalid service period. startISO="${startISO}", endISO="${endISO}"`;
            emit(onProgress, "gen_upload:failed", { error: err });
            return { ok: false, step: "params", error: err };
        }
        const startISOFinal = startISO;
        const endISOFinal = endISO;

        // Attestation date explicit or today
        const attestISOFinal = isoOk(attestationISO) ? attestationISO : todayISO();

        /* ========= MDY for filename/UI only ========= */
        const deliveryMDY   = toMDY(deliveryISO);
        const startMDY      = toMDY(startISOFinal);
        const endMDY        = toMDY(endISOFinal);
        // const attestationMDY = toMDY(attestISOFinal); // only if you want it in the filename/logs

        /* ========= Payload to backend: SNAKE_CASE + ISO ========= */
        const payload = {
            name: person.name || "",
            phone: person.phone || "",
            address: person.address || "",
            deliveryDate: deliveryISO,     // ⬅️ back to camelCase
            startDate: startISOFinal,      // ⬅️ back to camelCase
            endDate: endISOFinal,          // ⬅️ back to camelCase
            attestationDate: attestISOFinal, // ⬅️ back to camelCase
        };
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

        return { ok: true, person, upload: uploaded };
    }

    window.attestationFlow = { generateAndUpload };
})();