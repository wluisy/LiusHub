/**
 * LiusHub - Electron 主进程入口
 *
 * 职责：
 *  1. 创建主窗口
 *  2. 注册 IPC 处理器 (通过各 engine 模块)
 *  3. 处理应用生命周期 (ready / window-all-closed / activate)
 *  4. 初始化安全存储与各引擎
 */
const { app, BrowserWindow, ipcMain, shell, Menu, nativeTheme, dialog } = require('electron')
const path = require('node:path')
const fsp = require('node:fs/promises')
const fsSync = require('node:fs')
const { IPC } = require('../shared/ipc-channels')

// 引擎模块
const secureStore = require('./secure-store')
const windowManager = require('./window-manager')
const sshEngine = require('./engines/ssh-engine')
const sftpEngine = require('./engines/sftp-engine')
const dbEngine = require('./engines/db-engine')
const dockerEngine = require('./engines/docker-engine')
const toolEngine = require('./engines/tool-engine')
const fsEngine = require('./engines/fs-engine')

const isDev = process.env.NODE_ENV === 'development'

// 主题持久化（userData/theme.json）
let savedTheme = null
const themeFile = () => path.join(app.getPath('userData'), 'theme.json')
async function loadSavedTheme() {
  try {
    return JSON.parse(await fsp.readFile(themeFile(), 'utf-8')).theme || null
  } catch {
    return null
  }
}
async function persistTheme(theme) {
  try {
    await fsp.writeFile(themeFile(), JSON.stringify({ theme }), 'utf-8')
  } catch (e) {
    console.warn('[theme] 主题持久化失败:', e.message)
  }
}
function applyTheme(theme) {
  const t = theme === 'dark' ? 'dark' : 'light'
  savedTheme = t
  nativeTheme.themeSource = t
  persistTheme(t)
  windowManager.broadcast(IPC.APP_THEME_CHANGED, t)
}

// 单实例锁 — 防止多开
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
  process.exit(0)
}

app.on('second-instance', () => {
  const main = windowManager.getMainWindow()
  if (main) {
    if (main.isMinimized()) main.restore()
    main.focus()
  }
})

/* ---------------- 自定义数据目录 ----------------
 * bootstrap 文件固定存放在系统 appData/LiusHub 下（不随 userData 自身改变），
 * 启动时尽早 setPath('userData')，并把旧目录的白名单数据文件复制过去（仅复制不删除，幂等）。 */
const DATA_DIR_FILE = path.join(app.getPath('appData'), 'LiusHub', 'data-dir.json')
const MIGRATE_FILES = [
  'vault.json', 'glass.json', 'theme.json', 'tool-templates.json',
  'ssh-host-keys.json', 'background.png', 'background.jpg', 'background.webp',
]

function readDataDirCfg() {
  try { return JSON.parse(fsSync.readFileSync(DATA_DIR_FILE, 'utf-8')) } catch { return null }
}

function applyCustomDataDir() {
  const cfg = readDataDirCfg()
  const dir = cfg && cfg.userDataDir
  if (!dir) return
  try {
    fsSync.mkdirSync(dir, { recursive: true })
    const prev = cfg.previousDir
    if (prev) {
      for (const f of MIGRATE_FILES) {
        try {
          const from = path.join(prev, f)
          const to = path.join(dir, f)
          if (fsSync.existsSync(from) && !fsSync.existsSync(to)) fsSync.copyFileSync(from, to)
        } catch {}
      }
    }
    app.setPath('userData', dir)
  } catch (e) {
    console.error('[data-dir] 应用自定义数据目录失败，回退默认:', e.message)
  }
}
applyCustomDataDir()

/**
 * 创建主窗口
 */
async function createMainWindow() {
  const win = await windowManager.createMainWindow({ isDev })

  if (isDev) {
    // 开发模式连接 vite dev server
    win.loadURL('http://localhost:5173/')
  } else {
    // 生产模式加载打包后的渲染层（electron-builder 仅打包 dist-renderer）
    win.loadFile(path.join(__dirname, '..', '..', 'dist-renderer', 'index.html'))
  }

  // 外部链接走系统默认浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // 拦截导航
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('http://localhost:5173')) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })
}

/**
 * 注册所有 IPC 处理器
 */
function registerIpcHandlers() {
  // 应用级
  ipcMain.handle(IPC.APP_READY, () => ({
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    userData: app.getPath('userData'),
    dataDirCustom: !!(readDataDirCfg() && readDataDirCfg().userDataDir),
  }))
  ipcMain.handle(IPC.APP_RESTART, () => { app.relaunch(); app.exit(0) })

  ipcMain.handle(IPC.APP_GET_THEME, () => savedTheme || (nativeTheme.shouldUseDarkColors ? 'dark' : 'light'))
  ipcMain.on(IPC.APP_SET_THEME, (_e, theme) => applyTheme(theme))
  ipcMain.handle(IPC.APP_ENCRYPTION_STATUS, () => secureStore.isEncryptionAvailable())

  // 资产库
  ipcMain.handle(IPC.ASSET_LIST, (_e, type) => secureStore.list(type))
  ipcMain.handle(IPC.ASSET_SAVE, async (_e, asset) => {
    try {
      return await secureStore.save(asset)
    } catch (e) {
      console.error('[asset:save] 保存失败:', e && e.message, '| 参数类型:', typeof asset)
      throw e
    }
  })
  ipcMain.handle(IPC.ASSET_DELETE, (_e, id) => secureStore.remove(id))
  ipcMain.handle(IPC.ASSET_GET, (_e, id) => secureStore.get(id))

  // 本地文件系统 (SFTP 本地侧)
  ipcMain.handle(IPC.FS_LIST_LOCAL, (_e, p) => fsEngine.listLocal(p))
  ipcMain.handle(IPC.FS_LIST_DRIVES, () => fsEngine.listDrives())
  ipcMain.handle(IPC.FS_CHOOSE, (_e, { mode }) => fsEngine.choose(mode))
  ipcMain.handle(IPC.FS_SAVE_FILE, (_e, opts) => fsEngine.saveFile(opts))
  ipcMain.handle(IPC.FS_READ_TEXT, (_e, p) => fsEngine.readText(p))
  ipcMain.handle(IPC.FS_WRITE_TEXT, (_e, { path: p, content }) => fsEngine.writeText(p, content))

  // 设置 / 背景图 / 玻璃拟态
  ipcMain.handle(IPC.SETTINGS_GET_BG, () => fsEngine.getBackground())
  ipcMain.handle(IPC.SETTINGS_SAVE_BG, (_e, dataUrl) => fsEngine.saveBackground(dataUrl))
  ipcMain.handle(IPC.SETTINGS_CLEAR_BG, () => fsEngine.clearBackground())
  ipcMain.handle(IPC.SETTINGS_GET_GLASS, () => fsEngine.getGlassSettings())
  ipcMain.handle(IPC.SETTINGS_SAVE_GLASS, (_e, cfg) => fsEngine.saveGlassSettings(cfg))

  // 数据目录：弹系统目录选择框 → 写 bootstrap 文件，重启后生效
  ipcMain.handle(IPC.SETTINGS_SET_DATADIR, async () => {
    const r = await dialog.showOpenDialog({
      title: '选择数据目录',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (r.canceled || !r.filePaths.length) return null
    const dir = path.resolve(r.filePaths[0])
    const current = path.resolve(app.getPath('userData'))
    if (dir === current) return { dir, restartRequired: false }
    const previousDir = current
    fsSync.mkdirSync(dir, { recursive: true })
    fsSync.mkdirSync(path.dirname(DATA_DIR_FILE), { recursive: true })
    fsSync.writeFileSync(DATA_DIR_FILE, JSON.stringify({ userDataDir: dir, previousDir }, null, 2), 'utf-8')
    return { dir, restartRequired: true }
  })
  // 恢复默认数据目录：删除 bootstrap 文件，重启后回到系统默认位置
  ipcMain.handle(IPC.SETTINGS_RESET_DATADIR, async () => {
    try { fsSync.unlinkSync(DATA_DIR_FILE) } catch {}
    return { restartRequired: true }
  })

  // SSH
  ipcMain.handle(IPC.SSH_CONNECT, (_e, opts) => sshEngine.connect(opts))
  ipcMain.on(IPC.SSH_WRITE, (_e, { id, data }) => sshEngine.write(id, data))
  ipcMain.on(IPC.SSH_RESIZE, (_e, { id, cols, rows }) => sshEngine.resize(id, cols, rows))
  ipcMain.on(IPC.SSH_DISCONNECT, (_e, { id }) => sshEngine.disconnect(id))
  ipcMain.handle(IPC.SSH_LIST_SESSIONS, () => sshEngine.listSessions())

  // SFTP
  ipcMain.handle(IPC.SFTP_LIST, (_e, { sessionId, path: p }) => sftpEngine.list(sessionId, p))
  ipcMain.handle(IPC.SFTP_UPLOAD, (_e, { sessionId, local, remote }) =>
    sftpEngine.upload(sessionId, local, remote))
  ipcMain.handle(IPC.SFTP_DOWNLOAD, (_e, { sessionId, remote, local }) =>
    sftpEngine.download(sessionId, remote, local))
  ipcMain.handle(IPC.SFTP_MKDIR, (_e, { sessionId, p }) => sftpEngine.mkdir(sessionId, p))
  ipcMain.handle(IPC.SFTP_DELETE, (_e, { sessionId, p }) => sftpEngine.remove(sessionId, p))

  // 快捷命令
  ipcMain.handle(IPC.TOOL_LIST_TEMPLATES, () => toolEngine.listTemplates())
  ipcMain.handle(IPC.TOOL_SAVE_TEMPLATE, (_e, tpl) => toolEngine.saveTemplate(tpl))
  ipcMain.handle(IPC.TOOL_DELETE_TEMPLATE, (_e, id) => toolEngine.removeTemplate(id))

  // 数据库
  ipcMain.handle(IPC.DB_CONNECT, (_e, cfg) => dbEngine.connect(cfg))
  ipcMain.on(IPC.DB_DISCONNECT, (_e, { id }) => dbEngine.disconnect(id))
  ipcMain.handle(IPC.DB_LIST, (_e, { id }) => dbEngine.list(id))
  ipcMain.handle(IPC.DB_TABLES, (_e, { id, database }) => dbEngine.tables(id, database))
  ipcMain.handle(IPC.DB_SCHEMA, (_e, { id, database }) => dbEngine.schema(id, database))
  ipcMain.handle(IPC.DB_TABLE_DETAIL, (_e, { id, database, table }) => dbEngine.tableDetail(id, database, table))
  ipcMain.handle(IPC.DB_QUERY, (_e, { id, sql, params }) => dbEngine.query(id, sql, params))
  ipcMain.handle(IPC.DB_EXPORT, (_e, { id, table, file, format }) => dbEngine.exportFile(id, table, file, format))
  ipcMain.handle(IPC.DB_META, (_e, { id, database }) => dbEngine.meta(id, database))
  ipcMain.handle(IPC.DB_SEARCH, (_e, { id, database, keyword }) => dbEngine.search(id, database, keyword))

  // Docker
  ipcMain.handle(IPC.DOCKER_CONNECT, (_e, cfg) => dockerEngine.connect(cfg))
  ipcMain.on(IPC.DOCKER_DISCONNECT, (_e, { id }) => dockerEngine.disconnect(id))
  ipcMain.handle(IPC.DOCKER_LIST_CONTAINERS, (_e, { id, all }) => dockerEngine.listContainers(id, all))
  ipcMain.handle(IPC.DOCKER_LOGS, (_e, { id, containerId, tail }) => dockerEngine.logs(id, containerId, tail))
  ipcMain.on(IPC.DOCKER_STATS, (_e, { id, containerId }) => dockerEngine.statsStream(id, containerId))
  ipcMain.handle(IPC.DOCKER_STATS_STOP, (_e, { id }) => dockerEngine.stopStats(id))
  ipcMain.handle(IPC.DOCKER_IMAGE_LIST, (_e, { id }) => dockerEngine.listImages(id))
  ipcMain.handle(IPC.DOCKER_CONTAINER_START, (_e, { id, containerId }) => dockerEngine.start(id, containerId))
  ipcMain.handle(IPC.DOCKER_CONTAINER_STOP, (_e, { id, containerId }) => dockerEngine.stop(id, containerId))
}

app.whenReady().then(async () => {
  // 设置应用名 (Windows 上影响 userData 路径)
  app.setName('LiusHub')

  // 初始化安全存储
  await secureStore.init(app)

  // 恢复上次主题
  const saved = await loadSavedTheme()
  if (saved) {
    savedTheme = saved
    nativeTheme.themeSource = saved === 'dark' ? 'dark' : 'light'
  }

  // 隐藏默认菜单
  Menu.setApplicationMenu(null)

  // 注册所有 IPC
  registerIpcHandlers()

  // 创建主窗口
  await createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  // 统一清理所有引擎的连接（SSH / SFTP 复用 SSH 会话、数据库、Docker 及其 stats 流）
  sshEngine.disposeAll()
  dbEngine.disposeAll()
  dockerEngine.disposeAll()
  if (process.platform !== 'darwin') app.quit()
})

// 安全设置
app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
})
