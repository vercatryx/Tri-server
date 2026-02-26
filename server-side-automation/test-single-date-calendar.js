/**
 * SINGLE DATE CALENDAR – Console test
 * ====================================
 * For equipment flow: after selecting "Single Date" radio, open the single-date
 * calendar and select one date. Reads current month/year and navigates if needed.
 *
 * 1. On the billing form, ensure "Single Date" is selected (or run step0 first).
 * 2. Paste this entire file into the browser console.
 * 3. Run: await setSingleDate(2025, 5, 7)   // year, month (1–12), day
 *    Or:   await setSingleDate(new Date())  // today
 *
 * Selectors from Unite UI:
 * - Trigger: a[aria-controls="provided-service-date"] (opens calendar)
 * - Dropdown: .ui-date-field__dropdown.ui-date-field__dropdown--open
 * - Month label: .ui-date-field__controls div span (e.g. "May")
 * - Year input: #provided-service-date-year-input
 * - Prev/Next: .ui-date-field__controls a[role="button"]
 * - Day cells: .ui-calendar__day:not(.ui-calendar__day--out-of-month) div[role="button"]
 */
(function () {
  'use strict';

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const byXPath = (xp) => {
    const r = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    return r.singleNodeValue || null;
  };

  const clickLikeHuman = (el) => {
    if (!el) return;
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  };

  const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const MONTH_ABBREV = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  // ----- Config (match your page) -----
  const singleDateCalendar = {
    // Button that opens the single-date calendar (when "Single Date" is selected)
    triggerSelector: 'a[aria-controls="provided-service-date"]',
    triggerXpath: '/html/body/div[2]/div[2]/main/div/section/div/div[2]/div/div[1]/div[2]/div[2]/div/div[2]/div/form/div[4]/div[2]/div/div/div[1]',
    // Dropdown when open
    dropdownOpenClass: 'ui-date-field__dropdown--open',
    dropdownSelector: '.ui-date-field__dropdown',
    // Inside dropdown: controls (prev, month+year div, next)
    controlsSelector: '.ui-date-field__controls',
    yearInputId: 'provided-service-date-year-input',
    // Month+year block: div containing <span>Month</span> and <input id="provided-service-date-year-input">
    monthYearDivXpath: '/html/body/div[2]/div[2]/main/div/section/div/div[2]/div/div[1]/div[2]/div[2]/div/div[2]/div/form/div[4]/div[2]/div/div/div[2]/div[1]/div',
    // Prev/Next by aria-label so we don't click something that closes the dropdown
    prevMonthLabel: 'Previous Month:',
    nextMonthLabel: 'Next Month:',
    prevMonthXpath: '/html/body/div[2]/div[2]/main/div/section/div/div[2]/div/div[1]/div[2]/div[2]/div/div[2]/div/form/div[4]/div[2]/div/div/div[2]/div[1]/a[1]',
    nextMonthXpath: '/html/body/div[2]/div[2]/main/div/section/div/div[2]/div/div[1]/div[2]/div[2]/div/div[2]/div/form/div[4]/div[2]/div/div/div[2]/div[1]/a[2]',
    // Single calendar pane (one month) – use xpath so we don't query dropdown (which can close it)
    calendarPaneXpath: '/html/body/div[2]/div[2]/main/div/section/div/div[2]/div/div[1]/div[2]/div[2]/div/div[2]/div/form/div[4]/div[2]/div/div/div[2]/div[2]',
    // Day: only in-month cells, click the div[role="button"]
    dayCellSelector: '.ui-calendar__day:not(.ui-calendar__day--out-of-month) div[role="button"]'
  };

  function getTrigger() {
    const bySel = document.querySelector(singleDateCalendar.triggerSelector);
    if (bySel) return bySel;
    const container = byXPath(singleDateCalendar.triggerXpath);
    return container ? container.querySelector('a[role="button"]') || container : null;
  }

  /** True only if the single-date dropdown is open and visible (not a stale/hidden node). */
  function isOpen() {
    return !!getOpenDropdown();
  }

  /** The open single-date dropdown, or null. Has open class + calendar content (avoids false positive from other widgets). */
  function getOpenDropdown() {
    const openClass = singleDateCalendar.dropdownOpenClass.replace(/\s+/g, '.');
    const dd = document.querySelector(singleDateCalendar.dropdownSelector + '.' + openClass);
    if (!dd) return null;
    const hasContent = dd.querySelector('.ui-calendar') || dd.querySelector('.ui-date-field__controls');
    return hasContent ? dd : null;
  }

  /** Open the single-date calendar (click the calendar icon). Assume closed; click, wait 0.5s, move on. */
  window.openSingleDateCalendar = async function () {
    const trigger = getTrigger();
    if (!trigger) {
      console.error('[SingleDate] Trigger not found. Selector:', singleDateCalendar.triggerSelector, 'XPath:', singleDateCalendar.triggerXpath);
      return false;
    }
    console.log('[SingleDate] Opening calendar...');
    trigger.scrollIntoView?.({ block: 'center', inline: 'center' });
    await sleep(80);
    clickLikeHuman(trigger);
    // Short wait then move on so we read/navigate/click before dropdown closes (e.g. on blur)
    await sleep(250);
    return true;
  };

  /** Get the month+year block (div with span + year input) inside the open dropdown. */
  function getMonthYearBlock(dd) {
    if (!dd) return null;
    const yearInput = dd.querySelector('#' + singleDateCalendar.yearInputId) || document.getElementById(singleDateCalendar.yearInputId);
    if (yearInput && yearInput.parentElement && dd.contains(yearInput)) return yearInput.parentElement;
    const xp = singleDateCalendar.monthYearDivXpath;
    return xp ? byXPath(xp) : dd.querySelector('.ui-date-field__controls > div');
  }

  /** Get current month (0–11) and year from the open dropdown. Parse month from span, year from input. */
  function getVisibleMonthYear() {
    const dd = getOpenDropdown();
    if (!dd) return null;
    const block = getMonthYearBlock(dd);
    if (!block) return null;
    const span = block.querySelector('span');
    const yearInput = block.querySelector('input#' + singleDateCalendar.yearInputId) || document.getElementById(singleDateCalendar.yearInputId);
    const year = yearInput ? parseInt(yearInput.value, 10) : NaN;
    if (!span || !Number.isFinite(year)) return null;
    const monthText = (span.textContent || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!monthText) return null;
    const first3 = monthText.substring(0, 3);
    const monthIdx = MONTH_ABBREV.indexOf(first3);
    return monthIdx >= 0 ? { month: monthIdx, year } : null;
  }

  /** Click only the prev or next month button by the xpaths you provided. prevNotNext: true = prev, false = next. */
  async function clickMonthNav(prevNotNext) {
    const xpath = prevNotNext ? singleDateCalendar.prevMonthXpath : singleDateCalendar.nextMonthXpath;
    const btn = xpath ? byXPath(xpath) : null;
    if (!btn) return false;
    clickLikeHuman(btn);
    await sleep(120);
    return true;
  }

  /** Navigate the calendar until the visible month/year matches target. */
  async function navigateToMonth(targetMonth, targetYear) {
    for (let i = 0; i < 24; i++) {
      const cur = getVisibleMonthYear();
      if (!cur) {
        console.error('[SingleDate] Could not read current month/year.');
        return false;
      }
      if (cur.month === targetMonth && cur.year === targetYear) {
        console.log('[SingleDate] On target month:', targetYear, MONTH_NAMES[targetMonth]);
        return true;
      }
      if (cur.year < targetYear || (cur.year === targetYear && cur.month < targetMonth)) {
        await clickMonthNav(false); // next
      } else {
        await clickMonthNav(true);  // prev
      }
    }
    console.error('[SingleDate] Could not reach target month.');
    return false;
  }

  /** Click the day number (1–31). Uses only the calendar pane xpath – no dropdown query, so we don't close it. */
  function clickDay(dayNum) {
    const cal = singleDateCalendar.calendarPaneXpath ? byXPath(singleDateCalendar.calendarPaneXpath) : null;
    if (!cal) {
      console.error('[SingleDate] Calendar pane not found (calendarPaneXpath).');
      return false;
    }
    const dayButtons = cal.querySelectorAll(singleDateCalendar.dayCellSelector);
    const want = String(dayNum);
    const btn = Array.from(dayButtons).find((b) => (b.textContent || '').trim() === want);
    if (!btn) {
      console.error('[SingleDate] Day not found:', dayNum);
      return false;
    }
    clickLikeHuman(btn);
    return true;
  }

  /**
   * Set the single date: open calendar, navigate to month/year if needed, click day.
   * @param {number|Date} yearOrDate - year (if 2nd and 3rd args) or a Date
   * @param {number} [month] - month 1–12 (if first arg is year)
   * @param {number} [day] - day of month (if first arg is year)
   */
  window.setSingleDate = async function (yearOrDate, month, day) {
    let y, m, d;
    if (yearOrDate instanceof Date) {
      y = yearOrDate.getFullYear();
      m = yearOrDate.getMonth();
      d = yearOrDate.getDate();
    } else {
      y = yearOrDate;
      m = (month || 1) - 1; // 0-based
      d = day || 1;
    }

    console.log('[SingleDate] Setting date:', y, MONTH_NAMES[m], d);

    if (!(await window.openSingleDateCalendar())) return false;
    await sleep(80);
    // Focus inside dropdown (e.g. year input) so it does not close on blur
    const dd = getOpenDropdown();
    if (dd) {
      const yearInp = dd.querySelector('#' + singleDateCalendar.yearInputId) || document.getElementById(singleDateCalendar.yearInputId);
      if (yearInp) yearInp.focus();
      await sleep(40);
    }

    if (!(await navigateToMonth(m, y))) return false;
    await sleep(50);

    if (!clickDay(d)) return false;
    await sleep(100);

    console.log('[SingleDate] Done.');
    return true;
  };

  /** Step 0: Select "Single Date" radio (if form is on Date Range). */
  window.step0_selectSingleDateRadio = async function () {
    const radio = document.getElementById('provided-service-period-of-service-0') ||
                  document.querySelector('input[name="provided_service.period_of_service"][value="Single Date"]') ||
                  (() => {
                    const label = Array.from(document.querySelectorAll('label')).find((l) => (l.textContent || '').trim() === 'Single Date');
                    return label && label.getAttribute('for') ? document.getElementById(label.getAttribute('for')) : null;
                  })();
    if (!radio) {
      console.error('[SingleDate] Single Date radio not found.');
      return false;
    }
    if (!radio.checked) {
      clickLikeHuman(radio);
      await sleep(400);
    }
    console.log('[SingleDate] Step 0 done: Single Date radio selected.');
    return true;
  };

  /** Step 1: Click the calendar icon to open the dropdown. Wait 250ms. Check the page – is the calendar open? */
  window.step1_openCalendar = async function () {
    const trigger = getTrigger();
    if (!trigger) {
      console.error('[SingleDate] Trigger not found.');
      return false;
    }
    console.log('[SingleDate] Step 1: Clicking calendar icon...');
    trigger.scrollIntoView?.({ block: 'center', inline: 'center' });
    await sleep(80);
    clickLikeHuman(trigger);
    await sleep(250);
    console.log('[SingleDate] Step 1 done. Look at the page – is the calendar open?');
    return true;
  };

  /** Step 2: Read current month/year from the dropdown. Run this while the calendar is open. Returns { month, year } or null. */
  window.step2_readMonthYear = function () {
    const dd = getOpenDropdown();
    const info = getVisibleMonthYear();
    console.log('[SingleDate] Step 2: Dropdown found?', !!dd, '| Current month/year:', info ? MONTH_NAMES[info.month] + ' ' + info.year : null);
    return info;
  };

  /** Step 3: Navigate to target month. year=2025, month=5 means May 2025. Run while calendar is open. */
  window.step3_navigateToMonth = async function (year, month) {
    const targetMonth = (month || 1) - 1;
    const targetYear = year || new Date().getFullYear();
    console.log('[SingleDate] Step 3: Navigating to', MONTH_NAMES[targetMonth], targetYear, '...');
    const ok = await navigateToMonth(targetMonth, targetYear);
    console.log('[SingleDate] Step 3 done. Success?', ok);
    return ok;
  };

  /** Step 4: Click a day (1–31). Run while calendar is open and on the right month. */
  window.step4_clickDay = function (day) {
    const d = day == null ? new Date().getDate() : day;
    console.log('[SingleDate] Step 4: Clicking day', d, '...');
    const ok = clickDay(d);
    console.log('[SingleDate] Step 4 done. Success?', ok);
    return ok;
  };

  console.log('Single-date calendar – run steps one at a time:');
  console.log('  await step0_selectSingleDateRadio()     // if needed');
  console.log('  await step1_openCalendar()              // open calendar, then look at page');
  console.log('  step2_readMonthYear()                   // no await – does dropdown show? month/year?');
  console.log('  await step3_navigateToMonth(2025, 5)     // e.g. May 2025');
  console.log('  step4_clickDay(3)                       // click day 3');
  console.log('Or one shot: await setSingleDate(2025, 5, 3)');
})();
