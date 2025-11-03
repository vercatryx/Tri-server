// background.js
// - On click: ensure we're on the auth domain, inject login flow.
// - After navigation completes to step-2 host, inject patch to set/replace email & optionally fill password.

const AUTH_ORIGIN = "https://app.auth.uniteus.io/";
const STEP2_HOST = "app.uniteus.io";

chrome.action.onClicked.addListener(async (tab) => {
    try {
        // Load settings
        const { email, password, autoSubmit } = await chrome.storage.sync.get({
            email: "",
            password: "",
            autoSubmit: false
        });
        if (!email) {
            await chrome.tabs.create({ url: chrome.runtime.getURL("options.html") });
            return;
        }

        // If not already on auth origin, navigate there first
        if (!tab?.url?.startsWith(AUTH_ORIGIN)) {
            const updated = await chrome.tabs.update(tab.id, { url: AUTH_ORIGIN });
            // Wait for navigation complete, then inject
            await waitForTabComplete(updated.id);
        }

        // Inject login flow to perform first-page POST with CSRF
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ["scripts/loginFlow.js"]
        });

        // Provide settings to the injected script
        await chrome.tabs.sendMessage(tab.id, { type: "LOGIN_FLOW_SETTINGS", email });

        // Set up a one-time listener for when we land on the step-2 page
        const tabId = tab.id;
        const onUpdated = async (id, info, changedTab) => {
            if (id !== tabId || info.status !== "complete") return;
            try {
                const url = new URL(changedTab.url || "");
                if (url.host === STEP2_HOST) {
                    chrome.tabs.onUpdated.removeListener(onUpdated);
                    // Inject step-2 patch (edit hidden email, fill password if available)
                    await chrome.scripting.executeScript({
                        target: { tabId: id },
                        files: ["scripts/step2Patch.js"]
                    });
                    await chrome.tabs.sendMessage(id, {
                        type: "STEP2_SETTINGS",
                        email,
                        password,
                        autoSubmit
                    });
                }
            } catch {}
        };
        chrome.tabs.onUpdated.addListener(onUpdated);
    } catch (err) {
        console.error("[AutoLogin] Error:", err);
    }
});

function waitForTabComplete(tabId) {
    return new Promise((resolve) => {
        const listener = (id, info) => {
            if (id === tabId && info.status === "complete") {
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
            }
        };
        chrome.tabs.onUpdated.addListener(listener);
    });
}