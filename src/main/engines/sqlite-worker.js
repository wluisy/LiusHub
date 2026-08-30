/**
 * SQLite 工作线程 — better-sqlite3 同步 API 运行在独立线程。
 *
 * 目的：大查询不再阻塞 Electron 主进程（主进程阻塞会卡住所有窗口的全部 IPC，
 * 包括 SSH 终端输出转发）。协议：
 *   请求  { msgId, op, args: [...] }
 *   响应  { msgId, ok, data }        ok=false 时 data 为错误消息
 *   特殊  op='interrupt' 无需应答，用于主线程中断长时间运行的查询
 *         op='close'    关闭数据库后应答
 */
const { workerData, parentPort } = require('node:worker_threads')
const Database = require('better-sqlite3')

const db = new Database(workerData.file)

const quoteT = (s) => '"' + String(s).replace(/"/g, '""') + '"'
const quoteQ = (s) => "'" + String(s).replace(/'/g, "''") + "'"

const handlers = {
  ping() { return { ok: true } },
  list() {
    return { databases: [{ name: 'main' }] }
  },
  tables() {
    const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
    return { tables: t.map((r) => r.name) }
  },
  schema() {
    const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()
    const v = db.prepare("SELECT name FROM sqlite_master WHERE type='view'").all()
    return { tables: t.map((r) => r.name), views: v.map((r) => r.name), functions: [] }
  },
  tableDetail(_database, table) {
    const q = quoteQ(table)
    const cols = db.prepare(`PRAGMA table_info(${q})`).all()
    const idxs = db.prepare(`PRAGMA index_list(${q})`).all()
    const fks = db.prepare(`PRAGMA foreign_key_list(${q})`).all()
    const trigs = db.prepare(`SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name = ${q}`).all()
    return {
      checks: [],
      columns: cols.map((x) => ({
        name: x.name, type: x.type,
        nullable: x.notnull ? 'NO' : 'YES',
        key: x.pk ? 'PRI' : '',
        default: x.dflt_value,
      })),
      indexes: idxs.map((x) => ({ name: x.name, unique: !!x.unique })),
      foreignKeys: fks.map((x) => ({ name: 'fk_' + x.id, column: x.from, refTable: x.table, refColumn: x.to })),
      triggers: trigs.map((x) => ({ name: x.name, def: '' })),
    }
  },
  query(sql, params = []) {
    const stmt = db.prepare(sql)
    if (stmt.reader) {
      const rows = stmt.all(...params)
      return { rows, fields: stmt.columns().map((c) => ({ name: c.name, type: c.type })) }
    }
    const info = stmt.run(...params)
    return { rows: [], affectedRows: info.changes, insertId: info.lastInsertRowid }
  },
  meta() {
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name)
    return {
      tables: names.map((name) => {
        const cols = db.prepare(`PRAGMA table_info(${quoteQ(name)})`).all()
        const idxs = db.prepare(`PRAGMA index_list(${quoteQ(name)})`).all()
        const fks = db.prepare(`PRAGMA foreign_key_list(${quoteQ(name)})`).all()
        return {
          name,
          columns: cols.map((x) => ({
            name: x.name, type: x.type,
            nullable: x.notnull ? 'NO' : 'YES',
            key: x.pk ? 'PRI' : '', default: x.dflt_value,
          })),
          indexes: idxs.map((x) => ({ name: x.name, unique: !!x.unique })),
          foreignKeys: fks.map((x) => ({ name: 'fk_' + x.id, column: x.from, refTable: x.table, refColumn: x.to })),
        }
      }),
    }
  },
  search(_database, keyword) {
    const like = `%${keyword}%`
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name)
    const results = []
    for (const name of names.slice(0, 30)) {
      const cols = db.prepare(`PRAGMA table_info(${quoteT(name)})`).all()
      const textCols = cols.filter((x) => /(char|text|clob|enum)/i.test(x.type || '')).map((x) => x.name)
      if (!textCols.length) continue
      const sel = textCols.map(quoteT).join(', ')
      const where = textCols.map((c) => quoteT(c) + ' LIKE ?').join(' OR ')
      try {
        const rows = db.prepare(`SELECT ${sel} FROM ${quoteT(name)} WHERE ${where} LIMIT 20`).all(...textCols.map(() => like))
        if (rows.length) results.push({ table: name, columns: textCols, rows })
      } catch {}
    }
    return { keyword, tables: results }
  },
}

parentPort.on('message', ({ msgId, op, args = [] }) => {
  try {
    if (op === 'close') { db.close(); parentPort.postMessage({ msgId, ok: true, data: null }); return }
    if (op === 'interrupt') { try { db.interrupt() } catch {}; return }
    const h = handlers[op]
    if (!h) throw new Error('未知操作: ' + op)
    parentPort.postMessage({ msgId, ok: true, data: h(...args) })
  } catch (e) {
    parentPort.postMessage({ msgId, ok: false, data: e.message })
  }
})
