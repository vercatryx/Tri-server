// This module contains the complex DOM interactions ported from the extension.
// It uses page.evaluate() to inject the exact same robust logic into the browser.
// All Unite DOM selectors/IDs come from uniteSelectors.billing – edit that file when the site updates.

const uniteSelectors = require('./uniteSelectors');

async function executeBillingOnPage(page, requestData) {
    console.log('[BillingActions] Injecting billing logic...');

    try {
        const sel = uniteSelectors.billing;
        const result = await page.evaluate(async ({ data, sel }) => {
            // =========================================================================
            //  INJECTED LOGIC START (Ported from enterBillingDetails.js)
            //  Uses sel.* for all Unite elements – see uniteSelectors.js
            // =========================================================================

            console.log('[Injected] Starting billing logic for:', data);

            // --- Helpers ---
            const sleep = (ms) => new Promise(r => setTimeout(r, ms));
            const byXPath = (xp) => document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue || null;
            const shown = (el) => !!(el && (el.offsetParent !== null || (el.getClientRects?.().length || 0) > 0));

            // Event firers
            const fire = (el, type, init = {}) => el && el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true, ...init }));
            const mouse = (el, type) => el && el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
            const pointer = (el, type) => el && el.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: 'mouse', isPrimary: true, bubbles: true, cancelable: true }));
            const clickLikeHuman = (el) => {
                pointer(el, 'pointerdown');
                mouse(el, 'mousedown');
                pointer(el, 'pointerup');
                mouse(el, 'mouseup');
                mouse(el, 'click');
            };
            const setNativeValue = (el, value) => {
                const desc = el?.tagName === 'TEXTAREA' ? Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value') : Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
                if (desc?.set) desc.set.call(el, value); else if (el) el.value = value;
            };

            // Parsers
            const parseMDY = (s) => {
                const m = String(s).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
                if (!m) return null;
                const mm = +m[1], dd = +m[2], yyyy = +m[3];
                if (mm < 1 || mm > 12) return null;
                const last = new Date(yyyy, mm, 0).getDate();
                if (dd < 1 || dd > last) return null;
                return new Date(yyyy, mm - 1, dd);
            };
            // Format ISO YYYY-MM-DD -> MDY or Date obj -> MDY
            const toMDY = (d) => {
                if (typeof d === 'string') { // ISO string
                    const [y, m, day] = d.split('-');
                    return `${Number(m)}/${Number(day)}/${y}`;
                }
                const mm = String(d.getMonth() + 1).padStart(2, '0');
                const dd = String(d.getDate()).padStart(2, '0');
                const yy = d.getFullYear();
                return `${mm}/${dd}/${yy}`;
            };

            // --- Inputs ---
            // Data comes in ISO format from JSON usually: YYYY-MM-DD
            const startStr = data.start;
            const endStr = data.end;
            // Parse them to MDY for internal logic
            const [sY, sM, sD] = startStr.split('-').map(Number);
            const [eY, eM, eD] = endStr.split('-').map(Number);
            const reqStart = new Date(sY, sM - 1, sD);
            const reqEnd = new Date(eY, eM - 1, eD);
            // USER REQUEST: Do not calculate amount. Use JSON amount directly.
            const amount = data.amount;

            if (amount === undefined || amount === null) {
                return { ok: false, error: 'Missing "amount" in JSON request' };
            }

            console.log(`[Injected] Transformed dates: ${toMDY(reqStart)} -> ${toMDY(reqEnd)}`);
            console.log(`[Injected] Using explicit amount from JSON: $${amount}`);

            // --- EARLY DUPLICATE GUARD ---
            const plannedDays = Math.max(1, Math.floor((reqEnd - reqStart) / 86400000) + 1);
            // const plannedAmount = ratePerDay * plannedDays; // DEPRECATED - We use direct amount now

            const doInlineScanFallback = (startD, endD, amount) => {
                const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
                const cents = (v) => {
                    const n = Number(String(v).replace(/[^\d.]/g, ''));
                    return Number.isFinite(n) ? Math.round(n * 100) : NaN;
                };
                const sameDay = (a, b) => a && b && a.getTime() === b.getTime();
                const ds = sel.duplicateScan;
                const cards = Array.from(document.querySelectorAll('.' + ds.cardClass));
                const amtSel = '[data-test-element="' + ds.amountDataTest + '"]';
                const datesSel = (ds.datesDataTest || []).map(d => '[data-test-element="' + d + '"]').join(', ') || '[data-test-element="service-dates-value"]';
                const tCents = cents(amount);
                for (const card of cards) {
                    const amtEl = card.querySelector(amtSel);
                    const rngEl = card.querySelector(datesSel);
                    const amtCents = cents(norm(amtEl?.textContent));
                    const txt = norm(rngEl?.textContent);
                    let s = null, e = null;
                    if (txt) {
                        const parts = txt.split(/\s*-\s*/);
                        if (parts.length === 2) { s = new Date(parts[0]); e = new Date(parts[1]); }
                        else { s = new Date(txt); e = s; }
                        if (s) s.setHours(0, 0, 0, 0);
                        if (e) e.setHours(0, 0, 0, 0);
                    }
                    if (Number.isFinite(amtCents) && s && e && amtCents === tCents && sameDay(s, startD) && sameDay(e, endD)) {
                        return true;
                    }
                }
                return false;
            };

            if (doInlineScanFallback(reqStart, reqEnd, amount)) {
                console.warn('[Injected] Duplicate detected (early). Aborting.');
                return { ok: false, duplicate: true, error: 'Duplicate invoice detected' };
            }

            // --- 0. Wait for Authorized Table (Page Ready Check) ---
            const ad = sel.authorizedTable.date;
            const aa = sel.authorizedTable.amount;

            console.log('[Injected] Waiting for Authorized Table elements...');
            const getAuthEls = () => ({
                dateEl: document.getElementById(ad.id) || (ad.xpath && byXPath(ad.xpath)) || null,
                amountEl: document.getElementById(aa.id) || (aa.xpath && byXPath(aa.xpath)) || null
            });

            for (let i = 0; i < 30; i++) {
                const { dateEl, amountEl } = getAuthEls();
                if (dateEl && amountEl && shown(dateEl)) break;
                await sleep(500);
            }

            const { dateEl, amountEl } = getAuthEls();
            if (!dateEl || !amountEl) {
                console.warn('[Injected] Authorized table elements not found. Continuing, but risks are high.');
            } else {
                console.log('[Injected] Authorized table found. Verifying limits...');
                // Parse limits
                // Date format usually: "8/27/2025 - 2/27/2026"
                const dateText = dateEl.innerText || '';
                const [startStr, endStr] = dateText.split('-').map(s => s.trim());
                const authStart = parseMDY(startStr);
                const authEnd = parseMDY(endStr);

                // Amount format usually: $7,824.00 inside a span
                const amountText = (amountEl.innerText || '').replace(/[$,]/g, '');
                const authAmount = parseFloat(amountText);

                console.log(`[Injected] Limits: ${toMDY(authStart)} - ${toMDY(authEnd)}, Max: $${authAmount}`);

                // --- CLAMPING LOGIC (Extension Port) ---
                if (authStart && authEnd) {
                    // CLAMPING DEBUG LOGS
                    console.log(`[Clamping-Debug] Original Req Start: ${toMDY(reqStart)} (${reqStart.toISOString()})`);
                    console.log(`[Clamping-Debug] Original Req End:   ${toMDY(reqEnd)} (${reqEnd.toISOString()})`);
                    console.log(`[Clamping-Debug] Auth Window:        ${toMDY(authStart)} to ${toMDY(authEnd)}`);

                    // Clamp start
                    if (reqStart < authStart) {
                        console.warn(`[Clamping] Requested start ${toMDY(reqStart)} is BEFORE auth start ${toMDY(authStart)}. Adjusting to ${toMDY(authStart)}.`);
                        reqStart.setTime(authStart.getTime());
                    }
                    // Clamp end
                    if (reqEnd > authEnd) {
                        console.warn(`[Clamping] Requested end ${toMDY(reqEnd)} is AFTER auth end ${toMDY(authEnd)}. Adjusting to ${toMDY(authEnd)}.`);
                        reqEnd.setTime(authEnd.getTime());
                    }

                    console.log(`[Clamping-Debug] Final Req Start:    ${toMDY(reqStart)}`);
                    console.log(`[Clamping-Debug] Final Req End:      ${toMDY(reqEnd)}`);

                    // Fix overlap
                    if (reqStart > reqEnd) {
                        return { ok: false, error: `Clamped dates invalid: ${toMDY(reqStart)} > ${toMDY(reqEnd)}` };
                    }

                    // Amount Clamping (Logic Removed - User wants Raw Amount)
                    // We verify against Total Auth, but do not recalc 'projected amount'.
                    if (amount > authAmount) {
                        console.warn(`[Clamping] WARNING: Requested amount $${amount} > Auth Max $${authAmount}. Proceeding as requested, but might fail.`);
                    }
                }
            }


            // --- 1. Find Add Button & Open Shelf ---
            const ab = sel.addButton;
            const findAddButton = () => {
                let btn = (ab.id && document.getElementById(ab.id)) || (ab.xpath && byXPath(ab.xpath));
                if (btn) return btn;
                const fallback = (ab.textContains || 'add new contracted service').toLowerCase();
                const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
                return buttons.find(b => (b.textContent || '').toLowerCase().includes(fallback)) || null;
            };

            let addBtn = null;
            for (let i = 0; i < 10; i++) {
                addBtn = findAddButton();
                if (addBtn && shown(addBtn)) break;
                await sleep(500);
            }

            if (!addBtn) return { ok: false, error: 'Add button not found (Shelf trigger missing)' };

            const am = sel.amount;
            const isShelfOpen = () => !!((am.id && document.getElementById(am.id)) || (am.xpath && byXPath(am.xpath)));

            if (!isShelfOpen()) {
                console.log('[Injected] Clicking Add Button...');
                clickLikeHuman(addBtn);
                // Wait for shelf
                for (let i = 0; i < 20; i++) {
                    if (isShelfOpen()) break;
                    await sleep(200);
                }
                if (!isShelfOpen()) return { ok: false, error: 'Shelf did not open' };
            }

            // --- 2. Calculate & Verify Dates ---
            const days = Math.floor((reqEnd - reqStart) / 86400000) + 1;
            // const amount = days * ratePerDay; // DEPRECATED - used from JSON
            console.log(`[Step] Date Calculation: ${startStr} to ${endStr} = ${days} days.`);
            console.log(`[Step] Amount (Explicit): $${amount}`);

            if (days < 1) {
                return { ok: false, error: `Invalid date range: ${days} days` };
            }

            // --- 3. Fill Billing Info ---
            const amountField = (am.id && document.getElementById(am.id)) || (am.xpath && byXPath(am.xpath));
            if (!amountField) return { ok: false, error: 'Amount field missing' };

            // Use the exact amount from JSON - no calculation, no multiplication, no modification
            // Convert to number to ensure proper formatting, then back to string for the input
            const exactAmount = typeof amount === 'number' ? amount : Number(amount);
            // Format as string without any currency symbols or extra formatting
            const amountValue = exactAmount.toString();
            
            console.log(`[Step] Entering Exact Amount: ${amountValue} (original from JSON: ${amount})...`);
            
            amountField.focus();
            // Clear field first to remove any existing value
            setNativeValue(amountField, '');
            await sleep(50);
            // Set the exact amount value
            setNativeValue(amountField, amountValue);
            // Trigger events to ensure React/framework recognizes the change
            fire(amountField, 'input', { bubbles: true, cancelable: true });
            fire(amountField, 'change', { bubbles: true, cancelable: true });
            amountField.blur();
            await sleep(500);

            // --- 4. Date Picker Logic (The Beast) ---
            console.log('[Step] Setting Date Range in UI...');

            // ===== Robust Date Picker Logic (Ported from Extension) =====
            async function setDateRangeRobust(bStart, bEnd) {
                console.log(`[DateLogic] Setting range: ${toMDY(bStart)} -> ${toMDY(bEnd)}`);
                const sleep = (ms) => new Promise(r => setTimeout(r, ms));

                const M = (el, t) => el && el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
                const P = (el, t) => el && el.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
                const clickLikeHuman = (el) => { P(el, 'pointerdown'); M(el, 'mousedown'); P(el, 'pointerup'); M(el, 'mouseup'); M(el, 'click'); };

                const dr = sel.dateRange;
                const fi = dr.fakeInput || {};

                const isOpen = () => !!document.querySelector('.' + (dr.dropdownOpenClass || 'ui-duration-field__dropdown ui-duration-field__dropdown--open').replace(/\s+/g, '.'));

                const getFakeCandidates = () => {
                    const a = dr.buttonId && document.getElementById(dr.buttonId);
                    const b = fi.roleButton && document.querySelector(fi.roleButton);
                    const c = fi.value && document.querySelector(fi.value);
                    const d = fi.container && document.querySelector(fi.container);
                    return [a, b, c, d].filter(Boolean);
                };

                const openPicker = async () => {
                    if (isOpen()) return true;

                    const label = (dr.labelId && document.getElementById(dr.labelId)) || (dr.labelXpath && byXPath(dr.labelXpath));

                    const tryOnce = async () => {
                        const cands = getFakeCandidates();
                        console.log('[DateLogic] Attempting to open picker...');

                        // 1) Label tap (some builds need it to reveal inputs)
                        if (label && shown(label)) {
                            console.log('[DateLogic] Clicking label specificially...');
                            clickLikeHuman(label);
                            await sleep(120);
                            if (isOpen()) return true;
                        }

                        // 2) Try all fake candidates
                        for (const el of cands) {
                            if (!shown(el)) continue;
                            console.log('[DateLogic] Clicking candidate:', el.tagName, el.className);
                            el.scrollIntoView?.({ block: 'center', inline: 'center' });
                            await sleep(40);
                            clickLikeHuman(el);
                            for (let i = 0; i < 10; i++) { if (isOpen()) return true; await sleep(60); }
                        }

                        // 3) Keyboard fallback on best candidate
                        const best = cands.find(shown);
                        if (best) {
                            console.log('[DateLogic] Trying keyboard fallback...');
                            best.focus?.();
                            best.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true }));
                            best.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space', bubbles: true, cancelable: true }));
                            await sleep(120);
                            if (isOpen()) return true;
                            best.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
                            best.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
                            for (let i = 0; i < 10; i++) { if (isOpen()) return true; await sleep(60); }
                        }
                        return false;
                    };

                    for (let attempt = 1; attempt <= 3 && !isOpen(); attempt++) {
                        if (await tryOnce()) break;
                        await sleep(150 + attempt * 100);
                    }
                    return isOpen();
                };

                if (!await openPicker()) {
                    console.error('[DateLogic] Failed to open date picker after robust attempts.');
                    return false;
                }
                console.log('[DateLogic] Picker is open.');
                await sleep(500);

                // 2. NAVIGATE & CLICK
                const dd = document.querySelector(dr.dropdownClass ? '.' + dr.dropdownClass.replace(/^\./, '') : '.ui-duration-field__dropdown');
                const prevBtn = dd && dd.querySelector(dr.navPrev || 'a[role="button"]:first-of-type');
                const nextBtn = dd && dd.querySelector(dr.navNext || 'a[role="button"]:last-of-type');
                const startYearInput = dd && dr.startYearId && dd.querySelector('#' + dr.startYearId);
                const endYearInput = dd && dr.endYearId && dd.querySelector('#' + dr.endYearId);
                const leftCal = dd && dd.querySelector(dr.leftCalendar || '.ui-calendar:nth-of-type(1)');
                const rightCal = dd && dd.querySelector(dr.rightCalendar || '.ui-calendar:nth-of-type(2)');
                const leftSpan = dd && dd.querySelector(dr.leftSpan || '.ui-duration-field__controls div:nth-of-type(1) span');
                const rightSpan = dd && dd.querySelector(dr.rightSpan || '.ui-duration-field__controls div:nth-of-type(2) span');

                if (!prevBtn || !nextBtn) {
                    console.error('[DateLogic] Calendar controls missing.');
                    return false;
                }

                const monthIdx = (name) => ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
                    .indexOf(String(name || '').trim().toLowerCase());

                const getVisibleRange = () => {
                    const lMonth = monthIdx(leftSpan.textContent);
                    const rMonth = monthIdx(rightSpan.textContent);
                    const lYear = parseInt(startYearInput?.value || '0', 10);
                    const rYear = parseInt(endYearInput?.value || '0', 10);
                    return { left: lYear * 12 + lMonth, right: rYear * 12 + rMonth, lYear, rYear, lMonth, rMonth };
                };

                const ensureVis = async (date) => {
                    const target = date.getFullYear() * 12 + date.getMonth();
                    for (let i = 0; i < 24; i++) {
                        const { left, right } = getVisibleRange();
                        if (target >= left && target <= right) return true;
                        if (target < left) M(prevBtn, 'click');
                        else M(nextBtn, 'click');
                        await sleep(300); // Wait for transition
                    }
                    return false;
                };

                const clickDay = async (pane, date) => {
                    const want = String(date.getDate());
                    const daySel = dr.dayButton || '.ui-calendar__day:not(.ui-calendar__day--out-of-month) div[role="button"]';
                    const btns = Array.from(pane.querySelectorAll(daySel));
                    const btn = btns.find(b => (b.textContent || '').trim() === want);
                    if (btn) {
                        M(btn, 'mousedown');
                        M(btn, 'mouseup');
                        M(btn, 'click');
                        await sleep(200);
                        return true;
                    }
                    return false;
                };

                // CLICK START
                if (!await ensureVis(bStart)) return false;
                let vis = getVisibleRange();
                let pane = (vis.lYear === bStart.getFullYear() && vis.lMonth === bStart.getMonth()) ? leftCal : rightCal;
                console.log(`[DateLogic] Clicking Start Day: ${bStart.getDate()}`);
                if (!await clickDay(pane, bStart)) return false;

                // CLICK END
                if (!await ensureVis(bEnd)) return false;
                vis = getVisibleRange();
                pane = (vis.lYear === bEnd.getFullYear() && vis.lMonth === bEnd.getMonth()) ? leftCal : rightCal;
                console.log(`[DateLogic] Clicking End Day: ${bEnd.getDate()}`);
                if (!await clickDay(pane, bEnd)) return false;

                // CLOSE/VERIFY
                // Usually closes automatically or we click out? 
                // Extension logic says: let it close itself.
                await sleep(500);
                return true;
            }

            // Excecute the robust logic
            const dateParams = {
                start: new Date(sY, sM - 1, sD),
                end: new Date(eY, eM - 1, eD)
            };

            const dateResult = await setDateRangeRobust(dateParams.start, dateParams.end);
            if (!dateResult) {
                return { ok: false, error: 'Failed to set date range in UI' };
            }

            console.log('[Step] Date range UI interaction complete.');

            // --- 4. Place of Service Logic (The Beast Part 2) ---
            console.log('[Step] Setting Place of Service (12 - Home)...');

            async function selectHomeRobust() {
                const po = sel.placeOfService || {};
                const PLACE_ID = po.id;
                const PLACE_OUTER_XPATH = po.xpath;
                const HOME_TEXT = po.homeText || '12 - Home';
                const HOME_VALUE = po.homeValue || 'c0d441b4-ba1b-4f68-93af-a4d7d6659fba';
                const ch = po.choices || {};

                // Local helpers for this scope
                const byXPath = (xp) => document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue || null;
                const fire = (el, type, init = {}) => el && el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true, ...init }));
                const mouse = (el, type) => el && el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
                const keyEvt = (el, type, key = 'Enter', code = key) => el && el.dispatchEvent(new KeyboardEvent(type, { key, code, bubbles: true, cancelable: true }));
                const setNativeValue = (el, value) => {
                    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
                    if (desc?.set) desc.set.call(el, value);
                    else if (el) el.value = value;
                };

                const inner = PLACE_OUTER_XPATH ? byXPath(PLACE_OUTER_XPATH) : null;
                const selectEl = PLACE_ID ? document.getElementById(PLACE_ID) : null;
                if (!inner || !selectEl) {
                    console.warn('[selectHome] Select controls not present yet');
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

                const root = inner.closest('.choices') || inner.parentElement || inner;
                const openDropdown = () => {
                    const opener = (ch.inner && root.querySelector(ch.inner)) || root;
                    mouse(opener, 'mousedown');
                    mouse(opener, 'mouseup');
                    mouse(opener, 'click');
                };
                const getList = () =>
                    (ch.listDropdownExpanded && root.querySelector(ch.listDropdownExpanded)) ||
                    (ch.listDropdown && root.querySelector(ch.listDropdown));

                // 2) UI: open dropdown and try to click the option node directly
                openDropdown();
                for (let i = 0; i < 10; i++) {
                    const list = getList();
                    if (list?.children?.length) {
                        const optSel = ch.option || '.choices__item[role="option"]';
                        let optionNode =
                            list.querySelector('[data-value="' + HOME_VALUE + '"]') ||
                            Array.from(list.querySelectorAll(optSel)).find(n =>
                                (n.textContent || '').trim().toLowerCase() === (HOME_TEXT || '').toLowerCase()
                            ) ||
                            Array.from(list.querySelectorAll(optSel)).find(n =>
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

                openDropdown();
                await sleep(80);
                const searchInput =
                    (ch.searchInput && root.querySelector(ch.searchInput)) ||
                    (ch.searchInputAlt && root.querySelector(ch.searchInputAlt));
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

                const byValue = selectEl.querySelector('option[value="' + HOME_VALUE + '"]');
                const byText = Array.from(selectEl.options || []).find(o => (o.textContent || '').toLowerCase().includes('home'));
                const target = byValue || byText;
                if (target) {
                    selectEl.value = target.value;
                    fire(selectEl, 'change');
                    const single = (ch.singleSelected && root.querySelector(ch.singleSelected));
                    if (single) {
                        single.textContent = (target.textContent || HOME_TEXT).trim();
                        single.classList.remove('choices__placeholder');
                        single.setAttribute('data-value', target.value);
                    }
                    console.log('[selectHome] Applied fallback to set select value directly');
                    return true;
                }
                console.warn('[selectHome] All strategies failed');
                return false;
            }

            const homeSuccess = await selectHomeRobust();
            if (!homeSuccess) {
                return { ok: false, error: 'Failed to select Place of Service (12 - Home)' };
            }

            // --- 5. File Upload Logic (Browser-Side Fetch) ---
            const proofUrls = Array.isArray(data.proofURL) ? data.proofURL : (data.proofURL ? [data.proofURL] : []);
            if (proofUrls.length > 0) {
                console.log(`[Step] Uploading ${proofUrls.length} proof file(s) from URL(s)...`);

                async function uploadFileRobust(url, filename) {
                    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

                    // 1. Fetch Blob (using browser session)
                    let blob = null;
                    try {
                        const resp = await fetch(url);
                        if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`);
                        blob = await resp.blob();
                        console.log(`[Upload] Fetched blob size: ${blob.size}, type: ${blob.type}`);
                    } catch (e) {
                        console.error('[Upload] Failed to fetch file inside browser:', e);
                        return false;
                    }

                    const pu = sel.proofUpload || {};
                    const attachText = pu.attachButtonText || 'Attach Document';
                    let attachBtn = null;
                    const findBtn = () => {
                        const btns = Array.from(document.querySelectorAll('button'));
                        return btns.find(b => (b.textContent || '').includes(attachText) && b.offsetParent !== null);
                    };

                    for (let i = 0; i < 30; i++) {
                        attachBtn = findBtn();
                        if (attachBtn) break;
                        await sleep(100);
                    }
                    if (!attachBtn) { console.error('[Upload] Attach button not found'); return false; }

                    console.log('[Upload] Clicking Attach Document...');
                    attachBtn.click();
                    await sleep(1000);

                    const mo = pu.modal || {};
                    const fi2 = pu.fileInput || {};
                    let modal = null, input = null, submitBtn = null;
                    for (let i = 0; i < 30; i++) {
                        modal = (mo.id && document.getElementById(mo.id)) ||
                            (mo.classFallback && document.querySelector('.' + mo.classFallback.replace(/^\./, ''))) ||
                            (mo.roleFallback && document.querySelector(mo.roleFallback));

                        if (modal && modal.offsetParent !== null) {
                            input = (fi2.dataTestId && modal.querySelector('input[data-testid="' + fi2.dataTestId + '"]')) ||
                                (fi2.typeFallback && modal.querySelector(fi2.typeFallback));
                            submitBtn = (pu.saveButtonClass && modal.querySelector('.' + pu.saveButtonClass.replace(/^\./, '')));

                            if (input && submitBtn) break;
                        }
                        await sleep(200);
                    }

                    if (!modal || !input) { console.error('[Upload] Upload dialog/input not found'); return false; }

                    // 4. Set File (DataTransfer Magic)
                    // Use blob.type to support images (image/png, etc.) or PDFs automatically
                    const fileType = blob.type || 'application/octet-stream';
                    const file = new File([blob], filename, { type: fileType, lastModified: Date.now() });
                    const dt = new DataTransfer();
                    dt.items.add(file);
                    input.files = dt.files;

                    // Events to trigger React/Framework change detection
                    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
                    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));

                    console.log(`[Upload] File set in input: ${filename} (${fileType}). Waiting for validation...`);
                    await sleep(1000);

                    const disabledCls = pu.disabledClass || 'opacity-40';
                    for (let i = 0; i < 30; i++) {
                        if (!submitBtn.disabled && submitBtn.getAttribute('aria-disabled') !== 'true' && !submitBtn.classList.contains(disabledCls)) {
                            console.log('[Upload] Button enabled. Clicking...');
                            submitBtn.click();
                            await sleep(2000); // Wait for upload/close
                            return true;
                        }
                        await sleep(200);
                    }
                    console.error('[Upload] Attach button never enabled');
                    return false;
                }

                for (let idx = 0; idx < proofUrls.length; idx++) {
                    const url = proofUrls[idx];
                    const filename = url.split('/').pop() || `proof-${idx + 1}`;
                    console.log(`[Step] Uploading proof ${idx + 1}/${proofUrls.length}: ${url}`);
                    const uploadOk = await uploadFileRobust(url, filename);
                    if (!uploadOk) {
                        return { ok: false, error: `Failed to upload proof file ${idx + 1} of ${proofUrls.length} from URL` };
                    }
                }
                console.log(`[Step] All ${proofUrls.length} proof file(s) uploaded.`);
            } else {
                console.log('[Step] No proofURL provided, skipping upload.');
            }

            // --- 6. Fill Dependants (If Present) ---
            if (data.dependants && Array.isArray(data.dependants) && data.dependants.length > 0) {
                console.log('[Step] Processing Dependants:', data.dependants.length);

                // Formatter helper to align text
                // Goal: "child 1 (next line) child 2" for names
                // Goal: "child 1:       date"
                //       "child 2 long:  date"
                // Logic: 2 spaces per 1 character difference (heuristic for variable width fonts)

                let nameStr = '';
                let dobStr = '';
                let cinStr = '';

                // Calculate max name length for padding
                const maxNameLen = data.dependants.reduce((max, d) => Math.max(max, (d.name || 'Unknown').length), 0);

                data.dependants.forEach((d, idx) => {
                    const isLast = idx === data.dependants.length - 1;
                    const newline = isLast ? '' : '\n';

                    const name = d.name || 'Unknown';
                    const diff = maxNameLen - name.length;
                    const padding = ' '.repeat(Math.round(diff * 1.7)); // 1.7 spaces per char (User tuned)
                    const buffer = '  '; // Restored buffer

                    const paddedLabel = name + padding + buffer;

                    nameStr += `${name}${newline}`;
                    // Use paddedLabel for the labels in DOB and CIN fields to align values
                    dobStr += `${paddedLabel}: ${d.Birthday || ''}${newline}`;
                    cinStr += `${paddedLabel}: ${d.CIN || ''}${newline}`;
                });

                console.log('[Step] Dependants Strings Generated');

                const dep = sel.dependants || {};
                const fillArea = (field, value) => {
                    const id = field && field.id;
                    const xp = field && field.xpath;
                    const el = (id && document.getElementById(id)) || (xp && byXPath(xp));
                    if (el) {
                        el.focus();
                        setNativeValue(el, value);
                        fire(el, 'input');
                        fire(el, 'change');
                        el.blur();
                        return true;
                    }
                    return false;
                };

                if (fillArea(dep.name, nameStr)) console.log('Filled Dependant Names');
                else console.warn('Failed to find Dependant Name Field');

                if (fillArea(dep.dob, dobStr)) console.log('Filled Dependant DOBs');
                else console.warn('Failed to find Dependant DOB Field');

                if (fillArea(dep.cin, cinStr)) console.log('Filled Dependant CINs');
                else console.warn('Failed to find Dependant CIN Field');

            } else {
                console.log('[Step] No dependants to process.');
            }


            // --- 4. Submit ---
            const sub = sel.submit || {};
            const devSkip = !!sub.devSkipSubmit;

            if (devSkip) {
                console.log('[Step] DEV: Submit skipped (devSkipSubmit).');
                return { ok: true, amount, days, verified: false, devSkippedSubmit: true };
            }

            console.log('[Step] Submitting billing record...');
            const subId = sub.id || 'fee-schedule-provided-service-post-note-btn';
            const submitBtn = document.getElementById(subId);

            if (submitBtn) {
                clickLikeHuman(submitBtn);
                await sleep(3000);

                console.log('[Step] Verifying submission...');
                let found = false;
                for (let i = 0; i < 20; i++) {
                    if (doInlineScanFallback(reqStart, reqEnd, amount)) {
                        found = true;
                        break;
                    }
                    await sleep(500);
                }

                if (found) {
                    return { ok: true, amount, days, verified: true };
                } else {
                    console.warn('[Step] Verification failed: New record not found after submit.');
                    return { ok: true, amount, days, verified: false, warning: 'Billing attempted but not verified in list' };
                }
            } else {
                return { ok: false, error: 'Submit button (' + subId + ') not found' };
            }

            // =========================================================================
            //  INJECTED LOGIC END
            // =========================================================================
        }, { data: requestData, sel });

        return result;

    } catch (e) {
        return { ok: false, error: e.message };
    }
}

module.exports = { executeBillingOnPage };
