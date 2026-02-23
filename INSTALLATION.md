# Installation Guide for Windows

This guide is for installing on a **fresh Windows computer** with nothing pre-installed.

This project consists of two main components:
1. **Browser Extension** - A Chrome/Edge extension for Diet Fantasy Auto Billing
2. **Server-Side Automation** - A Node.js server using Playwright for automated billing

## Step-by-Step Installation

### Step 1: Install Node.js (First Time Setup)

1. **Download Node.js:**
   - Open your web browser (Edge or Chrome)
   - Go to: https://nodejs.org/
   - Download the **LTS version** (recommended, e.g., "v20.x.x LTS")
   - The file will be named something like `node-v20.x.x-x64.msi`

2. **Install Node.js:**
   - Double-click the downloaded `.msi` file
   - Click **"Next"** through the installation wizard
   - **IMPORTANT:** Check the box that says **"Automatically install the necessary tools"** (this installs build tools)
   - Click **"Install"** (you may need to allow administrator permissions)
   - Wait for installation to complete
   - Click **"Finish"**

3. **Verify Node.js Installation:**
   - Press `Windows Key + R`
   - Type `cmd` and press Enter (this opens Command Prompt)
   - Type the following and press Enter:
     ```
     node --version
     ```
   - You should see a version number (e.g., `v20.x.x`)
   - Type this and press Enter:
     ```
     npm --version
     ```
   - You should see a version number (e.g., `10.x.x`)
   - If both commands work, Node.js is installed correctly!

### Step 2: Copy Project Files

1. **Copy the entire project folder** to the Windows computer:
   - You can use a USB drive, network share, or cloud storage
   - Copy the entire folder (e.g., `df new exten` or whatever you named it)
   - Place it anywhere on the computer (e.g., `C:\Users\YourName\Desktop\` or `C:\Projects\`)

2. **Verify all files are present:**
   - Open the project folder
   - Make sure you see:
     - `manifest.json` file
     - `background/` folder
     - `modules/` folder
     - `icons/` folder
     - `server-side-automation/` folder
     - Various `.html` and `.js` files

### Step 3: Install Server Dependencies

1. **Open Command Prompt:**
   - Press `Windows Key + R`
   - Type `cmd` and press Enter
   - **OR** right-click the Start button → select "Windows Terminal" or "Command Prompt"

2. **Navigate to the server folder:**
   - Type this command (replace the path with your actual project location):
     ```
     cd "C:\Users\YourName\Desktop\df new exten\server-side-automation"
     ```
   - **Tip:** You can also:
     - Navigate to the `server-side-automation` folder in Windows Explorer
     - Right-click in the folder → select "Open in Terminal" or "Open PowerShell window here"
     - Then type `cmd` if it opens PowerShell

3. **Install Node.js packages:**
   - Type this command and press Enter:
     ```
     npm install
     ```
   - Wait for it to complete (this may take 2-5 minutes)
   - You should see "added X packages" when done

4. **Install Playwright browser:**
   - Type this command and press Enter:
     ```
     npx playwright install chromium
     ```
   - Wait for it to complete (this downloads Chromium, ~170MB, may take a few minutes)
   - You should see "Installing..." and then "Successfully installed"

### Step 4: Configure Environment Variables (Optional)

If you need to customize the server settings:

1. Navigate to the `server-side-automation` folder in Windows Explorer
2. Right-click in the folder → New → Text Document
3. Name it `.env` (make sure to include the dot at the beginning)
4. Open it with Notepad and add:
   ```
   PORT=3500
   HEADLESS=false
   ```
5. Save and close

- `PORT`: Server port (default: 3500)
- `HEADLESS`: Set to `true` to run browser in headless mode (default: false)

**Note:** If Windows doesn't let you create a file starting with a dot:
- Create it as `env.txt` first
- Then rename it to `.env` (you may need to enable "Show file extensions" in Windows Explorer)

### Step 5: Load Browser Extension

1. **Open Chrome or Edge browser** (Edge comes with Windows, Chrome can be downloaded from google.com/chrome)

2. **Open Extensions page:**
   - **Edge:** Type `edge://extensions/` in the address bar and press Enter
   - **Chrome:** Type `chrome://extensions/` in the address bar and press Enter

3. **Enable Developer mode:**
   - Look for a toggle switch in the bottom-left or top-right that says "Developer mode"
   - Turn it ON (it should turn blue/highlighted)

4. **Load the extension:**
   - Click the button that says **"Load unpacked"** or **"Load extension"**
   - A file picker window will open
   - Navigate to your project folder (the one containing `manifest.json`)
   - **Select the folder** (not a file inside it) and click "Select Folder" or "OK"

5. **Verify extension loaded:**
   - You should see "DF Billing" appear in your extensions list
   - The extension icon should appear in your browser toolbar

### Step 6: Start the Server

1. **Open Command Prompt** (if not already open):
   - Press `Windows Key + R`
   - Type `cmd` and press Enter

2. **Navigate to server folder:**
   - Type (adjust path to your actual location):
     ```
     cd "C:\Users\YourName\Desktop\df new exten\server-side-automation"
     ```
   - Press Enter

3. **Start the server:**
   - Type this command and press Enter:
     ```
     npm start
     ```
   - You should see: `Server running on http://localhost:3500`
   - **Keep this window open!** The server needs to keep running

4. **Open the web interface:**
   - Open your browser (Edge or Chrome)
   - Go to: `http://localhost:3500`
   - You should see the automation interface

**Note:** To stop the server, press `Ctrl + C` in the Command Prompt window.

## Verification

1. **Extension**: Check that the extension icon appears in your browser toolbar
2. **Server**: Visit `http://localhost:3500` - you should see the automation interface
3. **Console**: Check the terminal for any error messages

## Troubleshooting

### Extension won't load
- Ensure all files are present (especially `manifest.json`, `background/bridge.js`)
- Check browser console for errors (right-click extension icon → Inspect)
- Verify manifest version matches your browser (Manifest V3 for Chrome/Edge)

### Server won't start
- Verify Node.js is installed: `node --version`
- Check if port 3500 is already in use
- Ensure all dependencies are installed: `npm install`
- Check that Playwright browsers are installed: `npx playwright install chromium`

### Playwright errors
- Run: `npx playwright install chromium`
- If you get errors about missing DLLs or system dependencies, run:
  ```
  npx playwright install-deps chromium
  ```
- This installs Windows system dependencies needed by Playwright

### Permission errors
- Ensure the project folder is not in a protected location (like `C:\Program Files`)
- Try moving it to `C:\Users\YourName\Desktop\` or `C:\Projects\`
- Right-click the folder → Properties → Uncheck "Read-only" if checked

### Command Prompt issues
- If `node` or `npm` commands don't work, you may need to restart Command Prompt after installing Node.js
- Close and reopen Command Prompt, or restart your computer
- Make sure you're using Command Prompt (cmd.exe), not PowerShell (though PowerShell should work too)

### Windows Firewall
- When you first run the server, Windows may ask for firewall permission
- Click "Allow access" to let the server run on port 3500

## Project Structure

```
df new exten/
├── manifest.json              # Extension manifest
├── background/                # Background scripts
├── modules/                   # Extension modules
├── icons/                     # Extension icons
├── *.html, *.js              # Extension UI files
└── server-side-automation/    # Server component
    ├── package.json
    ├── src/
    │   ├── server.js         # Main server file
    │   └── core/             # Core automation modules
    └── public/               # Web UI files
```

## Quick Reference Commands

Once everything is set up, you'll use these commands regularly:

**To start the server:**
```
cd "C:\path\to\your\project\server-side-automation"
npm start
```

**To stop the server:**
- Press `Ctrl + C` in the Command Prompt window

**To restart the server (kills existing process first):**
```
cd "C:\path\to\your\project\server-side-automation"
npm run dev
```

## Notes

- The server runs on port 3500 by default
- The extension requires permissions for the domains specified in `manifest.json`
- Playwright downloads Chromium browser (~170MB) on first install - this is normal
- The server can run in headless or headed mode (see `.env` configuration)
- Keep the Command Prompt window open while the server is running
- You can minimize it, but don't close it or the server will stop

## Windows-Specific Tips

- **File paths with spaces:** Always use quotes around paths: `cd "C:\Users\Your Name\Desktop\df new exten"`
- **Long paths:** Windows has a 260-character path limit. Keep project folder names short if possible
- **Antivirus:** Some antivirus software may flag Playwright. You may need to add an exception for the project folder
- **Windows Defender:** May prompt you when npm installs packages. This is normal - click "Allow"
