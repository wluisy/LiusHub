<template>
  <div class="sftp-view">
    <!-- 子 tab：所有 SFTP 会话 -->
    <SessionTabs
      :sessions="sessions"
      :active-id="activeId"
      @select="activate"
      @close="closeSession"
      @copy="copySession"
      @edit="editSession"
    />

    <div class="sftp-toolbar glass-toolbar">
      <el-select v-model="selectedAssetId" placeholder="选择 SFTP 资产" style="width: 220px;" @change="onAssetSelect">
        <el-option v-for="a in assets" :key="a.id" :value="a.id" :label="a.name" />
      </el-select>
      <span class="muted">或</span>
      <el-button @click="manualForm = true" plain>手动连接</el-button>
      <el-button :disabled="!activeSession?.connected" @click="reloadBoth()">
        <el-icon><Refresh /></el-icon>
      </el-button>
      <el-button :disabled="!activeSession?.connected" @click="onMkdir">
        <el-icon><FolderAdd /></el-icon><span>新建文件夹</span>
      </el-button>
      <el-button :disabled="!activeSession?.connected" @click="onUpload">
        <el-icon><Upload /></el-icon><span>上传</span>
      </el-button>
      <el-button :disabled="!activeSession?.connected" @click="onDownload">
        <el-icon><Download /></el-icon><span>下载</span>
      </el-button>
      <el-button :disabled="!activeSession?.connected" @click="onDelete">
        <el-icon><Delete /></el-icon><span>删除</span>
      </el-button>
      <div style="flex: 1" />
      <span v-if="activeSession?.connected" class="row gap-8 muted">
        <span class="dot success" />{{ activeSession.info }}
      </span>
      <el-button v-if="activeSession?.connected" type="danger" size="small" @click="disconnect">断开</el-button>
    </div>

    <div class="lh-split">
      <!-- 本地（所有会话共用同一份本地浏览状态） -->
      <div class="pane">
        <div class="pane-header">
          <el-icon><Folder /></el-icon>
          <el-input
            v-model="localPathInput"
            size="small"
            class="path-input"
            placeholder="输入路径回车（如 D:\）"
            @keyup.enter="localGo()"
          />
        </div>
        <div class="pane-toolbar">
          <el-button size="small" @click="localCd('..')" :disabled="localPath === '此电脑'">..</el-button>
          <el-button size="small" @click="localRefresh()">刷新</el-button>
        </div>
        <div class="lh-file-table">
          <div
            v-for="row in localRows"
            :key="row.path"
            class="lh-file-row"
            :class="{ selected: localSel?.path === row.path }"
            @click="localSel = row"
            @dblclick="localCd(row)"
            @dragstart="onLocalDragStart($event, row)"
            draggable="true"
          >
            <el-icon :size="16" :color="row.isDir ? 'var(--accent)' : 'var(--text-muted)'">
              <Folder v-if="row.isDir" /><Document v-else />
            </el-icon>
            <span class="name">{{ row.name }}</span>
            <span class="size">{{ formatSize(row.size) }}</span>
            <span class="time">{{ formatTime(row.mtime) }}</span>
            <span class="perm">{{ row.isDir ? 'd' : '-' }}{{ modeStr(row.mode) }}</span>
          </div>
        </div>
      </div>

      <div class="divider" />

      <!-- 远端：展示当前激活会话的目录 -->
      <div class="pane" v-if="activeSession">
        <div class="pane-header">
          <el-icon><Folder /></el-icon>
          <span class="mono">{{ activeSession.remotePath }}</span>
        </div>
        <div class="pane-toolbar">
          <el-button size="small" @click="remoteCd('..')" :disabled="activeSession.remotePath==='/'">..</el-button>
          <el-button size="small" @click="remoteReload(activeSession)">刷新</el-button>
        </div>
        <div
          class="lh-file-table"
          @dragover.prevent
          @drop="onRemoteDrop"
        >
          <div
            v-for="row in activeSession.remoteRows"
            :key="row.path"
            class="lh-file-row"
            :class="{ selected: activeSession.remoteSel?.path === row.path }"
            @click="activeSession.remoteSel = row"
            @dblclick="remoteCd(row)"
          >
            <el-icon :size="16" :color="row.isDir ? 'var(--accent)' : 'var(--text-muted)'">
              <Folder v-if="row.isDir" /><Document v-else />
            </el-icon>
            <span class="name">{{ row.name }}</span>
            <span class="size">{{ formatSize(row.size) }}</span>
            <span class="time">{{ formatTime(row.mtime) }}</span>
            <span class="perm">{{ row.isDir ? 'd' : '-' }}{{ modeStr(row.mode) }}</span>
          </div>
          <div v-if="!activeSession.remoteRows.length" class="empty muted" style="padding: 20px; text-align: center;">
            {{ activeSession.connected ? '暂无文件' : '尚未连接' }}
          </div>
        </div>
      </div>
      <div v-else class="pane">
        <div class="empty muted" style="padding: 40px; text-align: center;">连接后在此浏览远端文件</div>
      </div>
    </div>

    <!-- 手动连接 / 编辑连接对话框 -->
    <el-dialog v-model="manualForm" :title="editingId ? '编辑 SFTP 连接' : '新建 SFTP 连接'" width="480px">
      <el-form :model="form" label-width="80px">
        <el-form-item label="主机"><el-input v-model="form.host" placeholder="192.168.1.1" /></el-form-item>
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
        <el-button type="primary" :loading="connecting" @click="connectManual">连接</el-button>
      </template>
    </el-dialog>

    <!-- 进度条 -->
    <transition name="fade">
      <div v-if="progress" class="progress-bar glass">
        <el-progress :percentage="progress.pct" :status="progress.status" />
        <span class="muted">{{ progress.label }}</span>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onActivated, onUnmounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAssetsStore } from '../stores/assets'
import { useConnectionSessions } from '../composables/useConnectionSessions'
import SessionTabs from '../components/SessionTabs.vue'

const store = useAssetsStore()
const {
  sessions, activeId, activeSession, activate, setStatus, rename,
  sessionMap, connectWith, reconnectSession, closeSession, copySession,
} = useConnectionSessions({
  connect: (cfg) => window.liushub.ssh.connect({ ...cfg, shell: false }),
  disconnect: (id) => window.liushub.ssh.disconnect(id),
  getBackendId: (s) => s.sshId,
  setBackendId: (s, id) => { s.sshId = id },
  state: () => ({ sshId: null, info: '', remotePath: '/', remoteRows: [], remoteSel: null }),
  titleOf: (cfg) => `${cfg.username}@${cfg.host}:${cfg.port}`,
  onConnected: async (s, r) => {
    s.info = `${r.username}@${r.host}:${r.port}`
    ElMessage.success('已建立 SFTP 会话')
    await remoteReload(s)
  },
  onReconnected: async (s, cfg) => {
    s.info = `${cfg.username}@${cfg.host}:${cfg.port}`
    rename(s.id, `${cfg.username}@${cfg.host}:${cfg.port}`)
    ElMessage.success('已重新连接')
    await remoteReload(s)
  },
})

const assets = ref([])
const selectedAssetId = ref(null)
const connecting = ref(false)
const manualForm = ref(false)
const editingId = ref(null)   // 正在编辑连接配置的会话 id（编辑后原地重连）
const form = ref({ host: '', port: 22, username: 'root', auth: 'password', password: '', privateKey: '', passphrase: '' })

// 本地状态（所有会话共用）
const localPath = ref('')
const localPathInput = ref('')
const localParent = ref(null)
const localRows = ref([])
const localSel = ref(null)
const localTruncated = ref(false)

watch(localPath, (p) => { localPathInput.value = p })

const progress = ref(null)

let progressUnsub = null
onMounted(async () => {
  // 初始化本地浏览：默认显示所有磁盘（此电脑），便于切换到其他盘
  localListDrives()
  // 订阅传输进度推送（真实字节进度，按会话过滤）
  progressUnsub = window.liushub.sftp.onProgress(({ sessionId, kind, loaded, total, pct }) => {
    const s = sessions.value.find((x) => x.sshId === sessionId)
    if (!s) return
    const label = `${kind === 'upload' ? '上传' : '下载'} ${Math.round(loaded / 1024)} KB / ${Math.round(total / 1024)} KB`
    progress.value = { pct, status: '', label }
  })
})

/** 资产下拉刷新：keep-alive 下 onMounted 只执行一次，改为每次切回本模块时重新拉取最新资产 */
async function refreshAssets() {
  await store.load('sftp')
  assets.value = store.list
}
onActivated(refreshAssets)

onUnmounted(() => {
  if (progressUnsub) { progressUnsub(); progressUnsub = null }
  // 断开所有会话，避免连接累积泄漏
  for (const s of sessions.value) {
    if (s.sshId) window.liushub.ssh.disconnect(s.sshId)
  }
})

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
  const cfg = { host: form.value.host, port: form.value.port, username: form.value.username }
  if (form.value.auth === 'password') cfg.password = form.value.password
  else { cfg.privateKey = form.value.privateKey; if (form.value.passphrase) cfg.passphrase = form.value.passphrase }
  // 编辑连接：在同一个会话上原地重连
  const editId = editingId.value
  editingId.value = null
  const target = editId ? sessions.value.find((x) => x.id === editId) : null
  connecting.value = true
  try {
    if (target) return await reconnectSession(target, cfg)
    return await connectWith(cfg)
  } finally {
    connecting.value = false
  }
}

/** 右键菜单：编辑已有会话的连接配置（原地重连，不新建 tab） */
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

async function onAssetSelect(id) {
  // 重置选择框，使"断开后再次选择同一资产"也能触发 change 重新连接
  selectedAssetId.value = null
  const a = await window.liushub.asset.get(id)
  if (!a) return
  if (a.secret?.decryptError) { ElMessage.warning(a.secret.decryptError); return }
  const cfg = { host: a.host, port: a.port, username: a.username }
  if (a.secret?.privateKey) cfg.privateKey = a.secret.privateKey
  else if (a.secret?.password) cfg.password = a.secret.password
  await connectWith(cfg)
}

function disconnect() {
  const s = activeSession.value
  if (!s) return
  if (s.sshId) window.liushub.ssh.disconnect(s.sshId)
  s.sshId = null
  s.connected = false
  setStatus(s.id, 'idle')
  ElMessage.info('已断开')
}

/* 远端操作（作用于当前激活会话） */
async function remoteReload(s, p) {
  if (!s || !s.sshId) return
  const target = p || s.remotePath
  try {
    const r = await window.liushub.sftp.list(s.sshId, target)
    s.remotePath = r.path
    s.remoteRows = r.items.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
  } catch (e) {
    ElMessage.error('列出目录失败: ' + e.message)
  }
}

async function remoteCd(row) {
  const s = activeSession.value
  if (!s) return
  if (row === '..') {
    const parent = s.remotePath.split('/').filter(Boolean).slice(0, -1).join('/')
    return remoteReload(s, '/' + parent)
  }
  if (row.isDir) {
    return remoteReload(s, row.path)
  } else {
    // 双击文件：下载
    onDownload()
  }
}

async function onMkdir() {
  const s = activeSession.value
  if (!s) return
  try {
    const { value } = await ElMessageBox.prompt('新文件夹名', '新建', { inputPattern: /^.+$/, inputErrorMessage: '名称不能为空' })
    await window.liushub.sftp.mkdir(s.sshId, joinPath(s.remotePath, value))
    ElMessage.success('已创建')
    remoteReload(s)
  } catch {}
}

async function onDelete() {
  const s = activeSession.value
  if (!s || !s.remoteSel) { ElMessage.warning('请先选择'); return }
  const dirTip = s.remoteSel.isDir ? '（目录必须为空，非空目录请先删除其内容）' : ''
  try {
    await ElMessageBox.confirm(`确认删除「${s.remoteSel.name}」?${dirTip}`, '提示', { type: 'warning' })
    await window.liushub.sftp.remove(s.sshId, s.remoteSel.path)
    ElMessage.success('已删除')
    remoteReload(s)
  } catch {}
}

async function onDownload() {
  const s = activeSession.value
  if (!s || !s.remoteSel) { ElMessage.warning('请先选择远端文件'); return }
  if (s.remoteSel.isDir) { ElMessage.warning('目录请用 zip/tar 整体下载（MVP 仅支持单文件）'); return }
  // 选择本地保存目录
  const dir = await window.liushub.fs.choose('openDirectory')
  if (!dir) return
  const local = joinPath(dir, s.remoteSel.name)
  progress.value = { pct: 0, status: '', label: `下载 ${s.remoteSel.name}` }
  try {
    await window.liushub.sftp.download(s.sshId, s.remoteSel.path, local)
    progress.value = { pct: 100, status: 'success', label: '下载完成' }
    localRefresh()
    setTimeout(() => progress.value = null, 1500)
  } catch (e) {
    progress.value = { pct: 0, status: 'exception', label: '下载失败: ' + e.message }
  }
}

async function onUpload() {
  const s = activeSession.value
  if (!s || !s.sshId) { ElMessage.warning('请先连接'); return }
  let local = null
  if (!localSel.value || localSel.value.isDir) {
    // 弹出系统文件选择框
    local = await window.liushub.fs.choose('openFile')
    if (!local) return
  } else {
    local = localSel.value.path
  }
  const name = local.split(/[/\\]/).pop()
  const remote = joinPath(s.remotePath, name)
  progress.value = { pct: 0, status: '', label: `上传 ${name}` }
  try {
    await window.liushub.sftp.upload(s.sshId, local, remote)
    progress.value = { pct: 100, status: 'success', label: '上传完成' }
    remoteReload(s)
    setTimeout(() => progress.value = null, 1500)
  } catch (e) {
    progress.value = { pct: 0, status: 'exception', label: '上传失败: ' + e.message }
  }
}

/* 本地文件浏览 (真实文件系统，所有会话共享) */
async function localReload(p) {
  const target = p || localPath.value
  try {
    const r = await window.liushub.fs.list(target)
    localPath.value = r.path
    localParent.value = r.parent
    localRows.value = r.items.sort((a, b) =>
      (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
    if (r.truncated && !localTruncated.value) {
      ElMessage.warning('本地目录条目过多，仅显示前 500 项')
    }
    localTruncated.value = !!r.truncated
  } catch (e) {
    ElMessage.error('读取本地目录失败: ' + e.message)
    localRows.value = []
  }
}

async function localCd(row) {
  if (row === '..') {
    if (localPath.value === '此电脑') return
    // 磁盘根目录（如 C:\）→ 返回磁盘列表，便于切换到其他盘
    if (localParent.value === localPath.value) {
      await localListDrives()
      return
    }
    if (localParent.value) {
      await localReload(localParent.value)
    }
    return
  }
  if (row.isDir) {
    await localReload(row.path)
  }
}

/** 列出所有磁盘（此电脑视图） */
async function localListDrives() {
  try {
    const r = await window.liushub.fs.listDrives()
    localPath.value = r.path
    localParent.value = r.parent
    localRows.value = r.items
    localTruncated.value = false
  } catch (e) {
    ElMessage.error('读取磁盘列表失败: ' + (e.message || e))
  }
}

/** 手动输入路径并跳转（支持 D:\ 等任意路径） */
function localGo() {
  const v = (localPathInput.value || '').trim()
  if (!v) return
  localReload(v)
}

/** 刷新当前本地视图（磁盘列表或当前目录） */
async function localRefresh() {
  if (localPath.value === '此电脑') await localListDrives()
  else await localReload()
}

function onLocalDragStart(e, row) {
  e.dataTransfer.setData('text/x-liushub-local', row.path)
}

async function onRemoteDrop(e) {
  const s = activeSession.value
  if (!s || !s.sshId) return
  const local = e.dataTransfer.getData('text/x-liushub-local')
  if (!local) return
  const name = local.split(/[/\\]/).pop()
  const remote = joinPath(s.remotePath, name)
  progress.value = { pct: 0, status: '', label: `上传 ${name}` }
  try {
    await window.liushub.sftp.upload(s.sshId, local, remote)
    progress.value = { pct: 100, status: 'success', label: '上传完成' }
    remoteReload(s)
    setTimeout(() => progress.value = null, 1500)
  } catch (err) {
    progress.value = { pct: 0, status: 'exception', label: '上传失败: ' + err.message }
  }
}

function reloadBoth() {
  const s = activeSession.value
  if (s) remoteReload(s)
  localRefresh()
}

/* 工具 */
function joinPath(base, name) {
  if (!base || base === '/') return '/' + name
  if (base.endsWith('/')) return base + name
  return base + '/' + name
}

function formatSize(n) {
  if (n == null) return ''
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB'
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB'
}

function formatTime(t) {
  if (!t) return ''
  return new Date(t).toLocaleString('zh-CN', { hour12: false })
}

function modeStr(m) {
  if (m == null) return '---------'
  const s = ['r','w','x','r','w','x','r','w','x']
  let out = ''
  for (let i = 8; i >= 0; i--) out += (m & (1 << i)) ? s[8 - i] : '-'
  return out
}
</script>

<style scoped>
.sftp-view { display: flex; flex-direction: column; height: 100%; gap: 12px; }
.sftp-toolbar { flex-shrink: 0; }
.pane-header {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--glass-border);
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--glass-bg-soft);
  -webkit-backdrop-filter: var(--backdrop-blur-soft);
  backdrop-filter: var(--backdrop-blur-soft);
}
.pane-header .path-input { flex: 1; }
.pane-toolbar {
  padding: 6px 8px;
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--glass-border);
}
.progress-bar {
  position: absolute;
  bottom: 16px; right: 16px;
  width: 320px;
  padding: 8px 12px;
}
</style>
