/**
 * UNITE US WEBSITE SELECTORS & ELEMENT CONFIG (copy for extension/root)
 * ======================================================================
 * Source of truth: server-side-automation/src/uniteSelectors.js
 * Copy from there when selectors change; this copy lets you ship the extension separately.
 */
(function () {
  'use strict';
  const UNITE_SELECTORS = {
  urls: { login: 'https://app.auth.uniteus.io/', logout: 'https://app.uniteus.io/logout' },
  auth: {
    email: { selectors: [ '#user_email', 'input[name="user[email]"]', '//html/body/div[2]/div/form/div[1]/input', 'input[type="email"]' ] },
    nextButton: { selectors: [ '#auth-0-submit-btn', 'input[name="commit"][value="Next"]', '//html/body/div[2]/div/form/div[2]/input', 'input[type="submit"]' ] },
    password: { selectors: [ '#app_1_user_password', 'input[name="app_1_user[password]"]', '//html/body/div[2]/div/form/div[2]/input', 'input[type="password"]' ] },
    signIn: { selectors: [ '#auth-1-submit-btn', 'input[name="commit"][value="Sign in"]', '//html/body/div[2]/div/form/div[3]/input', 'input[type="submit"][value="Sign in"]', 'input[type="submit"]', 'button[type="submit"]' ] }
  },
  billing: {
    pageReady: { id: 'basic-table-authorized-service-delivery-date-s-value', xpath: '//*[@id="container"]/div[2]/main/div/section/div' },
    authorizedTable: {
      date: { id: 'basic-table-authorized-service-delivery-date-s-value', xpath: '/html/body/div[2]/div[2]/main/div/section/div/div[2]/div/div[1]/div[1]/div[2]/div[3]/div/div[1]/div/table/tbody/tr[3]/td[2]' },
      amount: { id: 'basic-table-authorized-amount-value', xpath: '/html/body/div[2]/div[2]/main/div/section/div/div[2]/div/div[1]/div[1]/div[2]/div[3]/div/div[1]/div/table/tbody/tr[2]' },
      dateOpened: { id: 'basic-table-date-opened-value', xpath: '/html/body/div[2]/div[2]/main/div/section/div/div[2]/div/div[1]/div[1]/div[2]/div[1]/div[1]/div/table/tbody/tr[3]/td[2]' }
    },
    addButton: { id: 'add-fee-schedule-service-provided-button', xpath: '/html/body/div[2]/div[2]/main/div/section/div/div[2]/div/div[1]/div[2]/div[1]/div/button', textContains: 'add new contracted service' },
    amount: { id: 'provided-service-unit-amount', xpath: '/html/body/div[2]/div[2]/main/div/section/div/div[2]/div/div[1]/div[2]/div[2]/div[2]/div/form/div[3]/div[1]/div/input' },
    cancelButton: { id: 'fee-schedule-provided-service-cancel-btn' },
    duplicateScan: { cardClass: 'fee-schedule-provided-service-card', amountDataTest: 'unit-amount-value', datesDataTest: [ 'service-dates-value', 'service-start-date-value' ] },
    periodOfService: { dateRangeRadioId: 'provided-service-period-of-service-1', dateRangeLabelText: 'Date Range', dateRangeLabelId: 'Date Range-label', xpath: '/html/body/div[2]/div[2]/main/div/section/div/div[2]/div/div[1]/div[2]/div[2]/div/div[2]/div/form/div[4]/fieldset' },
    dateRange: {
      buttonId: '',
      labelId: '',
      labelXpath: "//label[@for='provided-service-date']",
      triggerXpath: '/html/body/div[2]/div[2]/main/div/section/div/div[2]/div/div[1]/div[2]/div[2]/div/div[2]/div/form/div[4]/div[1]/div/div/div[1]/a',
      startYearId: 'provided-service-date-year-input',
      endYearId: 'provided-service-date-year-input',
      dropdownOpenClass: 'ui-date-field__dropdown--open',
      fakeInput: { roleButton: 'a[aria-controls="provided-service-date"]', value: 'input#provided-service-date', container: '.ui-date-field' },
      dropdownClass: 'ui-date-field__dropdown',
      navPrev: 'a[role="button"]:first-of-type',
      navNext: 'a[role="button"]:last-of-type',
      leftCalendar: '.ui-calendar',
      rightCalendar: '.ui-calendar',
      leftSpan: '.ui-date-field__controls div span',
      rightSpan: '.ui-date-field__controls div span',
      dayButton: '.ui-calendar__day div[role="button"]'
    },
    placeOfService: {
      id: 'provided-service-place_of_service',
      xpath: '/html/body/div[2]/div[2]/main/div/section/div/div[2]/div/div[1]/div[2]/div[2]/div/div[2]/div/form/div[5]/div[2]/div/div[1]/div/div[2]',
      homeText: '12 - Home',
      homeValue: 'c0d441b4-ba1b-4f68-93af-a4d7d6659fba',
      choices: { inner: '.choices__inner', listDropdown: '.choices__list--dropdown .choices__list[role="listbox"]', listDropdownExpanded: '.choices__list--dropdown[aria-expanded="true"] .choices__list[role="listbox"]', option: '.choices__item[role="option"]', searchInput: '.choices__input.choices__input--cloned', searchInputAlt: 'input[type="text"].choices__input', singleSelected: '.choices__list--single .choices__item' }
    },
    proofUpload: { attachButtonText: 'Attach Document', modal: { id: 'upload-payments-documents', classFallback: 'dialog-paper', roleFallback: '[role="dialog"]' }, fileInput: { dataTestId: 'file-upload-input', typeFallback: 'input[type="file"]' }, saveButtonClass: 'attach-document-dialog__actions--save', disabledClass: 'opacity-40' },
    dependants: {
      name: { id: 'household_member_name_s_first_and_last', xpath: '/html/body/div[2]/div[2]/main/div/section/div/div[2]/div/div[1]/div[2]/div[2]/div[2]/div/form/div[5]/div[3]/div/textarea' },
      dob: { id: 'household_member_date_of_birth_s', xpath: '/html/body/div[2]/div[2]/main/div/section/div/div[2]/div/div[1]/div[2]/div[2]/div[2]/div/form/div[5]/div[4]/div/textarea' },
      cin: { id: 'household_member_cin_s', xpath: '/html/body/div[2]/div[2]/main/div/section/div/div[2]/div/div[1]/div[2]/div[2]/div[2]/div/form/div[5]/div[5]/div/textarea' }
    },
    submit: { id: 'fee-schedule-provided-service-post-note-btn', devSkipSubmit: false }
  }
  };
  if (typeof module !== 'undefined' && module.exports) { module.exports = UNITE_SELECTORS; } else if (typeof window !== 'undefined') { window.UNITE_SELECTORS = UNITE_SELECTORS; } else { self.UNITE_SELECTORS = UNITE_SELECTORS; }
})();
