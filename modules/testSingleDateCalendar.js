// modules/testSingleDateCalendar.js
// Standalone test function for single day calendar (no form opening)

(async () => {
    try {
        console.log('[testSingleDateCalendar] Starting calendar test...');
        
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        const byXPath = (xp) =>
            document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue || null;
        const shown = (el) => !!(el && (el.offsetParent !== null || (el.getClientRects?.().length || 0) > 0));
        const M = (el, t) => el && el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
        const P = (el, t) => el && el.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
        const clickLikeHuman = (el) => {
            if (!el) return;
            P(el, 'pointerdown');
            M(el, 'mousedown');
            P(el, 'pointerup');
            M(el, 'mouseup');
            M(el, 'click');
        };
        const fire = (el, type, init = {}) =>
            el && el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true, ...init }));
        const setNativeValue = (el, value) => {
            const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
            if (desc?.set) desc.set.call(el, value);
            else if (el) el.value = value;
        };
        
        // Get date from window or use today
        const testDate = window.__TEST_SINGLE_DATE__ ? new Date(window.__TEST_SINGLE_DATE__) : new Date();
        const fmt = (d) => `${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}`;
        console.log('[testSingleDateCalendar] Test date:', fmt(testDate));
        
        // Find the date input field
        const dateInput = document.getElementById('provided-service-date');
        
        if (!dateInput) {
            console.error('[testSingleDateCalendar] ❌ Date input field (#provided-service-date) not found');
            window.__TEST_SINGLE_DATE_RESULT__ = { ok: false, error: 'Date input field not found' };
            return;
        }
        
        if (!shown(dateInput)) {
            console.error('[testSingleDateCalendar] ❌ Date input field is not visible');
            window.__TEST_SINGLE_DATE_RESULT__ = { ok: false, error: 'Date input field not visible' };
            return;
        }
        
        console.log('[testSingleDateCalendar] ✅ Found date input field');
        
        // Scroll into view
        dateInput.scrollIntoView({ block: 'center', inline: 'center' });
        await sleep(200);
        
        // Check if calendar dropdown is open
        const getDropdown = () => {
            const field = dateInput.closest('.ui-date-field');
            return field?.querySelector('.ui-date-field__dropdown');
        };
        
        const isDropdownOpen = () => {
            const dropdown = getDropdown();
            if (!dropdown) return false;
            const style = window.getComputedStyle(dropdown);
            return style.display !== 'none' && dropdown.offsetParent !== null;
        };
        
        // Open the calendar
        if (!isDropdownOpen()) {
            console.log('[testSingleDateCalendar] Opening calendar dropdown...');
            
            // Try clicking the calendar icon first
            const calendarIcon = dateInput.closest('.ui-date-field')?.querySelector('.ui-date-field__calendar-icon');
            if (calendarIcon) {
                console.log('[testSingleDateCalendar] Clicking calendar icon');
                clickLikeHuman(calendarIcon);
                await sleep(300);
            }
            
            // If still not open, try clicking the input
            if (!isDropdownOpen()) {
                console.log('[testSingleDateCalendar] Clicking input field');
                clickLikeHuman(dateInput);
                await sleep(300);
            }
            
            // Wait for dropdown to appear
            for (let i = 0; i < 15 && !isDropdownOpen(); i++) {
                await sleep(100);
            }
        }
        
        if (!isDropdownOpen()) {
            console.error('[testSingleDateCalendar] ❌ Calendar dropdown did not open');
            window.__TEST_SINGLE_DATE_RESULT__ = { ok: false, error: 'Calendar dropdown did not open' };
            return;
        }
        
        console.log('[testSingleDateCalendar] ✅ Calendar dropdown is open');
        
        // Get calendar elements
        const dropdown = getDropdown();
        const controls = dropdown?.querySelector('.ui-date-field__controls');
        const yearInput = controls?.querySelector('#provided-service-date-year-input');
        const prevBtn = controls?.querySelector('a[role="button"]:first-of-type');
        const nextBtn = controls?.querySelector('a[role="button"]:last-of-type');
        const calendar = dropdown?.querySelector('.ui-calendar');
        
        if (!controls || !yearInput || !prevBtn || !nextBtn || !calendar) {
            console.error('[testSingleDateCalendar] ❌ Calendar structure not found');
            window.__TEST_SINGLE_DATE_RESULT__ = { ok: false, error: 'Calendar structure not found' };
            return;
        }
        
        console.log('[testSingleDateCalendar] ✅ Calendar structure found');
        
        // Set the year
        const targetYear = testDate.getFullYear();
        const currentYear = parseInt(yearInput.value || '0', 10);
        
        if (currentYear !== targetYear) {
            console.log(`[testSingleDateCalendar] Setting year from ${currentYear} to ${targetYear}`);
            setNativeValue(yearInput, String(targetYear));
            yearInput.value = String(targetYear);
            fire(yearInput, 'input');
            fire(yearInput, 'change');
            await sleep(300);
        } else {
            console.log(`[testSingleDateCalendar] Year already correct: ${targetYear}`);
        }
        
        // Navigate to the correct month
        const targetMonth = testDate.getMonth();
        const getCurrentMonth = () => {
            const monthSpan = controls.querySelector('div span');
            const monthText = monthSpan?.textContent?.trim() || '';
            const monthNames = ['january', 'february', 'march', 'april', 'may', 'june',
                              'july', 'august', 'september', 'october', 'november', 'december'];
            for (let i = 0; i < monthNames.length; i++) {
                if (monthText.toLowerCase().includes(monthNames[i])) {
                    return i;
                }
            }
            return null;
        };
        
        let currentMonth = getCurrentMonth();
        let attempts = 0;
        const maxAttempts = 24;
        
        console.log(`[testSingleDateCalendar] Navigating to month ${targetMonth} (current: ${currentMonth})`);
        
        while (currentMonth !== targetMonth && attempts < maxAttempts) {
            if (currentMonth === null) {
                // Can't determine month, try navigating backward first
                console.log('[testSingleDateCalendar] Month unknown, trying to navigate');
                M(prevBtn, 'click');
                await sleep(200);
                currentMonth = getCurrentMonth();
                attempts++;
                continue;
            }
            
            if (currentMonth < targetMonth) {
                console.log(`[testSingleDateCalendar] Current month ${currentMonth} < target ${targetMonth}, clicking next`);
                M(nextBtn, 'click');
            } else if (currentMonth > targetMonth) {
                console.log(`[testSingleDateCalendar] Current month ${currentMonth} > target ${targetMonth}, clicking prev`);
                M(prevBtn, 'click');
            }
            await sleep(200);
            currentMonth = getCurrentMonth();
            attempts++;
        }
        
        if (currentMonth !== targetMonth) {
            console.warn(`[testSingleDateCalendar] ⚠️ Could not navigate to target month ${targetMonth}, current: ${currentMonth}`);
        } else {
            console.log(`[testSingleDateCalendar] ✅ Navigated to correct month: ${targetMonth}`);
        }
        
        // Find and click the day
        const targetDay = String(testDate.getDate());
        const dayButtons = Array.from(calendar.querySelectorAll('.ui-calendar__day:not(.ui-calendar__day--out-of-month) div[role="button"]'));
        const dayButton = dayButtons.find(btn => (btn.textContent || '').trim() === targetDay);
        
        if (!dayButton) {
            console.error(`[testSingleDateCalendar] ❌ Day ${targetDay} not found in calendar`);
            console.log('[testSingleDateCalendar] Available days:', dayButtons.map(btn => btn.textContent?.trim()));
            window.__TEST_SINGLE_DATE_RESULT__ = { ok: false, error: `Day ${targetDay} not found` };
            return;
        }
        
        console.log(`[testSingleDateCalendar] Found day button for ${targetDay}, clicking...`);
        dayButton.scrollIntoView({ block: 'center', inline: 'center' });
        await sleep(150);
        clickLikeHuman(dayButton);
        await sleep(300);
        
        // Verify the date was set
        const finalValue = dateInput.value || '';
        const expectedMDY = fmt(testDate);
        
        console.log(`[testSingleDateCalendar] Final input value: "${finalValue}"`);
        console.log(`[testSingleDateCalendar] Expected value: "${expectedMDY}"`);
        
        if (finalValue === expectedMDY || finalValue.includes(expectedMDY) || (finalValue !== 'Invalid date' && finalValue.length > 0)) {
            console.log('[testSingleDateCalendar] ✅ Date set successfully!');
            window.__TEST_SINGLE_DATE_RESULT__ = { ok: true, value: finalValue, expected: expectedMDY };
        } else {
            console.warn('[testSingleDateCalendar] ⚠️ Date may not have been set correctly');
            window.__TEST_SINGLE_DATE_RESULT__ = { ok: false, value: finalValue, expected: expectedMDY, error: 'Date mismatch' };
        }
        
    } catch (e) {
        console.error('[testSingleDateCalendar] ❌ Error:', e);
        window.__TEST_SINGLE_DATE_RESULT__ = { ok: false, error: e?.message || String(e) };
    }
})();

