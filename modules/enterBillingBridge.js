// modules/enterBillingBridge.js
// Watches for window.__billingResult and provides a DOM probe the panel can call.
// Also posts BILLING_RESULT automatically when we detect success heuristics.

(function () {
    const startTs = Date.now();
    function log(...a){ try{ console.log("[enterBillingBridge]", ...a); }catch{} }

    // --- Globals used by panel probes ---
    const CARD_SEL = ".fee-schedule-provided-service-card";
    const REMAIN_SEL = '[data-test-element="unit-amount-remaining"], [data-test-element="remaining-amount-value"], .remaining-amount';
    const FORM_SEL = "form.payments-track-service";
    const TOAST_SEL = '[role="alert"], .toast, .notification, .ui-toast';

    let baselineCards = 0;
    try { baselineCards = document.querySelectorAll(CARD_SEL).length; } catch {}
    // Attempt to read initial "remaining $" numeric
    const parseMoney = (s) => Number(String(s).replace(/[^0-9.]/g, "")) || 0;
    let baselineRemaining = null;
    try {
        const rem = document.querySelector(REMAIN_SEL);
        if (rem) baselineRemaining = parseMoney(rem.textContent || "");
    } catch {}

    // Expose a probe for the panel to call from executeScript
    window.__BILLING_PROBE__ = () => {
        try {
            // 1) New service card was added
            const nowCards = document.querySelectorAll(CARD_SEL).length;
            if (nowCards > baselineCards) {
                return { ok: true, reason: "new_card" };
            }

            // 2) Remaining amount decreased
            const remEl = document.querySelector(REMAIN_SEL);
            if (remEl && baselineRemaining != null) {
                const nowRem = parseMoney(remEl.textContent || "");
                if (nowRem < baselineRemaining) {
                    return { ok: true, reason: "remaining_dropped" };
                }
            }

            // 3) Success toast/message appeared
            const toast = Array.from(document.querySelectorAll(TOAST_SEL))
                .map(n => (n.textContent || "").toLowerCase())
                .find(t => /success|created|submitted|saved/.test(t));
            if (toast) {
                return { ok: true, reason: "toast" };
            }

            // 4) Shelf form closed/disappeared shortly after submit
            const form = document.querySelector(FORM_SEL);
            if (!form) {
                // Heuristic: if form vanished, likely submitted
                return { ok: true, reason: "form_disappeared" };
            }

            return { ok: false };
        } catch (e) {
            return { ok: false, error: String(e) };
        }
    };

    // --- Bridge: post BILLING_RESULT when __billingResult appears ---
    let posted = false;
    const post = (payload) => {
        if (posted) return;
        posted = true;
        try {
            chrome.runtime?.sendMessage?.({ type: "BILLING_RESULT", ...payload });
            log("posted BILLING_RESULT:", payload);
        } catch (e) {
            log("failed to post BILLING_RESULT:", e?.message || e);
        }
    };

    (async () => {
        for (let i = 0; i < 200 && !posted; i++) {   // ~25s with taper
            const res = window.__billingResult;
            if (res && typeof res === "object") {
                const uid = window.__BILLING_INPUTS__?.userId ?? undefined;
                post({ ok: !!res.ok, reason: res.error || "", userId: uid, details: res.details });
                return;
            }
            await new Promise(r => setTimeout(r, (Date.now() - startTs < 2000) ? 150 : 300));
        }
    })();

    // --- DOM auto-success fallback (MutationObserver) ---
    const mo = new MutationObserver(() => {
        if (posted) { mo.disconnect(); return; }
        try {
            const probe = window.__BILLING_PROBE__?.();
            if (probe?.ok) {
                post({ ok: true, reason: probe.reason || "dom_observer", userId: window.__BILLING_INPUTS__?.userId });
                mo.disconnect();
            }
        } catch {}
    });

    try {
        mo.observe(document.body || document.documentElement, { childList: true, subtree: true });
    } catch {}

    // Stop observing after 25s; panel has its own polling too
    setTimeout(() => { try { mo.disconnect(); } catch {} }, 25000);
})();