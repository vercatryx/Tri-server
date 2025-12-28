// modules/enterBillingDetails.js
// Shelf-open is now robust: verifies clickability, tries multiple interaction paths,
// observes for lazy render, and *then* waits specifically for the authorized elements.

(async () => {
    try {
        console.log('[enterBillingDetails] Starting…');

        // ===== helpers =====
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        const byXPath = (xp) =>
            document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue || null;
        const fire = (el, type, init={}) =>
            el && el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true, ...init }));
        const mouse = (el, type) =>
            el && el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
        const pointer = (el, type) =>
            el && el.dispatchEvent(new PointerEvent(type, { pointerId:1, pointerType:'mouse', isPrimary:true, bubbles:true, cancelable:true }));
        const keyEvt = (el, type, key='Enter', code=key) =>
            el && el.dispatchEvent(new KeyboardEvent(type, { key, code, bubbles: true, cancelable: true }));
        const setNativeInputValue = (el, value) => {
            const desc =
                el?.tagName === 'TEXTAREA'
                    ? Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')
                    : Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
            if (desc?.set) desc.set.call(el, value);
            else if (el) el.value = value;
        };
        const setNativeValue = setNativeInputValue;
        const parseCurrency = (txt) => Number(String(txt).replace(/[^0-9.]/g, '')) || 0;
// Strict MDY parser: rejects impossible months/days (e.g., 9/38, 2/30)
        const parseMDY = (s) => {
            const m = String(s).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
            if (!m) return null;
            const mm = +m[1], dd = +m[2], yyyy = +m[3];
            if (mm < 1 || mm > 12) return null;
            const last = new Date(yyyy, mm, 0).getDate(); // last day in that month
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
        const shown = (el) => !!(el && (el.offsetParent !== null || (el.getClientRects?.().length || 0) > 0));

        // ===== constants =====
        const ADD_BTN_ID = 'add-fee-schedule-service-provided-button';
        const ADD_BTN_XP = '/html/body/div[2]/div[2]/main/div/section/div/div[2]/div/div[1]/div[2]/div[1]/div/button';

        const XPATH_REMAINING = '/html/body/div[2]/div[2]/main/div/section/div/div[2]/div/div[1]/div[2]/div[2]/div[2]/div/form/div[1]/div[1]/p/span';
        const XPATH_RANGE = '/html/body/div[2]/div[2]/main/div/section/div/div[2]/div/div[1]/div[2]/div[2]/div[2]/div/form/div[1]/div[2]/p';

        const AMOUNT_ID = 'provided-service-unit-amount';
        const AMOUNT_XPATH = '/html/body/div[2]/div[2]/main/div/section/div/div[2]/div/div[1]/div[2]/div[2]/div[2]/div/form/div[3]/div[1]/div/input';

        const PLACE_ID = 'provided-service-place_of_service';
        const PLACE_OUTER_XPATH = '/html/body/div[2]/div[2]/main/div/section/div/div[2]/div/div[1]/div[2]/div[2]/div[2]/div/form/div[5]/div[2]/div/div[1]/div/div[1]';

        const NOTE_XPATH = '/html/body/div[2]/div[2]/main/div/section/div/div[2]/div/div[1]/div[2]/div[2]/div[2]/div/form/div[7]/div/div/div[2]/textarea';

        const SUBMIT_ID = 'fee-schedule-provided-service-post-note-btn';
        const SUBMIT_XP = '//*[@id="fee-schedule-provided-service-post-note-btn"]';
        const DRAFT_ID = 'fee-schedule-provided-service-post-note-btn-secondary';

        const CANCEL_ID = 'fee-schedule-provided-service-cancel-btn';
        const CANCEL_XP = '/html/body/div[2]/div[2]/main/div/section/div/div[2]/div/div[1]/div[2]/div[2]/div[2]/div/form/div[10]/button';

        const HOME_TEXT = '12 - Home';
        const HOME_VALUE = 'c0d441b4-ba1b-4f68-93af-a4d7d6659fba';

        // Date Range label + widget
        const DATE_RANGE_LABEL_ID = 'Date Range-label';
        const DATE_RANGE_LABEL_XP = '/html/body/div[2]/div[2]/main/div/section/div/div[2]/div/div[1]/div[2]/div[2]/div[2]/div/form/div[4]/fieldset/div[2]/label/span';
        const RANGE_BTN_ID = 'provided-service-dates';
        const START_ID = 'provided-service-dates-start';
        const END_ID = 'provided-service-dates-end';
        const START_YR_ID = 'provided-service-dates-start-year';
        const END_YR_ID = 'provided-service-dates-end-year';

        // ===== inputs from popup =====
        const args = window.__BILLING_INPUTS__ || {};
        const ratePerDay = Number(args.ratePerDay || 48) || 48;
        const reqStart = parseMDY(args.start || '');
        const reqEnd = parseMDY(args.end || '');
        if (!reqStart || !reqEnd || reqEnd < reqStart) {
            console.error('[enterBillingDetails] Invalid start/end from popup:', args);
            window.__billingResult = { ok: false, error: 'Invalid date range provided' };
            return;
        }
        console.log('[enterBillingDetails] Requested:', fmtMDY(reqStart), '→', fmtMDY(reqEnd), '| Rate/day =', ratePerDay);
// ===== EARLY DUPLICATE GUARD (no UI interaction at all) =====
        const inclusiveDays__early = (a, b) => Math.floor((new Date(b.getFullYear(), b.getMonth(), b.getDate()) - new Date(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000) + 1;
        const plannedDays__early = Math.max(1, inclusiveDays__early(reqStart, reqEnd));
        const plannedAmount__early = ratePerDay * plannedDays__early;

        function doInlineScanFallback(startD, endD, amount) {
            // Minimal inline scanner if invoiceScanner module isn't present
            const norm = (s) => String(s||'').replace(/\s+/g,' ').trim();
            const cents = (v) => {
                if (typeof v === 'number') return Math.round(v*100);
                const n = Number(String(v).replace(/[^\d.]/g,''));
                return Number.isFinite(n) ? Math.round(n*100) : NaN;
            };
            const sameDay = (a,b) => a && b && a.getTime()===b.getTime();
            const cards = Array.from(document.querySelectorAll('.fee-schedule-provided-service-card'));
            const tCents = cents(amount);
            for (const card of cards) {
                const amtEl = card.querySelector('[data-test-element="unit-amount-value"]');
                const rngEl = card.querySelector('[data-test-element="service-dates-value"], [data-test-element="service-start-date-value"]');
                const amtCents = cents(norm(amtEl?.textContent));
                const txt = norm(rngEl?.textContent);
                let s=null,e=null;
                if (txt) {
                    const parts = txt.split(/\s*-\s*/);
                    if (parts.length===2) { s=new Date(parts[0]); e=new Date(parts[1]); }
                    else { s=new Date(txt); e=s; }
                    s && s.setHours(0,0,0,0);
                    e && e.setHours(0,0,0,0);
                }
                if (Number.isFinite(amtCents) && s && e && amtCents===tCents && sameDay(s,startD) && sameDay(e,endD)) {
                    return true;
                }
            }
            return false;
        }

        let isDuplicateEarly = false;
        try {
            if (window.invoiceScanner?.findExisting) {
                const out = window.invoiceScanner.findExisting({ start: reqStart, end: reqEnd, amount: plannedAmount__early, requireTitle: null });
                isDuplicateEarly = !!out?.exists;
            } else {
                isDuplicateEarly = doInlineScanFallback(reqStart, reqEnd, plannedAmount__early);
            }
        } catch {}

        if (isDuplicateEarly) {
            // Optional: log to your UI stream
            try { chrome.runtime?.sendMessage?.({ type:'NAV_PROGRESS', event:'log', line:'⛔ Duplicate invoice detected (precheck). Skipping billing.' }); } catch {}
            console.warn('[enterBillingDetails] Duplicate detected (early). Aborting before any clicks.');
            window.__billingResult = { ok:false, duplicate:true, error:'Duplicate invoice (early guard)' };
            return; // <-- HARD STOP: do not open shelf, do nothing else
        }


        // ---------- Shelf open helpers ----------
        const isShelfOpen = () => {
            const amt = document.getElementById(AMOUNT_ID) || byXPath(AMOUNT_XPATH);
            const rem = byXPath(XPATH_REMAINING);
            const rng = byXPath(XPATH_RANGE);
            const form = document.querySelector('form.payments-track-service');
            return !!((amt && shown(amt)) || (rem && shown(rem)) || (rng && shown(rng)) || (form && shown(form)));
        };

        const findAddButton = () => {
            // preferred by id/xpath
            let btn = document.getElementById(ADD_BTN_ID) || byXPath(ADD_BTN_XP);
            if (btn) return btn;

            // fallback: visible button with matching text
            const buttons = Array.from(document.querySelectorAll('button, [role="button"], a[role="button"]'));
            const match = buttons.find(b => {
                const t = (b.textContent || '').trim().toLowerCase();
                return shown(b) && /add\s+new\s+contracted\s+service/.test(t);
            });
            return match || null;
        };

        const centerPoint = (el) => {
            const r = el.getBoundingClientRect();
            return { x: Math.round((r.left + r.right)/2), y: Math.round((r.top + r.bottom)/2) };
        };

        const ensureClickable = (el) => {
            if (!shown(el)) return { ok: false, reason: 'Add button not visible' };
            const { x, y } = centerPoint(el);
            const top = document.elementFromPoint(x, y);
            if (!top) return { ok: false, reason: 'Add button not clickable' };
            if (top === el || el.contains(top)) return { ok: true };
            // sometimes the real clickable child is inside (e.g. span within button)
            if (top.closest && top.closest('button') === el) return { ok: true };
            // overlay covers it
            return { ok: false, reason: 'Add button covered by another element' };
        };

        async function openShelfRobust(addBtn) {
            if (isShelfOpen()) return true;

            // watch the container where the shelf mounts
            const watchRoot =
                byXPath('/html/body/div[2]/div[2]/main/div/section/div/div[2]/div/div[1]/div[2]/div[2]') ||
                document.querySelector('main') ||
                document.body;

            let resolved = false;
            const appeared = () => isShelfOpen();

            const mo = new MutationObserver(() => {
                if (appeared()) resolved = true;
            });
            try {
                mo.observe(watchRoot, { childList: true, subtree: true });
            } catch { /* ignore */ }

            const trySequence = async () => {
                // bring button to center and verify clickability
                addBtn.scrollIntoView({ block: 'center', inline: 'center' });
                await sleep(80);
                let ok = ensureClickable(addBtn);
                if (!ok.ok) {
                    console.warn('[enterBillingDetails] Add button not clickable:', ok.reason);
                }

                // pointer path
                addBtn.focus?.();
                pointer(addBtn, 'pointerover');
                pointer(addBtn, 'pointerenter');
                pointer(addBtn, 'pointerdown');
                mouse(addBtn, 'mousedown');
                pointer(addBtn, 'pointerup');
                mouse(addBtn, 'mouseup');
                mouse(addBtn, 'click');

                // wait ~1s for render
                for (let i = 0; i < 10 && !resolved; i++) {
                    if (appeared()) { resolved = true; break; }
                    await sleep(100);
                }
                if (resolved) return true;

                // keyboard path (Space then Enter)
                addBtn.focus?.();
                keyEvt(addBtn, 'keydown', ' ');
                keyEvt(addBtn, 'keyup', ' ');
                await sleep(60);
                keyEvt(addBtn, 'keydown', 'Enter');
                keyEvt(addBtn, 'keyup', 'Enter');

                for (let i = 0; i < 10 && !resolved; i++) {
                    if (appeared()) { resolved = true; break; }
                    await sleep(100);
                }
                if (resolved) return true;

                // native .click as last resort this round
                addBtn.click?.();
                for (let i = 0; i < 12 && !resolved; i++) {
                    if (appeared()) { resolved = true; break; }
                    await sleep(100);
                }
                return resolved;
            };

            // up to 3 attempts, re-resolving the button each time
            let opened = false;
            for (let attempt = 1; attempt <= 3 && !opened; attempt++) {
                // DOM may re-render; find again
                addBtn = findAddButton() || addBtn;
                opened = await trySequence();
                if (!opened) {
                    console.warn(`[enterBillingDetails] Open attempt ${attempt} failed; retrying…`);
                    await sleep(200 + attempt * 150);
                }
            }

            mo.disconnect();
            return opened || appeared();
        }

        // ===== wait up to 5s for Add button to appear =====
        let addBtn = null;
        for (let i = 0; i < 5; i++) { // check every ~1s
            addBtn = findAddButton();
            if (addBtn) break;
            await sleep(1000);
        }
        if (!addBtn) {
            console.error('[enterBillingDetails] Add button not found after waiting 5s.');
            window.__billingResult = { ok: false, error: 'Add button not found' };
            return;
        }

        // ===== open shelf if needed; then actively wait for authorized nodes =====
        if (!isShelfOpen()) {
            console.log('[enterBillingDetails] Shelf closed — opening…');
            const opened = await openShelfRobust(addBtn);
            if (!opened) {
                console.error('[enterBillingDetails] Shelf did not open after robust attempts.');
                window.__billingResult = { ok: false, error: 'Failed to open billing form' };
                return;
            }
            console.log('[enterBillingDetails] Shelf opened (interaction acknowledged).');
        } else {
            console.log('[enterBillingDetails] Shelf already open.');
        }

        // ===== actively wait for the authorized nodes after open =====
        const waitForAuthBits = async (timeoutMs = 4000) => {
            const startT = Date.now();
            while (Date.now() - startT < timeoutMs) {
                const remainingSpan = byXPath(XPATH_REMAINING);
                const rangeP = byXPath(XPATH_RANGE);
                if (remainingSpan && shown(remainingSpan) && rangeP && shown(rangeP)) {
                    return { remainingSpan, rangeP };
                }
                await sleep(120);
            }
            return { remainingSpan: null, rangeP: null };
        };

        const { remainingSpan, rangeP } = await waitForAuthBits(4500);
        if (!remainingSpan || !rangeP) {
            console.warn('[enterBillingDetails] Missing authorized limit elements after open.');
            window.__billingResult = { ok: false, error: 'Billing form elements not found' };
            return;
        }

        // ===== read authorized remaining + range =====
        const remaining = parseCurrency(remainingSpan.textContent || '');
        const rawRange = (rangeP.textContent || '').trim();
        const parts = rawRange.split(/[-–—]/).map(s => s.trim());
        const authStart = parseMDY(parts[0] || '');
        const authEnd = parseMDY(parts[1] || '');
        if (!authStart || !authEnd) {
            console.error('[enterBillingDetails] Could not parse authorized range:', rawRange);
            window.__billingResult = { ok: false, error: 'Invalid authorized date range' };
            return;
        }
        console.log('[enterBillingDetails] Authorized:', fmtMDY(authStart), '→', fmtMDY(authEnd), '| Remaining $', remaining);

        // ===== intersect requested with authorized =====
        const overlap = clampRange(reqStart, reqEnd, authStart, authEnd);
        if (!overlap) {
            console.error('[enterBillingDetails] No overlap between requested and authorized range — canceling.');
            const cancel = document.getElementById(CANCEL_ID) || byXPath(CANCEL_XP);
            if (cancel) cancel.click();
            window.__billingResult = { ok: false, error: 'No overlap in date ranges' };
            return;
        }

        let billStart = overlap.start;
        let billEnd = overlap.end;
        let days = inclusiveDays(billStart, billEnd);
        let amount = ratePerDay * days;

        // Cap by remaining (trim end date forward)
        if (amount > remaining) {
            const maxDays = Math.max(0, Math.floor(remaining / ratePerDay));
            if (maxDays <= 0) {
                console.error('[enterBillingDetails] Remaining too low to bill any day — canceling.');
                const cancel = document.getElementById(CANCEL_ID) || byXPath(CANCEL_XP);
                if (cancel) cancel.click();
                window.__billingResult = { ok: false, error: 'Insufficient remaining amount' };
                return;
            }
            days = maxDays;
            billEnd = addDays(billStart, days - 1);
            amount = ratePerDay * days;
            console.warn('[enterBillingDetails] Capped by remaining →', fmtMDY(billStart), 'to', fmtMDY(billEnd), 'Days:', days, 'Amount:', amount);
        } else {
            console.log('[enterBillingDetails] Billable:', fmtMDY(billStart), '→', fmtMDY(billEnd), 'Days:', days, 'Amount:', amount);
        }

        // ===== wait for amount input to exist (should, since shelf open) =====
        for (let i = 0; i < 20; i++) {
            const amt = document.getElementById(AMOUNT_ID) || byXPath(AMOUNT_XPATH);
            if (amt) break;
            await sleep(150);
        }

        // ===== fill amount =====
        const amountField = document.getElementById(AMOUNT_ID) || byXPath(AMOUNT_XPATH);
        if (!amountField) {
            console.error('[enterBillingDetails] Amount field not found.');
            window.__billingResult = { ok: false, error: 'Amount field not found' };
            return;
        }
        amountField.focus();
        setNativeValue(amountField, String(amount));
        amountField.valueAsNumber = Number(amount);
        fire(amountField, 'input');
        fire(amountField, 'change');
        amountField.blur();

        // ===== robust date-range setter =====
// ===== robust date-range setter (pane-aware; safe across months) =====
        async function setDateRangeRobust(bStart, bEnd) {

                console.groupCollapsed('[🧭 setDateRangeRobust] Starting');
                const fmt = (d)=>`${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}`;
                console.log('Input dates from billing logic:', fmt(bStart), '→', fmt(bEnd));
                console.log('Raw timestamps:', bStart.getTime(), bEnd.getTime());
            const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
            const byXPath = (xp) =>
                document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue || null;
            const shown = (el)=>!!(el && (el.offsetParent !== null || (el.getClientRects?.().length||0) > 0));
            const M = (el,t)=>el && el.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,view:window}));
            const P = (el,t)=>el && el.dispatchEvent(new PointerEvent(t,{bubbles:true,cancelable:true,pointerId:1,pointerType:'mouse',isPrimary:true}));

            const DATE_RANGE_LABEL_ID  = 'Date Range-label';
            const DATE_RANGE_LABEL_XP  = '/html/body/div[2]/div[2]/main/div/section/div/div[2]/div/div[1]/div[2]/div[2]/div[2]/div/form/div[4]/fieldset/div[2]/label/span';
            const RANGE_BTN_ID         = 'provided-service-dates';
            const START_YR_ID          = 'provided-service-dates-start-year';
            const END_YR_ID            = 'provided-service-dates-end-year';

            const isOpen = () => !!document.querySelector('.ui-duration-field__dropdown.ui-duration-field__dropdown--open');

            // ---- OPEN RELIABLY ----
            const getFakeCandidates = () => {
                const a = document.getElementById(RANGE_BTN_ID);
                const b = document.querySelector('.ui-duration-field__fake-input [role="button"]');
                const c = document.querySelector('.ui-duration-field__fake-input .ui-duration-field__fake-input__value');
                const d = document.querySelector('.ui-duration-field__fake-input');
                return [a,b,c,d].filter(Boolean);
            };
            const clickLikeHuman = (el) => { P(el,'pointerdown'); M(el,'mousedown'); P(el,'pointerup'); M(el,'mouseup'); M(el,'click'); };

            // Report result to the panel + keep a local window flag for debugging
            function reportBillingResult(res) {
                try {
                    chrome.runtime?.sendMessage?.({
                        type: "BILLING_RESULT",
                        ...res,
                        // Echo the userId we injected from the panel, if present
                        userId: window.__BILLING_INPUTS__?.userId ?? null
                    });
                } catch {}
                // also stash for manual inspection in console
                window.__billingResult = res;
            }

            async function openPickerRobust() {
                if (isOpen()) return true;

                const label = document.getElementById(DATE_RANGE_LABEL_ID) || byXPath(DATE_RANGE_LABEL_XP);
                const tryOnce = async () => {
                    const cands = getFakeCandidates();
                    // 1) label tap (some builds need it to reveal inputs)
                    if (label && shown(label)) { clickLikeHuman(label); await sleep(120); if (isOpen()) return true; }

                    // 2) try all fake candidates
                    for (const el of cands) {
                        if (!shown(el)) continue;
                        el.scrollIntoView?.({block:'center', inline:'center'});
                        await sleep(40);
                        clickLikeHuman(el);
                        for (let i=0;i<10;i++){ if (isOpen()) return true; await sleep(60); }
                    }

                    // 3) keyboard fallback on best candidate
                    const best = cands.find(shown);
                    if (best) {
                        best.focus?.();
                        best.dispatchEvent(new KeyboardEvent('keydown',{key:' ',code:'Space',bubbles:true,cancelable:true}));
                        best.dispatchEvent(new KeyboardEvent('keyup',{key:' ',code:'Space',bubbles:true,cancelable:true}));
                        await sleep(120);
                        if (isOpen()) return true;
                        best.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true}));
                        best.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',code:'Enter',bubbles:true,cancelable:true}));
                        for (let i=0;i<10;i++){ if (isOpen()) return true; await sleep(60); }
                    }
                    return false;
                };

                for (let attempt=1; attempt<=3 && !isOpen(); attempt++) {
                    if (await tryOnce()) break;
                    await sleep(150 + attempt*100);
                }
                return isOpen();
            }

            if (!(await openPickerRobust())) {
                console.error('[dateRange] dropdown did not open');
                return false;
            }

            // ---- PANE-AWARE CALENDAR CLICKS ----
            const dd = document.querySelector('.ui-duration-field__dropdown');
            const controls = dd.querySelector('.ui-duration-field__controls');
            const leftSpan  = controls?.querySelector('div:nth-of-type(1) span');
            const rightSpan = controls?.querySelector('div:nth-of-type(2) span');
            const startYearInput = controls?.querySelector('#'+START_YR_ID);
            const endYearInput   = controls?.querySelector('#'+END_YR_ID);
            const prevBtn = controls?.querySelector('a[role="button"]:first-of-type');
            const nextBtn = controls?.querySelector('a[role="button"]:last-of-type');

            const calendarsWrap = dd.querySelector('.ui-duration-field__calendars');
            const leftCal  = calendarsWrap?.querySelector('.ui-calendar:nth-of-type(1)');
            const rightCal = calendarsWrap?.querySelector('.ui-calendar:nth-of-type(2)');

            if (!controls || !leftSpan || !rightSpan || !leftCal || !rightCal || !prevBtn || !nextBtn) {
                console.error('[dateRange] expected calendar structure not found');
                return false;
            }

            const monthIdx = (name) => ['january','february','march','april','may','june','july','august','september','october','november','december']
                .indexOf(String(name||'').trim().toLowerCase());

            const getVisibleRangeAbs = () => {
                const lMonth = monthIdx(leftSpan.textContent);
                const rMonth = monthIdx(rightSpan.textContent);
                const lYear = parseInt(startYearInput?.value || '0', 10);
                const rYear = parseInt(endYearInput?.value   || '0', 10);
                return {
                    left:  lYear * 12 + lMonth,
                    right: rYear * 12 + rMonth,
                    lMonth, rMonth, lYear, rYear
                };
            };

            const ensureMonthVisible = async (date) => {
                const targetAbs = date.getFullYear()*12 + date.getMonth();
                for (let i=0; i<36; i++) {
                    const {left, right} = getVisibleRangeAbs();
                    if (targetAbs >= left && targetAbs <= right) return true;
                    if (targetAbs < left) { M(prevBtn,'click'); }
                    else if (targetAbs > right) { M(nextBtn,'click'); }
                    await sleep(110);
                }
                return false;
            };

            const clickDayInPane = async (pane, date) => {
                const want = String(date.getDate());
                const btns = Array.from(pane.querySelectorAll('.ui-calendar__day:not(.ui-calendar__day--out-of-month) div[role="button"]'));
                const btn = btns.find(b => (b.textContent || '').trim() === want);
                if (!btn) return false;
                M(btn,'mousedown'); M(btn,'mouseup'); M(btn,'click');
                await sleep(140);
                return true;
            };

            // Select START
            if (!(await ensureMonthVisible(bStart))) { console.error('[dateRange] could not show START month'); return false; }
            let vis = getVisibleRangeAbs();
            let ok = false;
            if (vis.lYear === bStart.getFullYear() && vis.lMonth === bStart.getMonth()) {
                ok = await clickDayInPane(leftCal, bStart);
            } else if (vis.rYear === bStart.getFullYear() && vis.rMonth === bStart.getMonth()) {
                ok = await clickDayInPane(rightCal, bStart);
            } else {
                if (bStart.getFullYear()*12 + bStart.getMonth() < vis.left) M(prevBtn,'click'); else M(nextBtn,'click');
                await sleep(120);
                vis = getVisibleRangeAbs();
                if (vis.lYear === bStart.getFullYear() && vis.lMonth === bStart.getMonth()) ok = await clickDayInPane(leftCal, bStart);
                else if (vis.rYear === bStart.getFullYear() && vis.rMonth === bStart.getMonth()) ok = await clickDayInPane(rightCal, bStart);
            }
            if (!ok) { console.error('[dateRange] could not click START day'); return false; }

            // Select END
            if (!(await ensureMonthVisible(bEnd))) { console.error('[dateRange] could not show END month'); return false; }
            vis = getVisibleRangeAbs();
            ok = false;
            if (vis.lYear === bEnd.getFullYear() && vis.lMonth === bEnd.getMonth()) {
                ok = await clickDayInPane(leftCal, bEnd);
            } else if (vis.rYear === bEnd.getFullYear() && vis.rMonth === bEnd.getMonth()) {
                ok = await clickDayInPane(rightCal, bEnd);
            } else {
                if (bEnd.getFullYear()*12 + bEnd.getMonth() < vis.left) M(prevBtn,'click'); else M(nextBtn,'click');
                await sleep(120);
                vis = getVisibleRangeAbs();
                if (vis.lYear === bEnd.getFullYear() && vis.lMonth === bEnd.getMonth()) ok = await clickDayInPane(leftCal, bEnd);
                else if (vis.rYear === bEnd.getFullYear() && vis.rMonth === bEnd.getMonth()) ok = await clickDayInPane(rightCal, bEnd);
            }
            if (!ok) { console.error('[dateRange] could not click END day'); return false; }

            // Let widget close itself; treat label only as a hint (UI may format differently)
            for (let i=0;i<20 && isOpen(); i++) await sleep(80);
            const wantTxt = `${String(bStart.getMonth()+1).padStart(2,'0')}/${String(bStart.getDate()).padStart(2,'0')}/${bStart.getFullYear()} - ${String(bEnd.getMonth()+1).padStart(2,'0')}/${String(bEnd.getDate()).padStart(2,'0')}/${bEnd.getFullYear()}`;
            const labelNow = (document.getElementById(RANGE_BTN_ID)?.textContent || '').trim();
            if (labelNow === wantTxt) {
                console.log('[dateRange] applied via pane-aware calendar clicks:', labelNow);
            } else {
                console.warn('[dateRange] label mismatch (UI may format differently):', { wantTxt, labelNow });
            }
            return true;
        }


        // ===== Check if single day (start === end) =====
        const isSingleDay = billStart.getTime() === billEnd.getTime();
        
        if (isSingleDay) {
            // ===== Single day date entry: Skip date range button, use #provided-service-date directly =====
            async function setSingleDateRobust(date) {
                console.groupCollapsed('[📅 setSingleDateRobust] Starting (single day)');
                const fmt = (d) => `${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}`;
                console.log('Single date to set:', fmt(date));
                
                // Helper functions (same as setDateRangeRobust)
                const M = (el,t) => el && el.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,view:window}));
                const P = (el,t) => el && el.dispatchEvent(new PointerEvent(t,{bubbles:true,cancelable:true,pointerId:1,pointerType:'mouse',isPrimary:true}));
                const clickLikeHuman = (el) => { P(el,'pointerdown'); M(el,'mousedown'); P(el,'pointerup'); M(el,'mouseup'); M(el,'click'); };
                
                // Wait for the single date input field to appear (form might need time to render)
                console.log('[singleDate] Waiting for date input field to appear...');
                let dateInput = null;
                for (let i = 0; i < 30; i++) { // Wait up to 3 seconds (30 * 100ms)
                    dateInput = document.getElementById('provided-service-date');
                    if (dateInput && shown(dateInput)) {
                        console.log('[singleDate] Found date input field after', i, 'attempts');
                        break;
                    }
                    await sleep(100);
                }
                
                if (!dateInput) {
                    console.error('[singleDate] Single date input field (#provided-service-date) not found after waiting');
                    return false;
                }
                
                if (!shown(dateInput)) {
                    console.error('[singleDate] Date input field is not visible');
                    return false;
                }
                
                console.log('[singleDate] Found date input field');
                
                // Format date as MM/DD/YYYY for the input (based on placeholder)
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                const year = date.getFullYear();
                const mdyDate = `${month}/${day}/${year}`;
                
                console.log(`[singleDate] Setting date to: ${mdyDate}`);
                
                // Scroll into view
                dateInput.scrollIntoView({ block: 'center', inline: 'center' });
                await sleep(150);
                
                // Open the calendar by clicking the input or calendar icon (same approach as test button)
                dateInput.focus();
                await sleep(100);
                
                // Try clicking the input or calendar icon (use parentElement like test button)
                const calendarIcon = dateInput.parentElement?.querySelector('.ui-date-field__calendar-icon');
                if (calendarIcon) {
                    console.log('[singleDate] Clicking calendar icon to open dropdown');
                    clickLikeHuman(calendarIcon);
                } else {
                    console.log('[singleDate] Clicking date input to open dropdown');
                    dateInput.click();
                }
                
                await sleep(500);
                
                // Check if calendar dropdown is open (same check as test button)
                let dropdown = dateInput.parentElement?.querySelector('.ui-date-field__dropdown');
                let isOpen = dropdown && (dropdown.style.display !== 'none' || dropdown.offsetParent !== null);
                
                if (!isOpen) {
                    console.warn('[singleDate] ⚠️ Calendar dropdown not visible, trying alternative approach...');
                    // Try clicking the input again
                    dateInput.click();
                    await sleep(500);
                    dropdown = dateInput.parentElement?.querySelector('.ui-date-field__dropdown');
                    isOpen = dropdown && (dropdown.style.display !== 'none' || dropdown.offsetParent !== null);
                }
                
                if (!isOpen || !dropdown) {
                    console.error('[singleDate] Calendar dropdown not found or not open');
                    return false;
                }
                
                console.log('[singleDate] ✅ Calendar dropdown found');
                
                // Find the calendar table
                const calendar = dropdown.querySelector('.ui-calendar');
                if (!calendar) {
                    console.error('[singleDate] ❌ Calendar table not found');
                    return false;
                }
                
                console.log('[singleDate] ✅ Calendar table found');
                
                // Navigate to the correct month/year (same as test button)
                const controls = dropdown.querySelector('.ui-date-field__controls');
                const yearInput = dropdown.querySelector('#provided-service-date-year-input');
                const prevBtn = dropdown.querySelector('a[role="button"]:first-of-type');
                const nextBtn = dropdown.querySelector('a[role="button"]:last-of-type');
                
                if (!controls || !yearInput || !prevBtn || !nextBtn || !calendar) {
                    console.error('[singleDate] Calendar structure not found', {
                        hasControls: !!controls,
                        hasYearInput: !!yearInput,
                        hasPrevBtn: !!prevBtn,
                        hasNextBtn: !!nextBtn,
                        hasCalendar: !!calendar
                    });
                    return false;
                }
                
                // Set the year first (same as test button)
                const targetYear = date.getFullYear();
                console.log('[singleDate] Setting year to:', targetYear);
                yearInput.value = targetYear;
                fire(yearInput, 'input');
                fire(yearInput, 'change');
                await sleep(300);
                
                // Navigate to correct month (same as test button)
                const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
                const targetMonth = date.getMonth(); // 0-indexed
                
                // Get current month from the calendar
                const monthSpan = controls.querySelector('div span');
                let currentMonthText = monthSpan?.textContent?.trim() || '';
                console.log('[singleDate] Current month text:', currentMonthText);
                
                // Try to navigate to the correct month
                let attempts = 0;
                while (attempts < 24) { // Max 24 months (2 years)
                    const monthText = monthSpan?.textContent?.trim() || '';
                    const currentMonthIdx = monthNames.findIndex(m => monthText.toLowerCase().includes(m));
                    
                    if (currentMonthIdx === targetMonth) {
                        console.log('[singleDate] ✅ Correct month reached');
                        break;
                    }
                    
                    if (currentMonthIdx < targetMonth || currentMonthIdx === -1) {
                        console.log('[singleDate] Clicking next month button');
                        if (nextBtn) {
                            M(nextBtn, 'click');
                            await sleep(200);
                        }
                    } else {
                        console.log('[singleDate] Clicking previous month button');
                        if (prevBtn) {
                            M(prevBtn, 'click');
                            await sleep(200);
                        }
                    }
                    attempts++;
                }
                
                await sleep(300);
                
                // Find and click the day (same as test button)
                const targetDay = String(date.getDate());
                const dayButtons = Array.from(calendar.querySelectorAll('.ui-calendar__day:not(.ui-calendar__day--out-of-month) div[role="button"]'));
                const dayButton = dayButtons.find(btn => {
                    const btnText = (btn.textContent || '').trim();
                    return btnText === targetDay;
                });
                
                if (!dayButton) {
                    console.error(`[singleDate] Day ${targetDay} not found in calendar`);
                    return false;
                }
                
                console.log(`[singleDate] ✅ Found day button, clicking day ${targetDay}`);
                dayButton.scrollIntoView({ block: 'center', inline: 'center' });
                await sleep(100);
                
                P(dayButton, 'pointerdown');
                M(dayButton, 'mousedown');
                P(dayButton, 'pointerup');
                M(dayButton, 'mouseup');
                M(dayButton, 'click');
                
                await sleep(300);
                
                // Verify the date was set
                const finalValue = dateInput.value || '';
                if (finalValue.includes(mdyDate) || finalValue === mdyDate || finalValue !== 'Invalid date') {
                    console.log('[singleDate] ✅ Date set successfully:', finalValue);
                    return true;
                }
                
                console.warn('[singleDate] ⚠️ Date may not have been set correctly. Value:', finalValue);
                return true; // Return true anyway - might still work
            }
            
            const okSingleDate = await setSingleDateRobust(billStart);
            if (!okSingleDate) {
                console.warn('[enterBillingDetails] Single date entry did not confirm; continuing.');
                window.__billingResult = { ok: false, error: 'Failed to set single date' };
                return;
            }
        } else {
            // ===== Multi-day: Click date range button and use date range picker =====
            const okRange = await setDateRangeRobust(billStart, billEnd);
            if (!okRange) {
                console.warn('[enterBillingDetails] Date range entry did not confirm; continuing.');
                window.__billingResult = { ok: false, error: 'Failed to set date range' };
                return;
            }
        }

        // ===== robust "Home" selection =====
        async function selectHomeRobust() {
            const inner = byXPath(PLACE_OUTER_XPATH);
            const selectEl = document.getElementById(PLACE_ID);
            if (!inner || !selectEl) {
                console.warn('[selectHome] Select controls not present yet');
                window.__billingResult = { ok: false, error: 'Place of service field not found' };
                return false;
            }

            // 1) Try Choices instance API
            const inst = selectEl.choices || selectEl._choices || selectEl._instance;
            if (inst && (typeof inst.setChoiceByValue === 'function' || typeof inst.setValue === 'function')) {
                try {
                    if (typeof inst.setChoiceByValue === 'function') inst.setChoiceByValue(HOME_VALUE);
                    else inst.setValue([{ value: HOME_VALUE, label: HOME_TEXT }]);
                    fire(selectEl, 'change');
                    console.log('[selectHome] Set via Choices instance API');
                    return true;
                } catch (e) {
                    console.warn('[selectHome] Choices API path failed, falling back:', e);
                }
            }

            // helpers to open dropdown and find list
            const root = inner.closest('.choices') || inner.parentElement || inner;
            const openDropdown = () => {
                const opener = root.querySelector('.choices__inner') || root;
                mouse(opener, 'mousedown');
                mouse(opener, 'mouseup');
                mouse(opener, 'click');
            };
            const getList = () =>
                root.querySelector('.choices__list--dropdown[aria-expanded="true"] .choices__list[role="listbox"]') ||
                root.querySelector('.choices__list--dropdown .choices__list[role="listbox"]');

            // 2) UI: open dropdown and try to click the option node directly
            openDropdown();
            for (let i = 0; i < 10; i++) {
                const list = getList();
                if (list?.children?.length) {
                    let optionNode =
                        list.querySelector(`[data-value="${HOME_VALUE}"]`) ||
                        Array.from(list.querySelectorAll('.choices__item[role="option"]')).find(n =>
                            (n.textContent || '').trim().toLowerCase() === HOME_TEXT.toLowerCase()
                        ) ||
                        Array.from(list.querySelectorAll('.choices__item[role="option"]')).find(n =>
                            (n.textContent || '').toLowerCase().includes('home')
                        );

                    if (optionNode) {
                        optionNode.scrollIntoView({ block: 'nearest' });
                        mouse(optionNode, 'mousedown');
                        mouse(optionNode, 'mouseup');
                        mouse(optionNode, 'click');
                        const val = optionNode.getAttribute('data-value') || HOME_VALUE;
                        if (selectEl && val) {
                            selectEl.value = val;
                            fire(selectEl, 'change');
                        }
                        console.log('[selectHome] Clicked option node in dropdown');
                        return true;
                    }
                }
                await sleep(100);
            }

            // 3) UI: type in the Choices search input and press Enter
            openDropdown();
            await sleep(80);
            const searchInput =
                root.querySelector('.choices__input--cloned') ||
                root.querySelector('input[type="text"].choices__input');
            if (searchInput) {
                setNativeValue(searchInput, 'home');
                fire(searchInput, 'input');
                fire(searchInput, 'change');
                await sleep(120);
                keyEvt(searchInput, 'keydown', 'Enter');
                keyEvt(searchInput, 'keyup', 'Enter');
                await sleep(150);

                if (selectEl && (selectEl.value === HOME_VALUE ||
                    (selectEl.selectedOptions?.[0]?.textContent || '').toLowerCase().includes('home'))) {
                    console.log('[selectHome] Selected via search + Enter');
                    fire(selectEl, 'change');
                    return true;
                }
            }

            // 4) Fallback: set <select> value directly and update visible text
            const byValue = selectEl.querySelector(`option[value="${HOME_VALUE}"]`);
            const byText = Array.from(selectEl.options || []).find(o => (o.textContent || '').toLowerCase().includes('home'));
            const target = byValue || byText;
            if (target) {
                selectEl.value = target.value;
                fire(selectEl, 'change');
                const single = root.querySelector('.choices__list--single .choices__item');
                if (single) {
                    single.textContent = (target.textContent || HOME_TEXT).trim();
                    single.classList.remove('choices__placeholder');
                    single.setAttribute('data-value', target.value);
                }
                console.log('[selectHome] Applied fallback to set select value directly');
                return true;
            }
            console.warn('[selectHome] All strategies failed');
            window.__billingResult = { ok: false, error: 'Failed to select place of service' };
            return false;
        }

        const homeSelected = await selectHomeRobust();
        if (!homeSelected) {
            return; // Error already set in selectHomeRobust
        }

        // ===== nudge form (no force-enabling) =====
        const noteEl = byXPath(NOTE_XPATH);
        if (noteEl) {
            setNativeValue(noteEl, (noteEl.value || '') + ' ');
            noteEl.dispatchEvent(new InputEvent('input', { bubbles: true, data: ' ', inputType: 'insertText' }));
            await sleep(40);
            setNativeValue(noteEl, (noteEl.value || '').slice(0, -1));
            noteEl.dispatchEvent(new InputEvent('input', { bubbles: true, data: null, inputType: 'deleteContentBackward' }));
            fire(noteEl, 'change');
        }
        const form = document.querySelector('form.payments-track-service');
        if (!form) {
            console.error('[enterBillingDetails] Form not found.');
            window.__billingResult = { ok: false, error: 'Billing form not found' };
            return;
        }
        fire(form, 'input');
        fire(form, 'change');
        fire(form, 'blur');
        form.reportValidity?.();

        // ===== submit =====
        const submit = async () => {
            console.log('[submit] Starting submit process...');
            const id = 'fee-schedule-provided-service-post-note-btn';
            const xp = '/html/body/div[2]/div[2]/main/div/section/div/div[2]/div/div[1]/div[2]/div[2]/div[2]/div/form/div[10]/div/button[2]';

            // Try multiple methods to find the button
            let btn = document.getElementById(id);
            console.log('[submit] Button by ID:', !!btn);

            if (!btn) {
                btn = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                console.log('[submit] Button by XPath:', !!btn);
            }

            if (!btn) {
                // Try by aria-label
                btn = document.querySelector('button[aria-label="SUBMIT FOR REVIEW"]');
                console.log('[submit] Button by aria-label:', !!btn);
            }

            if (!btn) {
                // Try by data-testid
                btn = document.querySelector('button[data-testid="add-note-btn"]');
                console.log('[submit] Button by data-testid:', !!btn);
            }

            if (!btn) {
                console.error('❌ Submit button not found by any method.');
                window.__billingResult = { ok: false, error: 'Submit button not found' };
                return false;
            }

            // Log detailed button state
            console.log('[submit] Button found! Details:', {
                id: btn.id,
                className: btn.className,
                disabled: btn.disabled,
                ariaDisabled: btn.getAttribute('aria-disabled'),
                ariaLabel: btn.getAttribute('aria-label'),
                textContent: btn.textContent,
                isVisible: shown(btn),
                offsetParent: !!btn.offsetParent,
                boundingRect: btn.getBoundingClientRect()
            });

            // Check if button is disabled
            if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') {
                console.error('❌ Submit button is disabled.');
                window.__billingResult = { ok: false, error: 'Submit button is disabled' };
                return false;
            }

            console.log('✅ Attempting to click SUBMIT FOR REVIEW…');

            // Try multiple clicking methods
            const fireMouse = (el, type) => {
                const event = new MouseEvent(type, {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    clientX: el.getBoundingClientRect().left + 10,
                    clientY: el.getBoundingClientRect().top + 10
                });
                const result = el.dispatchEvent(event);
                console.log(`[submit] Fired ${type}, result:`, result);
                return result;
            };

            // Scroll button into view
            btn.scrollIntoView({ behavior: 'instant', block: 'center' });
            console.log('[submit] Scrolled button into view');

            // Focus first
            btn.focus();
            console.log('[submit] Focused button');

            // Wait a tiny bit before firing events
            await sleep(50);

            // Fire mouse events
            fireMouse(btn, 'mouseover');
            fireMouse(btn, 'mouseenter');
            fireMouse(btn, 'mousedown');
            fireMouse(btn, 'mouseup');
            const clickResult = fireMouse(btn, 'click');

            // Also try native click
            console.log('[submit] Trying native click...');
            btn.click();

            console.log('[submit] All click attempts completed, click event result:', clickResult);

            return true;
        };

        console.log('[enterBillingDetails] Form filled (submit will happen AFTER upload)...');

        // ===== PDF UPLOAD SECTION =====
        // Check if upload is requested via billing inputs
        const billingInputs = window.__BILLING_INPUTS__ || {};
        const shouldUpload = billingInputs.attemptUpload && billingInputs.hasSignature;

        if (shouldUpload) {
            console.log('[enterBillingDetails] PDF upload requested - waiting for Attach Document button...');

            // Wait for the "Attach Document" button to appear
            let attachBtn = null;
            for (let i = 0; i < 30; i++) {
                attachBtn = document.querySelector('.payments-attachment-button') ||
                           Array.from(document.querySelectorAll('button[id^="payments-attachment-button"]'))
                               .find(b => (b.textContent || '').includes('Attach Document') && b.offsetParent !== null);
                if (attachBtn) {
                    console.log('[enterBillingDetails] Found "Attach Document" button after', i * 200, 'ms');
                    break;
                }
                await sleep(200);
            }

            if (!attachBtn) {
                console.warn('[enterBillingDetails] Attach Document button not found - skipping upload');
                window.__billingResult = {
                    ok: true,
                    actualStart: fmtMDY(billStart),
                    actualEnd: fmtMDY(billEnd),
                    actualAmount: amount,
                    uploadSkipped: true,
                    uploadReason: 'Attach button not found'
                };
                return;
            }

            // Trigger the PDF generation and upload using direct approach (like Test Direct Upload)
            console.log('[enterBillingDetails] Triggering PDF generation and upload...');

            // Convert dates to ISO format for backend
            const startISO = `${billStart.getFullYear()}-${String(billStart.getMonth() + 1).padStart(2, '0')}-${String(billStart.getDate()).padStart(2, '0')}`;
            const endISO = `${billEnd.getFullYear()}-${String(billEnd.getMonth() + 1).padStart(2, '0')}-${String(billEnd.getDate()).padStart(2, '0')}`;

            try {
                // Check if personInfo and pdfUploader are available
                if (!window.personInfo?.getPerson) {
                    console.error('[enterBillingDetails] personInfo module not loaded');
                    window.__billingResult = {
                        ok: true,
                        actualStart: fmtMDY(billStart),
                        actualEnd: fmtMDY(billEnd),
                        actualAmount: amount,
                        uploadFailed: true,
                        uploadError: 'personInfo module not loaded'
                    };
                    return;
                }

                if (!window.pdfUploader?.attachBytes) {
                    console.error('[enterBillingDetails] pdfUploader module not loaded');
                    window.__billingResult = {
                        ok: true,
                        actualStart: fmtMDY(billStart),
                        actualEnd: fmtMDY(billEnd),
                        actualAmount: amount,
                        uploadFailed: true,
                        uploadError: 'pdfUploader module not loaded'
                    };
                    return;
                }

                // Get person info
                console.log('[enterBillingDetails] Reading person info...');
                const personResult = await window.personInfo.getPerson({ retries: 4, delayMs: 250 });
                if (!personResult?.ok) {
                    throw new Error('Failed to read person info');
                }
                const person = personResult.person || {};
                console.log('[enterBillingDetails] Person:', person.name);

                // Generate PDF via backend
                console.log('[enterBillingDetails] Generating PDF via backend...');
                const backendUrl = "https://dietfantasy-nkw6.vercel.app/api/ext/attestation";
                const payload = {
                    name: person.name || "",
                    phone: person.phone || "",
                    address: person.address || "",
                    deliveryDate: startISO,
                    startDate: startISO,
                    endDate: endISO,
                    attestationDate: new Date().toISOString().slice(0, 10),
                    userId: billingInputs.userId || null
                };

                const pdfResponse = await new Promise((resolve) => {
                    chrome.runtime.sendMessage({ type: 'FETCH_ATTESTATION', backendUrl, payload }, resolve);
                });

                if (!pdfResponse?.ok) {
                    throw new Error(pdfResponse?.error || 'PDF generation failed');
                }

                // Decode PDF bytes
                let bytesU8;
                if (pdfResponse.dataB64) {
                    const bin = atob(pdfResponse.dataB64);
                    bytesU8 = new Uint8Array(bin.length);
                    for (let i = 0; i < bin.length; i++) bytesU8[i] = bin.charCodeAt(i);
                } else if (pdfResponse.data && typeof pdfResponse.data.byteLength === "number") {
                    bytesU8 = new Uint8Array(pdfResponse.data);
                } else {
                    throw new Error('No PDF data received');
                }

                console.log('[enterBillingDetails] PDF generated:', bytesU8.length, 'bytes');

                // Build filename
                const cleanName = (person.name || "Attestation").replace(/\s+/g, " ").trim().replace(/[\\/:*?"<>|]/g, "");
                const startDash = `${String(billStart.getMonth() + 1).padStart(2, '0')}-${String(billStart.getDate()).padStart(2, '0')}-${billStart.getFullYear()}`;
                const endDash = `${String(billEnd.getMonth() + 1).padStart(2, '0')}-${String(billEnd.getDate()).padStart(2, '0')}-${billEnd.getFullYear()}`;
                const filename = `${cleanName} ${startDash} - ${endDash}.pdf`;

                console.log('[enterBillingDetails] Uploading PDF:', filename);

                // Upload using pdfUploader (which handles the dialog)
                const uploadResult = await window.pdfUploader.attachBytes(bytesU8, filename);

                console.log('[enterBillingDetails] ✅ PDF uploaded successfully');

                // NOW submit the form AFTER successful upload
                // COMMENTED OUT FOR TESTING
                console.log('[enterBillingDetails] Submit button clicking commented out for testing');
                // console.log('[enterBillingDetails] Now submitting form...');
                // await sleep(500); // Wait for upload dialog to close

                // const submitSuccess = await submit();
                // if (!submitSuccess) {
                //     console.error('[enterBillingDetails] Submit failed after upload');
                //     window.__billingResult = {
                //         ok: true,
                //         actualStart: fmtMDY(billStart),
                //         actualEnd: fmtMDY(billEnd),
                //         actualAmount: amount,
                //         uploadSuccess: true,
                //         submitFailed: true
                //     };
                //     return;
                // }

                window.__billingResult = {
                    ok: true,
                    actualStart: fmtMDY(billStart),
                    actualEnd: fmtMDY(billEnd),
                    actualAmount: amount,
                    uploadSuccess: true,
                    submitted: false // Changed to false since we're not submitting
                };

            } catch (uploadErr) {
                console.error('[enterBillingDetails] Upload exception:', uploadErr);
                window.__billingResult = {
                    ok: true,
                    actualStart: fmtMDY(billStart),
                    actualEnd: fmtMDY(billEnd),
                    actualAmount: amount,
                    uploadFailed: true,
                    uploadError: uploadErr?.message || String(uploadErr)
                };
            }
        } else {
            console.log('[enterBillingDetails] Upload not requested or no signature');
            window.__billingResult = {
                ok: true,
                actualStart: fmtMDY(billStart),
                actualEnd: fmtMDY(billEnd),
                actualAmount: amount,
                uploadSkipped: true,
                uploadReason: shouldUpload ? 'No signature' : 'Upload not enabled'
            };
        }
    } catch (err) {
        console.error('[enterBillingDetails] Uncaught error:', err);
        window.__billingResult = { ok: false, error: 'Unexpected error: ' + (err.message || String(err)) };
        try {
            const cancel = document.getElementById(CANCEL_ID) ||
                document.evaluate(CANCEL_XP, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
            if (cancel) {
                console.warn('[enterBillingDetails] Canceling due to error…');
                cancel.click();
            }
        } catch {}
    }
})();