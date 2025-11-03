// scripts/loginFlow.js
// Content-script injected on https://app.auth.uniteus.io/*
// Does the legit first step: POST {authenticity_token, user[email]} and lets server redirect.

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
        // If we're not on the root, go there
        if (!/^https:\/\/app\.auth\.uniteus\.io\/?$/.test(location.href)) {
            location.href = "https://app.auth.uniteus.io/";
            return;
        }

        const csrf = await getCsrfToken();
        if (!csrf) throw new Error("CSRF token not found on auth page.");

        // Build + submit a real form so we get the same redirect path
        const form = document.createElement("form");
        form.method = "POST";
        form.action = "https://app.auth.uniteus.io/";
        form.style.display = "none";

        // Rails-style token
        const authenticity = document.createElement("input");
        authenticity.type = "hidden";
        authenticity.name = "authenticity_token";
        authenticity.value = csrf;

        const email = document.createElement("input");
        email.type = "hidden";
        email.name = "user[email]";
        email.value = SETTINGS.email;

        form.appendChild(authenticity);
        form.appendChild(email);
        document.body.appendChild(form);
        form.submit();
    }

    async function getCsrfToken() {
        // Prefer meta tag on current doc
        const meta = document.querySelector('meta[name="csrf-token"]');
        if (meta?.content) return meta.content;

        // Fallback: fetch root and parse
        const html = await fetch("/", { credentials: "same-origin" }).then(r => r.text());
        const doc = new DOMParser().parseFromString(html, "text/html");
        return doc.querySelector('meta[name="csrf-token"]')?.content || "";
    }
})();