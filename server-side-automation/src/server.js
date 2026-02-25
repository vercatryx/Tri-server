const express = require('express');
const fs = require('fs');
const path = require('path');
const { launchBrowser, closeBrowser } = require('./core/browser');
const { performLoginSequence } = require('./core/auth');
const { billingWorker, fetchRequestsFromApi, fetchRequestsFromTSS } = require('./core/billingWorker');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3500;

// Allow large queue payloads when running "Run current queue" with many items (default is 100kb)
app.use(express.json({ limit: '10mb' }));
// Serve static frontend
app.use(express.static(path.join(__dirname, '../public')));

// -- SSE Setup --
let clients = [];

function eventsHandler(req, res) {
    const headers = {
        'Content-Type': 'text/event-stream',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache'
    };
    res.writeHead(200, headers);

    const clientId = Date.now();
    const newClient = { id: clientId, res };
    clients.push(newClient);

    // Send initial queue state if exists
    if (currentRequests) {
        res.write(`event: queue\ndata: ${JSON.stringify(currentRequests)}\n\n`);
    }

    req.on('close', () => {
        clients = clients.filter(c => c.id !== clientId);
    });
}

function broadcast(type, data) {
    clients.forEach(client => {
        client.res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    });
}

app.get('/events', eventsHandler);

// Billing UI (same as index) – ensure reachable at /billing (e.g. localhost:3000/billing)
app.get('/billing', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// State
let isRunning = false;
let currentRequests = null;
let shouldStop = false;
let stopBillingWorker = null;

// Routes
app.post('/fetch-requests', async (req, res) => {
    try {
        console.log('[Server] Fetching requests from TSS API (Preview Mode)...');
        const requests = await fetchRequestsFromTSS();

        if (!requests || requests.length === 0) {
            return res.json({ success: true, count: 0, message: 'No pending requests found.' });
        }

        // Initialize status
        requests.forEach(r => { r.status = 'pending'; r.message = ''; });
        currentRequests = requests;
        broadcast('queue', currentRequests);

        res.json({ success: true, count: requests.length, message: `Loaded ${requests.length} requests.` });
    } catch (e) {
        console.error('[Server] Fetch Preview Error:', e);
        res.status(500).json({ error: e.message });
    }
});
app.post('/process-billing', async (req, res) => {
    if (isRunning) {
        return res.status(409).json({ message: 'Process already running' });
    }

    const { source = 'file', requests: bodyRequests } = req.body;

    let requests = [];

    try {
        if (source === 'file') {
            // -- SOURCE: FILE --
            const jsonPath = path.join(__dirname, '../billing_requests.json');
            if (!fs.existsSync(jsonPath)) {
                return res.status(404).json({ error: 'billing_requests.json not found' });
            }
            const data = fs.readFileSync(jsonPath, 'utf8');
            requests = JSON.parse(data);

            // Validate that we have an array
            if (!Array.isArray(requests)) {
                return res.status(500).json({ error: 'billing_requests.json must contain an array' });
            }
            if (requests.length === 0) {
                return res.status(400).json({ error: 'No requests found in billing_requests.json' });
            }

            // Initialize status for UI
            requests.forEach(r => { r.status = 'pending'; r.message = ''; });
            currentRequests = requests;
            broadcast('queue', currentRequests);
        } else if (source === 'queue') {
            // -- SOURCE: QUEUE (client sends selected list – no refetch) --
            if (!Array.isArray(bodyRequests) || bodyRequests.length === 0) {
                return res.status(400).json({
                    error: bodyRequests == null
                        ? 'Missing "requests" in body for Run current queue.'
                        : 'No requests in queue. Select items or load from server first.'
                });
            }
            // Use a shallow copy so we have a stable snapshot (objects inside are same refs for status updates)
            requests = bodyRequests.slice();
            requests.forEach(r => { r.status = r.status || 'pending'; r.message = r.message || ''; });
            currentRequests = requests;
            broadcast('queue', currentRequests);
            broadcast('log', { message: `Running ${requests.length} request(s) from current queue (no refetch).`, type: 'info' });
            console.log(`[Server] Run current queue: ${requests.length} request(s) (no TSS refetch).`);
        } else {
            // -- SOURCE: TSS API (only for "Start from Server") --
            console.log('[Server] Fetching requests from TSS API...');
            requests = await fetchRequestsFromTSS();
            
            if (!requests || requests.length === 0) {
                return res.status(400).json({ error: 'No requests found from TSS API' });
            }

            // Initialize status for UI
            requests.forEach(r => { r.status = 'pending'; r.message = ''; });
            currentRequests = requests;
            broadcast('queue', currentRequests);
            broadcast('log', { message: `Fetched ${requests.length} requests from TSS API.`, type: 'info' });
        }

    } catch (e) {
        console.error('[Server] Setup Error:', e);
        return res.status(500).json({ error: `Setup failed: ${e.message}` });
    }

    console.log(`[Server] Starting automation (Source: ${source})`);
    res.json({ message: 'Automation started', source: source });

    isRunning = true;
    shouldStop = false;
    broadcast('log', { message: `--- Starting Automation Run (${source}) ---`, type: 'info' });
    broadcast('status', { isRunning: true });

    // For TSS API, we don't need apiConfig since it's a public endpoint
    const apiConfig = null;

    // Create stop function that can be called to stop the worker
    stopBillingWorker = () => {
        shouldStop = true;
        console.log('[Server] Stop signal received');
    };

    (async () => {
        try {
            await launchBrowser();
            // Pass requests to worker (for file mode) or null (for API mode, worker will fetch from TSS)
            // Also pass a function to check if we should stop
            await billingWorker((source === 'file' || source === 'queue') ? requests : null, broadcast, source, apiConfig, () => shouldStop);
            if (shouldStop) {
                broadcast('log', { message: '--- Automation Run Stopped by User ---', type: 'warning' });
            } else {
                broadcast('log', { message: '--- Automation Run Complete ---', type: 'success' });
            }
        } catch (e) {
            console.error('CRITICAL AUTOMATION ERROR:', e);
            broadcast('log', { message: `Critical Error: ${e.message}`, type: 'error' });
        } finally {
            isRunning = false;
            shouldStop = false;
            stopBillingWorker = null;
            broadcast('status', { isRunning: false });
        }
    })();
});

app.post('/stop-billing', (req, res) => {
    if (!isRunning) {
        return res.json({ message: 'No process is currently running' });
    }

    console.log('[Server] Stop request received');
    shouldStop = true;
    if (stopBillingWorker) {
        stopBillingWorker();
    }
    
    broadcast('log', { message: 'Stop signal sent. Process will stop after current client...', type: 'warning' });
    res.json({ message: 'Stop signal sent' });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
