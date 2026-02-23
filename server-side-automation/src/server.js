const express = require('express');
const fs = require('fs');
const path = require('path');
const { launchBrowser, closeBrowser } = require('./core/browser');
const { performLoginSequence } = require('./core/auth');
const { billingWorker, fetchRequestsFromApi } = require('./core/billingWorker');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3500;

app.use(express.json());
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

// State
let isRunning = false;
let currentRequests = null;

// Routes
app.post('/fetch-requests', async (req, res) => {
    const { apiBaseUrl, apiKey } = req.body;
    const apiConfig = (apiBaseUrl) ? { baseUrl: apiBaseUrl, key: apiKey } : null;

    try {
        console.log('[Server] Fetching requests from API (Preview Mode)...');
        const requests = await fetchRequestsFromApi(apiConfig);

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

    const { source = 'file', apiBaseUrl, apiKey } = req.body;

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
        } else {
            // -- SOURCE: API --
            // We set currentRequests to empty or null so UI knows something is happening but waiting for data
            currentRequests = [];
            broadcast('log', { message: 'Mode: API. Fetching pending requests...', type: 'info' });
        }

    } catch (e) {
        console.error('[Server] Setup Error:', e);
        return res.status(500).json({ error: `Setup failed: ${e.message}` });
    }

    console.log(`[Server] Starting automation (Source: ${source})`);
    res.json({ message: 'Automation started', source: source });

    isRunning = true;
    broadcast('log', { message: `--- Starting Automation Run (${source}) ---`, type: 'info' });

    // Prepare API config
    const apiConfig = (source === 'api' && apiBaseUrl) ? { baseUrl: apiBaseUrl, key: apiKey } : null;

    (async () => {
        try {
            await launchBrowser();
            // Pass apiConfig to worker
            await billingWorker(source === 'file' ? requests : null, broadcast, source, apiConfig);
            broadcast('log', { message: '--- Automation Run Complete ---', type: 'success' });
        } catch (e) {
            console.error('CRITICAL AUTOMATION ERROR:', e);
            broadcast('log', { message: `Critical Error: ${e.message}`, type: 'error' });
        } finally {
            isRunning = false;
        }
    })();
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
