// modules/authRetryFlow.js
// Handles retry sequence when auth elements are not found
// Reports progress back to main extension via window.__AUTH_RETRY_PROGRESS__

(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const byXPath = (xp) =>
        document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue || null;

    // Progress reporting
    const reportProgress = (step, details = {}) => {
        window.__AUTH_RETRY_PROGRESS__ = { step, ...details, timestamp: Date.now() };
        console.log(`[AUTH_RETRY] ${step}:`, details);
    };

    // Use unified selectors when available (injected from uniteSelectors.js)
    const authTable = (typeof window !== 'undefined' && window.UNITE_SELECTORS && window.UNITE_SELECTORS.billing && window.UNITE_SELECTORS.billing.authorizedTable) || null;
    const authIds = authTable ? { date: authTable.date.id, amount: authTable.amount.id, dateOpened: authTable.dateOpened.id } : { date: 'basic-table-authorized-service-delivery-date-s-value', amount: 'basic-table-authorized-amount-value', dateOpened: 'basic-table-date-opened-value' };
    const authXpaths = authTable ? { date: authTable.date.xpath, amount: authTable.amount.xpath, dateOpened: authTable.dateOpened.xpath } : { date: '/html/body/div[2]/div[2]/main/div/section/div/div[2]/div/div[1]/div[1]/div[2]/div[3]/div/div[1]/div/table/tbody/tr[3]/td[2]', amount: '//*[@id="basic-table-authorized-amount-value"]', dateOpened: '/html/body/div[2]/div[2]/main/div/section/div/div[2]/div/div[1]/div[1]/div[2]/div[1]/div[1]/div/table/tbody/tr[3]/td[2]' };

    const findAuthElements = () => {
        let amountEl = document.querySelector('#' + authIds.amount);
        let datesEl = document.querySelector('#' + authIds.date);
        let dateOpenedEl = document.querySelector('#' + authIds.dateOpened);
        if (!amountEl && authXpaths.amount) amountEl = byXPath(authXpaths.amount);
        if (!datesEl && authXpaths.date) datesEl = byXPath(authXpaths.date);
        if (!dateOpenedEl && authXpaths.dateOpened) dateOpenedEl = byXPath(authXpaths.dateOpened);
        return { amountEl, datesEl, dateOpenedEl };
    };

    // Main retry function
    const attemptAuthRetry = async (maxAttempts = 3, attemptDelay = 2000) => {
        reportProgress('retry_start', { maxAttempts });

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            reportProgress('retry_attempt', { attempt, maxAttempts });

            // Step 1: Try multiple times to get auth items
            reportProgress('checking_auth_elements', { attempt });
            const MAX_AUTH_CHECKS = 20;
            const AUTH_CHECK_DELAY = 1200;

            let authFound = false;
            for (let check = 1; check <= MAX_AUTH_CHECKS; check++) {
                const { amountEl, datesEl, dateOpenedEl } = findAuthElements();
                
                if (amountEl && datesEl && dateOpenedEl) {
                    authFound = true;
                    reportProgress('auth_found', { check, attempt });
                    return { ok: true, found: true };
                }

                if (check < MAX_AUTH_CHECKS) {
                    await sleep(AUTH_CHECK_DELAY);
                }
            }

            if (authFound) {
                return { ok: true, found: true };
            }

            // Step 2: Auth not found, trigger relogin sequence
            if (attempt < maxAttempts) {
                reportProgress('auth_not_found_triggering_relogin', { attempt, maxAttempts });
                
                // Signal to background to handle relogin
                window.__AUTH_RETRY_NEEDED__ = {
                    attempt,
                    maxAttempts,
                    currentUrl: window.location.href,
                    needsRelogin: true
                };

                // Wait for relogin to complete (background will handle it)
                reportProgress('waiting_for_relogin', { attempt });
                
                // Return a signal that relogin is needed
                return { ok: false, needsRelogin: true, attempt };
            }
        }

        // All attempts exhausted
        reportProgress('retry_exhausted', { maxAttempts });
        return { ok: false, found: false, error: 'Auth elements not found after all retry attempts' };
    };

    // Export function
    window.authRetryFlow = {
        attemptAuthRetry,
        findAuthElements,
        reportProgress
    };

    // Auto-run if requested
    if (window.__AUTH_RETRY_REQUESTED__) {
        const result = await attemptAuthRetry(
            window.__AUTH_RETRY_REQUESTED__.maxAttempts || 3,
            window.__AUTH_RETRY_REQUESTED__.attemptDelay || 2000
        );
        window.__AUTH_RETRY_RESULT__ = result;
    }
})();



