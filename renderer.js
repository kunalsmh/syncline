const { ipcRenderer, clipboard } = require('electron');

// --- Clipboard History Logic ---

function renderClipboardHistory(history) {
    const listElement = document.getElementById('clipboard-list');
    listElement.innerHTML = ''; // Clear current

    if (history.length === 0) {
        listElement.innerHTML = '<div style="color: #64748b; text-align: center; padding: 20px;">No copied text yet</div>';
        return;
    }

    history.forEach((text, index) => {
        const item = document.createElement('div');
        item.className = 'clipboard-item';
        // Truncate long texts visually or let them wrap. Currently wrapping.
        item.textContent = text;

        // Let user copy it back upon clicking
        item.addEventListener('click', () => {
            // Write to clipboard, but prevent our monitor from thinking it's a *new* item 
            // wait, our monitor checks if it's the same as the very last item.
            clipboard.writeText(text);
        });

        listElement.appendChild(item);
    });
}

// Request initial history
ipcRenderer.send('get-clipboard-history');

// Listen for updates
ipcRenderer.on('clipboard-update', (event, history) => {
    renderClipboardHistory(history);
});
