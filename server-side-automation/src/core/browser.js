const { chromium } = require('playwright');
require('dotenv').config();

/** Number of browser instances to run in parallel (1 = current single-browser behavior). Env: BROWSER_COUNT */
const BROWSER_COUNT = Math.max(1, parseInt(process.env.BROWSER_COUNT || '1', 10));

/** Pool: slots[slot] = { browser, context, page } or null */
const slots = [];

function getSlot(slotIndex) {
    const slot = slotIndex == null ? 0 : slotIndex;
    if (slot < 0 || slot >= BROWSER_COUNT) throw new Error(`Invalid browser slot: ${slot} (BROWSER_COUNT=${BROWSER_COUNT})`);
    return slot;
}

async function launchBrowserForSlot(slotIndex) {
    const slot = getSlot(slotIndex);
    const existing = slots[slot];
    if (existing && existing.browser && existing.browser.isConnected()) {
        try {
            if (!existing.page.isClosed()) return existing.page;
        } catch (e) { /* invalid, recreate */ }
    }

    if (existing && existing.browser) {
        try {
            await existing.browser.close();
        } catch (e) { /* already closed */ }
        slots[slot] = null;
    }

    console.log(`[Browser] Launching Chromium (slot ${slot + 1}/${BROWSER_COUNT})...`);
    const browser = await chromium.launch({
        headless: process.env.HEADLESS === 'true',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--disable-dev-shm-usage',
            '--disable-features=IsolateOrigins,site-per-process',
            '--disable-site-isolation-trials'
        ]
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 },
        permissions: [],
        geolocation: undefined,
        locale: 'en-US',
        bypassCSP: true,
        extraHTTPHeaders: {
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'DNT': '1',
            'Connection': 'keep-alive'
        }
    });

    await context.grantPermissions([], { origin: 'https://app.uniteus.io' });
    await context.clearPermissions();

    const page = await context.newPage();

    await page.route('**/*', async (route) => {
        const request = route.request();
        const url = request.url();

        if (url.includes('app.launchdarkly.com') || url.includes('maps.googleapis.com')) {
            return route.abort();
        }

        if (!url.includes('uniteus.io') && !url.includes('localhost') && !url.startsWith('data:')) {
            try {
                const response = await route.fetch();
                const headers = { ...response.headers() };
                headers['access-control-allow-origin'] = '*';
                headers['access-control-allow-credentials'] = 'true';
                return route.fulfill({ response, headers });
            } catch (e) {
                return route.continue();
            }
        }

        return route.continue();
    });

    page.on('console', msg => {
        if (msg.type() === 'log') console.log(`[Browser ${slot}] ${msg.text()}`);
        if (msg.type() === 'warn') console.warn(`[Browser ${slot}] ${msg.text()}`);
        if (msg.type() === 'error') console.error(`[Browser ${slot}] ${msg.text()}`);
    });

    slots[slot] = { browser, context, page };
    return page;
}

async function getPage(slotIndex) {
    const slot = getSlot(slotIndex);
    if (!slots[slot] || !slots[slot].page || slots[slot].page.isClosed()) {
        return launchBrowserForSlot(slot);
    }
    return slots[slot].page;
}

function getContext(slotIndex) {
    const slot = getSlot(slotIndex);
    if (!slots[slot]) return null;
    return slots[slot].context;
}

async function closeBrowser(slotIndex) {
    if (slotIndex === undefined || slotIndex === null) {
        for (let s = 0; s < BROWSER_COUNT; s++) await closeBrowser(s);
        return;
    }
    const slot = getSlot(slotIndex);
    const existing = slots[slot];
    if (existing && existing.browser) {
        try {
            await existing.browser.close();
        } catch (e) { /* ignore */ }
        slots[slot] = null;
    }
}

async function restartBrowser(slotIndex) {
    const slot = getSlot(slotIndex);
    console.log(`[Browser] Restarting browser (slot ${slot + 1})...`);
    await closeBrowser(slot);
    return launchBrowserForSlot(slot);
}

/** Legacy single-browser API: launch and return one page (slot 0). Used by server startup. */
async function launchBrowser() {
    return launchBrowserForSlot(0);
}

module.exports = {
    launchBrowser,
    getPage,
    getContext,
    closeBrowser,
    restartBrowser,
    BROWSER_COUNT
};
