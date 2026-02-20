require('dotenv').config();
const { app, BrowserWindow, Menu, Tray, clipboard, ipcMain, nativeImage, screen } = require('electron');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_ANON_KEY || '';
let supabase = null;
try {
    if (supabaseUrl && supabaseKey) {
        supabase = createClient(supabaseUrl, supabaseKey);
        console.log('[Supabase] Client initialized.');
    } else {
        console.warn('[Supabase] No credentials found in .env');
    }
} catch (error) {
    console.error('[Supabase] Failed to initialize client:', error.message);
}

let mainWindow;
let tray = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 320,
        height: 450,
        show: false,
        frame: false,
        resizable: false,
        transparent: true,
        vibrancy: 'under-window',
        visualEffectState: 'active',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        alwaysOnTop: true,
        skipTaskbar: true
    });

    mainWindow.loadFile('index.html');

    // Hide window when it loses focus
    mainWindow.on('blur', () => {
        if (!app.isQuitting) {
            mainWindow.hide();
        }
    });

    mainWindow.on('close', function (event) {
        if (!app.isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        }
    });
}

function getWindowPosition() {
    const windowBounds = mainWindow.getBounds();
    const trayBounds = tray.getBounds();

    // Center window horizontally below the tray icon
    const x = Math.round(trayBounds.x + (trayBounds.width / 2) - (windowBounds.width / 2));
    // Position window 5 pixels vertically below the tray icon
    const y = Math.round(trayBounds.y + trayBounds.height + 5);

    return { x, y };
}

function toggleWindow() {
    if (mainWindow.isVisible()) {
        mainWindow.hide();
    } else {
        const position = getWindowPosition();
        mainWindow.setPosition(position.x, position.y, false);
        mainWindow.show();
        mainWindow.focus();
    }
}

function createTray() {
    const icon = nativeImage.createEmpty();
    tray = new Tray(icon);
    tray.setTitle('📋'); // Use emoji for simple icon
    tray.setToolTip('Clipboard Manager');

    const contextMenu = Menu.buildFromTemplate([
        { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } }
    ]);

    tray.on('click', toggleWindow);
    tray.on('right-click', () => tray.popUpContextMenu(contextMenu));
}

// Fetch all clipboard history from Supabase, sorted newest first, deduplicated
async function fetchFromSupabase() {
    if (!supabase) return [];
    try {
        const { data, error } = await supabase
            .from('clipboard')
            .select('text, created_at')
            .order('created_at', { ascending: false })
            .limit(100); // Fetch more to allow for manual deduplication

        if (error) {
            console.error('[Supabase] Fetch error:', error.message);
            return [];
        }

        // Deduplicate in JS to maintain newest-first order
        const seen = new Set();
        const deduplicated = [];
        for (const item of data) {
            if (!seen.has(item.text)) {
                seen.add(item.text);
                deduplicated.push(item.text);
            }
            if (deduplicated.length >= 50) break;
        }

        console.log(`[Supabase] Fetched and deduplicated ${deduplicated.length} items.`);
        return deduplicated;
    } catch (err) {
        console.error('[Supabase] Unexpected fetch error:', err);
        return [];
    }
}

// Push a new item to Supabase
async function pushToSupabase(text) {
    if (!supabase) return;
    try {
        // Optional: Check if the last item is identical to avoid redundant writes
        // But for "realtime" synced devices, maybe we want every copy?
        // User asked for no duplicates IN THE APP, so we deduplicate on fetch.

        await supabase
            .from('clipboard')
            .insert([{ text }]);
    } catch (err) {
        console.error('[Supabase] Unexpected insert error:', err);
    }
}

function sendHistoryToRenderer(history) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('clipboard-update', history);
    }
}

function startPolling() {
    if (!supabase) return;

    let lastTopId = null;
    setInterval(async () => {
        const { data, error } = await supabase
            .from('clipboard')
            .select('id, text, created_at')
            .order('created_at', { ascending: false })
            .limit(1);

        if (error || !data || data.length === 0) return;

        const latest = data[0];

        if (latest.id !== lastTopId) {
            lastTopId = latest.id;

            // Check if current system clipboard already has this text
            // to avoid feedback loops if we were the ones who pushed it
            if (clipboard.readText() !== latest.text) {
                clipboard.writeText(latest.text);
            }

            const history = await fetchFromSupabase();
            sendHistoryToRenderer(history);
        }
    }, 1000);
}

function startLocalClipboardMonitor() {
    let lastText = clipboard.readText();

    setInterval(async () => {
        const text = clipboard.readText();
        if (text && text !== lastText) {
            lastText = text;
            await pushToSupabase(text);
        }
    }, 1000);
}

app.on('before-quit', () => { app.isQuitting = true; });

app.whenReady().then(async () => {
    // Hide dock icon on macOS
    if (process.platform === 'darwin') {
        app.dock.hide();
    }

    createWindow();
    createTray();

    const history = await fetchFromSupabase();

    if (history.length > 0) {
        if (clipboard.readText() !== history[0]) {
            clipboard.writeText(history[0]);
        }
    }

    startPolling();
    startLocalClipboardMonitor();

    ipcMain.on('get-clipboard-history', async (event) => {
        const h = await fetchFromSupabase();
        event.reply('clipboard-update', h);
    });

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});
