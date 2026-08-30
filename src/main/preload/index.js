/**
 * Preload 脚本 — 在 contextIsolation 下向渲染进程暴露受限的 API。
 *
 * 所有暴露的方法都通过 ipcRenderer 走主进程；不允许直接暴露 fs / net。
 */
const { contextBridge, ipcRenderer } = require('electron')
const { IPC } = require('../../shared/ipc-channels')

// 订阅助手：把主进程推送 (如 SSH_DATA) 暴露为可订阅的事件总线
function on(channel, handler) {
  const listener = (_e, ...args) => handler(...args)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  // 应用
  app: {
    ready: () => ipcRenderer.invoke(IPC.APP_READY),
    getTheme: () => ipcRenderer.invoke(IPC.APP_GET_THEME),
    setTheme: (theme) => ipcRenderer.send(IPC.APP_SET_THEME, theme),
    onThemeChange: (cb) => on(IPC.APP_THEME_CHANGED, cb),
    getEncryptionAvailable: () => ipcRenderer.invoke(IPC.APP_ENCRYPTION_STATUS),
    restart: () => ipcRenderer.invoke(IPC.APP_RESTART),
  },

  // 资产
  asset: {
    list: (type) => ipcRenderer.invoke(IPC.ASSET_LIST, type),
    save: (asset) => ipcRenderer.invoke(IPC.ASSET_SAVE, asset),
    remove: (id) => ipcRenderer.invoke(IPC.ASSET_DELETE, id),
    get: (id) => ipcRenderer.invoke(IPC.ASSET_GET, id),
  },

  // SSH
  ssh: {
    connect: (opts) => ipcRenderer.invoke(IPC.SSH_CONNECT, opts),
    disconnect: (id) => ipcRenderer.send(IPC.SSH_DISCONNECT, { id }),
    write: (id, data) => ipcRenderer.send(IPC.SSH_WRITE, { id, data }),
    resize: (id, cols, rows) => ipcRenderer.send(IPC.SSH_RESIZE, { id, cols, rows }),
    listSessions: () => ipcRenderer.invoke(IPC.SSH_LIST_SESSIONS),
    onData: (cb) => on(IPC.SSH_DATA, cb),
    onClose: (cb) => on(IPC.SSH_CLOSE, cb),
  },

  // SFTP
  sftp: {
    list: (sessionId, p) => ipcRenderer.invoke(IPC.SFTP_LIST, { sessionId, path: p }),
    upload: (sessionId, local, remote) =>
      ipcRenderer.invoke(IPC.SFTP_UPLOAD, { sessionId, local, remote }),
    download: (sessionId, remote, local) =>
      ipcRenderer.invoke(IPC.SFTP_DOWNLOAD, { sessionId, remote, local }),
    mkdir: (sessionId, p) => ipcRenderer.invoke(IPC.SFTP_MKDIR, { sessionId, p }),
    remove: (sessionId, p) => ipcRenderer.invoke(IPC.SFTP_DELETE, { sessionId, p }),
    onProgress: (cb) => on(IPC.SFTP_PROGRESS, cb),
  },

  // 本地文件系统
  fs: {
    list: (p) => ipcRenderer.invoke(IPC.FS_LIST_LOCAL, p),
    listDrives: () => ipcRenderer.invoke(IPC.FS_LIST_DRIVES),
    choose: (mode = 'openFile') => ipcRenderer.invoke(IPC.FS_CHOOSE, { mode }),
    saveFile: (opts) => ipcRenderer.invoke(IPC.FS_SAVE_FILE, opts),
    readText: (p) => ipcRenderer.invoke(IPC.FS_READ_TEXT, p),
    writeText: (p, content) => ipcRenderer.invoke(IPC.FS_WRITE_TEXT, { path: p, content }),
  },

  // 设置 / 背景图 / 玻璃拟态
  settings: {
    getBackground: () => ipcRenderer.invoke(IPC.SETTINGS_GET_BG),
    saveBackground: (dataUrl) => ipcRenderer.invoke(IPC.SETTINGS_SAVE_BG, dataUrl),
    clearBackground: () => ipcRenderer.invoke(IPC.SETTINGS_CLEAR_BG),
    getGlass: () => ipcRenderer.invoke(IPC.SETTINGS_GET_GLASS),
    saveGlass: (cfg) => ipcRenderer.invoke(IPC.SETTINGS_SAVE_GLASS, cfg),
    setDataDir: () => ipcRenderer.invoke(IPC.SETTINGS_SET_DATADIR),
    resetDataDir: () => ipcRenderer.invoke(IPC.SETTINGS_RESET_DATADIR),
  },

  // 工具坞
  tool: {
    listTemplates: () => ipcRenderer.invoke(IPC.TOOL_LIST_TEMPLATES),
    saveTemplate: (tpl) => ipcRenderer.invoke(IPC.TOOL_SAVE_TEMPLATE, tpl),
    deleteTemplate: (id) => ipcRenderer.invoke(IPC.TOOL_DELETE_TEMPLATE, id),
  },

  // 数据库
  db: {
    connect: (cfg) => ipcRenderer.invoke(IPC.DB_CONNECT, cfg),
    disconnect: (id) => ipcRenderer.send(IPC.DB_DISCONNECT, { id }),
    list: (id) => ipcRenderer.invoke(IPC.DB_LIST, { id }),
    tables: (id, database) => ipcRenderer.invoke(IPC.DB_TABLES, { id, database }),
    schema: (id, database) => ipcRenderer.invoke(IPC.DB_SCHEMA, { id, database }),
    tableDetail: (id, database, table) => ipcRenderer.invoke(IPC.DB_TABLE_DETAIL, { id, database, table }),
    query: (id, sql, params) => ipcRenderer.invoke(IPC.DB_QUERY, { id, sql, params }),
    export: (id, table, file, format) => ipcRenderer.invoke(IPC.DB_EXPORT, { id, table, file, format }),
    meta: (id, database) => ipcRenderer.invoke(IPC.DB_META, { id, database }),
    search: (id, database, keyword) => ipcRenderer.invoke(IPC.DB_SEARCH, { id, database, keyword }),
    onStatus: (cb) => on(IPC.DB_STATUS, cb),
  },

  // Docker
  docker: {
    connect: (cfg) => ipcRenderer.invoke(IPC.DOCKER_CONNECT, cfg),
    disconnect: (id) => ipcRenderer.send(IPC.DOCKER_DISCONNECT, { id }),
    listContainers: (id, all = true) => ipcRenderer.invoke(IPC.DOCKER_LIST_CONTAINERS, { id, all }),
    logs: (id, containerId, tail = 200) => ipcRenderer.invoke(IPC.DOCKER_LOGS, { id, containerId, tail }),
    stats: (id, containerId) => ipcRenderer.send(IPC.DOCKER_STATS, { id, containerId }),
    onStats: (cb) => on(IPC.DOCKER_STATS, cb),
    stopStats: (id) => ipcRenderer.invoke(IPC.DOCKER_STATS_STOP, { id }),
    listImages: (id) => ipcRenderer.invoke(IPC.DOCKER_IMAGE_LIST, { id }),
    start: (id, cid) => ipcRenderer.invoke(IPC.DOCKER_CONTAINER_START, { id, containerId: cid }),
    stop: (id, cid) => ipcRenderer.invoke(IPC.DOCKER_CONTAINER_STOP, { id, containerId: cid }),
  },
}

contextBridge.exposeInMainWorld('liushub', api)

// 暴露共享常量 (渲染层用)
contextBridge.exposeInMainWorld('LIUSHUB_CONST', {
  ASSET_TYPES: require('../../shared/ipc-channels').ASSET_TYPES,
  DB_TYPES: require('../../shared/ipc-channels').DB_TYPES,
})
