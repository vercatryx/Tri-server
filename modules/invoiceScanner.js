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

        console.log(`[invoiceScanner.parseCard] Card ${idx}: amountText="${amountText}", cents=${cents}, datesText="${datesText}"`);

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

        const fmtDate = (d) => d ? `${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}` : 'null';
        console.log(`[invoiceScanner.parseCard] Card ${idx}: Parsed dates: start=${fmtDate(start)}, end=${fmtDate(end)}`);

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
        console.log('[invoiceScanner.scanCards] Found', cards.length, 'cards with selector .fee-schedule-provided-service-card');

        // Log visibility status
        cards.forEach((card, i) => {
            const isVisible = !!(card.offsetParent !== null || (card.getClientRects?.().length || 0) > 0);
            console.log(`[invoiceScanner.scanCards] Card ${i+1}: visible=${isVisible}`);
        });

        return cards.map(parseCard);
    }

    /**
     * @param {{start:string|Date, end:string|Date|null, amount:number|string, requireTitle?:string|null}} opts
     * @returns {{exists:boolean, matches:Array, rows:Array}}
     */
    function findExisting(opts) {
        console.log('[invoiceScanner.findExisting] Called with:', opts);
        const rows = scanCards();
        const requireTitle = opts?.requireTitle || null;

        const tStart = dFrom(opts?.start);
        const tEnd = opts?.end == null ? tStart : dFrom(opts?.end);
        const fmtDate = (d) => d ? `${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}` : 'null';

        console.log('[invoiceScanner.findExisting] Target dates:', fmtDate(tStart), '→', fmtDate(tEnd));

        if (!tStart || !tEnd) {
            console.warn('[invoiceScanner.findExisting] Bad dates');
            return { exists: false, matches: [], rows, error: "Bad dates" };
        }
        const targetCents = centsFrom(opts?.amount);
        console.log('[invoiceScanner.findExisting] Target amount:', opts?.amount, '→', targetCents, 'cents');

        if (!Number.isFinite(targetCents)) {
            console.warn('[invoiceScanner.findExisting] Bad amount');
            return { exists: false, matches: [], rows, error: "Bad amount" };
        }

        const filtered = rows.filter(r => (requireTitle ? r.title === requireTitle : true));
        console.log('[invoiceScanner.findExisting] Filtered', filtered.length, 'cards (title filter:', requireTitle || 'none', ')');

        const matches = filtered.filter(r => {
            const amtMatch = Number.isFinite(r.cents) && r.cents === targetCents;
            const startMatch = r.start && sameDay(r.start, tStart);
            const endMatch = r.end && sameDay(r.end, tEnd);

            console.log(`[invoiceScanner.findExisting] Card ${r.idx}: amt=${r.cents}(${amtMatch}), start=${fmtDate(r.start)}(${startMatch}), end=${fmtDate(r.end)}(${endMatch})`);

            return Number.isFinite(r.cents) &&
                r.start && r.end &&
                r.cents === targetCents &&
                sameDay(r.start, tStart) &&
                sameDay(r.end, tEnd);
        });

        console.log('[invoiceScanner.findExisting] Found', matches.length, 'matches');
        if (matches.length > 0) {
            console.log('[invoiceScanner.findExisting] Match details:', matches.map(m => ({
                amount: m.amountText,
                dates: m.datesText,
                status: m.status,
                invoiceNo: m.invoiceNo
            })));
        }

        return { exists: matches.length > 0, matches, rows };
    }

    window.invoiceScanner = { findExisting };
})();