/**
 * 数据库引擎 — 多数据库适配器
 *
 * 支持类型：mysql / postgres / sqlite / clickhouse / redis
 * 设计：统一的 DbAdapter 接口 (connect/query/list/schema/import/export)
 *
 * MVP 实现策略：
 *   - SQLite: 完整 (better-sqlite3 同步 API)
 *   - MySQL:   完整 (mysql2/promise)
 *   - Postgres: 完整 (pg)
 *   - Redis:   完整 (redis)
 *   - ClickHouse: 留 HTTP 适配器 (使用 fetch + ch.js 占位)
 */
const { randomUUID } = require('node:crypto')
const { Worker } = require('node:worker_threads')
const nodePath = require('node:path')
const { BrowserWindow } = require('electron')
const { IPC } = require('../../shared/ipc-channels')

/** id -> { type, client } */
const connections = new Map()

/** 非 SQLite 查询的统一超时（SQLite 走 worker RPC 自带超时 + 中断） */
const QUERY_TIMEOUT_MS = 30000

/** 给异步操作加超时保护：超时后 UI 不再被挂起的查询卡住 */
function withTimeout(promise, ms = QUERY_TIMEOUT_MS, label = '查询') {
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      const t = setTimeout(() => reject(new Error(`${label}超时（${ms}ms）`)), ms)
      if (typeof t.unref === 'function') t.unref()
    }),
  ])
}

/* ---------------- SQLite worker RPC ----------------
 * better-sqlite3 是同步 API，跑在主进程会阻塞所有 IPC。
 * 每个连接一个 worker 线程；长查询可通过 interrupt 消息跨线程中断。 */
function rpcOp(worker, op, args = [], timeoutMs = QUERY_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const msgId = randomUUID()
    const cleanup = () => { clearTimeout(timer); worker.off('message', onMessage) }
    const onMessage = (m) => {
      if (m.msgId !== msgId) return
      cleanup()
      m.ok ? resolve(m.data) : reject(new Error(m.data))
    }
    const timer = setTimeout(() => {
      cleanup()
      try { worker.postMessage({ msgId: 'int_' + msgId, op: 'interrupt' }) } catch {}
      reject(new Error(`SQLite 查询超时（${timeoutMs}ms），已发送中断请求`))
    }, timeoutMs)
    if (typeof timer.unref === 'function') timer.unref()
    worker.on('message', onMessage)
    worker.postMessage({ msgId, op, args })
  })
}

/** 连接级错误广播（Redis 等客户端断连时渲染层即时感知） */
function broadcastDbStatus(id, error) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(IPC.DB_STATUS, { id, error })
  }
}

/** 数据库连接错误中文翻译 */
function translateDbError(err) {
  const msg = (err && (err.message || err.code)) || String(err || '')
  const rules = [
    [/access denied|ER_ACCESS_DENIED|28P01|WRONGPASS|invalid password|authentication failed/i,
      '认证失败：请检查用户名、密码是否正确'],
    [/unknown database|ER_BAD_DB_ERROR|3D000|does not exist/i,
      '数据库不存在：请检查数据库名是否正确'],
    [/ECONNREFUSED|ER_CONN_HOST_ERROR|connection refused/i,
      '连接被拒绝：请检查主机地址与端口是否可达'],
    [/ENOTFOUND/i, '主机解析失败：请检查 IP/域名是否正确'],
    [/ETIMEDOUT|timeout|timed out/i, '连接超时：请检查网络、防火墙或数据库服务状态'],
    [/ER_DBACCESS_DENIED|permission denied|42501/i, '无权限访问该数据库/表'],
    [/connection reset|ECONNRESET/i, '连接被重置：数据库服务可能已停止'],
    [/max connection/i, '连接数已达上限，请稍后再试'],
  ]
  for (const [re, zh] of rules) {
    if (re.test(msg)) return zh
  }
  return `连接失败：${msg}`
}

async function connect(cfg) {
  if (!cfg || !cfg.type) throw new Error('缺少数据库类型')
  const id = randomUUID()
  const adapter = ADAPTERS[cfg.type]
  if (!adapter) throw new Error('不支持的数据库类型: ' + cfg.type)
  let client
  try {
    client = await adapter.connect(cfg)
  } catch (e) {
    throw new Error(translateDbError(e))
  }
  connections.set(id, { type: cfg.type, cfg, client })
  // Redis 客户端支持事件订阅：断连/错误主动推送，界面不再等到下次查询才发现
  if (cfg.type === 'redis' && typeof client.on === 'function') {
    client.on('error', (e) => broadcastDbStatus(id, e?.message || String(e)))
  }
  return { id, type: cfg.type, banner: `已连接 ${cfg.type}` }
}

function disconnect(id) {
  const c = connections.get(id)
  if (!c) return
  try { ADAPTERS[c.type].disconnect && ADAPTERS[c.type].disconnect(c.client) } catch {}
  connections.delete(id)
}

/** 关闭全部数据库连接（应用退出时统一清理） */
function disposeAll() {
  for (const id of [...connections.keys()]) disconnect(id)
}

async function list(id) {
  const c = connections.get(id)
  // 连接已不存在（主进程重启清空连接表等）：返回标记而非抛错，
  // 避免 ipcMain.handle 把每次失效调用都打进控制台
  if (!c) return { gone: true, reason: '连接不存在' }
  return ADAPTERS[c.type].list(c.client, c.cfg)
}

/** 按需加载指定数据库的表（Navicat 式展开），不存在的连接返回 gone 标记 */
async function tables(id, database) {
  const c = connections.get(id)
  if (!c) return { gone: true, reason: '连接不存在' }
  if (!database) return { tables: [] }
  return ADAPTERS[c.type].tables(c.client, c.cfg, database)
}

/** Navicat 式：加载数据库下的分类内容（表/视图/函数），视图与函数按数据库类型尽力实现 */
async function schema(id, database) {
  const c = connections.get(id)
  if (!c) return { gone: true, reason: '连接不存在' }
  if (!database) return { tables: [], views: [], functions: [] }
  return ADAPTERS[c.type].schema(c.client, c.cfg, database)
}

/** 加载表详情：字段 / 索引 / 外键（Navicat 式展开表节点） */
async function tableDetail(id, database, table) {
  const c = connections.get(id)
  if (!c) return { gone: true, reason: '连接不存在' }
  if (!table) return { columns: [], indexes: [], foreignKeys: [], checks: [], triggers: [] }
  return ADAPTERS[c.type].tableDetail(c.client, c.cfg, database, table)
}

/** 单次查询返回的最大行数（防大结果集 IPC 内存峰值；导出走 exportFile） */
const QUERY_ROW_LIMIT = 5000

async function query(id, sql, params = []) {
  const c = connections.get(id)
  if (!c) return { gone: true, reason: '连接不存在' }
  const t0 = Date.now()
  // SQLite 走 worker RPC 自带超时+中断；其余适配器用 Promise 竞速超时兜底
  const p = ADAPTERS[c.type].query(c.client, sql, params)
  const res = c.type === 'sqlite' ? await p : await withTimeout(p)
  if (Array.isArray(res.rows) && res.rows.length > QUERY_ROW_LIMIT) {
    res.rows = res.rows.slice(0, QUERY_ROW_LIMIT)
    res.truncated = true
  }
  return { ...res, durationMs: Date.now() - t0 }
}

/** 拉取数据库的完整元数据（所有表 + 字段 + 索引 + 外键），供数据字典 / ER 图使用 */
async function meta(id, database) {
  const c = connections.get(id)
  if (!c) return { gone: true, reason: '连接不存在' }
  if (!database) return { tables: [] }
  const p = ADAPTERS[c.type].meta(c.client, c.cfg, database)
  return c.type === 'sqlite' ? p : withTimeout(p, QUERY_TIMEOUT_MS, '元数据加载')
}

/** 在数据库中查找：跨表文本搜索（按各类型文本字段 LIKE 匹配） */
async function search(id, database, keyword) {
  const c = connections.get(id)
  if (!c) return { gone: true, reason: '连接不存在' }
  if (!database || !keyword || !String(keyword).trim()) return { keyword, tables: [] }
  const p = ADAPTERS[c.type].search(c.client, c.cfg, database, String(keyword).trim())
  return c.type === 'sqlite' ? p : withTimeout(p, QUERY_TIMEOUT_MS, '全库搜索')
}

async function exportFile(id, table, file, format = 'csv') {
  const c = connections.get(id)
  if (!c) return { gone: true, reason: '连接不存在' }
  // 标识符转义，防止表名拼接 SQL；多取 1 行用于判断是否被截断
  const q = ADAPTERS[c.type].quoteId || ((s) => s)
  const LIMIT = 100000
  const rows = await ADAPTERS[c.type].query(c.client, `SELECT * FROM ${q(table)} LIMIT ${LIMIT + 1}`)
  const truncated = rows.rows.length > LIMIT
  const data = rows.rows.slice(0, LIMIT)
  const fs = require('node:fs/promises')
  if (format === 'json') {
    await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf-8')
  } else {
    // CSV：分块追加写，避免大表内存峰值
    if (!data.length) { await fs.writeFile(file, '', 'utf-8'); return { rows: 0, truncated: false, file } }
    const escape = (v) => {
      if (v === null || v === undefined) return ''
      let s = String(v)
      // 防 Excel/Sheets 公式注入：以 = + - @ 开头时前缀单引号
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const headers = Object.keys(data[0])
    await fs.writeFile(file, headers.join(',') + '\n', 'utf-8')
    let buf = []
    for (const r of data) {
      buf.push(headers.map((h) => escape(r[h])).join(','))
      if (buf.length >= 5000) { await fs.appendFile(file, buf.join('\n') + '\n', 'utf-8'); buf = [] }
    }
    if (buf.length) await fs.appendFile(file, buf.join('\n') + '\n', 'utf-8')
  }
  return { rows: data.length, file, truncated }
}

/* ----------------------------- 适配器 ----------------------------- */

const ADAPTERS = {}

/* SQLite — worker 线程版（同步 API 隔离在 worker，主进程不再被大查询阻塞） */
ADAPTERS.sqlite = {
  async connect(cfg) {
    const fsp = require('node:fs/promises')
    const file = cfg.database || ':memory:'
    // 防御：文件不存在时 better-sqlite3 会静默创建空库，用户输错路径会误以为数据丢失
    if (file !== ':memory:') {
      try {
        await fsp.access(file)
      } catch (e) {
        if (e.code === 'ENOENT') throw new Error(`SQLite 数据库文件不存在: ${file}`)
        throw e
      }
    }
    const worker = new Worker(nodePath.join(__dirname, 'sqlite-worker.js'), { workerData: { file } })
    await rpcOp(worker, 'ping', [], 5000)
    return { worker }
  },
  async disconnect(c) {
    try { await rpcOp(c.worker, 'close', [], 2000) } catch {}
    try { await c.worker.terminate() } catch {}
  },
  quoteId(s) { return '"' + String(s).replace(/"/g, '""') + '"' },
  async list(c) {
    return rpcOp(c.worker, 'list', [])
  },
  async tables(c) {
    return rpcOp(c.worker, 'tables', [])
  },
  async schema(c) {
    return rpcOp(c.worker, 'schema', [])
  },
  async tableDetail(c, cfg, database, table) {
    return rpcOp(c.worker, 'tableDetail', [database, table])
  },
  async query(c, sql, params = []) {
    return rpcOp(c.worker, 'query', [sql, params])
  },
  /** SQLite：完整元数据（表 + 字段 + 索引 + 外键），worker 内执行 */
  async meta(c) {
    return rpcOp(c.worker, 'meta', [])
  },
  /** SQLite：跨表文本搜索 */
  async search(c, _cfg, database, keyword) {
    return rpcOp(c.worker, 'search', [database, keyword])
  },
}

/* MySQL */
ADAPTERS.mysql = {
  connect(cfg) {
    const mysql = require('mysql2/promise')
    return mysql.createConnection({
      host: cfg.host,
      port: cfg.port || 3306,
      user: cfg.username,
      password: cfg.password,
      database: cfg.database,
      connectTimeout: 10000,
    })
  },
  async disconnect(c) { try { await c.end() } catch {} },
  quoteId(s) { return '`' + String(s).replace(/`/g, '``') + '`' },
  async list(c) {
    const [dbs] = await c.query("SHOW DATABASES")
    return { databases: dbs.map((db) => ({ name: db.Database })) }
  },
  /** MySQL 可在同一连接内查看任意库的表 */
  async tables(c, cfg, db) {
    const q = '`' + String(db).replace(/`/g, '``') + '`'
    const [t] = await c.query(`SHOW TABLES FROM ${q}`)
    return { tables: t.map((row) => Object.values(row)[0]) }
  },
  /** MySQL：分类加载表/视图/函数 */
  async schema(c, cfg, db) {
    const q = '`' + String(db).replace(/`/g, '``') + '`'
    const [tables] = await c.query(`SHOW FULL TABLES FROM ${q} WHERE Table_type='BASE TABLE'`)
    const [views] = await c.query(`SHOW FULL TABLES FROM ${q} WHERE Table_type='VIEW'`)
    const [funcs] = await c.query(
      "SELECT routine_name FROM information_schema.ROUTINES WHERE routine_schema = ? AND routine_type = 'FUNCTION'",
      [db],
    )
    return {
      tables: tables.map((r) => Object.values(r)[0]),
      views: views.map((r) => Object.values(r)[0]),
      functions: funcs.map((r) => r.routine_name || Object.values(r)[0] || ''),
    }
  },
  /** MySQL：表详情（字段/索引/外键） */
  async tableDetail(c, cfg, db, table) {
    const q = '`' + String(db).replace(/`/g, '``') + '`'
    const t = '`' + String(table).replace(/`/g, '``') + '`'
    const [cols] = await c.query(`SHOW FULL COLUMNS FROM ${q}.${t}`)
    const [idx] = await c.query(`SHOW INDEX FROM ${q}.${t}`)
    const [fk] = await c.query(
      `SELECT constraint_name, column_name, referenced_table_name, referenced_column_name
       FROM information_schema.KEY_COLUMN_USAGE
       WHERE table_schema = ? AND table_name = ? AND referenced_table_name IS NOT NULL`,
      [db, table],
    )
    // 检查约束 / 触发器（MySQL 8+ 才有 check_constraints；5.7 静默降级为空）
    let checks = [], triggers = []
    try {
      const [chk] = await c.query(
        `SELECT cc.constraint_name name, cc.check_clause def
         FROM information_schema.check_constraints cc
         JOIN information_schema.table_constraints tc
           ON tc.constraint_name = cc.constraint_name AND tc.constraint_schema = cc.constraint_schema
         WHERE tc.constraint_type = 'CHECK' AND tc.table_schema = ? AND tc.table_name = ?`,
        [db, table],
      )
      checks = chk
    } catch {}
    try {
      const [trg] = await c.query(
        `SELECT trigger_name name, CONCAT(action_timing, ' ', event_manipulation) def
         FROM information_schema.triggers WHERE trigger_schema = ? AND event_object_table = ?`,
        [db, table],
      )
      triggers = trg
    } catch {}
    return {
      columns: cols.map((x) => ({
        name: x.Field, type: x.Type, nullable: x.Null,
        key: x.Key, default: x.Default, comment: x.Comment,
      })),
      indexes: idx.map((x) => ({ name: x.Key_name, column: x.Column_name, unique: !x.Non_unique, type: x.Index_type })),
      foreignKeys: fk.map((x) => ({
        name: x.constraint_name, column: x.column_name,
        refTable: x.referenced_table_name, refColumn: x.referenced_column_name,
      })),
      checks, triggers,
    }
  },
  async query(c, sql, params) {
    const [rows, fields] = await c.query(sql, params)
    return {
      rows: Array.isArray(rows) ? rows : [],
      fields: (fields || []).map((f) => ({ name: f.name, type: f.columnType })),
      affectedRows: Array.isArray(rows) ? rows.length : rows.affectedRows,
    }
  },
  /** MySQL：完整元数据（表 + 字段 + 索引 + 外键），4 条 SQL 一次性拉取 */
  async meta(c, _cfg, db) {
    const q = '`' + String(db).replace(/`/g, '``') + '`'
    const [tables] = await c.query(`SHOW FULL TABLES FROM ${q} WHERE Table_type='BASE TABLE'`)
    const names = tables.map((r) => Object.values(r)[0])
    const [cols] = await c.query(
      `SELECT table_name t, column_name n, column_type ty, is_nullable nu, column_key k, column_default d, column_comment cm
       FROM information_schema.columns WHERE table_schema = ? ORDER BY table_name, ordinal_position`,
      [db],
    )
    const [idx] = await c.query(
      `SELECT table_name t, index_name n, column_name c, non_unique nu, index_type ty
       FROM information_schema.statistics WHERE table_schema = ? ORDER BY table_name, index_name, seq_in_index`,
      [db],
    )
    const [fk] = await c.query(
      `SELECT table_name t, constraint_name n, column_name c, referenced_table_name rt, referenced_column_name rc
       FROM information_schema.KEY_COLUMN_USAGE
       WHERE table_schema = ? AND referenced_table_name IS NOT NULL`,
      [db],
    )
    const tmap = {}
    for (const n of names) tmap[n] = { name: n, columns: [], indexes: [], foreignKeys: [] }
    for (const x of cols) if (tmap[x.t]) tmap[x.t].columns.push({ name: x.n, type: x.ty, nullable: x.nu, key: x.k, default: x.d, comment: x.cm })
    for (const x of idx) if (tmap[x.t]) tmap[x.t].indexes.push({ name: x.n, column: x.c, unique: !x.nu, type: x.ty })
    for (const x of fk) if (tmap[x.t]) tmap[x.t].foreignKeys.push({ name: x.n, column: x.c, refTable: x.rt, refColumn: x.rc })
    return { tables: Object.values(tmap) }
  },
  /** MySQL：跨表文本搜索 */
  async search(c, _cfg, db, keyword) {
    const [cols] = await c.query(
      `SELECT table_name t, column_name n FROM information_schema.columns
       WHERE table_schema = ? AND data_type IN ('char','varchar','text','tinytext','mediumtext','longtext','enum','set')`,
      [db],
    )
    const byTable = {}
    for (const x of cols) (byTable[x.t] = byTable[x.t] || []).push(x.n)
    const q = '`' + String(db).replace(/`/g, '``') + '`'
    const like = `%${keyword}%`
    const results = []
    for (const tname of Object.keys(byTable).slice(0, 30)) {
      const cArr = byTable[tname]
      const qt = '`' + String(tname).replace(/`/g, '``') + '`'
      const sel = cArr.map((c) => '`' + String(c).replace(/`/g, '``') + '`').join(', ')
      const where = cArr.map((c) => '`' + String(c).replace(/`/g, '``') + '` LIKE ?').join(' OR ')
      try {
        const [rows] = await c.query(`SELECT ${sel} FROM ${q}.${qt} WHERE ${where} LIMIT 20`, cArr.map(() => like))
        if (rows.length) results.push({ table: tname, columns: cArr, rows })
      } catch {}
    }
    return { keyword, tables: results }
  },
}

/* PostgreSQL */
ADAPTERS.postgres = {
  connect(cfg) {
    const { Client } = require('pg')
    return new Client({
      host: cfg.host,
      port: cfg.port || 5432,
      user: cfg.username,
      password: cfg.password,
      // 未指定数据库时连默认的 postgres 库，避免 pg 用用户名当库名导致连接失败
      database: cfg.database || 'postgres',
      connectionTimeoutMillis: 10000,
    }).connect()
  },
  async disconnect(c) { try { await c.end() } catch {} },
  quoteId(s) { return '"' + String(s).replace(/"/g, '""') + '"' },
  async list(c) {
    const dbs = await c.query("SELECT datname FROM pg_database WHERE datistemplate=false")
    return { databases: dbs.rows.map((r) => ({ name: r.datname })) }
  },
  /** PostgreSQL 单连接只能查当前库（连接时未指定则默认 postgres 库）的表 */
  async tables(c, cfg, db) {
    const connected = (cfg && cfg.database) || 'postgres'
    if (db !== connected) return { tables: [], note: 'PostgreSQL 单连接无法跨库查看，请改用该库连接' }
    const t = await c.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")
    return { tables: t.rows.map((r) => r.tablename) }
  },
  /** PostgreSQL：分类加载表/视图/函数（仅当前库） */
  async schema(c, cfg, db) {
    const connected = (cfg && cfg.database) || 'postgres'
    if (db !== connected) return { tables: [], views: [], functions: [], note: 'PostgreSQL 单连接无法跨库查看，请改用该库连接' }
    const tables = await c.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")
    const views = await c.query("SELECT viewname FROM pg_views WHERE schemaname='public'")
    const funcs = await c.query("SELECT DISTINCT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace")
    return {
      tables: tables.rows.map((r) => r.tablename),
      views: views.rows.map((r) => r.viewname),
      functions: funcs.rows.map((r) => r.proname),
    }
  },
  /** PostgreSQL：表详情（字段/索引/外键） */
  async tableDetail(c, cfg, db, table) {
    const cols = await c.query(
      "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",
      [table],
    )
    const idx = await c.query("SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename=$1", [table])
    const fk = await c.query(
      `SELECT tc.constraint_name, kcu.column_name, ccu.table_name AS ref_table, ccu.column_name AS ref_column
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
       WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public' AND tc.table_name = $1`,
      [table],
    )
    // 检查约束 / 触发器（public schema，失败降级为空）
    const chk = await c.query(
      `SELECT conname name, pg_get_constraintdef(oid) def FROM pg_constraint
       WHERE contype = 'c' AND conrelid = ('public.' || $1)::regclass`,
      [table],
    ).catch(() => ({ rows: [] }))
    const trg = await c.query(
      `SELECT tgname name, pg_get_triggerdef(oid) def FROM pg_trigger
       WHERE tgrelid = ('public.' || $1)::regclass AND NOT tgisinternal`,
      [table],
    ).catch(() => ({ rows: [] }))
    return {
      columns: cols.rows.map((x) => ({
        name: x.column_name, type: x.data_type,
        nullable: x.is_nullable, default: x.column_default,
      })),
      indexes: idx.rows.map((x) => ({ name: x.indexname, def: x.indexdef })),
      foreignKeys: fk.rows.map((x) => ({
        name: x.constraint_name, column: x.column_name,
        refTable: x.ref_table, refColumn: x.ref_column,
      })),
      checks: chk.rows, triggers: trg.rows,
    }
  },
  async query(c, sql, params) {
    const r = await c.query(sql, params)
    return {
      rows: r.rows,
      fields: (r.fields || []).map((f) => ({ name: f.name, type: f.dataTypeID })),
      affectedRows: r.rowCount,
    }
  },
  /** PostgreSQL：完整元数据（表 + 字段 + 索引 + 外键，仅当前库） */
  async meta(c, cfg, db) {
    const connected = (cfg && cfg.database) || 'postgres'
    if (db !== connected) return { tables: [], note: 'PostgreSQL 单连接无法跨库查看，请改用该库连接' }
    const t = await c.query("SELECT tablename AS n FROM pg_tables WHERE schemaname='public' ORDER BY tablename")
    const cols = await c.query(
      `SELECT table_name t, column_name n, data_type ty, is_nullable nu, column_default d
       FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name, ordinal_position`,
    )
    const idx = await c.query(`SELECT tablename t, indexname n, indexdef d FROM pg_indexes WHERE schemaname='public' ORDER BY tablename, indexname`)
    const fk = await c.query(
      `SELECT tc.table_name t, tc.constraint_name n, kcu.column_name c, ccu.table_name rt, ccu.column_name rc
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
       WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`,
    )
    const tmap = {}
    for (const r of t.rows) tmap[r.n] = { name: r.n, columns: [], indexes: [], foreignKeys: [] }
    for (const r of cols.rows) if (tmap[r.t]) tmap[r.t].columns.push({ name: r.n, type: r.ty, nullable: r.nu, default: r.d })
    for (const r of idx.rows) if (tmap[r.t]) tmap[r.t].indexes.push({ name: r.n, def: r.d })
    for (const r of fk.rows) if (tmap[r.t]) tmap[r.t].foreignKeys.push({ name: r.n, column: r.c, refTable: r.rt, refColumn: r.rc })
    return { tables: Object.values(tmap) }
  },
  /** PostgreSQL：跨表文本搜索（仅当前库） */
  async search(c, cfg, db, keyword) {
    const connected = (cfg && cfg.database) || 'postgres'
    if (db !== connected) return { keyword, tables: [], note: 'PostgreSQL 单连接无法跨库查看，请改用该库连接' }
    const cols = await c.query(
      `SELECT table_name t, column_name n FROM information_schema.columns
       WHERE table_schema='public' AND data_type IN ('character varying','character','text') ORDER BY table_name`,
    )
    const byTable = {}
    for (const x of cols.rows) (byTable[x.t] = byTable[x.t] || []).push(x.n)
    const like = `%${keyword}%`
    const results = []
    for (const tname of Object.keys(byTable).slice(0, 30)) {
      const cArr = byTable[tname]
      const sel = cArr.map((x) => '"' + String(x).replace(/"/g, '""') + '"').join(', ')
      const where = cArr.map((x) => '"' + String(x).replace(/"/g, '""') + '" ILIKE $1').join(' OR ')
      try {
        const r = await c.query(`SELECT ${sel} FROM "${tname.replace(/"/g, '""')}" WHERE ${where} LIMIT 20`, [like])
        if (r.rows.length) results.push({ table: tname, columns: cArr, rows: r.rows })
      } catch {}
    }
    return { keyword, tables: results }
  },
}

/* Redis */
ADAPTERS.redis = {
  async connect(cfg) {
    const { createClient } = require('redis')
    const client = createClient({ url: `redis://${cfg.host || '127.0.0.1'}:${cfg.port || 6379}`, password: cfg.password })
    client.on('error', (e) => console.error('[redis]', e))
    await client.connect()
    return client
  },
  async disconnect(c) { try { await c.disconnect() } catch {} },
  async list(c) {
    return { databases: [{ name: 'default' }] }
  },
  async tables(c) {
    return { tables: ['keys'] }
  },
  async schema(c) {
    return { tables: ['keys'], views: [], functions: [] }
  },
  async tableDetail(c) {
    return { columns: [], indexes: [], foreignKeys: [] }
  },
  async meta() { return { tables: [] } },
  async search() { return { keyword: '', tables: [] } },
  async query(c, sql) {
    // Redis 没有 SQL，把整个语句当命令执行
    const args = sql.trim().split(/\s+/)
    const cmd = args.shift()
    if (!cmd) throw new Error('命令不能为空')
    const result = await c.sendCommand([cmd, ...args])
    return { rows: [{ result: typeof result === 'string' ? result : JSON.stringify(result) }], fields: [{ name: 'result' }] }
  },
}

/* ClickHouse — 通过 HTTP 接口 */
ADAPTERS.clickhouse = {
  async connect(cfg) {
    return {
      url: `http://${cfg.host || '127.0.0.1'}:${cfg.port || 8123}`,
      database: cfg.database || 'default',
      auth: cfg.username ? `${cfg.username}:${cfg.password || ''}` : null,
    }
  },
  async disconnect() { /* no-op */ },
  quoteId(s) { return '`' + String(s).replace(/`/g, '``') + '`' },
  async list(c) {
    const r = await chFetch(c, `SHOW DATABASES`)
    return { databases: r.split('\n').filter(Boolean).map((name) => ({ name })) }
  },
  /** ClickHouse 可在同一连接内按库名查看表 */
  async tables(c, cfg, db) {
    const q = '`' + String(db).replace(/`/g, '``') + '`'
    const t = await chFetch(c, `SHOW TABLES FROM ${q}`)
    return { tables: t.split('\n').filter(Boolean) }
  },
  async schema(c, cfg, db) {
    const q = '`' + String(db).replace(/`/g, '``') + '`'
    const t = await chFetch(c, `SHOW TABLES FROM ${q}`)
    return { tables: t.split('\n').filter(Boolean), views: [], functions: [] }
  },
  async tableDetail(c, cfg, db, table) {
    const q = '`' + String(db).replace(/`/g, '``') + '`'
    const t = '`' + String(table).replace(/`/g, '``') + '`'
    const d = await chFetch(c, `DESCRIBE TABLE ${q}.${t}`)
    const columns = d.split('\n').filter(Boolean).map((line) => {
      const [name, type] = line.split('\t')
      return { name, type }
    })
    return { columns, indexes: [], foreignKeys: [], checks: [], triggers: [] }
  },
  async meta(c, cfg, db) {
    const q = '`' + String(db).replace(/`/g, '``') + '`'
    const t = await chFetch(c, `SHOW TABLES FROM ${q}`)
    const names = t.split('\n').filter(Boolean)
    const tables = []
    for (const name of names.slice(0, 50)) {
      const d = await chFetch(c, `DESCRIBE TABLE ${q}.\`${name.replace(/`/g, '``')}\``)
      tables.push({
        name,
        columns: d.split('\n').filter(Boolean).map((line) => {
          const [n, ty] = line.split('\t')
          return { name: n, type: ty }
        }),
        indexes: [], foreignKeys: [],
      })
    }
    return { tables }
  },
  async search() { return { keyword: '', tables: [] } },
  async query(c, sql) {
    const text = await chFetch(c, sql + ' FORMAT JSON')
    try {
      const json = JSON.parse(text)
      const rows = json.data || []
      const fields = (json.meta || []).map((m) => ({ name: m.name, type: m.type }))
      return { rows, fields }
    } catch {
      return { rows: [{ result: text }], fields: [{ name: 'result' }] }
    }
  },
}

async function chFetch(client, sql) {
  const headers = { 'Content-Type': 'text/plain' }
  if (client.auth) headers['Authorization'] = 'Basic ' + Buffer.from(client.auth).toString('base64')
  const url = `${client.url}/?database=${encodeURIComponent(client.database)}`
  // 与其他适配器一致：10s 连接超时，避免不可达时无限挂起
  const resp = await fetch(url, { method: 'POST', headers, body: sql, signal: AbortSignal.timeout(10000) })
  if (!resp.ok) throw new Error(`ClickHouse HTTP ${resp.status}: ${await resp.text()}`)
  return resp.text()
}

module.exports = { connect, disconnect, disposeAll, list, tables, schema, tableDetail, query, meta, search, exportFile }
