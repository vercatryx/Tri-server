// scripts/step2Patch.js
// Content-script for https://app.auth.uniteus.io/login password screen
// Fills password field and clicks Sign in button

(() => {
    let SETTINGS = { email: "", password: "", autoSubmit: false };

    chrome.runtime.onMessage.addListener((msg) => {
        if (msg?.type === "STEP2_SETTINGS") {
            SETTINGS = {
                email: msg.email || "",
                password: msg.password || "",
                autoSubmit: !!msg.autoSubmit
            };
            run().catch(err => console.error("[step2Patch] failed:", err));
        }
    });

    async function run() {
        if (!SETTINGS.password) {
            console.log("[step2Patch] No password provided");
            return;
        }

        // Wait for the password input field to be available
        const passwordInput = await waitForElement('#app_1_user_password', 5000);
        if (!passwordInput) {
            console.error("[step2Patch] Password input not found");
            return;
        }

        console.log("[step2Patch] Found password input, filling it in");

        // Fill in the password
        passwordInput.value = SETTINGS.password;

        // Trigger input events to ensure React/Vue listeners are notified
        passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
        passwordInput.dispatchEvent(new Event('change', { bubbles: true }));

        // Wait a moment for validation
        await new Promise(resolve => setTimeout(resolve, 100));

        // Auto-submit if requested
        if (SETTINGS.autoSubmit) {
            // Find and click the Sign in button
            const signInButton = document.querySelector('#auth-1-submit-btn, input[type="submit"][value="Sign in"]');
            if (signInButton) {
                console.log("[step2Patch] Clicking Sign in button");
                signInButton.click();
            } else {
                console.error("[step2Patch] Sign in button not found");
            }
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