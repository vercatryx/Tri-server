// modules/uploadPDF.js
// Provides window.pdfUploader with:
//   - openModal()
//   - attachBytes(bytes, filename)
//   - uploadTest()  // uses background FETCH_FILE_BYTES for a public PDF

(function () {
    if (window.pdfUploader) {
        console.log("[uploadPDF] Already loaded, skipping re-initialization");
        return;
    }

    const log = (...a) => { try { console.log("[uploadPDF]", ...a); } catch {} };
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    // Guard against double uploads
    let uploadInProgress = false;

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
        // Click the billing details "Attach Document" button
        // This button appears in the invoice details entry shelf after billing details are filled
        let btn = document.querySelector('.payments-attachment-button');

        // Try by partial ID match if class selector fails
        if (!btn) {
            const buttons = document.querySelectorAll('button[id^="payments-attachment-button"]');
            if (buttons.length > 0) {
                // Find visible button with "Attach Document" text
                btn = Array.from(buttons).find(b => {
                    const text = (b.textContent || '').trim();
                    return text.includes('Attach Document') && b.offsetParent !== null;
                });
            }
        }

        if (btn) {
            log("Clicking 'Attach Document' button in billing details shelf");
            btn.click();
            await sleep(300); // Wait for dialog to render
            return true;
        }

        log("Attach Document button not found; assuming dialog already open");
        return false;
    }

    function ensurePdfName(name) {
        if (!name || typeof name !== 'string') return 'upload.pdf';
        if (!/\.pdf$/i.test(name)) return name + '.pdf';
        return name;
    }

    async function attachBytes(rawBytes, filename) {
        // Guard against concurrent uploads
        if (uploadInProgress) {
            log("⚠ Upload already in progress, skipping duplicate call");
            return { ok: false, error: "Upload already in progress" };
        }

        uploadInProgress = true;
        try {
            return await attachBytesImpl(rawBytes, filename);
        } finally {
            uploadInProgress = false;
        }
    }

    async function attachBytesImpl(rawBytes, filename) {
        // Accept Uint8Array OR Array<number>
        const u8 = rawBytes instanceof Uint8Array ? rawBytes : new Uint8Array(rawBytes);

        // Try to find any upload dialog that's currently open
        let modal = null;

        // Method 1: Look for .dialog-paper with "Attach Documents" title
        try {
            log("Looking for .dialog-paper...");
            const dialogs = document.querySelectorAll('.dialog-paper');
            log(`Found ${dialogs.length} .dialog-paper elements`);

            for (const dialog of dialogs) {
                const title = dialog.querySelector('.title');
                log(`Dialog title: "${title?.textContent}"`);
                if (title && title.textContent.includes('Attach Document')) {
                    modal = dialog;
                    log("✓ Found 'Attach Documents' dialog");
                    break;
                }
            }
        } catch (e) {
            log("Error searching for dialog:", e);
        }

        // Method 2: Look for any visible file upload dialog
        if (!modal) {
            log("Trying alternative: looking for file-upload-dropzone...");
            const dropzones = document.querySelectorAll('.file-upload-dropzone');
            log(`Found ${dropzones.length} dropzone elements`);

            for (const dz of dropzones) {
                const parent = dz.closest('.dialog-paper') || dz.closest('[role="dialog"]') || dz.closest('.dialog');
                if (parent && parent.offsetParent !== null) {
                    modal = parent;
                    log("✓ Found dialog via dropzone");
                    break;
                }
            }
        }

        if (!modal) {
            log("✗ No dialog found");
            throw new Error("No upload dialog found. Make sure the 'Attach Document' dialog is open.");
        }

        const input =
            modal.querySelector('input[type="file"][data-testid="file-upload-input"]') ||
            modal.querySelector('input[type="file"]');
        if (!input) throw new Error("Hidden file input not found");

        const dropzone =
            modal.querySelector('.file-upload-dropzone') ||
            modal.querySelector('[data-testid*="drop"]') ||
            modal.querySelector('[class*="dropzone"]');

        // Find submit button for the billing dialog
        let submitBtn =
            modal.querySelector('.attach-document-dialog__actions--save') ||
            modal.querySelector('button[aria-label="Attach"]');

        const pdfName = ensurePdfName(filename);
        const blob = new Blob([u8], { type: 'application/pdf' });
        const file = new File([blob], pdfName, { type: 'application/pdf', lastModified: Date.now() });

        log(`Created file: ${pdfName}, size: ${file.size} bytes`);

        // Create DataTransfer with file
        const dt = new DataTransfer();
        dt.items.add(file);

        // Method 1: Set input.files directly using native setter
        try {
            const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files');
            if (desc && desc.set) {
                desc.set.call(input, dt.files);
                log("Set files via native setter");
            } else {
                input.files = dt.files;
                log("Set files via direct assignment");
            }
        } catch (e) {
            log("Warning: Could not set input.files", e);
        }

        // Method 2: Simulate drag and drop on dropzone
        if (dropzone) {
            log("Simulating drag and drop on dropzone...");
            const dt2 = new DataTransfer();
            dt2.items.add(file);

            const dropEvent = new DragEvent('drop', {
                bubbles: true,
                cancelable: true,
                composed: true,
                dataTransfer: dt2
            });

            dropzone.dispatchEvent(dropEvent);
            log("Drop event dispatched on dropzone");
        }

        // Method 3: Fire change event on input (single event only)
        log("Firing change event...");
        input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

        await sleep(500); // Wait longer for UI to process

        // Wait for button to become enabled (dialog starts with disabled button)
        log("Waiting for submit button to become enabled...");
        log(`Submit button initial state: disabled=${submitBtn?.disabled}, aria-disabled=${submitBtn?.getAttribute('aria-disabled')}`);

        for (let i = 0; i < 30; i++) {
            if (submitBtn && !submitBtn.disabled && submitBtn.getAttribute('aria-disabled') !== 'true') {
                log(`✓ Submit button enabled after ${i * 100}ms`);
                break;
            }
            await sleep(100);
        }

        // Final check and click
        const isEnabled = submitBtn && !submitBtn.disabled && submitBtn.getAttribute('aria-disabled') !== 'true';
        log(`Submit button final state: disabled=${submitBtn?.disabled}, aria-disabled=${submitBtn?.getAttribute('aria-disabled')}, isEnabled=${isEnabled}`);

        if (isEnabled) {
            log("✓ Clicking submit button");
            submitBtn.click();
            await sleep(500); // Wait for upload to process
        } else {
            log("✗ Submit button still not enabled");
            // Try to find if there's a preview or file listed
            const fileList = modal.querySelector('.file-upload-dropzone__preview');
            if (fileList) {
                log("Dropzone preview content:", fileList.textContent);
            }
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