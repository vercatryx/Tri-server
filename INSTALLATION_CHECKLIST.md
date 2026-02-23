# Quick Installation Checklist - Windows

Use this checklist when installing on a fresh Windows computer.

## Prerequisites Setup
- [ ] Download Node.js from https://nodejs.org/ (get LTS version)
- [ ] Install Node.js (check "Automatically install necessary tools")
- [ ] Verify Node.js: Open Command Prompt, type `node --version` (should show version)
- [ ] Verify npm: Type `npm --version` (should show version)
- [ ] Have Chrome or Edge browser installed

## Project Setup
- [ ] Copy entire project folder to Windows computer
- [ ] Verify these folders exist:
  - [ ] `background/` folder
  - [ ] `modules/` folder
  - [ ] `icons/` folder
  - [ ] `server-side-automation/` folder
- [ ] Verify `manifest.json` file exists in root folder

## Server Installation
- [ ] Open Command Prompt (Windows Key + R, type `cmd`)
- [ ] Navigate to server folder:
  ```
  cd "C:\path\to\project\server-side-automation"
  ```
- [ ] Run `npm install` (wait for completion)
- [ ] Run `npx playwright install chromium` (wait for download)
- [ ] (Optional) Create `.env` file if needed

## Extension Installation
- [ ] Open Chrome/Edge browser
- [ ] Go to `chrome://extensions/` or `edge://extensions/`
- [ ] Enable "Developer mode" toggle
- [ ] Click "Load unpacked"
- [ ] Select project root folder (where `manifest.json` is)
- [ ] Verify "DF Billing" extension appears in list

## Start Server
- [ ] Open Command Prompt
- [ ] Navigate to `server-side-automation` folder
- [ ] Run `npm start`
- [ ] See message: "Server running on http://localhost:3500"
- [ ] Open browser to `http://localhost:3500`
- [ ] Verify web interface loads

## Verification
- [ ] Extension icon visible in browser toolbar
- [ ] Server running (Command Prompt shows server message)
- [ ] Web interface accessible at http://localhost:3500
- [ ] No error messages in Command Prompt

## Common Issues
- **Node.js not found:** Restart Command Prompt or restart computer
- **npm install fails:** Check internet connection, try again
- **Extension won't load:** Make sure you selected the folder with `manifest.json`, not a subfolder
- **Server won't start:** Check if port 3500 is already in use, close other programs
- **Firewall warning:** Click "Allow access" when Windows asks

## Quick Commands Reference
```
# Navigate to server folder
cd "C:\path\to\project\server-side-automation"

# Start server
npm start

# Stop server (in Command Prompt window)
Ctrl + C

# Restart server (kills existing process)
npm run dev
```
