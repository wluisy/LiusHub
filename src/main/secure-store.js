/**
 * 安全存储 - 加密保存用户连接资产（密码、密钥等）
 *
 * 加密方式：
 *   - 使用 Electron safeStorage 提供的 OS 级密钥
 *     (Windows DPAPI / macOS Keychain / Linux libsecret)
 *   - 加密后的二进制 base64 后存入 <userData>/vault.json
 *   - 资产明文结构只在主进程可见，preload 不导出解密数据
 *
 * 资产条目结构：
 *   {
 *     id: string (uuid),
 *     type: 'ssh' | 'sftp' | 'database' | 'docker' | 'rdp',
 *     name: string,
 *     host: string,
 *     port: number,
 *     username: string,
 *     // 其余敏感字段放在 secret blob 中（加密后存）
 *     secret: { password?, privateKey?, passphrase? },
 *     extra: object,                 // 其它非敏感配置
 *     createdAt: number,
 *     updatedAt: number,
 *   }
 */
const fs = require('node:fs/promises')
const path = require('node:path')
const { safeStorage } = require('electron')
const { randomUUID } = require('node:crypto')

let vaultPath = null
let cache = []     // 解密后的内存缓存
let loaded = false

function isEncryptionAvailable() {
  try { return safeStorage.isEncryptionAvailable() } catch { return false }
}

async function init(app) {
  vaultPath = path.join(app.getPath('userData'), 'vault.json')
  await load()

  if (!isEncryptionAvailable()) {
    console.warn('[secure-store] safeStorage 不可用 — 将以明文存储 secret 字段。生产环境建议启用 OS 级密钥库。')
  }
}

async function load() {
  try {
    const buf = await fs.readFile(vaultPath, 'utf-8')
    cache = JSON.parse(buf)
  } catch (e) {
    if (e.code === 'ENOENT') {
      cache = []
    } else {
      console.error('[secure-store] 加载失败', e)
      cache = []
    }
  }
  loaded = true
}

// 串行化写盘，避免并发保存时快照被互相覆盖（数据丢失）
let persistChain = Promise.resolve()

function persist() {
  const data = JSON.stringify(cache, null, 2)
  const run = persistChain.then(() => doPersist(data))
  // 单个写盘失败不中断后续写盘，但当前调用者仍能通过 run 感知失败
  persistChain = run.catch(() => {})
  return run
}

/**
 * 实际写盘：唯一临时文件名 + 原子替换。
 * Windows 下可能因杀软扫描占用、目标被占用、残留只读临时文件而报 EPERM/EACCES，
 * 任一环节失败则回退为直接写目标文件，保证资产始终可保存。
 */
async function doPersist(data) {
  const tmp = `${vaultPath}.${process.pid}.${Date.now()}.tmp`
  try {
    await fs.writeFile(tmp, data, 'utf-8')
    await fs.rename(tmp, vaultPath)
  } catch (e) {
    try { await fs.unlink(tmp) } catch {}
    await fs.writeFile(vaultPath, data, 'utf-8')
  }
}

function encryptSecret(secret) {
  if (!secret) return null
  if (!isEncryptionAvailable()) return secret
  try {
    return safeStorage.encryptString(JSON.stringify(secret)).toString('base64')
  } catch (e) {
    // safeStorage 可用标志位可能为 true 但实际加密失败（部分 Windows 环境）
    // 回退明文存储，保证资产始终可保存
    console.warn('[secure-store] 加密失败，回退明文存储:', e.message)
    return secret
  }
}

function decryptSecret(blob) {
  if (!blob) return null
  // 明文对象（加密不可用时的回退存储）直接返回
  if (typeof blob !== 'string') return blob
  // 字符串 blob 意味着该资产曾加密存储；当前环境无法解密时显式标记，
  // 让渲染层提示重新录入，而不是静默返回坏数据（表现为"密码怎么填都不对"）
  if (!isEncryptionAvailable()) {
    return { decryptError: '当前系统密钥库不可用，无法解密该资产，请重新录入密码/私钥' }
  }
  try {
    const raw = safeStorage.decryptString(Buffer.from(blob, 'base64'))
    return JSON.parse(raw)
  } catch (e) {
    console.error('[secure-store] 解密失败', e)
    return { decryptError: '解密失败（系统密钥或用户上下文已变化），请重新录入密码/私钥' }
  }
}

/** 公开输出：脱敏（剥离 secret） */
function publicShape(a) {
  const { secret, ...rest } = a
  return rest
}

async function list(type) {
  if (!loaded) await load()
  return cache.filter((a) => !type || a.type === type).map(publicShape)
}

async function get(id) {
  if (!loaded) await load()
  const a = cache.find((x) => x.id === id)
  if (!a) return null
  return { ...publicShape(a), secret: decryptSecret(a.secret) }
}

async function save(asset) {
  if (!loaded) await load()
  // 防御：IPC 参数必须为纯 JSON 数据（structured clone 只接受纯数据）
  try {
    asset = JSON.parse(JSON.stringify(asset))
  } catch (e) {
    console.error('[secure-store] 参数含无法序列化数据:', e.message)
    throw new Error('资产数据包含无法序列化的内容，请检查输入')
  }
  if (!asset || typeof asset !== 'object') throw new Error('无效的资产数据')
  const now = Date.now()
  const idx = cache.findIndex((x) => x.id === asset.id)
  const record = {
    ...asset,
    id: asset.id || randomUUID(),
    createdAt: idx >= 0 ? cache[idx].createdAt : now,
    updatedAt: now,
  }
  if (record.secret) {
    record.secret = encryptSecret(record.secret)
  } else if (idx >= 0 && cache[idx].secret) {
    // 本次提交未携带 secret 时保留原有加密值，避免误清空
    record.secret = cache[idx].secret
  }
  if (idx >= 0) cache[idx] = record
  else cache.push(record)
  await persist()
  return publicShape(record)
}

async function remove(id) {
  if (!loaded) await load()
  const before = cache.length
  cache = cache.filter((x) => x.id !== id)
  if (cache.length !== before) await persist()
  return before !== cache.length
}

module.exports = { init, list, get, save, remove, isEncryptionAvailable }
