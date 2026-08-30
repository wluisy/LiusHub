/**
 * 窗口管理
 *
 * 负责主窗口的创建与生命周期管理。
 */
const { BrowserWindow, app } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

// 窗口/任务栏图标（dev 模式使用 build/icon.png；打包后由 exe 自带图标接管）
const appIcon = path.join(__dirname, '..', '..', 'build', 'icon.png')
const ICON = fs.existsSync(appIcon) ? appIcon : undefined

let mainWindow = null

function getMainWindow() {
  return mainWindow
}

function broadcast(channel, payload) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload)
  }
}

async function createMainWindow({ isDev } = {}) {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    icon: ICON,
    backgroundColor: '#0e1116',
    title: 'LiusHub',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#00000000',
      symbolColor: '#ffffff',
      height: 36,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,           // preload 需要 require
      webSecurity: true,
      spellcheck: false,
    },
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  return mainWindow
}

module.exports = {
  getMainWindow,
  createMainWindow,
  broadcast,
}
