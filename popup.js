async function activeTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
}

async function setOpenForActive(open) {
    const tab = await activeTab();
    const status = document.getElementById("status");
    if (!tab || !/^https?:\/\//.test(tab.url || "")) {
        status.textContent = "Open a normal http(s) page first.";
        return;
    }
    // Tell background to set per-tab state and sync
    await chrome.runtime.sendMessage({ type: "DF_SET_OPEN", tabId: tab.id, open: !!open });
    status.textContent = open ? "Shelf opened for THIS tab." : "Shelf closed on this tab.";
}

document.getElementById("open").addEventListener("click", () => setOpenForActive(true));
document.getElementById("close").addEventListener("click", () => setOpenForActive(false));