// scripts/step2Patch.js
// Content-script for https://app.uniteus.io/* second screen.
// - Replaces hidden email input + visible span to match configured email.
// - If there's a password input, fills it (optional) and submits.

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
        if (!SETTINGS.email) return;

        // 1) Replace on-screen email span if found (id from saved markup)
        try {
            const span = document.querySelector("#user-email");
            if (span?.firstChild) {
                span.firstChild.textContent = " " + SETTINGS.email + " ";
            }
        } catch {}

        // 2) Set hidden input that is actually submitted
        try {
            const hidden = document.getElementById("app_1_user_email");
            if (hidden) hidden.value = SETTINGS.email;
        } catch {}

        // 3) If there is an email field (sometimes not hidden), keep them in sync
        const emailInputs = [
            document.querySelector('input[name="app_1_user[email]"]'),
            document.getElementById("app_1_user_email")
        ].filter(Boolean);
        for (const el of emailInputs) {
            try { el.value = SETTINGS.email; } catch {}
        }

        // 4) Optional: fill password and submit if present
        const pwd = document.querySelector('input[type="password"]');
        if (pwd && SETTINGS.password) {
            pwd.value = SETTINGS.password;
            // Attempt to trigger React/Vue input listeners if any
            fireInputEvents(pwd);
        }

        // 5) Auto-submit if requested
        if (SETTINGS.autoSubmit) {
            const form = pwd ? pwd.closest("form") : document.querySelector("form");
            if (form) {
                // Try to click a primary submit button first
                const btn = form.querySelector('button[type="submit"], button[name="commit"], input[type="submit"]');
                if (btn) {
                    btn.click();
                } else {
                    form.submit();
                }
            }
        }
    }

    function fireInputEvents(el) {
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
    }
})();