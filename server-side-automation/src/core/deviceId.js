/**
 * Stable device identifier for authorization.
 * Prefers hardware/platform identifiers (harder to spoof than MAC or IP):
 * - macOS: IOPlatformUUID from ioreg
 * - Linux: /etc/machine-id
 * - Windows: UUID from wmic csproduct
 * Fallback: hash of primary MAC + hostname so we still get a stable id.
 */
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { execSync } = require('child_process');

let cachedDeviceId = null;

function getRawId() {
    const platform = os.platform();

    if (platform === 'darwin') {
        try {
            const out = execSync('ioreg -rd1 -c IOPlatformExpertDevice', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
            const m = out.match(/IOPlatformUUID\s*=\s*"([^"]+)"/);
            if (m && m[1]) return m[1].trim();
        } catch (_) {}
    }

    if (platform === 'linux') {
        for (const p of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
            try {
                if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8').trim();
            } catch (_) {}
        }
    }

    if (platform === 'win32') {
        try {
            const out = execSync('wmic csproduct get uuid', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
            const lines = out.split('\n').map(s => s.trim()).filter(Boolean);
            // First line is "UUID", second is the value
            if (lines.length >= 2 && lines[0].toUpperCase() === 'UUID') {
                const uuid = lines[1];
                if (uuid && uuid !== '') return uuid;
            }
        } catch (_) {}
    }

    // Fallback: stable hash from hostname + first non-internal MAC
    const ifaces = os.networkInterfaces();
    let mac = '';
    for (const name of Object.keys(ifaces)) {
        for (const iface of ifaces[name]) {
            if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
                mac = iface.mac;
                break;
            }
        }
        if (mac) break;
    }
    const seed = `${os.hostname()}|${mac}`;
    return crypto.createHash('sha256').update(seed).digest('hex').slice(0, 32);
}

/**
 * Returns a short, stable device ID (uppercase alphanumeric) for this machine.
 * Same machine always returns the same id.
 */
function getDeviceId() {
    if (cachedDeviceId) return cachedDeviceId;
    const raw = getRawId();
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    cachedDeviceId = hash.slice(0, 12).toUpperCase();
    return cachedDeviceId;
}

module.exports = { getDeviceId, getRawId };
