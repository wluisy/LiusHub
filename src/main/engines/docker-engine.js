/**
 * Docker 引擎 — 基于 dockerode
 *
 * 支持：
 *   - 通过 SSH 跳板或本地 socket 连接
 *   - 容器列表/启动/停止
 *   - 容器日志 (tail)
 *   - 容器 stats (流式)
 *   - 镜像列表
 */
const Docker = require('dockerode')
const { randomUUID } = require('node:crypto')
const { BrowserWindow } = require('electron')
const { IPC } = require('../../shared/ipc-channels')

/** id -> Docker */
const clients = new Map()
/** id -> Set<stream> 当前活跃的 stats 流 */
const statsStreams = new Map()

async function connect(cfg) {
  const id = randomUUID()
  let docker
  if (cfg.ssh) {
    // 走 docker-modem 内置 SSH 支持：ssh2 exec 'docker system dial-stdio'，
    // 支持私钥/口令认证，不依赖本机 ssh-agent（agentForward 关闭）
    const sshOptions = { agentForward: false }
    if (cfg.ssh.privateKey) sshOptions.privateKey = Buffer.from(cfg.ssh.privateKey, 'utf-8')
    if (cfg.ssh.passphrase) sshOptions.passphrase = cfg.ssh.passphrase
    docker = new Docker({
      protocol: 'ssh',
      host: cfg.ssh.host,
      port: cfg.ssh.port || 22,
      username: cfg.ssh.username,
      sshOptions,
    })
    clients.set(id, { docker })
  } else if (cfg.socketPath) {
    docker = new Docker({ socketPath: cfg.socketPath })
    clients.set(id, { docker })
  } else {
    docker = new Docker({
      host: cfg.host || '127.0.0.1',
      port: cfg.port || 2375,
      protocol: cfg.tls ? 'https' : 'http',
      ca: cfg.ca, cert: cfg.cert, key: cfg.key,
    })
    clients.set(id, { docker })
  }
  // 探活
  await docker.ping()
  return { id, banner: '已连接 Docker' }
}

function get(id) {
  const c = clients.get(id)
  if (!c) throw new Error('Docker 连接不存在')
  return c.docker
}

function disconnect(id) {
  stopStats(id)
  clients.delete(id)
}

/** 停止指定连接的全部 stats 流（视图切走时暂停 IPC 推送） */
function stopStats(id) {
  const streams = statsStreams.get(id)
  if (streams) {
    for (const st of streams) { try { st.destroy() } catch {} }
    statsStreams.delete(id)
  }
  return { ok: true }
}

async function listContainers(id, all = true) {
  const d = get(id)
  const list = await d.listContainers({ all })
  return list.map((c) => ({
    id: c.Id,
    name: (c.Names || [])[0]?.replace(/^\//, '') || c.Id.slice(0, 12),
    image: c.Image,
    state: c.State,
    status: c.Status,
    created: c.Created,
    ports: c.Ports || [],
  }))
}

/**
 * 剥离非 TTY 容器日志的多路复用帧头（每帧 8 字节：[streamType, 0,0,0, uint32 BE 长度]）。
 * TTY 容器输出为裸文本（首帧不满足帧头特征时原样返回）。
 */
function demuxDockerLogs(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8) return buf.toString('utf-8')
  // 快速判断是否为多路复用流：首帧 streamType 应为 0/1/2 且随后 3 字节为 0
  if (buf[0] > 2 || buf[1] !== 0 || buf[2] !== 0 || buf[3] !== 0) return buf.toString('utf-8')
  const out = []
  let i = 0
  while (i + 8 <= buf.length) {
    const len = buf.readUInt32BE(i + 4)
    if (i + 8 + len > buf.length) break
    out.push(buf.slice(i + 8, i + 8 + len))
    i += 8 + len
  }
  return out.map((b) => b.toString('utf-8')).join('')
}

async function logs(id, containerId, tail = 200) {
  const d = get(id)
  const c = d.getContainer(containerId)
  const buf = await c.logs({ stdout: true, stderr: true, tail, follow: false })
  return { log: demuxDockerLogs(buf) }
}

/**
 * stats 流为连续的 JSON 对象，单个对象可能被 TCP 分块。
 * 用字符串感知的大括号配对切分出完整 JSON 再解析，避免跨块解析失败。
 */
function makeStatsSplitter(onObject) {
  let buf = ''
  let depth = 0
  let inStr = false
  let esc = false
  return (chunk) => {
    buf += chunk.toString('utf-8')
    let objStart = -1
    for (let i = 0; i < buf.length; i++) {
      const ch = buf[i]
      if (inStr) {
        if (esc) esc = false
        else if (ch === '\\') esc = true
        else if (ch === '"') inStr = false
        continue
      }
      if (ch === '"') { inStr = true; continue }
      if (ch === '{') { if (depth === 0) objStart = i; depth++ }
      else if (ch === '}') {
        depth--
        if (depth === 0 && objStart >= 0) {
          const text = buf.slice(objStart, i + 1)
          buf = buf.slice(i + 1)
          i = -1
          objStart = -1
          try { onObject(JSON.parse(text)) } catch {}
        }
      }
    }
    if (depth === 0 && !inStr) {
      // 无未配对内容：丢弃 buf 前缀中的非 JSON 噪声
      const brace = buf.indexOf('{')
      buf = brace >= 0 ? buf.slice(brace) : ''
    }
  }
}

/**
 * stats 持续推送 (通过 IPC)。
 * 每个 id 只保留一个活跃流：重复订阅时先销毁旧流，避免无限累积。
 */
async function statsStream(id, containerId) {
  const d = get(id)
  // 销毁同连接的旧 stats 流
  const old = statsStreams.get(id)
  if (old) { for (const st of old) { try { st.destroy() } catch {} } }
  const c = d.getContainer(containerId)
  const stream = await c.stats({ stream: true })
  const set = statsStreams.get(id) || new Set()
  set.add(stream)
  statsStreams.set(id, set)
  // 跨块安全的 JSON 切分，逐条推送完整 stats 对象
  const emit = makeStatsSplitter((obj) => {
    sendToAll(IPC.DOCKER_STATS, { id, containerId, stats: obj })
  })
  stream.on('data', emit)
  stream.on('error', (e) => sendToAll(IPC.DOCKER_STATS, { id, containerId, error: e.message }))
  const cleanup = () => {
    set.delete(stream)
    if (set.size === 0) statsStreams.delete(id)
  }
  stream.on('end', cleanup)
  stream.on('close', cleanup)
  return { ok: true }
}

async function listImages(id) {
  const d = get(id)
  const imgs = await d.listImages({ all: false })
  return imgs.map((i) => ({
    id: i.Id,
    repoTags: i.RepoTags || [],
    size: i.Size,
    created: i.Created,
  }))
}

async function start(id, cid) { await get(id).getContainer(cid).start(); return { ok: true } }
async function stop(id, cid)   { await get(id).getContainer(cid).stop();  return { ok: true } }

function sendToAll(channel, payload) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload)
  }
}

/** 关闭全部 Docker 连接（含 stats 流），应用退出时统一清理 */
function disposeAll() {
  for (const id of [...clients.keys()]) disconnect(id)
}

module.exports = {
  connect, disconnect, disposeAll, listContainers, logs, statsStream, stopStats,
  listImages, start, stop,
}
