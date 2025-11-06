(function () {
    // Run in top frame only to avoid duplicate agents in iframes
    if (window.top !== window) return;
    if (window.navAgent) return;

    /* ========================= Core utils ========================= */
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const PROGRESS = (event, data = {}) => {
        try { chrome.runtime.sendMessage({ type: "NAV_PROGRESS", event, ...data }); } catch {}
    };
    const LOG = (line, extra = {}) => PROGRESS("log", { line: `\n${line}`, ...extra });
    const TS = () => new Date().toLocaleTimeString();

    const state = {
        items: [],      // [{key, name, idx, url, status, billingStatus, uploadStatus, error}]
        running: false,
        paused: false,
        stopped: false,
        lastListUrl: null,
        pageStart: null,    // e.g. 51 for "51–100 of 463"
        pagerTotal: null,   // e.g. 463
        firstPageStart: null, // learned dynamically (1 or 51)
    };

    /* ========================= DOM helpers ========================= */
    function getTable() {
        return document.querySelector("table.border-collapse.w-full")
            || document.querySelector("table.border-collapse.font-regular-font.w-full")
            || document.querySelector("table");
    }
    function getRows() {
        const rowsById = Array.from(document.querySelectorAll("tr[id^='open-cases-table-row-']"));
        if (rowsById.length) return rowsById;
        const table = getTable();
        if (!table) return [];
        return Array.from(table.querySelectorAll("tbody tr"));
    }
    function extractNameFromRow(tr) {
        const nameSpan = tr.querySelector("td:nth-child(2) span");
        const text = (nameSpan?.textContent || "").trim();
        return text || null;
    }
    function buildKeyFromRow(tr, i) {
        const id = tr.id || "";
        const idx = Number(String(id).match(/(\d+)$/)?.[1] ?? i);
        return { key: id || `row-${idx}`, idx };
    }
    function ensureListUrl() { state.lastListUrl = location.href; }
    function listVisible() { return getRows().length > 0; }

    /* ========================= Pager helpers ========================= */
    function getPagerContainer() {
        return document.querySelector(".pager-container") || null;
    }
    function readPager() {
        const container = getPagerContainer();
        if (!container) return null;

        // Find a span whose text looks like "1-50 of 479"
        const spans = Array.from(container.querySelectorAll('span'));
        const label = spans.find(s => /^\s*\d+\s*-\s*\d+\s*of\s*\d+\s*$/i.test((s.textContent || '').trim()));
        if (!label) return null;

        const txt = (label.textContent || '').trim();
        const m = /^(\d+)\s*-\s*(\d+)\s*of\s*(\d+)$/.exec(txt);
        if (!m) return null;

        const start = Number(m[1]);
        const end   = Number(m[2]);
        const total = Number(m[3]);

        // Try several reasonable button selectors (no :has)
        const prevBtn =
            container.querySelector('button[aria-label="Previous Page"]') ||
            container.querySelector('button[aria-label="Previous"]') ||
            container.querySelector('button[title="Previous"]') ||
            container.querySelector('button[aria-label*="Prev"]');

        const nextBtn =
            container.querySelector('button[aria-label="Next Page"]') ||
            container.querySelector('button[aria-label="Next"]') ||
            container.querySelector('button[title="Next"]') ||
            container.querySelector('button[aria-label*="Next"]');

        const isDisabled = (el) => {
            if (!el) return true;
            const aria = (el.getAttribute('aria-disabled') || '').toLowerCase();
            const cls  = el.className || '';
            return !!el.disabled ||
                aria === 'true' ||
                /opacity-50|cursor-default|pointer-events-none|disabled/i.test(cls);
        };

        // DOM-derived state
        let hasPrev = !!prevBtn && !isDisabled(prevBtn);
        let hasNext = !!nextBtn && !isDisabled(nextBtn);

        // Math fallback: authoritative
        if (end < total) hasNext = true;
        if (start > 1)   hasPrev = true;

        return {
            start, end, total,
            prevBtn, nextBtn,
            hasPrev, hasNext,
            labelEl: label,
            el: container,
            text: txt
        };
    }


    async function waitForUrlChange(prevUrl, timeoutMs = 10000) {
        const t0 = Date.now();
        while (Date.now() - t0 < timeoutMs) {
            if (location.href !== prevUrl) return location.href;
            await sleep(120);
        }
        return location.href;
    }
    async function waitForList(timeoutMs = 20000) {
        const t0 = Date.now();
        while (Date.now() - t0 < timeoutMs) {
            if (listVisible() && readPager()) return true;
            await sleep(120);
        }
        return !!(listVisible() && readPager());
    }
    async function waitForPagerChange(prevStart, prevEnd, timeoutMs = 4000) {
        const t0 = Date.now();
        while (Date.now() - t0 < timeoutMs) {
            const p = readPager();
            if (p && (p.start !== prevStart || p.end !== prevEnd)) return true;
            await sleep(80);
        }
        return false;
    }
    async function clickAndWait(btn, label) {
        if (!btn) return false;
        const before = readPager();
        btn.click();
        await waitForPagerChange(before?.start, before?.end, 4000);
        const p = readPager();
        LOG(`[Pager] ${label} → now at ${p ? `${p.start}-${p.end} of ${p.total}` : "unknown"}`);
        return !!p;
    }
    async function learnFirstPageStart(maxHops = 30) {
        const p0 = readPager(); if (!p0) return false;
        let hops = 0, cur = p0;
        while (cur.hasPrev && hops++ < maxHops) {
            await clickAndWait(cur.prevBtn, "Prev");
            cur = readPager(); if (!cur) break;
        }
        if (cur && Number.isFinite(cur.start)) state.firstPageStart = cur.start;
        // Go back to original
        let back = 0;
        while (cur && (cur.start !== p0.start) && cur.hasNext && back++ < maxHops) {
            await clickAndWait(cur.nextBtn, "Next");
            cur = readPager();
        }
        return true;
    }
    async function goToFirstPage(maxHops = 30) {
        const p0 = readPager(); if (!p0) return false;
        let hops = 0, cur = p0;
        while (cur.hasPrev && hops++ < maxHops) {
            await clickAndWait(cur.prevBtn, "Prev");
            cur = readPager(); if (!cur) break;
        }
        if (cur && Number.isFinite(cur.start)) state.firstPageStart = cur.start;
        return !!cur;
    }
    async function goToPageStart(desiredStart, maxHops = 300) {
        if (!Number.isFinite(state.firstPageStart)) await learnFirstPageStart();
        let cur = readPager(); if (!cur) return false;
        const size = Math.max(1, (cur.end - cur.start + 1));
        const firstStart = Number.isFinite(state.firstPageStart) ? state.firstPageStart : cur.start;
        if (cur.start === desiredStart) return true;
        await goToFirstPage();
        cur = readPager(); if (!cur) return false;
        const hopsNeeded = Math.max(0, Math.floor((desiredStart - firstStart) / size));
        let hops = 0;
        while (hops < hopsNeeded && cur?.hasNext) {
            await clickAndWait(cur.nextBtn, "Next");
            cur = readPager(); if (!cur) break;
            hops++;
        }
        cur = readPager();
        return !!cur && cur.start === desiredStart;
    }

    /* ========================= Stabilizers ========================= */
    async function stabilizeList({ minStableMs = 300, maxWaitMs = 4000 } = {}) {
        // Wait until: pager text freezes AND there are rows AND the first row has text
        const t0 = Date.now();
        let lastTxt = null;
        let lastChange = Date.now();
        while (Date.now() - t0 < maxWaitMs) {
            const p = readPager();
            const rows = getRows();
            const firstHasText = rows[0] && !!extractNameFromRow(rows[0]);
            if (p && rows.length > 0 && firstHasText) {
                const txt = p.text || `${p.start}-${p.end} of ${p.total}`;
                if (txt !== lastTxt) {
                    lastTxt = txt;
                    lastChange = Date.now();
                } else if (Date.now() - lastChange >= minStableMs) {
                    return true;
                }
            }
            await sleep(80);
        }
        return !!(getRows().length && readPager());
    }
    function normalizeName(s) {
        return String(s || "")
            .toLowerCase()
            .replace(/\s+/g, " ")
            .trim();
    }
    async function retryFindRowByName(name, { tries = 10, delay = 120, nudgeScroll = true } = {}) {
        const want = normalizeName(name);
        const scrollContainer = getTable()?.parentElement || document.scrollingElement || document.documentElement;
        for (let i = 0; i < tries; i++) {
            const rows = getRows();
            for (const tr of rows) {
                const n = extractNameFromRow(tr);
                if (n && normalizeName(n) === want) return tr;
            }
            if (nudgeScroll && scrollContainer && i > 0 && i % 3 === 0) {
                // Minor vertical nudge to tick any lazy renderers
                scrollContainer.scrollTop += 1;
                scrollContainer.scrollTop -= 1;
            }
            await sleep(delay);
        }
        return null;
    }

    /* ========================= Detail marker ========================= */
    async function waitForDetailMarker(timeoutMs = 12000) {
        const SEL = ".aside-column, .contact-column__name, [data-testid='client-header'], .ClientHeaderClass";
        const t0 = Date.now();
        while (Date.now() - t0 < timeoutMs) {
            const el = document.querySelector(SEL);
            if (el) {
                LOG("Detail marker found.");
                return true;
            }
            await sleep(120);
        }
        LOG("❌ Detail marker not found after timeout.");
        return false;
    }

    async function readPersonFromDetail() {
        try {
            const api = (window.personInfo && (window.personInfo.read || window.personInfo.get || window.personInfo.readPerson || window.personInfo.readInfo)) || window.getPersonInfo;
            if (api) {
                const out = await api();
                if (out) return out;
            }
            const name = (document.querySelector(".contact-column__name")?.textContent || "").trim() || null;
            const phone = (document.querySelector('[data-test-element^="phone-numbers_number_"]')?.textContent || "").trim() || null;
            const email = (document.querySelector('.email a[href^="mailto:"]')?.textContent || "").trim() || null;
            let address = null;
            const addrBlock = document.querySelector(".address__details");
            if (addrBlock) {
                const lines = Array.from(addrBlock.querySelectorAll("p")).map(p => (p.textContent || "").trim()).filter(Boolean);
                const cleaned = lines[0]?.toLowerCase() === "primary" ? lines.slice(1) : lines;
                address = cleaned.join(", ");
            }
            return { name, phone, email, address };
        } catch {
            return null;
        }
    }

    /* ========================= Context restoration ========================= */
    function inListContext() {
        return getRows().length > 0 && !!readPager();
    }
    function findCandidateListLinks() {
        const links = Array.from(document.querySelectorAll("a[href], button, [role='button']"));
        const byHref = links.filter(a => {
            const h = a.getAttribute("href") || "";
            return /\/dashboard\/cases\/open/i.test(h) || /\/cases\/open/i.test(h);
        });
        if (byHref.length) return byHref;
        const byText = links.filter(el => {
            const t = (el.textContent || "").trim().toLowerCase();
            return /^(open cases|cases|open|back to cases)$/.test(t);
        });
        return byText;
    }
    async function ensureListContext() {
        if (inListContext()) return true;

        LOG("[List] Context missing — attempting to restore…");
        const candidates = findCandidateListLinks();
        for (const el of candidates) {
            try {
                el.click();
                await sleep(400);
                if (await waitForList(8000)) {
                    if (inListContext()) {
                        LOG("[List] Restored via candidate click.");
                        ensureListUrl();
                        await stabilizeList();
                        return true;
                    }
                }
            } catch {}
        }
        if (state.lastListUrl && location.href !== state.lastListUrl) {
            LOG("[List] Navigating to lastListUrl…");
            location.assign(state.lastListUrl);
            await sleep(700);
            if (await waitForList(12000) && inListContext()) {
                LOG("[List] Restored via lastListUrl.");
                await stabilizeList();
                return true;
            }
        }
        const ready = await waitForList(10000);
        if (ready && inListContext()) {
            await stabilizeList();
            return true;
        }
        LOG("❌ [List] Could not restore list context.");
        return false;
    }

    /* ========================= Skip integration ========================= */
    function getSkipSet() {
        try {
            const arr = Array.isArray(window.__SKIP_KEYS__) ? window.__SKIP_KEYS__ : [];
            return new Set(arr);
        } catch { return new Set(); }
    }

    /* ========================= Scrape list ========================= */
    async function scrapeList() {
        if (!(await ensureListContext())) {
            return { ok: false, error: "Could not establish list context" };
        }
        await stabilizeList();

        const pager = readPager();
        if (!pager) {
            LOG("❌ Pager not found or unreadable.");
            return { ok: false, error: "Pager not found" };
        }

        // NOTE: Do not overwrite pageStart if a run is active (we'll set it at Start).
        if (!state.running && state.pageStart == null) {
            state.pageStart = pager.start;
            PROGRESS("pager:set", { pageStart: state.pageStart, total: pager.total, text: pager.text });
            LOG(`[Pager] Captured pageStart=${state.pageStart} on scrape (${pager.text}).`);
        }

        const rows = getRows();
        state.items = rows.map((tr, i) => {
            const name = extractNameFromRow(tr);
            const { key, idx } = buildKeyFromRow(tr, i);
            return { key, name, idx, url: null, status: null, billingStatus: null, uploadStatus: null, error: '' };
        }).filter(x => x.name);

        ensureListUrl();
        state.pagerTotal = pager.total;
        LOG(`[Scrape] ${state.items.length} users on ${pager.text}.`);
        PROGRESS("list", { count: state.items.length, items: getItems() });
        return { ok: true, items: getItems() };
    }
    function getItems() {
        return state.items.map(x => ({ ...x }));
    }

    /* ========================= Cross-page row finding ========================= */
    /* ========================= Cross-page row finding (STRICT, from page 1) ========================= */
    async function findRowAcrossPages(
        name,
        { returnToOriginalIfNotFound = true, forceFromFirst = true, maxHops = 2000 } = {}
    ) {
        // Ensure list context is available
        if (!(await ensureListContext())) {
            LOG(`[FindAll] List context missing before full scan for "${name}".`);
            return { tr: null, pageStart: null };
        }

        // Read where we are now (so we can restore if requested)
        const original = readPager();
        if (!original) {
            LOG(`[FindAll] Pager missing before full scan for "${name}".`);
            return { tr: null, pageStart: null };
        }

        // Always start from the very first page if requested (ignore state.firstPageStart)
        if (forceFromFirst) {
            LOG(`[FindAll] Forcing scan from FIRST page for "${name}" (was at ${original.start}-${original.end} of ${original.total}).`);
            // Hard-walk Prev until there is no Prev, with stabilization between moves
            let safetyPrev = 0;
            let p = readPager();
            while (p?.hasPrev && safetyPrev++ < maxHops) {
                await clickAndWait(p.prevBtn, "Prev (to first)");
                await stabilizeList();
                p = readPager();
            }
        }

        await stabilizeList();
        let p = readPager();
        if (!p) {
            LOG(`[FindAll] Pager missing after move-to-first for "${name}".`);
            return { tr: null, pageStart: null };
        }

        // Compute scan bounds
        const pageSize = Math.max(1, (p.end - p.start + 1));
        const total = Number.isFinite(p.total) ? p.total : pageSize; // fallback
        const maxPages = Math.max(1, Math.ceil(total / pageSize));
        LOG(`[FindAll] Scanning up to ${maxPages} page(s) @ size ${pageSize} for "${name}". Starting at ${p.start}-${p.end} of ${p.total}.`);

        // Linear scan forward
        // Linear scan forward
        let pagesScanned = 0;
        while (pagesScanned < maxPages && p) {
            pagesScanned++;

            const tr = await retryFindRowByName(name, { tries: 8, delay: 110, nudgeScroll: true });
            if (tr) {
                LOG(`[FindAll] FOUND "${name}" on page starting ${p.start} (page ${pagesScanned}/${maxPages}).`);
                return { tr, pageStart: p.start };
            }

            // Decide whether to advance — prefer math over button state
            const canMathNext = p.end < p.total;
            const canBtnNext  = p.hasNext;

            LOG(`[FindAll] "${name}" not on ${p.start}-${p.end}. ${canMathNext ? '→ Next (math)' : (canBtnNext ? '→ Next (btn)' : '→ End of list')}`);

            if (!(canMathNext || canBtnNext)) break; // truly at end

            // If there's no usable nextBtn (or it's mis-detected), we still try to click it when present;
            // if absent, attempt keyboard/PageDown or bail — but 'canMathNext' keeps loop honest.
            if (p.nextBtn && (canMathNext || canBtnNext)) {
                await clickAndWait(p.nextBtn, "Next (scan)");
            } else {
                // Fallback: last resort, simulate a small scroll to trigger lazy UI then re-read pager.
                document.scrollingElement && (document.scrollingElement.scrollTop += 1);
                await sleep(120);
            }

            await stabilizeList();
            const p2 = readPager();
            if (!p2) break;
            p = p2;
        }

        LOG(`[FindAll] FAILED to locate "${name}" after scanning ${pagesScanned}/${maxPages} page(s).`);

        // Optional: restore the original page window
        if (returnToOriginalIfNotFound && original) {
            let cur = readPager();
            let back = 0;
            while (cur && cur.start !== original.start && cur.hasPrev && back++ < maxHops) {
                await clickAndWait(cur.prevBtn, "Prev (restore)");
                await stabilizeList();
                cur = readPager();
            }
            LOG(`[FindAll] Restored to original window starting at ${original.start}.`);
        }

        return { tr: null, pageStart: null };
    }
    /* ========================= Visit one ========================= */
    async function visitOne(item) {
        try {
            LOG(`Visiting ${item.name}…`, { key: item.key });
            PROGRESS("visit:start", { key: item.key, name: item.name });

            const prevUrl = location.href;

            // Ensure context + stabilized list
            if (!(await ensureListContext())) throw new Error("List not available before visit");
            await stabilizeList();

            // ✅ Don’t jump first — check current page; if missing, scan all pages and then anchor where found.
            await stabilizeList();

// 1) Try current page first (sorting may have changed)
            let row = await retryFindRowByName(item.name, { tries: 10, delay: 110 });
            if (!row) {
                LOG(`[Find] Not on current page — scanning all pages for "${item.name}"…`);
                // const found = await findRowAcrossPages(item.name, { returnToOriginalIfNotFound: false });
                const found = await findRowAcrossPages(item.name, { returnToOriginalIfNotFound: false, forceFromFirst: true });
                if (!found.tr) throw new Error(`Row for ${item.name} not found on any page`);
                // 2) Snap our pageStart anchor to the page where we actually found this user
                state.pageStart = found.pageStart || state.pageStart;
                PROGRESS("pager:set", { pageStart: state.pageStart, reason: "found-on-different-page" });
                LOG(`[Pager] "${item.name}" located on page start=${state.pageStart}.`);
                row = found.tr;
            }

            // Click & wait for detail
            row.scrollIntoView({ behavior: "smooth", block: "center" });
            await sleep(120);
            row.click();
            const newUrl = await waitForUrlChange(prevUrl);
            item.url = newUrl;

            const markerOk = await waitForDetailMarker(12000);
            if (!markerOk) {
                LOG("[Detail] Marker missing; waiting briefly before parse.");
                await sleep(1200);
            }

            // Parse detail (best-effort)
            try {
                const person = await readPersonFromDetail();
                if (person) {
                    PROGRESS("detail:person", { key: item.key, name: item.name, person });
                    const parts = [];
                    if (person.name) parts.push(`Name: ${person.name}`);
                    if (person.phone) parts.push(`Phone: ${person.phone}`);
                    if (person.email) parts.push(`Email: ${person.email}`);
                    if (person.address) parts.push(`Addr: ${person.address}`);
                    LOG(`[Detail] ${parts.join(" | ")}`, { key: item.key });
                } else {
                    LOG("[Detail] Parsed — no fields found.", { key: item.key });
                }
            } catch (e) {
                LOG(`[Detail] Parse error: ${e?.message || e}`, { key: item.key });
            }

            // ====== Upload + Billing (unchanged) ======
            // ====== Upload + Billing (toggle-aware) ======
            try {
                const params = await new Promise((resolve) => {
                    chrome.storage.sync.get(
                        ['startDate', 'endDate', 'ratePerDay', 'attestationDate', 'doUpload', 'doBilling'],
                        resolve
                    );
                });

                const startISOVal = params.startDate;
                const endISOVal   = params.endDate;
                const ratePerDay  = Number(params.ratePerDay || 48) || 48;
                const dateStr     = params.attestationDate;

                const doUpload    = params.doUpload !== false;  // default true
                const doBilling   = params.doBilling !== false; // default true

                if (!startISOVal || !endISOVal) {
                    throw new Error('Missing start or end date');
                }

                const toMDY = (iso) => { const [y, m, d] = iso.split('-'); return `${m}/${d}/${y}`; };
                const toISO = (s) => {
                    if (typeof s !== "string") return null;
                    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
                    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
                    if (m) return `${m[3]}-${m[1].padStart(2,"0")}-${m[2].padStart(2,"0")}`;
                    return null;
                };

                const startISOArg = toISO(startISOVal) || startISOVal || null;
                const endISOArg   = toISO(endISOVal)   || endISOVal   || null;
                const attestISO   = toISO(dateStr)     || dateStr     || null;

                // Share to window for generator compatibility
                window.__ATT_POPUP_PARAMS__ = {
                    chosenDate: attestISO,
                    attestationISO: attestISO,
                    startISO: startISOArg,
                    endISO: endISOArg
                };

                // --- Upload (conditional) ---
                if (doUpload) {
                    PROGRESS("upload:start", { key: item.key, name: item.name });
                    const uploadResp = await chrome.runtime.sendMessage({
                        type: "GENERATE_AND_UPLOAD",
                        chosenDate: attestISO,
                        attestationISO: attestISO,
                        startISO: startISOArg,
                        endISO: endISOArg,
                        backendUrl: "https://dietfantasy-nkw6.vercel.app/api/ext/attestation"
                    });

                    if (!uploadResp?.ok) {
                        const error = uploadResp?.error || 'Unknown upload error';
                        PROGRESS("upload:error", { key: item.key, name: item.name, error });
                        item.uploadStatus = 'error';
                        item.error = error;
                        LOG(`Upload failed for ${item.name}: ${error}`, { key: item.key });
                    } else {
                        PROGRESS("upload:ok", { key: item.key, name: item.name });
                        item.uploadStatus = 'ok';
                        LOG(`Upload completed for ${item.name}`, { key: item.key });
                    }
                    await sleep(600);
                } else {
                    PROGRESS("upload:skip", { key: item.key, name: item.name });
                    LOG(`Upload skipped by toggle for ${item.name}`, { key: item.key });
                    // Note: leave uploadStatus null (neither ok nor error).
                }

                // --- Billing (conditional) ---
                if (doBilling) {
                    PROGRESS("billing:start", { key: item.key, name: item.name });
                    const billingParams = { start: toMDY(startISOVal), end: toMDY(endISOVal), ratePerDay };
                    const billingResp = await chrome.runtime.sendMessage({
                        type: "INJECT_BILLING_SCRIPT",
                        billingParams
                    });

                    if (!billingResp?.ok) {
                        const error = billingResp?.error || 'Unknown billing error';
                        PROGRESS("billing:error", { key: item.key, name: item.name, error });
                        item.billingStatus = 'error';
                        item.error = error;
                        LOG(`Billing failed for ${item.name}: ${error}`, { key: item.key });
                    } else {
                        PROGRESS("billing:ok", { key: item.key, name: item.name });
                        item.billingStatus = 'ok';
                        LOG(`Billing completed for ${item.name}`, { key: item.key });
                    }
                } else {
                    PROGRESS("billing:skip", { key: item.key, name: item.name });
                    LOG(`Billing skipped by toggle for ${item.name}`, { key: item.key });
                    // Note: leave billingStatus null.
                }

                // Final status: "ok" means everything you *asked* it to do succeeded.
                const needUpload  = !!doUpload;
                const needBilling = !!doBilling;
                const uploadOk    = !needUpload  || item.uploadStatus  === 'ok';
                const billingOk   = !needBilling || item.billingStatus === 'ok';
                item.status = (uploadOk && billingOk) ? 'ok' : 'error';

            } catch (e) {
                const error = e.message || String(e);
                PROGRESS("visit:error", { key: item.key, name: item.name, error });
                item.status = 'error';
                item.error = error;
                LOG(`Error processing ${item.name}: ${error}`, { key: item.key });
            }

            await sleep(1400);

            // ===== Return to list & restore paginator =====
            LOG("[Nav] Returning to list…", { key: item.key });
            history.back();

            await sleep(420);
            let listReady = await waitForList(20000);
            if (!listReady && state.lastListUrl && location.href !== state.lastListUrl) {
                LOG("[Nav] List not visible; navigating to saved list URL…", { key: item.key });
                location.assign(state.lastListUrl);
                await sleep(600);
                listReady = await waitForList(20000);
            }
            if (!listReady) throw new Error("List did not reappear");

            if (!(await ensureListContext())) throw new Error("Failed to re-establish list context after back()");
            await stabilizeList();

            if (state.pageStart) {
                const ok = await goToPageStart(state.pageStart);
                await stabilizeList();
                if (!ok) LOG(`[Pager] ⚠️ Could not restore pager to start=${state.pageStart}.`, { key: item.key });
            }

            item.status = (item.billingStatus === 'ok' && item.uploadStatus === 'ok') ? 'ok' : 'error';
            PROGRESS("visit:ok", { key: item.key, url: item.url, name: item.name });
            LOG(`✅ Completed ${item.name}`, { key: item.key });
            return true;
        } catch (e) {
            item.status = 'error';
            item.error = e.message || String(e);
            PROGRESS("visit:error", { key: item.key, name: item.name, error: item.error });
            LOG(`❌ Error on ${item.name}: ${item.error}`, { key: item.key });
            return false;
        }
    }

    /* ========================= Runner ========================= */
    async function runAll({ fromIndex = 0 } = {}) {
        if (state.running) {
            LOG("Run already in progress — ignoring duplicate start.");
            return { ok: true, items: getItems(), alreadyRunning: true };
        }

        // 🔊 Capture current pager window **right when Start is clicked**
        const pAtStart = readPager();
        if (pAtStart) {
            state.pageStart = pAtStart.start;
            state.pagerTotal = pAtStart.total;
            PROGRESS("pager:set", { pageStart: state.pageStart, total: state.pagerTotal, reason: "start-click" });
            LOG(`[Start] ${TS()} — pageStart set to ${state.pageStart} (${pAtStart.text}).`);
        } else {
            LOG("[Start] No pager detected at start; will attempt to recover.");
        }

        if (!listVisible()) {
            LOG("Waiting for list to be visible before scraping…");
            const ready = await waitForList(20000);
            if (!ready) {
                const msg = "Open Cases table not visible (timeout).";
                PROGRESS("run:error", { error: msg });
                LOG(`❌ ${msg}`);
                return { ok: false, error: msg };
            }
        }

        if (!state.items.length) {
            const res = await scrapeList();
            if (!res.ok || !state.items.length) {
                const msg = "No rows found — is the Open Cases table visible?";
                PROGRESS("run:error", { error: msg });
                LOG(`❌ ${msg}`);
                return { ok: false, error: msg };
            }
        }

        const skipSet = getSkipSet();

        state.running = true;
        state.paused = false;
        state.stopped = false;
        PROGRESS("run:start", { total: state.items.length, fromIndex, pageStart: state.pageStart, totalCount: state.pagerTotal });
        LOG(`Starting run with ${state.items.length} users — anchor pageStart=${state.pageStart}, total=${state.pagerTotal}`);

        for (let i = fromIndex; i < state.items.length; i++) {
            if (state.stopped) break;
            while (state.paused && !state.stopped) await sleep(180);
            if (state.stopped) break;

            const item = state.items[i];
            if (skipSet.has(item.key) || item.skip === true) {
                PROGRESS("visit:skip", { key: item.key, name: item.name });
                LOG(`⏭️ Skipping ${item.name}`, { key: item.key });
                continue;
            }

            LOG(`→ Visiting #${i + 1}/${state.items.length}: ${item.name}`, { key: item.key });
            await visitOne(item);
            PROGRESS("state:update", { items: getItems() });
        }

        state.running = false;
        if (!state.stopped) {
            PROGRESS("run:done", { items: getItems() });
            LOG("Run finished.");
        } else {
            LOG("⏹️ Stopped.");
            PROGRESS("run:stop", {});
        }
        return { ok: true, items: getItems() };
    }

    /* ========================= Controls ========================= */
    function pause()  { state.paused = true;  PROGRESS("run:pause");  LOG("⏸️ Paused.");  return { ok: true }; }
    function resume() { state.paused = false; PROGRESS("run:resume"); LOG("▶️ Resumed."); return { ok: true }; }
    function stop()   { state.stopped = true; state.running = false; PROGRESS("run:stop"); LOG("⏹️ Stopped."); return { ok: true }; }

    window.navAgent = {
        scrapeList,
        runAll,
        pause,
        resume,
        stop,
        getState: () => ({
            running: state.running,
            paused: state.paused,
            stopped: state.stopped,
            items: getItems(),
            pageStart: state.pageStart,
            pagerTotal: state.pagerTotal,
            lastListUrl: state.lastListUrl
        })
    };
})();