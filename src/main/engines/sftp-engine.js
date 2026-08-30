/**
 * SFTP 引擎 — 基于 ssh2 子系统
 *
 * 设计：
 *   - 复用 ssh-engine 维护的 ssh2 Client，通过 sftp() 子系统得到 Sftp 实例
 *   - 每个 sessionId 缓存一个 Sftp，避免重复握手
 *   - 大文件传输走流式 pipe
 */
const { sessions: sshSessions } = require('./ssh-engine')
const fs = require('node:fs')
const path = require('node:path')
const { BrowserWindow } = require('electron')
const { IPC } = require('../../shared/ipc-channels')

/** sessionId -> Sftp instance */
const sftpCache = new Map()

/** 传输进度推送（按 1% 变化节流） */
function sendProgress(sessionId, kind, loaded, total) {
  const pct = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(IPC.SFTP_PROGRESS, { sessionId, kind, loaded, total, pct })
  }
}

function getSftp(sessionId) {
  return new Promise((resolve, reject) => {
    const s = sshSessions.get(sessionId)
    if (!s || !s.ready) return reject(new Error('SSH 会话未就绪'))
    if (sftpCache.has(sessionId)) return resolve(sftpCache.get(sessionId))

    s.client.sftp((err, sftp) => {
      if (err) return reject(err)
      sftpCache.set(sessionId, sftp)
      sftp.on('end', () => sftpCache.delete(sessionId))
      sftp.on('close', () => sftpCache.delete(sessionId))
      resolve(sftp)
    })
  })
}

/* ----------------------------- 目录操作 ----------------------------- */

function list(sessionId, p) {
  return new Promise((resolve, reject) => {
    getSftp(sessionId).then((sftp) => {
      sftp.readdir(p || '.', (err, list) => {
        if (err) return reject(err)
        const out = (list || []).map((it) => ({
          name: it.filename,
          path: path.posix.join(p || '.', it.filename),
          isDir: it.attrs.isDirectory(),
          size: it.attrs.size,
          mode: it.attrs.mode,
          mtime: it.attrs.mtime * 1000,
          atime: it.attrs.atime * 1000,
          uid: it.attrs.uid,
          gid: it.attrs.gid,
        }))
        resolve({ path: p, items: out })
      })
    }, reject)
  })
}

function mkdir(sessionId, p) {
  return new Promise((resolve, reject) => {
    getSftp(sessionId).then((sftp) => {
      sftp.mkdir(p, { mode: 0o755 }, (err) => err ? reject(err) : resolve({ ok: true }))
    }, reject)
  })
}

function remove(sessionId, p) {
  return new Promise((resolve, reject) => {
    getSftp(sessionId).then((sftp) => {
      // 简单策略：先 stat，再决定 unlink 或 rmdir
      sftp.stat(p, (err, stats) => {
        if (err) return reject(err)
        const op = stats.isDirectory() ? 'rmdir' : 'unlink'
        sftp[op](p, (e) => e ? reject(e) : resolve({ ok: true }))
      })
    }, reject)
  })
}

/* ----------------------------- 文件传输 ----------------------------- */

/**
 * 渲染层在 invoke 时只能传字符串参数 (无法传 function)。
 */
function upload(sessionId, local, remote) {
  return new Promise((resolve, reject) => {
    getSftp(sessionId).then((sftp) => {
      let total = 0
      try { total = fs.statSync(local).size } catch {}
      const rs = fs.createReadStream(local)
      const ws = sftp.createWriteStream(remote, { flags: 'w', mode: 0o644 })
      let written = 0
      let lastPct = -1
      let settled = false
      const fail = (err) => {
        if (settled) return
        settled = true
        try { rs.destroy() } catch {}
        try { ws.destroy() } catch {}
        // 尽力清理远端半截文件
        try { sftp.unlink(remote, () => {}) } catch {}
        reject(err)
      }
      rs.on('data', (chunk) => {
        written += chunk.length
        const p = total > 0 ? Math.floor((written / total) * 100) : -1
        if (p !== lastPct) { lastPct = p; sendProgress(sessionId, 'upload', written, total) }
      })
      rs.on('error', fail)
      ws.on('error', fail)
      ws.on('close', () => {
        if (!settled) {
          settled = true
          sendProgress(sessionId, 'upload', total, total)
          resolve({ ok: true, bytes: written })
        }
      })
      rs.pipe(ws)
    }, reject)
  })
}

function download(sessionId, remote, local) {
  return new Promise((resolve, reject) => {
    getSftp(sessionId).then((sftp) => {
      // 先取远端文件大小用于进度计算
      sftp.stat(remote, (statErr, st) => {
        if (statErr) return reject(statErr)
        const total = (st && st.size) || 0
        const ws = fs.createWriteStream(local)
        const rs = sftp.createReadStream(remote)
        let written = 0
        let lastPct = -1
        let settled = false
        const fail = (err) => {
          if (settled) return
          settled = true
          try { rs.destroy() } catch {}
          try { ws.destroy() } catch {}
          // 尽力清理本地半截文件
          try { fs.unlink(local, () => {}) } catch {}
          reject(err)
        }
        rs.on('data', (chunk) => {
          written += chunk.length
          const p = total > 0 ? Math.floor((written / total) * 100) : -1
          if (p !== lastPct) { lastPct = p; sendProgress(sessionId, 'download', written, total) }
        })
        rs.on('error', fail)
        ws.on('error', fail)
        ws.on('close', () => {
          if (!settled) {
            settled = true
            sendProgress(sessionId, 'download', total, total)
            resolve({ ok: true, bytes: written })
          }
        })
        rs.pipe(ws)
      })
    }, reject)
  })
}

module.exports = {
  list, mkdir, remove, upload, download,
}
