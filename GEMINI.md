# GEMINI.md

## Project Overview

This is a Chrome extension named "DF Billing" designed to automate billing and documentation workflows on the UniteUs platform for an entity named "Diet Fantasy". The extension provides a side panel with two main modes: "Auto" and "Manual".

-   **Auto Mode**: This mode iterates through a list of users fetched from a backend service and, for each user, performs a series of automated actions. These actions include navigating to the user's page on UniteUs, uploading attestation documents, and entering billing information. The user can start, pause, and stop the automated process.

-   **Manual Mode**: This mode provides a set of tools for more granular control over the extension's features. Users can manually trigger actions like logging into UniteUs, creating new users, entering billing information for a specific date range, and uploading PDF documents.

The extension is built using HTML, CSS, and JavaScript. It uses a service worker (`background/bridge.js`) to manage communication between the side panel and the content scripts that interact with the UniteUs website.

### Technologies

-   **Frontend**: HTML, CSS, JavaScript
-   **Browser API**: Chrome Extension Manifest V3
-   **Backend (for data)**: The extension fetches user data from a service hosted at `https://dietfantasy-nkw6.vercel.app`.

## Building and Running

There are no explicit build steps mentioned in the project. As a Chrome extension, it can be loaded directly into the browser in developer mode.

**To run the extension:**

1.  Open Google Chrome and navigate to `chrome://extensions`.
2.  Enable "Developer mode" in the top right corner.
3.  Click "Load unpacked".
4.  Select the project's root directory (`/Users/shloimieheimowitz/WebstormProjects/dfPanelExtention`).

The extension's icon should appear in the Chrome toolbar. Clicking the icon will open the side panel.

## Development Conventions

The code follows a modular structure, with a clear separation between the background script, the panel UI and logic, and the content scripts that are injected into the web pages.

-   **Service Worker**: `background/bridge.js` handles all communication between the panel and the content scripts, and manages the extension's state.
-   **Panel**: `panel.html` and `panel.js` define the UI and logic for the main side panel. `manual.html` and `manual.js` do the same for the manual mode.
-   **Content Scripts**: The `modules/` directory contains various content scripts, each responsible for a specific task on the UniteUs website (e.g., `loginFlow.js`, `enterBillingDetails.js`, `uploadpdf.js`).

The code makes extensive use of modern JavaScript features like `async/await` and communicates between different parts of the extension using `chrome.runtime.sendMessage` and `chrome.tabs.sendMessage`.
