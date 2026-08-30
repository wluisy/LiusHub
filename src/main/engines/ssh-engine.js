/**
 * SSH 引擎 — 基于 ssh2。
 *
 * 一个 session 包含：
 *   - Client (ssh2.Client) - 与远端 SSH 服务握手
 *   - Shell stream - 终端 PTY
 *   - SFTP 子系统 - 与 SFTP 引擎共享
 *
 * 提供的操作：
 *   - connect(opts)        - 打开新会话
 *   - write(id, data)      - 写入终端 (来自 xterm)
 *   - resize(id, cols, r)  - PTY 尺寸变化
 *   - disconnect(id)       - 关闭
 *   - listSessions()       - 当前活跃会话
 *
 * 数据上行 / 下行通过 IPC 推送给渲染层：ssh:data、ssh:close。
 */
const { Client } = require('ssh2')
const { randomUUID, createHash } = require('node:crypto')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { BrowserWindow, app } = require('electron')
const { IPC } = require('../../shared/ipc-channels')

/** @type {Map<string, SshSession>} */
const sessions = new Map()

/* --------------------- 主机密钥指纹（TOFU） ---------------------
 * 首次连接记录服务器公钥指纹到 <userData>/ssh-host-keys.json，
 * 之后每次连接比对：不一致即拒绝（服务器被更换或中间人攻击）。
 * 若确认安全，删除该文件（或对应条目）后重试即可。 */
function hostKeysFile() {
  return path.join(app.getPath('userData'), 'ssh-host-keys.json')
}

async function loadHostKeys() {
  try { return JSON.parse(await fsp.readFile(hostKeysFile(), 'utf-8')) } catch { return {} }
}

async function saveHostKeys(map) {
  try { await fsp.writeFile(hostKeysFile(), JSON.stringify(map, null, 2), 'utf-8') } catch {}
}

function sendToAll(channel, payload) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload)
  }
}

function sendToOwner(session, channel, payload) {
  // 这里简化成广播 (前端按 sessionId 过滤)
  sendToAll(channel, { id: session.id, ...payload })
}

/**
 * @typedef {Object} SshSession
 * @property {string} id
 * @property {Client} client
 * @property {any}    stream       - shell stream
 * @property {string} host
 * @property {number} port
 * @property {string} username
 * @property {boolean} ready
 */

/**
 * 打开 SSH 连接并启动交互式 shell
 * @param {{
 *   host: string,
 *   port?: number,
 *   username: string,
 *   password?: string,
 *   privateKey?: string,
 *   passphrase?: string,
 *   cols?: number,
 *   rows?: number,
 *   keepaliveInterval?: number,
 *   readyTimeout?: number,
 *   jumpHost?: object,        // 跳板机配置 (递归 connect)
 * }} opts
 */
/**
 * 将 ssh2 的英文错误翻译为中文提示
 */
function translateSshError(err) {
  const msg = (err && err.message) || String(err || '')
  const rules = [
    [/authentication methods failed|permission denied/i, '认证失败：请检查用户名、密码或私钥是否正确'],
    [/ECONNREFUSED/i, '连接被拒绝：请检查主机地址与端口是否可达'],
    [/ETIMEDOUT|timed out|timeout/i, '连接超时：请检查网络、防火墙或主机是否在线'],
    [/EHOSTUNREACH/i, '主机不可达：请检查 IP/域名是否正确'],
    [/ENETUNREACH/i, '网络不可达：请检查本机网络连接'],
    [/host key verification failed|host denied|host key/i,
      '主机密钥校验失败：与首次连接记录的指纹不一致（服务器可能被更换或存在中间人风险）。确认安全后可删除数据目录下 ssh-host-keys.json 中对应记录再重试'],
    [/no compatible|unsupported/i, '不支持的认证方式'],
    [/privateKey|parse key|invalid key/i, '私钥解析失败：请检查私钥格式是否正确'],
    [/handshake/i, 'SSH 握手失败：目标可能不是 SSH 服务，或端口配置错误'],
    [/socket closed|connection closed/i, '连接被远端关闭'],
    [/parse/i, '参数解析失败'],
  ]
  for (const [re, zh] of rules) {
    if (re.test(msg)) return zh
  }
  return `连接失败：${msg}`
}

async function connect(opts) {
  if (!opts || !opts.host || !opts.username) {
    throw new Error('host 与 username 不能为空')
  }

  const id = randomUUID()
  const client = new Client()

  const port = Number(opts.port) || 22
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('端口无效（应为 1-65535 的整数）')
  }
  if (typeof opts.host !== 'string' || typeof opts.username !== 'string') {
    throw new Error('host 与 username 必须为字符串')
  }

  const config = {
    host: opts.host,
    port,
    username: opts.username,
    keepaliveInterval: opts.keepaliveInterval || 10000,
    readyTimeout: opts.readyTimeout || 20000,
  }

  if (opts.privateKey) {
    try {
      config.privateKey = Buffer.from(opts.privateKey, 'utf-8')
      if (opts.passphrase) config.passphrase = opts.passphrase
    } catch (e) {
      throw new Error('私钥格式无效: ' + e.message)
    }
  } else if (opts.password) {
    config.password = opts.password
  } else {
    throw new Error('需要提供 password 或 privateKey')
  }

  // 主机密钥 TOFU 校验：首次记录指纹，之后不一致即拒绝
  const hostKeys = await loadHostKeys()
  const hostId = `${config.host}:${config.port}`
  config.hostVerifier = (keyBuf) => {
    const fp = createHash('sha256').update(keyBuf).digest('base64')
    if (!hostKeys[hostId]) {
      hostKeys[hostId] = fp
      saveHostKeys(hostKeys)
      return true
    }
    return hostKeys[hostId] === fp
  }

  return new Promise((resolve, reject) => {
    /** @type {SshSession} */
    const session = {
      id,
      client,
      stream: null,
      host: config.host,
      port: config.port,
      username: config.username,
      ready: false,
      closed: false, // 关闭事件只推一次
    }

    const markClosed = (code, reason) => {
      if (session.closed) return
      session.closed = true
      sendToOwner(session, IPC.SSH_CLOSE, { code, reason })
    }

    client.on('ready', () => {
      session.ready = true

      // 纯 SFTP/工具连接：不启动 PTY shell
      if (opts.shell === false) {
        sessions.set(id, session)
        return resolve({
          id,
          host: session.host,
          port: session.port,
          username: session.username,
          banner: '已连接',
        })
      }

      client.shell({
        cols: opts.cols || 80,
        rows: opts.rows || 24,
        term: 'xterm-256color',
      }, (err, stream) => {
        if (err) {
          markClosed(-1, translateSshError(err))
          client.end()
          return reject(new Error(translateSshError(err)))
        }
        session.stream = stream
        sessions.set(id, session)

        // 直接传 Buffer（IPC 原生支持），UTF-8 跨 chunk 拼接交给 xterm 解码，
        // 避免多字节字符（如中文）被 TCP 分块切割时 toString 产生乱码
        stream.on('data', (chunk) => {
          sendToOwner(session, IPC.SSH_DATA, { data: chunk })
        })

        stream.on('close', () => {
          markClosed(0)
          dispose(id)
        })

        resolve({
          id,
          host: session.host,
          port: session.port,
          username: session.username,
          banner: '已连接',
        })
      })
    })

    client.on('error', (err) => {
      const zh = translateSshError(err)
      markClosed(-1, zh)
      sessions.delete(id)
      try { client.end() } catch {}
      reject(new Error(zh))
    })

    // end / close / stream close 三路事件只推一次 SSH_CLOSE
    client.on('end', () => {
      markClosed(0)
      sessions.delete(id)
    })

    client.on('close', () => {
      markClosed(0)
      sessions.delete(id)
    })

    client.connect(config)
  })
}

function write(id, data) {
  const s = sessions.get(id)
  if (s && s.stream) s.stream.write(data)
}

function resize(id, cols, rows) {
  const s = sessions.get(id)
  if (s && s.stream) s.stream.setWindow(rows, cols, 0, 0)
}

function disconnect(id) {
  const s = sessions.get(id)
  if (!s) return
  try { s.stream && s.stream.close() } catch {}
  try { s.client.end() } catch {}
  sessions.delete(id)
}

function dispose(id) {
  const s = sessions.get(id)
  if (!s) return
  try { s.client.destroy() } catch {}
  sessions.delete(id)
}

function disposeAll() {
  for (const id of [...sessions.keys()]) dispose(id)
}

function listSessions() {
  return [...sessions.values()].map((s) => ({
    id: s.id,
    host: s.host,
    port: s.port,
    username: s.username,
    ready: s.ready,
  }))
}

module.exports = {
  sessions,
  connect,
  write,
  resize,
  disconnect,
  disposeAll,
  listSessions,
}
