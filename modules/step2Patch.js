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
        console.log("[step2Patch] 🔐 Starting password entry...", { 
            hasPassword: !!SETTINGS.password, 
            autoSubmit: SETTINGS.autoSubmit,
            currentUrl: window.location.href 
        });

        if (!SETTINGS.password) {
            console.error("[step2Patch] ❌ No password provided");
            return;
        }

        // Wait for the password input field to be available (longer timeout)
        console.log("[step2Patch] Waiting for password input field...");
        let passwordInput = await waitForElement('#app_1_user_password', 10000);
        if (!passwordInput) {
            console.warn("[step2Patch] Primary selector not found, trying alternatives...");
            // Try alternative selectors
            passwordInput = document.querySelector('input[type="password"]');
            if (!passwordInput) {
                passwordInput = document.querySelector('input[name*="password" i]');
            }
            if (!passwordInput) {
                passwordInput = document.querySelector('input[id*="password" i]');
            }
            if (passwordInput) {
                console.log("[step2Patch] ✓ Found alternative password input:", passwordInput.id || passwordInput.name);
            } else {
                console.error("[step2Patch] ❌ No password input found with any selector");
                return;
            }
        }

        console.log("[step2Patch] ✓ Found password input, filling it in");

        // Fill in the password
        passwordInput.value = SETTINGS.password;
        passwordInput.focus();

        // Trigger input events to ensure React/Vue listeners are notified
        passwordInput.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        passwordInput.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
        passwordInput.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true }));
        passwordInput.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true }));

        // Wait a moment for validation
        await new Promise(resolve => setTimeout(resolve, 300));

        console.log("[step2Patch] Password filled, checking for submit button...");

        // Auto-submit if requested
        if (SETTINGS.autoSubmit) {
            // Find and click the Sign in button - try multiple selectors
            let signInButton = document.querySelector('#auth-1-submit-btn');
            if (!signInButton) {
                signInButton = document.querySelector('input[type="submit"][value="Sign in"]');
            }
            if (!signInButton) {
                signInButton = document.querySelector('button[type="submit"]');
            }
            if (!signInButton) {
                signInButton = document.querySelector('input[type="submit"]');
            }
            if (!signInButton) {
                // Try finding by text content
                const buttons = Array.from(document.querySelectorAll('button, input[type="submit"]'));
                signInButton = buttons.find(btn => 
                    (btn.textContent || btn.value || '').toLowerCase().includes('sign in') ||
                    (btn.textContent || btn.value || '').toLowerCase().includes('submit')
                );
            }

            if (signInButton) {
                console.log("[step2Patch] ✓ Found sign in button, clicking...", signInButton);
                signInButton.focus();
                await new Promise(resolve => setTimeout(resolve, 200));
                signInButton.click();
                console.log("[step2Patch] ✓ Sign in button clicked");
            } else {
                console.error("[step2Patch] ❌ Sign in button not found with any selector");
                console.log("[step2Patch] Available buttons:", Array.from(document.querySelectorAll('button, input[type="submit"]')).map(b => ({
                    id: b.id,
                    type: b.type,
                    value: b.value,
                    text: b.textContent
                })));
            }
        } else {
            console.log("[step2Patch] Auto-submit disabled, password filled but not submitting");
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