/**
 * 共享 IPC 通道常量 — 渲染进程和主进程必须使用相同的通道名。
 * 在 preload 中通过 contextBridge 暴露给渲染层。
 *
 * 注意：本文件使用 CommonJS (module.exports)，
 * 因为主进程与 preload 均为 CommonJS 环境 (require)。
 * 渲染层 (Vite) 如需引用，直接 import 本文件亦可（Vite 支持 CJS interop）。
 */
const IPC = Object.freeze({
  // 应用 / 窗口
  APP_READY: 'app:ready',
  APP_GET_THEME: 'app:get-theme',
  APP_SET_THEME: 'app:set-theme',
  APP_THEME_CHANGED: 'app:theme-changed',   // 主 -> 渲染 主题变更推送
  APP_ENCRYPTION_STATUS: 'app:encryption-status',
  APP_RESTART: 'app:restart',

  // 资产 (加密存储)
  ASSET_LIST: 'asset:list',
  ASSET_SAVE: 'asset:save',
  ASSET_DELETE: 'asset:delete',
  ASSET_GET: 'asset:get',

  // SSH 引擎
  SSH_CONNECT: 'ssh:connect',
  SSH_DISCONNECT: 'ssh:disconnect',
  SSH_WRITE: 'ssh:write',
  SSH_RESIZE: 'ssh:resize',
  SSH_LIST_SESSIONS: 'ssh:list-sessions',
  SSH_DATA: 'ssh:data',          // 主 -> 渲染
  SSH_CLOSE: 'ssh:close',         // 主 -> 渲染

  // SFTP 引擎
  SFTP_LIST: 'sftp:list',
  SFTP_UPLOAD: 'sftp:upload',
  SFTP_DOWNLOAD: 'sftp:download',
  SFTP_MKDIR: 'sftp:mkdir',
  SFTP_DELETE: 'sftp:delete',
  SFTP_PROGRESS: 'sftp:progress',   // 主 -> 渲染 传输进度推送

  // 本地文件系统 (SFTP 本地侧浏览 / 上传选文件)
  FS_LIST_LOCAL: 'fs:list-local',
  FS_LIST_DRIVES: 'fs:list-drives',
  FS_CHOOSE: 'fs:choose',
  FS_SAVE_FILE: 'fs:save-file',
  FS_READ_TEXT: 'fs:read-text',
  FS_WRITE_TEXT: 'fs:write-text',

  // 设置 / 背景图 / 玻璃拟态
  SETTINGS_GET_BG: 'settings:get-bg',
  SETTINGS_SAVE_BG: 'settings:save-bg',
  SETTINGS_CLEAR_BG: 'settings:clear-bg',
  SETTINGS_GET_GLASS: 'settings:get-glass',
  SETTINGS_SAVE_GLASS: 'settings:save-glass',
  SETTINGS_SET_DATADIR: 'settings:set-datadir',
  SETTINGS_RESET_DATADIR: 'settings:reset-datadir',

  // 快捷命令 (工具坞)
  TOOL_LIST_TEMPLATES: 'tool:list-templates',
  TOOL_SAVE_TEMPLATE: 'tool:save-template',
  TOOL_DELETE_TEMPLATE: 'tool:delete-template',

  // 数据库引擎
  DB_CONNECT: 'db:connect',
  DB_DISCONNECT: 'db:disconnect',
  DB_LIST: 'db:list',
  DB_TABLES: 'db:tables',
  DB_SCHEMA: 'db:schema',
  DB_TABLE_DETAIL: 'db:table-detail',
  DB_QUERY: 'db:query',
  DB_EXPORT: 'db:export',
  DB_META: 'db:meta',
  DB_SEARCH: 'db:search',
  DB_STATUS: 'db:status',          // 主 -> 渲染 连接级错误/断连推送

  // Docker 引擎
  DOCKER_CONNECT: 'docker:connect',
  DOCKER_DISCONNECT: 'docker:disconnect',
  DOCKER_LIST_CONTAINERS: 'docker:list-containers',
  DOCKER_LOGS: 'docker:logs',
  DOCKER_STATS: 'docker:stats',
  DOCKER_STATS_STOP: 'docker:stats-stop',
  DOCKER_IMAGE_LIST: 'docker:image-list',
  DOCKER_CONTAINER_START: 'docker:container-start',
  DOCKER_CONTAINER_STOP: 'docker:container-stop',
})

/**
 * 资产 (连接配置) 类型 — 用于资产库。
 */
const ASSET_TYPES = Object.freeze({
  SSH: 'ssh',
  SFTP: 'sftp',
  DATABASE: 'database',
  DOCKER: 'docker',
  RDP: 'rdp',
})

/**
 * 数据库类型白名单
 */
const DB_TYPES = Object.freeze({
  MYSQL: 'mysql',
  POSTGRES: 'postgres',
  SQLITE: 'sqlite',
  CLICKHOUSE: 'clickhouse',
  REDIS: 'redis',
})

module.exports = { IPC, ASSET_TYPES, DB_TYPES }
