/**
 * 工具坞引擎 - 快捷命令模板管理
 *
 * 模板存放在 <userData>/tool-templates.json
 * 内置一些常用模板：磁盘、CPU、内存、网络、服务状态。
 */
const fs = require('node:fs/promises')
const path = require('node:path')
const { app } = require('electron')
const { randomUUID } = require('node:crypto')
const BUILTIN = [
  { name: '磁盘使用', command: 'df -h | head -n 20', tag: 'system' },
  { name: '内存使用', command: 'free -h', tag: 'system' },
  { name: 'CPU 信息', command: 'lscpu | head -n 20', tag: 'system' },
  { name: '运行中进程 (Top 20)', command: 'ps -eo pid,user,pcpu,pmem,comm --sort=-pcpu | head -n 20', tag: 'system' },
  { name: '系统负载', command: 'uptime', tag: 'system' },
  { name: '网络连接', command: 'ss -tunap | head -n 20', tag: 'network' },
  { name: '最近登录', command: 'last -n 10', tag: 'system' },
  { name: '时间同步', command: 'date && timedatectl', tag: 'system' },
]

let templatePath = null
let userTemplates = []

async function init() {
  templatePath = path.join(app.getPath('userData'), 'tool-templates.json')
  try {
    const buf = await fs.readFile(templatePath, 'utf-8')
    userTemplates = JSON.parse(buf)
  } catch {
    userTemplates = []
  }
}

async function persist() {
  if (!templatePath) templatePath = path.join(app.getPath('userData'), 'tool-templates.json')
  await fs.writeFile(templatePath, JSON.stringify(userTemplates, null, 2), 'utf-8')
}

async function listTemplates() {
  if (!templatePath) await init()
  return [...BUILTIN, ...userTemplates]
}

async function saveTemplate(tpl) {
  if (!templatePath) await init()
  const now = Date.now()
  if (tpl.id) {
    const idx = userTemplates.findIndex((t) => t.id === tpl.id)
    if (idx >= 0) {
      userTemplates[idx] = { ...userTemplates[idx], ...tpl, updatedAt: now }
    } else {
      // id 未匹配到已有模板：按新模板保存，避免静默丢弃
      userTemplates.push({ ...tpl, createdAt: now, updatedAt: now, builtin: false })
    }
  } else {
    userTemplates.push({ ...tpl, id: randomUUID(), createdAt: now, updatedAt: now, builtin: false })
  }
  await persist()
  return listTemplates()
}

/** 删除用户自定义模板（内置模板不可删） */
async function removeTemplate(id) {
  if (!templatePath) await init()
  const before = userTemplates.length
  userTemplates = userTemplates.filter((t) => t.id !== id)
  if (userTemplates.length !== before) await persist()
  return listTemplates()
}

module.exports = { init, listTemplates, saveTemplate, removeTemplate }
