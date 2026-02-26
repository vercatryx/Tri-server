#!/usr/bin/env node
/**
 * Downloads the Node.js binary for the current platform and extracts it to node-runtime/
 * so the packaged Electron app can spawn Node without relying on system PATH.
 * Run before building: npm run download-node (or it runs automatically before build:mac / build:win).
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const NODE_VERSION = '20.18.0';
const OUT_DIR = path.join(__dirname, '..', 'node-runtime');

const platform = process.platform;
const arch = process.arch;

let filename, ext, stripDir;
if (platform === 'darwin') {
  const nodeArch = arch === 'arm64' ? 'arm64' : 'x64';
  filename = `node-v${NODE_VERSION}-darwin-${nodeArch}.tar.gz`;
  ext = 'tar.gz';
  stripDir = 1;
} else if (platform === 'win32') {
  filename = `node-v${NODE_VERSION}-win-${arch === 'x64' ? 'x64' : 'ia32'}.zip`;
  ext = 'zip';
  stripDir = 1;
} else {
  console.error('Unsupported platform for download-node:', platform);
  process.exit(1);
}

const url = `https://nodejs.org/dist/v${NODE_VERSION}/${filename}`;
const archivePath = path.join(__dirname, '..', path.basename(filename));

function download(url) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(archivePath);
    https.get(url, { headers: { 'User-Agent': 'Node' } }, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        const redirect = res.headers.location;
        file.close();
        fs.unlinkSync(archivePath);
        return download(redirect).then(resolve).catch(reject);
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', (err) => { fs.unlinkSync(archivePath); reject(err); });
  });
}

function extract() {
  const cwd = path.dirname(archivePath);
  if (ext === 'tar.gz') {
    execSync(`tar -xzf "${path.basename(archivePath)}"`, { cwd, stdio: 'inherit' });
  } else {
    // Windows 10+ has tar; Git Bash has unzip
    try {
      execSync(`tar -xf "${path.basename(archivePath)}"`, { cwd, stdio: 'inherit' });
    } catch (_) {
      execSync(`unzip -o -q "${path.basename(archivePath)}"`, { cwd, stdio: 'inherit' });
    }
  }
  const suffix = platform === 'darwin' ? `darwin-${arch === 'arm64' ? 'arm64' : 'x64'}` : `win-${arch === 'x64' ? 'x64' : 'ia32'}`;
  let extractedDir = path.join(cwd, `node-v${NODE_VERSION}-${suffix}`);
  if (!fs.existsSync(extractedDir)) {
    const entries = fs.readdirSync(cwd).filter(e => e.startsWith('node-v'));
    if (entries.length) extractedDir = path.join(cwd, entries[0]);
  }
  if (fs.existsSync(OUT_DIR)) fs.rmSync(OUT_DIR, { recursive: true });
  fs.renameSync(extractedDir, OUT_DIR);
}

(async () => {
  console.log('Downloading Node', NODE_VERSION, 'for', platform, arch, '...');
  await download(url);
  console.log('Extracting to node-runtime/ ...');
  extract();
  fs.unlinkSync(archivePath);
  console.log('Done. node-runtime/', platform === 'win32' ? 'node.exe' : 'bin/node', 'is ready.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
