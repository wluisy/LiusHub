<template>
  <div class="ssh-view">
    <!-- 子 tab：所有 SSH 会话（在功能模块 tab 之下的二级 tab） -->
    <SessionTabs
      :sessions="sessions"
      :active-id="activeId"
      @select="onSelect"
      @close="closeSession"
      @copy="copySession"
      @edit="editSession"
    />

    <div class="ssh-toolbar glass-toolbar">
      <el-select v-model="selectedAssetId" placeholder="选择资产" style="width: 240px;" @change="onAssetSelect">
        <el-option v-for="a in assets" :key="a.id" :value="a.id" :label="`${a.name} · ${a.username}@${a.host}`" />
      </el-select>
      <span class="muted">或</span>
      <el-button @click="manualForm = true" plain>手动连接</el-button>
      <el-button @click="quickCmd = true" plain>
        <el-icon><Tools /></el-icon><span>快捷命令</span>
      </el-button>
      <div style="flex: 1" />
      <template v-if="activeSession">
        <span v-if="activeSession.status === 'connected'" class="row gap-8">
          <span class="dot success" />
          <span class="muted">{{ activeSession.title }}</span>
        </span>
        <span v-else-if="activeSession.status === 'connecting'" class="row gap-8">
          <span class="dot warning" />
          <span class="muted">连接中…</span>
        </span>
        <el-button v-if="activeSession.status === 'connected'" type="danger" size="small" @click="disconnect">断开</el-button>
      </template>
    </div>

    <div class="ssh-content glass">
      <!-- 每个会话一个独立终端容器，仅激活的可见（其余保持存活，切换不丢输出） -->
      <div
        v-for="s in sessions"
        :key="s.id"
        v-show="s.id === activeId"
        class="term-wrap"
      >
        <div :ref="(el) => setTermEl(s, el)" class="lh-terminal" />
      </div>
      <div v-if="!sessions.length" class="ssh-placeholder">
        <el-icon :size="48" color="var(--text-muted)"><Monitor /></el-icon>
        <p class="muted" style="margin-top: 12px;">选择资产并点击"连接"开始</p>
        <el-button type="primary" @click="connect">连接</el-button>
      </div>
    </div>

    <!-- 手动连接 / 编辑连接对话框 -->
    <el-dialog v-model="manualForm" :title="editingId ? '编辑连接' : '新建 SSH 连接'" width="480px">
      <el-form :model="form" label-width="80px">
        <el-form-item label="主机"><el-input v-model="form.host" /></el-form-item>
        <el-form-item label="端口"><el-input-number v-model="form.port" :min="1" :max="65535" /></el-form-item>
        <el-form-item label="用户名"><el-input v-model="form.username" /></el-form-item>
        <el-form-item label="认证">
          <el-radio-group v-model="form.auth">
            <el-radio value="password">密码</el-radio>
            <el-radio value="key">私钥</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="form.auth==='password'" label="密码">
          <el-input v-model="form.password" type="password" show-password />
        </el-form-item>
        <el-form-item v-else label="私钥">
          <el-input v-model="form.privateKey" type="textarea" :rows="6" />
        </el-form-item>
        <el-form-item v-if="form.auth==='key'" label="口令">
          <el-input v-model="form.passphrase" type="password" show-password />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="manualForm=false">取消</el-button>
        <el-button type="primary" @click="connectManual">连接</el-button>
      </template>
    </el-dialog>

    <!-- 快捷命令 -->
    <el-dialog v-model="quickCmd" title="快捷命令" width="640px">
      <div class="row gap-12" style="margin-bottom: 12px;">
        <el-input v-model="cmdText" placeholder="选择模板或输入自定义命令" @keyup.enter="runCmd" />
        <el-button type="primary" @click="runCmd">执行</el-button>
      </div>
      <div class="cmd-templates">
        <el-tag
          v-for="t in templates"
          :key="t.name"
          class="cmd-tag"
          @click="cmdText = t.command"
        >{{ t.name }}</el-tag>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted, onActivated, onUnmounted, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { WebLinksAddon } from 'xterm-addon-web-links'
import 'xterm/css/xterm.css'
import { useAssetsStore } from '../stores/assets'
import { useSessionTabs } from '../composables/useSessionTabs'
import { takePendingSsh } from '../handoff'
import SessionTabs from '../components/SessionTabs.vue'

const store = useAssetsStore()
const { sessions, activeId, activeSession, addSession, activate, setStatus, rename, removeSession } = useSessionTabs()

const assets = ref([])
const selectedAssetId = ref(null)
const manualForm = ref(false)
const quickCmd = ref(false)
const cmdText = ref('')
const templates = ref([])
const editingId = ref(null)   // 正在编辑连接配置的会话 id（编辑后原地重连）

const form = ref({ host: '', port: 22, username: 'root', auth: 'password', password: '', privateKey: '', passphrase: '' })

// 会话技术状态（非响应式）：每个会话独立的终端实例 / 订阅 / 后端 ssh id / 连接配置
const sessionMap = new Map()

let dataUnsub = null
let closeUnsub = null

onMounted(async () => {
  // 只加载 ssh 类型资产，保证下拉里出现的都是 SSH 资产
  templates.value = await window.liushub.tool.listTemplates()

  // 全局订阅：按 sshId 路由到对应会话的终端
  dataUnsub = window.liushub.ssh.onData(({ id, data }) => {
    for (const entry of sessionMap.values()) {
      if (entry.sshId === id && entry.term) entry.term.write(data)
    }
  })
  closeUnsub = window.liushub.ssh.onClose(({ id, code, reason }) => {
    for (const [sid, entry] of sessionMap.entries()) {
      if (entry.sshId !== id) continue
      entry.sshId = null
      setStatus(sid, 'idle')
      ElMessage.warning(`连接已关闭 (code=${code}${reason ? ', ' + reason : ''})`)
    }
  })

  // 处理"待连接"资产（从资产库快速连接跳转过来；keep-alive 下每次激活都检查）
  consumePendingSsh()

  // 全局快捷键：F11 全屏
  window.addEventListener('keydown', onKeydown)
  // 窗口尺寸变化时重新贴合激活的终端
  window.addEventListener('resize', onWindowResize)
})

/** 窗口尺寸变化：重新校准当前激活会话的终端 */
function onWindowResize() {
  nextTick(() => fitWithRetry(sessionMap.get(activeId.value)))
}

/** 资产下拉刷新：keep-alive 下 onMounted 只执行一次，改为每次切回本模块时重新拉取最新资产 */
async function refreshAssets() {
  await store.load('ssh')
  assets.value = store.list
}
onActivated(() => {
  refreshAssets()
  consumePendingSsh()
})

/** 处理"待连接"资产（资产库快速连接跳转）：取出即清空，防止残留明文 */
async function consumePendingSsh() {
  const a = takePendingSsh()
  if (!a) return
  if (a.secret?.decryptError) { ElMessage.warning(a.secret.decryptError); return }
  form.value = {
    host: a.host, port: a.port, username: a.username,
    auth: a.secret?.privateKey ? 'key' : 'password',
    password: a.secret?.password || '',
    privateKey: a.secret?.privateKey || '',
    passphrase: a.secret?.passphrase || '',
  }
  nextTick(() => connectManual())
}

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', onWindowResize)
  // 清理所有会话：断开后端 + 销毁终端
  for (const entry of sessionMap.values()) {
    if (entry.sshId) window.liushub.ssh.disconnect(entry.sshId)
    entry.ro && entry.ro.disconnect()
    try { entry.term && entry.term.dispose() } catch {}
  }
  sessionMap.clear()
  dataUnsub && dataUnsub()
  closeUnsub && closeUnsub()
})

function onKeydown(e) {
  if (e.key !== 'F11') return
  e.preventDefault()
  if (document.fullscreenElement) { document.exitFullscreen(); return }
  const entry = sessionMap.get(activeId.value)
  if (entry?.el) entry.el.parentElement?.requestFullscreen()
}

function setTermEl(s, el) {
  const entry = sessionMap.get(s.id)
  if (entry) entry.el = el
}

/**
 * 让终端贴合容器尺寸：测量 .lh-terminal 实际尺寸并同步给 xterm 与 PTY。
 * 容器不可见（display:none / 0 尺寸）时跳过，待可见后再校准。
 */
function fitTerm(entry) {
  if (!entry || !entry.term || !entry.fit || !entry.el) return
  if (!entry.el.offsetWidth || !entry.el.offsetHeight) return
  try { entry.fit.fit() } catch {}
  if (entry.sshId) window.liushub.ssh.resize(entry.sshId, entry.term.cols, entry.term.rows)
}

/**
 * 带延迟重试的贴合：首次 fit 往往发生在字体度量 / 布局尚未稳定时（如自定义字体未加载、
 * 页面过渡动画中），行数会被算小，导致终端只占容器上部、下方留白。
 * 通过多次延迟重算覆盖这一窗口期，确保最终行数贴合容器。
 */
function fitWithRetry(entry, times = 6, delay = 100) {
  if (!entry) return
  fitTerm(entry)
  if (times > 0) setTimeout(() => fitWithRetry(entry, times - 1, delay), delay)
}

function ensureTerm(s) {
  const entry = sessionMap.get(s.id)
  if (!entry || entry.term || !entry.el) return
  const term = new Terminal({
    fontFamily: 'JetBrains Mono, Cascadia Code, Consolas, monospace',
    fontSize: 13,
    cursorBlink: true,
    theme: {
      background: '#000000',
      foreground: '#e6edf3',
      cursor: '#6b8afd',
      selectionBackground: 'rgba(107,138,253,0.3)',
    },
    allowProposedApi: true,
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  term.loadAddon(new WebLinksAddon())
  term.open(entry.el)
  term.onData((d) => {
    if (entry.sshId) window.liushub.ssh.write(entry.sshId, d)
  })

  // 用 ResizeObserver 监听容器尺寸变化，自动重算并同步 PTY 尺寸
  const ro = new ResizeObserver(() => fitTerm(entry))
  ro.observe(entry.el)
  entry.term = term
  entry.fit = fit
  entry.ro = ro
  // 首次渲染后分多次校准，覆盖字体/布局稳定窗口期
  fitWithRetry(entry, 8, 100)
}

/** 建立连接：新增子 tab → 初始化终端 → 连接 */
async function doConnect(cfg, suffix = '') {
  const s = addSession(cfg.username ? `${cfg.username}@${cfg.host}:${cfg.port}` : '连接中…')
  sessionMap.set(s.id, { cfg, suffix, sshId: null, term: null, fit: null, ro: null, el: null })
  setStatus(s.id, 'connecting')
  await nextTick()
  const entry = sessionMap.get(s.id)
  if (!entry) return
  ensureTerm(s)
  if (entry.term) entry.term.clear()
  try {
    const r = await window.liushub.ssh.connect({
      ...cfg,
      cols: entry.term?.cols || 80,
      rows: entry.term?.rows || 24,
    })
    entry.sshId = r.id
    rename(s.id, `${r.username}@${r.host}:${r.port}${entry.suffix}`)
    setStatus(s.id, 'connected')
    // 连接成功后分多次校准终端尺寸并同步给 PTY
    nextTick(() => fitWithRetry(entry))
    ElMessage.success('已连接')
  } catch (e) {
    setStatus(s.id, 'error')
    if (entry.term) entry.term.write(`\r\n\x1b[31m[连接失败] ${e.message || e}\x1b[0m\r\n`)
    ElMessage.error('连接失败: ' + (e.message || e))
  }
}

function buildCfgFromForm() {
  const cfg = {
    host: form.value.host,
    port: form.value.port,
    username: form.value.username,
  }
  if (form.value.auth === 'password') cfg.password = form.value.password
  else {
    cfg.privateKey = form.value.privateKey
    if (form.value.passphrase) cfg.passphrase = form.value.passphrase
  }
  return cfg
}

async function onAssetSelect(id) {
  const a = await window.liushub.asset.get(id)
  if (!a) return
  if (a.secret?.decryptError) { ElMessage.warning(a.secret.decryptError); return }
  const cfg = { host: a.host, port: a.port, username: a.username }
  if (a.secret?.privateKey) {
    cfg.privateKey = a.secret.privateKey
    if (a.secret.passphrase) cfg.passphrase = a.secret.passphrase
  } else if (a.secret?.password) {
    cfg.password = a.secret.password
  }
  await doConnect(cfg)
}

async function connectManual() {
  if (!form.value.host) { ElMessage.warning('请输入主机'); return }
  if (!form.value.username) { ElMessage.warning('请输入用户名'); return }
  if (form.value.auth === 'password' && !form.value.password) {
    ElMessage.warning('请输入密码'); return
  }
  if (form.value.auth === 'key' && !form.value.privateKey) {
    ElMessage.warning('请输入私钥'); return
  }
  manualForm.value = false
  const cfg = buildCfgFromForm()
  // 编辑连接：在同一个会话上原地重连
  const editId = editingId.value
  editingId.value = null
  const target = editId ? sessions.value.find((x) => x.id === editId) : null
  if (target) return reconnectSession(target, cfg)
  await doConnect(cfg)
}

/** 右键菜单：编辑已有会话的连接配置（复用其终端原地重连） */
function editSession(id) {
  const entry = sessionMap.get(id)
  if (!entry || !entry.cfg) { ElMessage.warning('该会话无连接配置，无法编辑'); return }
  const c = entry.cfg
  form.value = {
    host: c.host, port: c.port, username: c.username,
    auth: c.privateKey ? 'key' : 'password',
    password: c.password || '',
    privateKey: c.privateKey || '',
    passphrase: c.passphrase || '',
  }
  editingId.value = id
  manualForm.value = true
}

/** 在指定会话上用新配置原地重连（保留原终端，无需重建 tab） */
async function reconnectSession(s, cfg) {
  const entry = sessionMap.get(s.id)
  if (!entry) return
  if (entry.sshId) window.liushub.ssh.disconnect(entry.sshId)
  entry.sshId = null
  entry.cfg = cfg
  setStatus(s.id, 'connecting')
  ensureTerm(s)
  if (entry.term) entry.term.clear()
  try {
    const r = await window.liushub.ssh.connect({
      ...cfg,
      cols: entry.term?.cols || 80,
      rows: entry.term?.rows || 24,
    })
    entry.sshId = r.id
    rename(s.id, `${r.username}@${r.host}:${r.port}${entry.suffix || ''}`)
    setStatus(s.id, 'connected')
    nextTick(() => fitWithRetry(entry))
    ElMessage.success('已连接')
  } catch (e) {
    setStatus(s.id, 'error')
    if (entry.term) entry.term.write(`\r\n\x1b[31m[连接失败] ${e.message || e}\x1b[0m\r\n`)
    ElMessage.error('连接失败: ' + (e.message || e))
  }
}

function connect() {
  if (selectedAssetId.value) onAssetSelect(selectedAssetId.value)
  else manualForm.value = true
}

function onSelect(id) {
  activate(id)
  // 切换到可见终端时重新校准尺寸
  nextTick(() => fitWithRetry(sessionMap.get(id)))
}

function closeSession(id) {
  const entry = sessionMap.get(id)
  if (entry) {
    if (entry.sshId) window.liushub.ssh.disconnect(entry.sshId)
    entry.ro && entry.ro.disconnect()
    try { entry.term && entry.term.dispose() } catch {}
    sessionMap.delete(id)
  }
  // 关闭的是当前激活会话时重置选择框，使再次选择同一资产也能触发 change
  if (id === activeId.value) selectedAssetId.value = null
  removeSession(id)
}

function copySession(id) {
  const entry = sessionMap.get(id)
  if (!entry || !entry.cfg) { ElMessage.warning('该会话无连接配置，无法复制'); return }
  doConnect({ ...entry.cfg }, ' (副本)')
}

function disconnect() {
  const entry = sessionMap.get(activeId.value)
  if (!entry) return
  if (entry.sshId) window.liushub.ssh.disconnect(entry.sshId)
  entry.sshId = null
  setStatus(activeId.value, 'idle')
  if (entry.term) entry.term.write('\r\n\x1b[33m[已断开]\x1b[0m\r\n')
  // 断开后重置选择框，使再次选择同一资产也能触发 change 重新连接
  selectedAssetId.value = null
}

async function runCmd() {
  if (!cmdText.value) return
  const entry = sessionMap.get(activeId.value)
  if (!entry || !entry.sshId) { ElMessage.warning('请先连接 SSH'); return }
  window.liushub.ssh.write(entry.sshId, cmdText.value + '\r')
  cmdText.value = ''
}
</script>

<style scoped>
.ssh-view { display: flex; flex-direction: column; height: 100%; gap: 12px; }
.ssh-content { flex: 1; min-height: 0; padding: 8px; overflow: hidden; display: flex; flex-direction: column; }
/* 终端占满整个区域，输入行在底部，滚动滑轮内容可滚到最底部 */
.term-wrap { flex: 1; min-height: 0; }
.lh-terminal { height: 100%; min-height: 0; position: relative; }
/* 保证 xterm 根元素撑满容器（视口随容器高度），行数由多次校准的 fit 决定 */
.ssh-view :deep(.xterm) { height: 100%; }
.ssh-placeholder {
  flex: 1;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
.cmd-templates { display: flex; flex-wrap: wrap; gap: 6px; }
.cmd-tag { cursor: pointer; user-select: none; }
</style>
