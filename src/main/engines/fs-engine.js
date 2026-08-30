/**
 * 本地文件系统引擎 — 供 SFTP 本地侧浏览、上传选文件使用
 * 另含背景图管理：保存/读取/清除用户自定义背景图
 */
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { app, dialog } = require('electron')

/* ----------------------------- 本地文件列表 ----------------------------- */

async function listLocal(p) {
  let target = p || os.homedir()
  // 归一化 'D:' → 'D:\'，避免 Windows drive-relative 解析出 D:\D:
  if (typeof target === 'string' && /^[a-zA-Z]:$/.test(target)) target += '\\'
  const abs = path.resolve(target)
  const entries = await fsp.readdir(abs, { withFileTypes: true })
  // 并发批量 stat 获取大小/时间（限制数量避免卡顿）
  const limit = 500
  const items = await Promise.all(entries.slice(0, limit).map(async (e) => {
    const full = path.join(abs, e.name)
    let size = 0, mtime = 0, isDir = e.isDirectory()
    try {
      const st = await fsp.stat(full)
      size = st.size
      mtime = st.mtimeMs
      isDir = st.isDirectory()
    } catch {}
    return { name: e.name, path: full, isDir, size, mtime, mode: 0 }
  }))
  return { path: abs, parent: path.dirname(abs), items, truncated: entries.length > limit }
}

/**
 * 列出本机所有可用磁盘（Windows）— SFTP 本地侧用于切换盘符
 */
async function listDrives() {
  const drives = []
  if (process.platform === 'win32') {
    for (let c = 65; c <= 90; c++) {
      const letter = String.fromCharCode(c)
      const p = `${letter}:\\`
      try {
        await fsp.access(p)
        drives.push({ name: `${letter}:`, path: p, isDir: true, size: 0, mtime: 0, mode: 0 })
      } catch {}
    }
  } else {
    drives.push({ name: '/', path: '/', isDir: true, size: 0, mtime: 0, mode: 0 })
  }
  return { path: '此电脑', parent: '此电脑', items: drives, truncated: false }
}

/**
 * 弹出系统文件/目录选择框
 * mode: 'openFile' | 'openDirectory' | 'openFiles'
 */
// 会话内授权路径表：仅通过系统对话框选择的路径（或其子路径）可用 readText/writeText 访问，
// 防止渲染层被注入后经 IPC 任意读写全盘文件
const dialogPaths = new Set()

function isPathAllowed(p) {
  const t = path.resolve(String(p || ''))
  if (dialogPaths.has(t)) return true
  for (const d of dialogPaths) {
    if (t.startsWith(d + path.sep)) return true
  }
  return false
}

async function choose(mode = 'openFile') {
  const props = mode === 'openFile' ? ['openFile'] : mode === 'openFiles' ? ['openFile', 'multiSelections'] : ['openDirectory']
  const r = await dialog.showOpenDialog({ properties: props })
  if (r.canceled || !r.filePaths.length) return null
  for (const fp of r.filePaths) dialogPaths.add(path.resolve(fp))
  return mode === 'openFile' ? r.filePaths[0] : r.filePaths
}

/**
 * 弹出系统保存对话框，返回用户选择的文件路径（取消则返回 null）
 */
async function saveFile({ defaultPath, filters } = {}) {
  const r = await dialog.showSaveDialog({
    defaultPath,
    filters: filters && filters.length ? filters : [{ name: 'All Files', extensions: ['*'] }],
  })
  if (r.canceled || !r.filePath) return null
  dialogPaths.add(path.resolve(r.filePath))
  return r.filePath
}

/**
 * 读取本地文本文件内容（运行 SQL 文件等场景使用，UTF-8）。
 * 仅允许读取通过文件对话框选择过的路径。
 */
async function readText(p) {
  if (typeof p !== 'string' || !p.trim()) throw new Error('无效的文件路径')
  if (!isPathAllowed(p)) throw new Error('路径未授权：仅允许访问通过文件对话框选择的路径')
  return await fsp.readFile(p, 'utf-8')
}

/**
 * 写入本地文本文件（UTF-8）。用于数据字典 / ER 图等导出场景。
 * 若父目录不存在会自动创建；返回写入路径。
 * 仅允许写入通过保存对话框选择过的路径。
 */
async function writeText(p, content) {
  if (typeof p !== 'string' || !p.trim()) throw new Error('无效的文件路径')
  const target = path.resolve(p)
  if (!isPathAllowed(target)) throw new Error('路径未授权：仅允许写入通过保存对话框选择的路径')
  await fsp.mkdir(path.dirname(target), { recursive: true })
  await fsp.writeFile(target, String(content ?? ''), 'utf-8')
  return target
}

/* ----------------------------- 背景图管理 ----------------------------- */

const BG_NAMES = ['background.png', 'background.jpg', 'background.webp']

async function readAsDataUrl(p) {
  const buf = await fsp.readFile(p)
  const ext = path.extname(p).slice(1).toLowerCase()
  const mime = ext === 'jpg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png'
  return `data:${mime};base64,${buf.toString('base64')}`
}

/**
 * 获取背景图（返回 dataURL，dev(http)/prod(file) 下均无跨域限制）
 */
async function getBackground() {
  for (const name of BG_NAMES) {
    const p = path.join(app.getPath('userData'), name)
    try {
      await fsp.access(p)
      return await readAsDataUrl(p)
    } catch {}
  }
  return null
}

/**
 * 保存背景图
 * dataUrl: 形如 "data:image/png;base64,...."
 */
async function saveBackground(dataUrl) {
  if (!dataUrl || !dataUrl.startsWith('data:image')) {
    throw new Error('无效的图片数据')
  }
  const m = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/)
  if (!m) throw new Error('仅支持 PNG/JPEG/WebP')
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1]
  const buf = Buffer.from(m[2], 'base64')
  if (buf.length > 20 * 1024 * 1024) throw new Error('图片过大（>20MB）')
  const ud = app.getPath('userData')
  const target = `background.${ext}`
  // 清理旧背景（不同扩展名）
  for (const old of BG_NAMES) {
    if (old !== target) {
      try { await fsp.unlink(path.join(ud, old)) } catch {}
    }
  }
  await fsp.writeFile(path.join(ud, target), buf)
  // 返回 dataURL 供渲染层直接使用
  return dataUrl
}

async function clearBackground() {
  const ud = app.getPath('userData')
  for (const name of BG_NAMES) {
    try { await fsp.unlink(path.join(ud, name)) } catch {}
  }
  return null
}

/* ----------------------------- 玻璃拟态设置 ----------------------------- */

const GLASS_FILE = 'glass.json'
const GLASS_DEFAULTS = {
  enabled: true,          // 是否启用玻璃拟态（关闭回到原生界面）
  blur: 18,               // 玻璃模糊度 (px)
  frost: 55,              // 玻璃磨砂度（不透明度 %）
  bgMode: 'fluid',        // 背景模式：'fluid' 流体 | 'wallpaper' 自定义壁纸
  bgBlur: 8,              // 壁纸模糊度 (px)
  bgFrost: 45,            // 壁纸磨砂度（可读性遮罩 %）
  fluidStyle: 'aurora',   // 流体渐变样式（见 glassmorphism.css 的 data-fluid 预设）
  fluidColors: ['#6b8afd', '#8b5cf6', '#0ea5e9'], // 自定义流体光斑颜色
}

/**
 * 读取玻璃拟态配置（不存在时返回默认值并落盘）
 */
async function getGlassSettings() {
  const p = path.join(app.getPath('userData'), GLASS_FILE)
  try {
    const raw = JSON.parse(await fsp.readFile(p, 'utf-8'))
    return { ...GLASS_DEFAULTS, ...raw }
  } catch {
    // 文件不存在或损坏：返回默认值。
    // 注意：这里不能调用 saveGlassSettings —— 它内部又会调用 getGlassSettings，
    // 会形成无限递归，导致主进程挂起、glass.json 永远无法创建。
    return { ...GLASS_DEFAULTS }
  }
}

/**
 * 保存玻璃拟态配置（只合并白名单字段）
 */
async function saveGlassSettings(cfg) {
  const cur = await getGlassSettings()
  const merged = { ...cur }
  for (const k of Object.keys(GLASS_DEFAULTS)) {
    if (cfg && cfg[k] !== undefined) merged[k] = cfg[k]
  }
  // 数值范围保护
  merged.blur = clampNum(merged.blur, 0, 40, GLASS_DEFAULTS.blur)
  merged.frost = clampNum(merged.frost, 0, 90, GLASS_DEFAULTS.frost)
  merged.bgBlur = clampNum(merged.bgBlur, 0, 40, GLASS_DEFAULTS.bgBlur)
  merged.bgFrost = clampNum(merged.bgFrost, 0, 90, GLASS_DEFAULTS.bgFrost)
  merged.enabled = !!merged.enabled
  merged.bgMode = merged.bgMode === 'wallpaper' ? 'wallpaper' : 'fluid'
  // 流体样式白名单（与 glassmorphism.css 的 data-fluid 预设保持一致，custom 走用户自定义颜色）
  const FLUIDS = ['aurora', 'sunset', 'ocean', 'forest', 'nebula', 'graphite', 'custom']
  merged.fluidStyle = FLUIDS.includes(merged.fluidStyle) ? merged.fluidStyle : 'aurora'
  // 自定义流体颜色：仅接受 #rrggbb，非法项回退默认
  const HEX = /^#[0-9a-fA-F]{6}$/
  const colors = Array.isArray(merged.fluidColors) ? merged.fluidColors : []
  const fallback = GLASS_DEFAULTS.fluidColors
  merged.fluidColors = [0, 1, 2].map((i) =>
    typeof colors[i] === 'string' && HEX.test(colors[i]) ? colors[i] : fallback[i])
  await fsp.writeFile(path.join(app.getPath('userData'), GLASS_FILE), JSON.stringify(merged, null, 2), 'utf-8')
  return merged
}

function clampNum(v, min, max, fallback) {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

module.exports = { listLocal, listDrives, choose, saveFile, readText, getBackground, saveBackground, clearBackground, getGlassSettings, saveGlassSettings }
