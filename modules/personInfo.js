// content/utils/personInfo.js
(function attachPersonInfo() {
    if (window.personInfo) return;

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    const SEEN = new WeakSet();
    function* deepWalk(root) {
        if (!root || SEEN.has(root)) return;
        SEEN.add(root);
        yield root;

        if (root.shadowRoot) yield* deepWalk(root.shadowRoot);

        if (root instanceof Document || root instanceof ShadowRoot) {
            for (const el of root.querySelectorAll("*")) yield* deepWalk(el);
            return;
        }
        for (const c of root.children || []) yield* deepWalk(c);

        if (root.tagName === "IFRAME") {
            try {
                const doc = root.contentDocument;
                if (doc) yield* deepWalk(doc);
            } catch {}
        }
    }

    function queryDeepFirst(selector, root = document, maxNodes = 6000) {
        let n = 0;
        for (const node of deepWalk(root)) {
            if (++n > maxNodes) break;
            try {
                const host = (node instanceof Document || node instanceof ShadowRoot) ? node : node;
                const match = host?.querySelector?.(selector);
                if (match) return match;
            } catch {}
        }
        return null;
    }

    function norm(s) { return String(s || "").trim(); }
    function digits(s) { return String(s || "").replace(/\D+/g, ""); }

    function parseName(root) {
        const h = root.querySelector(".contact-column__name") || queryDeepFirst(".contact-column__name");
        const txt = norm(h?.textContent);
        return txt || null;
    }

    function parsePhone(root) {
        const span = root.querySelector("[data-test-element='phone-numbers_number_0']") ||
            queryDeepFirst("[data-test-element='phone-numbers_number_0']");
        let raw = norm(span?.textContent);
        if (!raw) {
            const a = root.querySelector(".ui-contact-information__compact-phone a[href^='tel:']") ||
                queryDeepFirst(".ui-contact-information__compact-phone a[href^='tel:']");
            raw = norm(a?.textContent || a?.getAttribute?.("href")?.replace(/^tel:/, ""));
        }
        const d = digits(raw);
        if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
        if (d.length === 11 && d.startsWith("1")) return `(${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`;
        return raw || null;
    }

    function parseAddress(root) {
        const details = root.querySelector(".address .address__details") || queryDeepFirst(".address .address__details");
        if (details) {
            const ps = Array.from(details.querySelectorAll("p")).map(p => norm(p.textContent)).filter(Boolean);
            const filtered = ps.filter(line => !/^primary$/i.test(line) && !/county$/i.test(line));
            const addr = filtered.join(", ").replace(/\s{2,}/g, " ").replace(/\s,/, ",");
            return addr || null;
        }
        const addrEl = root.querySelector(".address") || queryDeepFirst(".address");
        const txt = norm(addrEl?.textContent).replace(/\s{2,}/g, " ");
        return txt || null;
    }

    async function readOnce() {
        const root = document.querySelector(".contact-column") ||
            queryDeepFirst(".contact-column") ||
            document;
        const name = parseName(root);
        const phone = parsePhone(root);
        const address = parseAddress(root);
        return { name: name || "", phone: phone || "", address: address || "" };
    }

    async function waitDomReady(limitMs = 4000) {
        const t0 = Date.now();
        while (Date.now() - t0 < limitMs) {
            if (document.readyState === "interactive" || document.readyState === "complete") return true;
            await sleep(120);
        }
        return true;
    }

    async function getPerson({ retries = 3, delayMs = 220 } = {}) {
        await waitDomReady();
        let last = { name: "", phone: "", address: "" };
        for (let i = 0; i < retries; i++) {
            const cur = await readOnce();
            last = cur;
            if (cur.name || cur.phone || cur.address) {
                return { ok: true, person: cur };
            }
            await sleep(delayMs * (i + 1));
        }
        return { ok: true, person: last };
    }

    window.personInfo = { getPerson };
})();