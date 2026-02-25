const termEl = document.getElementById('terminal');
const queueBody = document.getElementById('queue-body');
const statusBadge = document.getElementById('connection-status');
const filterStatusEl = document.getElementById('filter-status');

/** Full request list (unfiltered). Updated on each queue event. */
let allRequests = [];

/** Set of indices in allRequests that are selected for "Run current queue". */
let selectedIndices = new Set();

// Connect to SSE
const evtSource = new EventSource('/events');

evtSource.onopen = () => {
    statusBadge.textContent = 'Connected';
    statusBadge.className = 'badge connected';
    log('System connected to server.');
};

evtSource.onerror = () => {
    statusBadge.textContent = 'Disconnected';
    statusBadge.className = 'badge disconnected';
};

// Handle Log Events
evtSource.addEventListener('log', (e) => {
    const data = JSON.parse(e.data);
    log(data.message, data.type);
});

// Handle Queue Updates (Full Refresh)
evtSource.addEventListener('queue', (e) => {
    const requests = JSON.parse(e.data);
    allRequests = requests;
    syncFilterOptions(requests);
    applyFilterAndRender();
    updateStats(requests);
});

// Handle Status Updates (for showing/hiding stop button)
evtSource.addEventListener('status', (e) => {
    const data = JSON.parse(e.data);
    const stopBtn = document.getElementById('btn-stop');
    if (stopBtn) {
        if (data.isRunning) {
            stopBtn.style.display = 'inline-block';
        } else {
            stopBtn.style.display = 'none';
        }
    }
});

filterStatusEl.addEventListener('change', () => applyFilterAndRender());

document.getElementById('select-all').addEventListener('change', function () {
    const checked = this.checked;
    const status = (filterStatusEl.value || '').trim();
    const norm = (s) => (s != null && String(s).trim() !== '' ? String(s).trim() : 'pending');
    const filtered = status ? allRequests.filter(r => norm(r.status) === status) : allRequests;
    filtered.forEach(req => {
        const idx = allRequests.findIndex(r => r === req);
        if (idx !== -1) {
            if (checked) selectedIndices.add(idx); else selectedIndices.delete(idx);
        }
    });
    applyFilterAndRender();
    updateTotalAmount();
});

function getOrderCount(req) {
    const ids = req.orderIds;
    if (Array.isArray(ids) && ids.length > 0) return ids.length;
    if (req.orderNumber != null && req.orderNumber !== '') return 1;
    return 1;
}

function getAmountNum(req) {
    const n = Number(req.amount);
    return Number.isFinite(n) ? n : 0;
}

function runCurrentQueue() {
    const toRun = selectedIndices.size > 0
        ? allRequests.filter((_, i) => selectedIndices.has(i))
        : allRequests;
    if (toRun.length === 0) {
        log('No requests to run. Load from server or select items.', 'error');
        return;
    }
    log(`Sending ${toRun.length} request(s) to run (current queue)...`, 'info');
    fetch('/process-billing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'queue', requests: toRun })
    })
        .then(r => {
            if (!r.ok) {
                return r.json().then(data => { throw new Error(data.error || r.statusText); });
            }
            return r.json();
        })
        .then(d => {
            log(`Started: ${d.message || 'OK'} (${toRun.length} items)`, 'success');
        })
        .catch(e => {
            log(`Error: ${e.message}`, 'error');
        });
}

function triggerProcess(source = 'file') {
    log(`Sending request to start automation (Source: ${source})...`, 'info');

    // Switch to POST to carry body data nicely
    fetch('/process-billing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            source
        })
    })
        .then(r => {
            console.log('[Client] Response status:', r.status, r.statusText);
            if (!r.ok) {
                return r.json().then(data => {
                    console.error('[Client] Error response:', data);
                    throw new Error(data.error || `HTTP ${r.status}: ${r.statusText}`);
                });
            }
            return r.json();
        })
        .then(d => {
            console.log('[Client] Success response:', d);
            if (d.error) {
                log(`Error: ${d.error}`, 'error');
            } else {
                const msg = d.source === 'file' ? `Triggered: ${d.count || 0} requests [File Mode]` : 'Automation started [TSS API Mode]';
                log(msg, 'success');
            }
        })
        .catch(e => {
            console.error('[Client] Fetch error:', e);
            log(`Error triggering: ${e.message || e}`, 'error');
        });
}

function downloadCloudRequests() {
    log('Fetching pending requests from TSS API (Preview)...', 'info');
    document.getElementById('queue-body').innerHTML = ''; // Clear previous

    fetch('/fetch-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
    })
        .then(r => r.json())
        .then(d => {
            if (d.error) {
                log(`Fetch Error: ${d.error}`, 'error');
            } else {
                log(`Fetched ${d.count} requests from TSS API.`, 'success');
            }
        })
        .catch(e => {
            log(`Fetch Failed: ${e.message}`, 'error');
        });
}

function stopProcess() {
    log('Sending stop signal to server...', 'info');
    
    fetch('/stop-billing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    })
        .then(r => r.json())
        .then(d => {
            if (d.error) {
                log(`Stop Error: ${d.error}`, 'error');
            } else {
                log(`Stop signal sent: ${d.message}`, 'warning');
            }
        })
        .catch(e => {
            log(`Stop Failed: ${e.message}`, 'error');
        });
}

function log(msg, type = 'info') {
    const div = document.createElement('div');
    div.className = `line ${type}`;
    div.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    termEl.appendChild(div);
    termEl.scrollTop = termEl.scrollHeight;
}

/**
 * Build filter options from every distinct status in the data.
 * No preset list – only statuses that appear in requests (worker, API, or file).
 */
function syncFilterOptions(requests) {
    const seen = new Set();
    for (const r of requests) {
        const s = r.status != null && String(r.status).trim() !== '' ? String(r.status).trim() : 'pending';
        seen.add(s);
    }
    const statuses = [...seen].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    const current = filterStatusEl.value;
    filterStatusEl.innerHTML = '<option value="">All</option>';
    for (const s of statuses) {
        const opt = document.createElement('option');
        opt.value = s;
        opt.textContent = s;
        if (s === current) opt.selected = true;
        filterStatusEl.appendChild(opt);
    }
    const currentNorm = current.trim().toLowerCase();
    const exists = statuses.some(z => z.trim().toLowerCase() === currentNorm);
    if (!exists && current !== '') filterStatusEl.value = '';
}

function applyFilterAndRender() {
    const status = (filterStatusEl.value || '').trim();
    const norm = (s) => (s != null && String(s).trim() !== '' ? String(s).trim() : 'pending');
    const filtered = status
        ? allRequests.filter(r => norm(r.status) === status)
        : allRequests;
    renderQueue(filtered);
}

function statusToClass(s) {
    const v = (s || 'pending').toLowerCase();
    const map = { pending: 'status-pending', processing: 'status-processing', success: 'status-success', failed: 'status-failed', skipped: 'status-skipped', warning: 'status-warning' };
    return map[v] || 'status-other';
}

function renderQueue(requests) {
    queueBody.innerHTML = '';
    requests.forEach(req => {
        const idx = allRequests.findIndex(r => r === req);
        const isSelected = idx !== -1 && selectedIndices.has(idx);
        const status = req.status || 'pending';
        const statusClass = statusToClass(req.status);
        const orderCount = getOrderCount(req);
        const amount = getAmountNum(req);
        const amountStr = amount > 0 ? '$' + amount.toFixed(2) : '-';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="col-select"><input type="checkbox" class="row-select" data-index="${idx}" ${isSelected ? 'checked' : ''} aria-label="Select row"></td>
            <td>${escapeHtml(req.name)}</td>
            <td class="col-orders">${orderCount}</td>
            <td class="col-amount">${amountStr}</td>
            <td>${req.start ? `${escapeHtml(req.start)} → ${escapeHtml(req.end)}` : (req.date ? escapeHtml(req.date) : '-')}</td>
            <td><span class="status-badge ${statusClass}">${escapeHtml(status)}</span></td>
            <td style="font-size:0.85em; color:#ccc">${escapeHtml(req.message || '-')}</td>
        `;
        const cb = tr.querySelector('.row-select');
        cb.addEventListener('change', function () {
            const i = parseInt(this.getAttribute('data-index'), 10);
            if (!Number.isFinite(i) || i < 0) return;
            if (this.checked) selectedIndices.add(i); else selectedIndices.delete(i);
            updateTotalAmount();
            updateSelectAllState();
        });
        queueBody.appendChild(tr);
    });
    updateSelectAllState();
}

function escapeHtml(s) {
    if (s == null) return '';
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
}

function updateSelectAllState() {
    const status = (filterStatusEl.value || '').trim();
    const norm = (s) => (s != null && String(s).trim() !== '' ? String(s).trim() : 'pending');
    const filtered = status ? allRequests.filter(r => norm(r.status) === status) : allRequests;
    if (filtered.length === 0) {
        document.getElementById('select-all').checked = false;
        document.getElementById('select-all').indeterminate = false;
        return;
    }
    const selectedVisible = filtered.filter(req => {
        const idx = allRequests.findIndex(r => r === req);
        return idx !== -1 && selectedIndices.has(idx);
    });
    const selectAllEl = document.getElementById('select-all');
    selectAllEl.checked = selectedVisible.length === filtered.length;
    selectAllEl.indeterminate = selectedVisible.length > 0 && selectedVisible.length < filtered.length;
}

function updateTotalAmount() {
    const toSum = selectedIndices.size > 0
        ? allRequests.filter((_, i) => selectedIndices.has(i))
        : allRequests;
    const total = toSum.reduce((acc, r) => acc + getAmountNum(r), 0);
    document.getElementById('total-amount').textContent = '$' + total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    document.getElementById('total-amount-hint').textContent = selectedIndices.size > 0
        ? `(${selectedIndices.size} selected)`
        : (allRequests.length ? `(${allRequests.length} items)` : '(selected / visible)');
}

function updateStats(requests) {
    document.getElementById('stat-total').textContent = requests.length;
    document.getElementById('stat-pending').textContent = requests.filter(r => !r.status || r.status === 'pending').length;
    document.getElementById('stat-success').textContent = requests.filter(r => r.status === 'success').length;
    document.getElementById('stat-failed').textContent = requests.filter(r => r.status === 'failed').length;
    updateTotalAmount();
}
