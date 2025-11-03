// modules/uploadPDF.js
// Provides window.pdfUploader with:
//   - openModal()
//   - attachBytes(bytes, filename)
//   - uploadTest()  // uses background FETCH_FILE_BYTES for a public PDF

(function () {
    if (window.pdfUploader) return;

    const log = (...a) => { try { console.log("[uploadPDF]", ...a); } catch {} };
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    async function waitFor(sel, root = document, timeout = 6000) {
        const hit = root.querySelector(sel);
        if (hit) return hit;
        return await new Promise((resolve, reject) => {
            const obs = new MutationObserver(() => {
                const el = root.querySelector(sel);
                if (el) { obs.disconnect(); resolve(el); }
            });
            obs.observe(document.documentElement, { childList: true, subtree: true });
            setTimeout(() => { obs.disconnect(); reject(new Error(`Timeout waiting for ${sel}`)); }, timeout);
        });
    }

    async function openModal() {
        // Primary button
        let btn = document.querySelector('#upload-document-link');
        // Fallback XPath
        if (!btn) {
            try {
                const xp = "/html/body/div[2]/div[2]/main/div/section/div/div[2]/div/div[1]/div[1]/div[2]/div[4]/div/div/div[2]/button";
                btn = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
            } catch {}
        }
        if (btn) {
            btn.click();
            log("Clicked 'Attach a document'");
            await sleep(200); // 0.2s for modal to render
            return true;
        }
        log("Attach button not found; assuming modal already open");
        return false;
    }

    function ensurePdfName(name) {
        if (!name || typeof name !== 'string') return 'upload.pdf';
        if (!/\.pdf$/i.test(name)) return name + '.pdf';
        return name;
    }

    async function attachBytes(rawBytes, filename) {
        // Accept Uint8Array OR Array<number>
        const u8 = rawBytes instanceof Uint8Array ? rawBytes : new Uint8Array(rawBytes);

        const modal = await waitFor('#upload-document-modal.dialog.open');
        const input =
            modal.querySelector('input[type="file"][data-testid="file-upload-input"]') ||
            modal.querySelector('input[type="file"]');
        if (!input) throw new Error("Hidden file input not found");

        const dropzone =
            modal.querySelector('.file-upload-dropzone') ||
            modal.querySelector('[data-testid*="drop"]') ||
            modal.querySelector('[class*="dropzone"]');

        const submitBtn = modal.querySelector('#upload-submit-btn');

        const pdfName = ensurePdfName(filename);
        const blob = new Blob([u8], { type: 'application/pdf' });
        const file = new File([blob], pdfName, { type: 'application/pdf', lastModified: Date.now() });

        // Assign to input.files (use native setter if patched)
        const dt = new DataTransfer();
        dt.items.add(file);
        const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files');
        if (desc && desc.set) desc.set.call(input, dt.files);
        else input.files = dt.files;

        input.dispatchEvent(new Event('input',  { bubbles: true, composed: true }));
        input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

        // Also synthesize drop (harmless if uploader ignores it)
        if (dropzone) {
            const dt2 = new DataTransfer();
            dt2.items.add(file);
            const mkEvt = (t) => new DragEvent(t, { bubbles: true, cancelable: true, composed: true, dataTransfer: dt2 });
            dropzone.dispatchEvent(mkEvt('dragenter'));
            dropzone.dispatchEvent(mkEvt('dragover'));
            dropzone.dispatchEvent(mkEvt('drop'));
        }

        await sleep(150);
        if (submitBtn && !submitBtn.disabled && submitBtn.getAttribute('aria-disabled') !== 'true') {
            submitBtn.click();
        }

        return { ok: true, name: file.name, size: file.size };
    }

    async function uploadTest() {
        const url = 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf';
        const resp = await chrome.runtime.sendMessage({ type: 'FETCH_FILE_BYTES', url, filename: 'dummy.pdf' });
        if (!resp?.ok) throw new Error(resp?.error || 'fetch failed');

        await openModal();
        return await attachBytes(resp.bytes, resp.filename || resp.name || 'dummy.pdf');
    }

    window.pdfUploader = { openModal, attachBytes, uploadTest };
    log("window.pdfUploader ready");
})();