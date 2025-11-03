// Exposed initializer, called by manual.js after the HTML is injected
window.__CreateUserMount = function initCreateUserScreen({ apiBase, onDone }) {
    const $ = (id) => document.getElementById(id);

    // DOM
    const backBtn = $('cuBackBtn');
    const attemptBtn = $('cuAttemptBtn');
    const saveBtn = $('cuSaveBtn');
    const status  = $('cuStatus');

    const caseUrl = $('cuCaseUrl');
    const caseUrlHelp = $('cuCaseUrlHelp');
    const parsedEl = $('cuParsed');

    const first = $('cuFirst');
    const last  = $('cuLast');
    const address = $('cuAddress');
    const apt     = $('cuApt');
    const city    = $('cuCity');
    const state   = $('cuState');
    const zip     = $('cuZip');
    const phone   = $('cuPhone');
    const email   = $('cuEmail');
    const county  = $('cuCounty');
    const dislikes = $('cuDislikes');

    const medicaid = $('cuMedicaid');
    const paused   = $('cuPaused');
    const complex  = $('cuComplex');
    const bill     = $('cuBill');
    const delivery = $('cuDelivery');

    const schedWrap = $('cuSchedule');

    const btnAuto = $('cuBtnAuto');
    const btnSugg = $('cuBtnSugg');
    const busy    = $('cuBusy');
    const geoMsg  = $('cuGeoMsg');
    const geoErr  = $('cuGeoErr');
    const candsBox= $('cuCands');

    const DAYS = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];

    let lat = null, lng = null;

    // ---------- UI helpers ----------
    function setStatus(msg, tone='') {
        status.textContent = msg || '';
        status.style.color = tone === 'error' ? '#fca5a5'
            : tone === 'success' ? '#86efac' : '#9ca3af';
    }
    function show(b, el) { el.style.display = b ? '' : 'none'; }
    function enableSave(b) {
        // disable until both case URL valid AND geocoded coords present
        saveBtn.disabled = !b;
        saveBtn.style.opacity = b ? '1' : '0.6';
        saveBtn.style.cursor = b ? 'pointer' : 'not-allowed';
    }

    function parseUniteUsUrl(urlStr) {
        try {
            const u = new URL(String(urlStr));
            const path = u.pathname.replace(/\/+$/, "");
            const m = /\/cases\/open\/([0-9a-fA-F-]{10,})\/contact\/([0-9a-fA-F-]{10,})/.exec(path);
            if (!m) return null;
            const [, caseId, clientId] = m;
            return { caseId, clientId };
        } catch { return null; }
    }
    function streetQueryNoUnit({ address, city, state, zip }) {
        return [address, city, state, zip].filter(Boolean).join(", ");
    }

    // ---------- Build schedule (all true by default) ----------
    function buildSchedule() {
        schedWrap.innerHTML = '';
        DAYS.forEach(d => {
            const id = `cuDay_${d}`;
            const label = document.createElement('label');
            label.style.display = 'inline-flex';
            label.style.alignItems = 'center';
            label.style.gap = '6px';

            const inp = document.createElement('input');
            inp.type = 'checkbox';
            inp.id = id;
            inp.checked = true;
            inp.addEventListener('change', () => {}); // reserve if you want state tracking

            label.appendChild(inp);
            label.appendChild(document.createTextNode(d.slice(0,3).toUpperCase()));
            schedWrap.appendChild(label);
        });
    }
    buildSchedule();

    // ---------- Validation + Save button gating ----------
    function updateCaseUrlUI() {
        const url = caseUrl.value.trim();
        const parsed = url ? parseUniteUsUrl(url) : null;
        if (!url) {
            caseUrlHelp.textContent = 'Case URL is required';
            caseUrlHelp.style.color = '#fca5a5';
            parsedEl.textContent = '';
            show(false, parsedEl);
            return false;
        }
        if (!parsed) {
            caseUrlHelp.textContent = 'Must match /cases/open/{caseId}/contact/{clientId}';
            caseUrlHelp.style.color = '#fca5a5';
            parsedEl.textContent = '';
            show(false, parsedEl);
            return false;
        }
        caseUrlHelp.textContent = 'Looks good';
        caseUrlHelp.style.color = '#86efac';
        parsedEl.textContent = `Parsed ✓ Case ID: ${parsed.caseId} | Client ID: ${parsed.clientId}`;
        show(true, parsedEl);
        return true;
    }
    function isGeocoded() {
        return Number.isFinite(lat) && Number.isFinite(lng);
    }
    function gateSave() {
        enableSave(updateCaseUrlUI() && isGeocoded());
    }
    caseUrl.addEventListener('input', () => { updateCaseUrlUI(); gateSave(); });

    // ---------- Chrome helpers ----------
    async function getActiveTab() {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) throw new Error('No active tab');
        return tab;
    }
    async function execOnPage(fn, args = []) {
        const tab = await getActiveTab();
        const [{ result } = {}] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: fn,
            args
        });
        return result;
    }

    // ---------- Attempt Auto (from page) ----------
    attemptBtn.addEventListener('click', async () => {
        setStatus('Reading page…');
        try {
            const scraped = await execOnPage(() => {
                const out = {};

                // URL (for case URL)
                out.url = location.href || '';

                // Name
                const nameEl = document.querySelector('.contact-column h3.contact-column__name');
                if (nameEl) out.name = nameEl.textContent.trim();

                // Phone (first one)
                const phoneEl = document.querySelector('.ui-contact-information__compact-phone [data-test-element^="phone-numbers_number_"]');
                if (phoneEl) out.phone = phoneEl.textContent.trim();

                // Email (first mailto)
                const emailEl = document.querySelector('.email a[href^="mailto:"]');
                if (emailEl) out.email = (emailEl.getAttribute('title') || emailEl.textContent || '').trim();

                // Address pieces
                const addrRoot = document.querySelector('.address .address__details');
                if (addrRoot) {
                    const ps = Array.from(addrRoot.querySelectorAll('p'));
                    // Typical structure from snippet:
                    // p[0] = "Primary" (italic)
                    // p[1] = street line (e.g., "62 SUZANNE DR APT 214")
                    // p[2] = "<span>CITY, <abbr>STATE</abbr></span> ZIP"
                    // p[3] = county line with class "county"
                    if (ps[1]) out.street = ps[1].textContent.trim();
                    if (ps[2]) {
                        const citySpan = ps[2].querySelector('span');
                        if (citySpan) {
                            const abbr = citySpan.querySelector('abbr');
                            const cityText = citySpan.childNodes[0]?.textContent || '';
                            out.city = cityText.replace(/,\s*$/,'').trim();
                            if (abbr) out.state = abbr.textContent.trim();
                        }
                        const zipText = ps[2].textContent.replace(/\s+/g,' ').trim();
                        const zipMatch = zipText.match(/\b\d{5}(-\d{4})?\b/);
                        if (zipMatch) out.zip = zipMatch[0];
                    }
                    const countyEl = addrRoot.querySelector('.county');
                    if (countyEl) out.county = countyEl.textContent.trim().replace(/ County$/i,'');
                }

                return out;
            });

            // Case URL → set and validate
            if (scraped?.url) {
                caseUrl.value = scraped.url;
                updateCaseUrlUI();
            }

            // Name split
            if (scraped?.name) {
                const parts = scraped.name.trim().split(/\s+/);
                if (parts.length >= 2) {
                    last.value = parts.pop();
                    first.value = parts.join(' ');
                } else {
                    first.value = scraped.name.trim();
                }
            }

            if (scraped?.phone) phone.value = scraped.phone;
            if (scraped?.email) email.value = scraped.email;
            if (scraped?.street) {
                // Try to split apt if present at end like "APT 214"
                address.value = scraped.street;
                const aptMatch = scraped.street.match(/\bAPT\.?\s+([A-Z0-9-]+)$/i);
                if (aptMatch) {
                    apt.value = aptMatch[1];
                    address.value = scraped.street.replace(/\s*APT\.?\s+[A-Z0-9-]+$/i,'').trim();
                }
            }
            if (scraped?.city)  city.value  = scraped.city;
            if (scraped?.state) state.value = scraped.state;
            if (scraped?.zip)   zip.value   = scraped.zip;
            if (scraped?.county) county.value = scraped.county;

            setStatus('Page read ✓', 'success');

            // If we have enough address info, auto geocode
            const hasAddr = (address.value || '').trim() && (city.value || '').trim() && (state.value || '').trim();
            if (hasAddr) {
                await geocodeAuto(); // sets lat/lng and gates the button
            } else {
                gateSave();
            }
        } catch (e) {
            setStatus(`Auto-read failed: ${e?.message || e}`, 'error');
            gateSave();
        }
    });

    // ---------- Geocode actions ----------
    async function geocodeAuto() {
        geoErr.textContent = '';
        show(false, geoErr);
        show(true, busy);
        show(false, candsBox);
        show(false, geoMsg);

        const q = streetQueryNoUnit({ address: address.value, city: city.value, state: state.value, zip: zip.value });
        try {
            const r = await fetch(`${apiBase}/api/geocode/search?q=${encodeURIComponent(q)}&limit=1`, { cache: 'no-store' });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const data = await r.json();
            const item = Array.isArray(data?.items) && data.items[0];
            if (!item) throw new Error('Not found');
            lat = Number(item.lat); lng = Number(item.lng);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('Invalid coords');
            geoMsg.textContent = `✓ Geocoded: ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
            show(true, geoMsg);
            gateSave();
        } catch (e) {
            geoErr.textContent = 'Address not found. Try suggestions.';
            show(true, geoErr);
            gateSave();
        } finally {
            show(false, busy);
        }
    }

    async function geocodeSuggestions() {
        geoErr.textContent = '';
        show(false, geoErr);
        show(true, busy);
        show(false, geoMsg);
        candsBox.innerHTML = '';

        const q = streetQueryNoUnit({ address: address.value, city: city.value, state: state.value, zip: zip.value });
        try {
            const r = await fetch(`${apiBase}/api/geocode/search?q=${encodeURIComponent(q)}&limit=8`, { cache: 'no-store' });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const data = await r.json();
            const items = Array.isArray(data?.items) ? data.items : [];
            if (!items.length) {
                candsBox.innerHTML = `<div style="padding:8px; font-size:12px; color:#9ca3af;">No suggestions found.</div>`;
            } else {
                const frag = document.createDocumentFragment();
                items.forEach((it) => {
                    const row = document.createElement('div');
                    row.style.padding = '8px';
                    row.style.borderBottom = '1px dashed #334155';
                    row.style.cursor = 'pointer';
                    row.textContent = `${it.label} — ${Number(it.lat).toFixed(5)}, ${Number(it.lng).toFixed(5)} (${it.provider})`;
                    row.addEventListener('click', () => {
                        lat = Number(it.lat); lng = Number(it.lng);
                        candsBox.innerHTML = '';
                        geoMsg.textContent = `✓ Selected: ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
                        show(true, geoMsg);
                        show(false, candsBox);
                        gateSave();
                    });
                    frag.appendChild(row);
                });
                candsBox.appendChild(frag);
            }
            show(true, candsBox);
        } catch (e) {
            geoErr.textContent = 'Failed to load suggestions.';
            show(true, geoErr);
        } finally {
            show(false, busy);
        }
    }

    btnAuto.addEventListener('click', geocodeAuto);
    btnSugg.addEventListener('click', geocodeSuggestions);

    // ---------- Save (Create) ----------
    async function onSave() {
        setStatus('');
        const url = caseUrl.value.trim();
        const parsed = parseUniteUsUrl(url);
        if (!url) { setStatus('Enter the Unite Us Case URL', 'error'); return; }
        if (!parsed?.caseId || !parsed?.clientId) { setStatus('Case URL invalid', 'error'); return; }
        if (!(Number.isFinite(lat) && Number.isFinite(lng))) {
            setStatus('Please geocode the address first', 'error'); return;
        }

        // Build schedule payload
        const schedule = {};
        DAYS.forEach(d => {
            const cb = document.getElementById(`cuDay_${d}`);
            schedule[d] = !!cb?.checked;
        });

        const payload = {
            first: first.value || "",
            last:  last.value || "",
            address: address.value || "",
            apt: apt.value || "",
            city: city.value || "",
            county: county.value || "",
            state: state.value || "",
            zip: zip.value || "",
            phone: phone.value || "",
            dislikes: dislikes.value || "",
            medicaid: !!medicaid.checked,
            paused:   !!paused.checked,
            complex:  !!complex.checked,
            bill:     !!bill.checked,
            delivery: !!delivery.checked,
            schedule,
            lat, lng,
            caseId: parsed.caseId,
            clientId: parsed.clientId
        };

        // (Email currently not stored server-side; included here if you later add a column)
        // payload.email = email.value || "";

        saveBtn.disabled = true;
        backBtn.disabled = true;
        attemptBtn.disabled = true;
        setStatus('Saving…');

        try {
            const r = await fetch(`${apiBase}/api/users`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!r.ok) throw new Error(await r.text().catch(() => `HTTP ${r.status}`));
            setStatus('Created ✓', 'success');

            // tiny delay so user sees the success
            setTimeout(() => { onDone?.(); }, 600);
        } catch (e) {
            setStatus(e?.message || 'Save failed', 'error');
            saveBtn.disabled = false;
            backBtn.disabled = false;
            attemptBtn.disabled = false;
            gateSave();
        }
    }

    saveBtn.addEventListener('click', onSave);
    backBtn.addEventListener('click', () => onDone?.());

    // Initial gate
    gateSave();
};