const { app, BrowserWindow, screen, ipcMain, Menu, Tray, nativeImage } = require("electron");
const Store = require("electron-store").default;
const path = require("path");

const store = new Store()

let mainWindow
let overlayWindow
let tray
let workInterval = null
let running = false

const DEFAULT = {
    workTime: 20,
    breakTime: 20,
    preMessage: "Time for a screen break!",
    postMessage: "Back to focus. Good work! 🎯"
}



function createTray() {
    tray = new Tray(path.join(__dirname, "favicon.ico"))
    tray.setToolTip("BlinkBreak")
    tray.on("click", () => { mainWindow.show(); mainWindow.focus() })
    updateTray()
}

function updateTray() {
    if (!tray) return
    tray.setContextMenu(Menu.buildFromTemplate([
        {
            label: running ? "⏹  Stop" : "▶  Start",
            click: () => running
                ? stopCycle()
                : startCycle(store.get("settings", DEFAULT))
        },
        { label: "Show App", click: () => { mainWindow.show(); mainWindow.focus() } },
        { type: "separator" },
        { label: "Quit", click: () => app.exit(0) }
    ]))
}

// ─── Windows ──────────────────────────────────────────────────────────────────

function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 360,
        height: 480,
        minWidth: 320,
        minHeight: 420,
        frame: false,
        resizable: true,
        icon: path.join(__dirname, "favicon.ico"), 
        webPreferences: { nodeIntegration: true, contextIsolation: false }
    })

    mainWindow.loadFile("index.html")

    mainWindow.webContents.on("did-finish-load", () => {
        const s = store.get("settings", DEFAULT)
        mainWindow.webContents.send("init", { settings: s, running })
    })

    // Close hides to tray — cycle keeps running
    mainWindow.on("close", e => {
        e.preventDefault()
        mainWindow.hide()
    })
}

function createOverlay() {
    const { width } = screen.getPrimaryDisplay().workAreaSize
    const W = 520, H = 140

    overlayWindow = new BrowserWindow({
        width: W,
        height: H,
        x: Math.floor((width - W) / 2),
        y: 0,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        focusable: false,
        hasShadow: false,
        webPreferences: { nodeIntegration: true, contextIsolation: false }
    })

    overlayWindow.loadFile("overlay.html")
    overlayWindow.setIgnoreMouseEvents(true)
    overlayWindow.setAlwaysOnTop(true, "screen-saver")
    overlayWindow.hide()
}

// ─── Cycle ────────────────────────────────────────────────────────────────────

function startCycle(data) {
    store.set("settings", data)
    if (workInterval) clearInterval(workInterval)
    running = true

    const workMs = Math.max(Number(data.workTime) || 20, 0.05) * 60 * 1000

    function trigger() {
        const bt = Number(data.breakTime) || 20
        overlayWindow.show()
        overlayWindow.webContents.send("sequence", {
            breakTime: bt,
            preMessage: data.preMessage || DEFAULT.preMessage,
            postMessage: data.postMessage || DEFAULT.postMessage
        })
        // Total: 2.2s pre → 3s countdown → 0.9s GO pause → bt seconds → 0.4s + 3s post
        const totalMs = 2200 + 3000 + 900 + bt * 1000 + 400 + 3200
        setTimeout(() => overlayWindow.hide(), totalMs)
    }

    workInterval = setInterval(trigger, workMs)
    broadcast("power-state", true)
    broadcast("settings", data)
    updateTray()
}

function stopCycle() {
    running = false
    if (workInterval) { clearInterval(workInterval); workInterval = null }
    overlayWindow.hide()
    broadcast("power-state", false)
    updateTray()
}

function broadcast(ch, data) {
    if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send(ch, data)
}

// ─── App ──────────────────────────────────────────────────────────────────────

app.whenReady().then(() => {
    Menu.setApplicationMenu(null)
    createMainWindow()
    createOverlay()
    createTray()
})

app.on("window-all-closed", e => e.preventDefault())

// ─── IPC ──────────────────────────────────────────────────────────────────────

ipcMain.on("start-cycle", (_, data) => startCycle(data))
ipcMain.on("stop-cycle", () => stopCycle())
ipcMain.on("save-settings", (_, data) => {
    store.set("settings", data)
    if (running) { stopCycle(); startCycle(data) }
})
ipcMain.on("minimize", () => mainWindow.minimize())
ipcMain.on("maximize", () => {
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
})
ipcMain.on("hide-window", () => mainWindow.hide())
ipcMain.on("quit-app", () => app.exit(0))