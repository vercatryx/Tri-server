# Packaging as a desktop app (Windows & Mac)

The app can run as a normal desktop application using Electron: one window with the billing UI, no terminal or browser tab.

## Run in development

```bash
npm run electron
```

This starts the Express server and opens an app window at `http://localhost:3500`. Close the window to stop the server.

## Build installers

- **Mac (DMG):** `npm run build:mac`  
  Output: `dist/Billing Automation-1.0.0-arm64.dmg` (and `.app` in `dist/mac-arm64/`).  
  If the build fails with `hdiutil detach` (e.g. exit 16), the DMG volume from a previous build may still be mounted: eject **Billing Automation 1.0.0-arm64** from the Finder sidebar (or run `hdiutil detach "/Volumes/Billing Automation 1.0.0-arm64"`), then retry. Alternatively use `npm run build:mac:app` to build only the `.app` (no DMG) — output is in `dist/mac-arm64/Billing Automation.app`.

- **Windows (NSIS):** `npm run build:win`  
  Run on Windows (or use a Windows VM/CI). Output: `dist/Billing Automation Setup 1.0.0.exe`.

## Packaged app behaviour

- **Config:** The app ships with whatever `.env` is in the project when you run `npm run build:mac` or `build:win`. Put your `UNITEUS_EMAIL` and `UNITEUS_PASSWORD` (and any other options) into `.env` before building so they are included in the package.
- **Playwright:** On first run, Chromium is downloaded into the same user data folder (one-time, ~150MB). Later runs use that copy.
- **Node:** The packaged app embeds a Node binary (downloaded when you run `npm run build:mac` or `build:win`). No need to install Node on the target machine.

## Code signing (optional)

- **Mac:** Sign with a “Developer ID Application” certificate and notarize the app so Gatekeeper doesn’t block it.
- **Windows:** Sign the installer and executable so SmartScreen doesn’t warn.

Without signing, users may see security warnings; they can still “Open” / “Run” the app.
