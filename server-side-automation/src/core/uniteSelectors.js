/**
 * UNITE US WEBSITE SELECTORS & ELEMENT CONFIG
 * ===========================================
 * Central config for all DOM elements we interact with on app.uniteus.io and
 * app.auth.uniteus.io. When the Unite site is updated, adjust values here
 * instead of hunting through auth.js, billingActions.js, etc.
 *
 * WHEN THE UNITE SITE UPDATES:
 * 1. Inspect the changed page (login, billing form, date picker, etc.).
 * 2. Update the matching section below (auth.*, billing.*) with new ids, XPaths,
 *    class names, or button text. Comments explain what each part is for.
 * 3. No need to touch auth.js, billingActions.js, or billingWorker.js unless
 *    you add new element types.
 *
 * CONVENTIONS:
 * - id: element id (e.g. user_email) — we add # when building selectors
 * - xpath: full XPath fallback when ID changes
 * - selectors: array of CSS/XPath strings; we try each until one matches
 * - class names: stored without leading dot; we add . when querying
 */

module.exports = {
  // ---------------------------------------------------------------------------
  // URLS
  // ---------------------------------------------------------------------------
  urls: {
    /** Auth/login page. User enters email here, then clicks Next -> /login. */
    login: 'https://app.auth.uniteus.io/',
    /** Hit this before login to clear any existing Unite session. */
    logout: 'https://app.uniteus.io/logout'
  },

  // ---------------------------------------------------------------------------
  // AUTH / LOGIN (auth.js)
  // Used on app.auth.uniteus.io. Playwright uses these selectors via page.$(s).
  // ---------------------------------------------------------------------------
  auth: {
    /** Email input on initial auth page. */
    email: {
      selectors: [
        '#user_email',
        'input[name="user[email]"]',
        '//html/body/div[2]/div/form/div[1]/input',
        'input[type="email"]'
      ]
    },
    /** "Next" button after email. Triggers redirect to /login. */
    nextButton: {
      selectors: [
        '#auth-0-submit-btn',
        'input[name="commit"][value="Next"]',
        '//html/body/div[2]/div/form/div[2]/input',
        'input[type="submit"]'
      ]
    },
    /** Password input on /login page. */
    password: {
      selectors: [
        '#app_1_user_password',
        'input[name="app_1_user[password]"]',
        '//html/body/div[2]/div/form/div[2]/input',
        'input[type="password"]'
      ]
    },
    /** "Sign in" button on /login page. Submits credentials. */
    signIn: {
      selectors: [
        '#auth-1-submit-btn',
        'input[name="commit"][value="Sign in"]',
        '//html/body/div[2]/div/form/div[3]/input',
        'input[type="submit"][value="Sign in"]',
        'input[type="submit"]',
        'button[type="submit"]'
      ]
    }
  },

  // ---------------------------------------------------------------------------
  // BILLING PAGE (billingActions.js – runs inside page.evaluate)
  // All IDs, XPaths, classes, and text fallbacks for the billing/case contact UI.
  // ---------------------------------------------------------------------------
  billing: {
    // ----- Page ready / Authorized table -------------------------------------
    /** Selector we wait for before running billing (billingWorker + injected). */
    pageReady: {
      /** Primary: table cell showing authorized service delivery date. */
      id: 'basic-table-authorized-service-delivery-date-s-value'
    },
    /** Authorized limits table: date range and max amount. Used for clamping. */
    authorizedTable: {
      date: {
        id: 'basic-table-authorized-service-delivery-date-s-value',
        xpath: '/html/body/div[2]/div[2]/main/div/section/div/div[2]/div/div[1]/div[1]/div[2]/div[3]/div/div[1]/div/table/tbody/tr[3]/td[2]'
      },
      amount: {
        id: 'basic-table-authorized-amount-value',
        xpath: '/html/body/div[2]/div[2]/main/div/section/div/div[2]/div/div[1]/div[1]/div[2]/div[3]/div/div[1]/div/table/tbody/tr[2]'
      }
    },

    // ----- Add button & billing shelf ----------------------------------------
    /** Button that opens the "Add fee schedule / provided service" shelf. */
    addButton: {
      id: 'add-fee-schedule-service-provided-button',
      xpath: '/html/body/div[2]/div[2]/main/div/section/div/div[2]/div/div[1]/div[2]/div[1]/div/button',
      /** Fallback: button whose text contains this (case-insensitive). */
      textContains: 'add new contracted service'
    },
    /** Amount input in the shelf form. Also used to detect "shelf is open". */
    amount: {
      id: 'provided-service-unit-amount',
      xpath: '/html/body/div[2]/div[2]/main/div/section/div/div[2]/div/div[1]/div[2]/div[2]/div[2]/div/form/div[3]/div[1]/div/input'
    },
    /** Cancel button to close the shelf (optional; we rarely use it). */
    cancelButton: {
      id: 'fee-schedule-provided-service-cancel-btn'
    },

    // ----- Duplicate detection (existing billing cards) ----------------------
    /** Scans existing cards to detect duplicate date-range + amount. */
    duplicateScan: {
      /** Card container class for each billing entry. */
      cardClass: 'fee-schedule-provided-service-card',
      /** data-test-element for amount shown on card. */
      amountDataTest: 'unit-amount-value',
      /** data-test-element for date range; alternate if they use start-only. */
      datesDataTest: ['service-dates-value', 'service-start-date-value']
    },

    // ----- Date range picker -------------------------------------------------
    /** Date range field. Opens the duration picker dropdown. */
    dateRange: {
      /** Main button/trigger for the date range. */
      buttonId: 'provided-service-dates',
      labelId: 'Date Range-label',
      labelXpath: '/html/body/div[2]/div[2]/main/div/section/div/div[2]/div/div[1]/div[2]/div[2]/div[2]/div/form/div[4]/fieldset/div[2]/label/span',
      /** Start/end year inputs inside the dropdown. */
      startYearId: 'provided-service-dates-start-year',
      endYearId: 'provided-service-dates-end-year',
      /** Dropdown is open when this class combination exists. */
      dropdownOpenClass: 'ui-duration-field__dropdown ui-duration-field__dropdown--open',
      /** Selectors for "fake" input / trigger elements we can click to open. */
      fakeInput: {
        roleButton: '.ui-duration-field__fake-input [role="button"]',
        value: '.ui-duration-field__fake-input .ui-duration-field__fake-input__value',
        container: '.ui-duration-field__fake-input'
      },
      /** Dropdown container. */
      dropdownClass: 'ui-duration-field__dropdown',
      /** Prev/next month buttons inside dropdown. */
      navPrev: 'a[role="button"]:first-of-type',
      navNext: 'a[role="button"]:last-of-type',
      /** Left/right calendar panes. */
      leftCalendar: '.ui-calendar:nth-of-type(1)',
      rightCalendar: '.ui-calendar:nth-of-type(2)',
      /** Spans showing current month label for each pane. */
      leftSpan: '.ui-duration-field__controls div:nth-of-type(1) span',
      rightSpan: '.ui-duration-field__controls div:nth-of-type(2) span',
      /** Clickable day elements (exclude out-of-month). */
      dayButton: '.ui-calendar__day:not(.ui-calendar__day--out-of-month) div[role="button"]'
    },

    // ----- Place of Service (dropdown) ---------------------------------------
    /**
     * "Place of Service" Choices.js dropdown. We always choose "12 - Home".
     * Structure moved: form layout changed from .../div[2]/div[2]/... to .../div[2]/div/div[2]/...
     * xpath targets the dropdown container: div.choices__list.choices__list--dropdown
     * (contains input.choices__input.choices__input--cloned + div.choices__list[role="listbox"] with options).
     */
    placeOfService: {
      id: 'provided-service-place_of_service',
      xpath: '/html/body/div[2]/div[2]/main/div/section/div/div[2]/div/div[1]/div[2]/div[2]/div/div[2]/div/form/div[5]/div[2]/div/div[1]/div/div[2]',
      /** Option we select. */
      homeText: '12 - Home',
      homeValue: 'c0d441b4-ba1b-4f68-93af-a4d7d6659fba',
      /** Choices.js: dropdown container, listbox, options, search input. */
      choices: {
        inner: '.choices__inner',
        listDropdown: '.choices__list--dropdown .choices__list[role="listbox"]',
        listDropdownExpanded: '.choices__list--dropdown[aria-expanded="true"] .choices__list[role="listbox"]',
        option: '.choices__item[role="option"]',
        searchInput: '.choices__input.choices__input--cloned',
        searchInputAlt: 'input[type="text"].choices__input',
        singleSelected: '.choices__list--single .choices__item'
      }
    },

    // ----- Proof / document upload -------------------------------------------
    /** Attach proof documents. Button opens modal; we then set file input. */
    proofUpload: {
      /** Button text we match (must be visible). */
      attachButtonText: 'Attach Document',
      /** Modal dialog. */
      modal: {
        id: 'upload-payments-documents',
        classFallback: 'dialog-paper',
        roleFallback: '[role="dialog"]'
      },
      /** File input inside modal. */
      fileInput: {
        dataTestId: 'file-upload-input',
        typeFallback: 'input[type="file"]'
      },
      /** Save/Attach button in modal. Wait until not disabled before clicking. */
      saveButtonClass: 'attach-document-dialog__actions--save',
      /** Save button is disabled when it has this class. */
      disabledClass: 'opacity-40'
    },

    // ----- Dependants (household members) ------------------------------------
    /** Textareas for dependant names, DOBs, CINs. Multi-line formatted. */
    dependants: {
      name: {
        id: 'household_member_name_s_first_and_last',
        xpath: '/html/body/div[2]/div[2]/main/div/section/div/div[2]/div/div[1]/div[2]/div[2]/div[2]/div/form/div[5]/div[3]/div/textarea'
      },
      dob: {
        id: 'household_member_date_of_birth_s',
        xpath: '/html/body/div[2]/div[2]/main/div/section/div/div[2]/div/div[1]/div[2]/div[2]/div[2]/div/form/div[5]/div[4]/div/textarea'
      },
      cin: {
        id: 'household_member_cin_s',
        xpath: '/html/body/div[2]/div[2]/main/div/section/div/div[2]/div/div[1]/div[2]/div[2]/div[2]/div/form/div[5]/div[5]/div/textarea'
      }
    },

    // ----- Submit ------------------------------------------------------------
    /** Submit button to post the billing record. */
    submit: {
      id: 'fee-schedule-provided-service-post-note-btn',
      /** When true, skip submit + verification (dev only). Set to false for production. */
      devSkipSubmit: false
    }
  }
};
