#!/usr/bin/env node

require('dotenv').config();
const { execSync } = require('child_process');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 3500;

console.log(`Killing any process on port ${PORT}...`);
try {
    execSync(`lsof -ti:${PORT} | xargs kill -9 2>/dev/null`, { encoding: 'utf8' });
    console.log('Done. Waiting for port to be released...');
} catch (e) {
    // lsof exits non-zero when no PIDs found; that's fine
}
setTimeout(() => {
    startServer();
}, 2000);

function startServer() {
    console.log('Starting server...');
    const server = spawn('node', ['src/server.js'], {
        stdio: 'inherit',
        shell: true
    });
    
    server.on('error', (err) => {
        console.error('Failed to start server:', err);
        process.exit(1);
    });
    
    // Handle Ctrl+C
    process.on('SIGINT', () => {
        console.log('\nShutting down server...');
        server.kill();
        process.exit(0);
    });
}

