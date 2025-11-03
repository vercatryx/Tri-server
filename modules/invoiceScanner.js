// modules/invoiceScanner.js
// Scans "Provided Service" cards and checks for an exact invoice match.
// Exposes: window.invoiceScanner.findExisting({ start, end, amount, requireTitle? })

(function () {
    if (window.invoiceScanner) return;

    const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
    const centsFrom = (v) => {
        if (typeof v === "number") return Math.round(v * 100);
        const n = Number(String(v).replace(/[^\d.]/g, ""));
        return Number.isFinite(n) ? Math.round(n * 100) : NaN;
    };
    const dFrom = (v) => {
        if (v instanceof Date) {
            const d = new Date(v);
            d.setHours(0, 0, 0, 0);
            return d;
        }
        const d = new Date(String(v));
        if (Number.isNaN(d.getTime())) return null;
        d.setHours(0, 0, 0, 0);
        return d;
    };
    const sameDay = (a, b) => !!(a && b && a.getTime() === b.getTime());

    function parseCard(card, idx) {
        const titleEl = card.querySelector("h3");
        const amountEl = card.querySelector('[data-test-element="unit-amount-value"]');
        const rangeEl  = card.querySelector('[data-test-element="service-dates-value"], [data-test-element="service-start-date-value"]');
        const statusEl = card.querySelector('[data-testid="ps-invoice-status"]');
        const linkEl   = card.querySelector('a[href^="/invoices/"]');

        const title = norm(titleEl?.textContent);
        const amountText = norm(amountEl?.textContent);
        const cents = centsFrom(amountText);
        const datesText = norm(rangeEl?.textContent);

        let start = null, end = null;
        if (datesText) {
            const parts = datesText.split(/\s*-\s*/);
            if (parts.length === 2) {
                start = dFrom(parts[0]);
                end   = dFrom(parts[1]);
            } else {
                start = dFrom(datesText);
                end   = start;
            }
        }

        return {
            idx,
            title,
            cents,
            amountText,
            datesText,
            start,
            end,
            status: norm(statusEl?.textContent),
            invoiceNo: norm(linkEl?.textContent || "").replace(/^Invoice\s*#\s*/i, ""),
            link: linkEl ? new URL(linkEl.getAttribute("href"), location.origin).href : null,
            _el: card
        };
    }

    function scanCards() {
        const cards = Array.from(document.querySelectorAll(".fee-schedule-provided-service-card"));
        return cards.map(parseCard);
    }

    /**
     * @param {{start:string|Date, end:string|Date|null, amount:number|string, requireTitle?:string|null}} opts
     * @returns {{exists:boolean, matches:Array, rows:Array}}
     */
    function findExisting(opts) {
        const rows = scanCards();
        const requireTitle = opts?.requireTitle || null;

        const tStart = dFrom(opts?.start);
        const tEnd = opts?.end == null ? tStart : dFrom(opts?.end);
        if (!tStart || !tEnd) {
            return { exists: false, matches: [], rows, error: "Bad dates" };
        }
        const targetCents = centsFrom(opts?.amount);
        if (!Number.isFinite(targetCents)) {
            return { exists: false, matches: [], rows, error: "Bad amount" };
        }

        const filtered = rows.filter(r => (requireTitle ? r.title === requireTitle : true));

        const matches = filtered.filter(r =>
            Number.isFinite(r.cents) &&
            r.start && r.end &&
            r.cents === targetCents &&
            sameDay(r.start, tStart) &&
            sameDay(r.end, tEnd)
        );

        return { exists: matches.length > 0, matches, rows };
    }

    window.invoiceScanner = { findExisting };
})();