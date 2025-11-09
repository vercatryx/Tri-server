(function () {
    // Top-frame only to avoid duplicate listeners
    if (window.top !== window) return;
    if (window.__DISPATCHER_BOUND__) return;
    window.__DISPATCHER_BOUND__ = true;

    const log = (...a) => { try { console.debug('[dispatcher]', ...a); } catch {} };
    const toError = (e) => (e?.message || String(e));
    const ok = (x = {}) => ({ ok: true, ...x });
    const err = (e, extra = {}) => ({ ok: false, error: toError(e), ...extra });
    const pick = (host, names) => names.map(n => host?.[n]).find(Boolean);

    // ----- Person info -----
    async function readPersonInfo() {
        try {
            const api =
                pick(window.personInfo, ['read', 'get', 'readPerson', 'readInfo']) ||
                window.getPersonInfo;
            if (api) {
                const out = await api();
                if (out) return ok({ person: out });
            }
            const nameSpan = document.querySelector("table tbody tr td:nth-child(2) span");
            const name = (nameSpan?.textContent || '').trim();
            if (name) return ok({ person: { name } });
            return err('Unable to read person info (no module API and no DOM match).');
        } catch (e) { return err(e); }
    }

    // ----- Upload PDF (open/upload test hooks) -----
    async function uploadPdf({ onlyOpen = false } = {}) {
        try {
            const upl = window.pdfUploader || window.uploadPDF || window.uploadPdf || {};
            const openModal = pick(upl, ['openModal', 'ensureModal', 'showDialog']);
            const testUpload = pick(upl, ['uploadTest', 'uploadSample', 'runTest']);

            if (onlyOpen) {
                if (!openModal) return err('Uploader module not found or no openModal().');
                const r = await openModal();
                return ok({ opened: true, result: r ?? null });
            }
            if (testUpload) {
                const r = await testUpload();
                return ok({ uploaded: true, result: r ?? null });
            }
            if (openModal) {
                const r = await openModal();
                return ok({ opened: true, result: r ?? null });
            }
            return err('Uploader module not found.');
        } catch (e) { return err(e); }
    }

    // ----- Full attestation flow (generate + upload) -----
    async function generateAndUpload({ backendUrl, chosenDate, userId }) {
        try {
            log('generateAndUpload called with userId:', userId);
            const flow = window.attestationFlow || window.attestation || window.attest;
            const run = pick(flow, ['generateAndUpload', 'run', 'start']);
            if (!run) return err('attestationFlow module not loaded.');
            const res = await run({ backendUrl, chosenDate, userId });
            return res?.ok ? res : ok(res || {});
        } catch (e) { return err(e); }
    }

    // NEW: Enter billing details
    async function enterBilling({ file }) {
        try {
            if (!file) return err('No file specified for billing');
            await chrome.runtime.sendMessage({
                target: { tabId: (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id },
                files: [file],
            });
            return ok({ injected: true });
        } catch (e) {
            return err(e);
        }
    }

    // ----- Navigator helpers -----
    async function navScrapeList() {
        if (!window.navAgent?.scrapeList) return err('navAgent not loaded.');
        return await window.navAgent.scrapeList();
    }

    async function navStart(fromIndex = 0) {
        if (!window.navAgent?.runAll) return err('navAgent not loaded.');
        return await window.navAgent.runAll({ fromIndex: Number(fromIndex) || 0 });
    }

    function navPause()  { return window.navAgent?.pause  ? window.navAgent.pause()  : err('navAgent not loaded.'); }
    function navResume() { return window.navAgent?.resume ? window.navAgent.resume() : err('navAgent not loaded.'); }
    function navStop()   { return window.navAgent?.stop   ? window.navAgent.stop()   : err('navAgent not loaded.'); }

    // ----- Message router -----
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        (async () => {
            try {
                if (!msg || msg.type == null) return;

                // Health check
                if (msg.type === 'PING') { sendResponse(ok({ from: 'content' })); return; }

                // Navigator
                if (msg.type === 'NAV_SCRAPE_LIST') { sendResponse(await navScrapeList());           return; }
                if (msg.type === 'NAV_START')       { sendResponse(await navStart(msg.fromIndex));   return; }
                if (msg.type === 'NAV_PAUSE')       { sendResponse(navPause());                      return; }
                if (msg.type === 'NAV_RESUME')      { sendResponse(navResume());                     return; }
                if (msg.type === 'NAV_STOP')        { sendResponse(navStop());                       return; }

                // Person info
                if (msg.type === 'READ_PERSON_INFO') { sendResponse(await readPersonInfo());         return; }

                // Upload/open
                if (msg.type === 'UPLOAD_PDF') {
                    sendResponse(await uploadPdf({ onlyOpen: !!msg.onlyOpen }));
                    return;
                }

                // Full flow
                if (msg.type === 'GENERATE_AND_UPLOAD') {
                    log('GENERATE_AND_UPLOAD received in dispatcher:', msg);
                    const { backendUrl, chosenDate, userId } = msg;
                    log('Extracted from msg - userId:', userId);
                    if (!backendUrl) { sendResponse(err('backendUrl is required.')); return; }
                    sendResponse(await generateAndUpload({ backendUrl, chosenDate, userId }));
                    return;
                }

                // NEW: Billing
                if (msg.type === 'ENTER_BILLING') {
                    sendResponse(await enterBilling({ file: msg.file }));
                    return;
                }

                // Unknown -> ack
                log('unknown message type', msg.type);
                sendResponse(ok({ passthrough: true, type: msg.type }));
            } catch (e) {
                sendResponse(err(e));
            }
        })();
        return true; // async
    });

    log('dispatcher ready (top frame)');
})();