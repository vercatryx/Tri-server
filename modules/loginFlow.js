// scripts/loginFlow.js
// Content-script injected on https://app.auth.uniteus.io/*
// Fills email field and clicks Next button

(() => {
    let SETTINGS = { email: "" };

    chrome.runtime.onMessage.addListener((msg) => {
        if (msg?.type === "LOGIN_FLOW_SETTINGS") {
            SETTINGS.email = msg.email || "";
            if (!SETTINGS.email) return;
            run().catch(err => console.error("[loginFlow] failed:", err));
        }
    });

    async function run() {
        // Wait for the email input field to be available
        const emailInput = await waitForElement('#user_email', 5000);
        if (!emailInput) {
            console.error("[loginFlow] Email input not found");
            return;
        }

        // Fill in the email
        emailInput.value = SETTINGS.email;

        // Trigger input events to ensure React/Vue listeners are notified
        emailInput.dispatchEvent(new Event('input', { bubbles: true }));
        emailInput.dispatchEvent(new Event('change', { bubbles: true }));

        // Wait a moment for validation
        await new Promise(resolve => setTimeout(resolve, 100));

        // Find and click the Next button
        const nextButton = document.querySelector('#auth-0-submit-btn, input[type="submit"][value="Next"]');
        if (nextButton) {
            console.log("[loginFlow] Clicking Next button");
            nextButton.click();
        } else {
            console.error("[loginFlow] Next button not found");
        }
    }

    async function waitForElement(selector, timeout = 5000) {
        const startTime = Date.now();
        while (Date.now() - startTime < timeout) {
            const element = document.querySelector(selector);
            if (element) return element;
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return null;
    }
})();