<template>
  <div class="docker-view">
    <!-- 子 tab：所有 Docker 会话 -->
    <SessionTabs
      :sessions="sessions"
      :active-id="activeId"
      @select="activate"
      @close="closeSession"
      @copy="copySession"
      @edit="editSession"
    />

    <div class="docker-toolbar glass-toolbar">
      <el-select v-model="selectedAssetId" placeholder="选择 Docker 主机" style="width: 240px;" @change="onAssetSelect">
        <el-option v-for="a in assets" :key="a.id" :value="a.id" :label="a.name" />
      </el-select>
      <el-button @click="manualForm = true" plain>手动连接</el-button>
      <span v-if="activeSession?.connected" class="row gap-8 muted"><span class="dot success" />已连接 {{ activeSession.title }}</span>
      <div style="flex: 1" />
      <el-button :disabled="!activeSession?.connected" @click="loadAll(activeSession)">
        <el-icon><Refresh /></el-icon><span>刷新</span>
      </el-button>
      <el-button :disabled="!activeSession?.connected" type="danger" plain @click="disconnect">
        <span>断开</span>
      </el-button>
    </div>

    <template v-if="activeSession">
      <div class="docker-grid">
        <!-- 容器 -->
        <div class="glass">
          <div class="pane-header">
            <span>容器 ({{ activeSession.containers.length }})</span>
          </div>
          <div class="container-list">
            <div
              v-for="c in activeSession.containers"
              :key="c.id"
              class="container-row"
              :class="{ active: activeSession.selectedContainer?.id === c.id }"
              @click="selectContainer(activeSession, c)"
            >
              <span :class="['dot', stateClass(c.state)]" />
              <div class="info">
                <div class="name mono">{{ c.name }}</div>
                <div class="muted">{{ c.image }} · {{ c.status }}</div>
              </div>
              <div class="actions" @click.stop>
                <el-button size="small" @click="startContainer(activeSession, c)" v-if="c.state !== 'running'">启动</el-button>
                <el-button size="small" type="warning" @click="stopContainer(activeSession, c)" v-else>停止</el-button>
              </div>
            </div>
            <div v-if="!activeSession.containers.length" class="muted" style="padding: 20px; text-align: center;">无容器</div>
          </div>
        </div>

        <!-- 详情/日志/资源 -->
        <div class="glass">
          <div class="pane-header">
            <span v-if="activeSession.selectedContainer">{{ activeSession.selectedContainer.name }} · {{ activeSession.selectedContainer.state }}</span>
            <span v-else class="muted">请选择容器</span>
          </div>
          <el-tabs v-model="activeSession.activeTab" v-if="activeSession.selectedContainer">
            <el-tab-pane label="日志" name="logs">
              <pre class="logs mono">{{ activeSession.logs }}</pre>
            </el-tab-pane>
            <el-tab-pane label="资源" name="stats">
              <div v-if="activeSession.stats" class="stats-grid">
                <div class="stat-card glass">
                  <div class="muted">CPU</div>
                  <div class="value">{{ activeSession.stats.cpuPct }}%</div>
                </div>
                <div class="stat-card glass">
                  <div class="muted">内存</div>
                  <div class="value">{{ activeSession.stats.mem }}</div>
                  <div class="muted" style="font-size: 11px;">{{ activeSession.stats.memPct }}%</div>
                </div>
                <div class="stat-card glass">
                  <div class="muted">网络 I/O</div>
                  <div class="value" style="font-size: 14px;">{{ activeSession.stats.netRx }} / {{ activeSession.stats.netTx }}</div>
                </div>
              </div>
              <div v-else class="muted" style="padding: 20px; text-align: center;">
                <el-button size="small" type="primary" @click="startStats(activeSession)">订阅实时资源</el-button>
              </div>
            </el-tab-pane>
            <el-tab-pane label="镜像" name="images">
              <div class="image-list">
                <div v-for="i in activeSession.images" :key="i.id" class="image-row">
                  <div class="name mono">{{ i.repoTags.join(',') || i.id.slice(7, 19) }}</div>
                  <div class="muted">{{ formatSize(i.size) }}</div>
                </div>
              </div>
            </el-tab-pane>
          </el-tabs>
          <div v-else class="muted" style="padding: 60px; text-align: center;">从左侧选择容器查看详情</div>
        </div>
      </div>
    </template>
    <div v-else class="docker-empty glass">
      <el-icon :size="48" color="var(--text-muted)"><Box /></el-icon>
      <p class="muted" style="margin-top: 12px;">选择 Docker 主机或手动连接</p>
    </div>

    <!-- 手动连接 / 编辑连接 -->
    <el-dialog v-model="manualForm" :title="editingId ? '编辑 Docker 连接' : '连接 Docker'" width="420px">
      <el-form :model="form" label-width="80px">
        <el-form-item label="主机"><el-input v-model="form.host" /></el-form-item>
        <el-form-item label="端口"><el-input-number v-model="form.port" :min="1" :max="65535" /></el-form-item>
        <el-form-item label="协议">
          <el-radio-group v-model="form.protocol"><el-radio value="http">HTTP</el-radio><el-radio value="https">HTTPS</el-radio></el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="manualForm=false">取消</el-button>
        <el-button type="primary" @click="onManualConnect">连接</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted, onActivated, onDeactivated, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import { useAssetsStore } from '../stores/assets'
import { useConnectionSessions } from '../composables/useConnectionSessions'
import SessionTabs from '../components/SessionTabs.vue'

const store = useAssetsStore()
const {
  sessions, activeId, activeSession, activate, setStatus, rename,
  sessionMap, connectWith, reconnectSession, closeSession, copySession,
} = useConnectionSessions({
  connect: (cfg) => window.liushub.docker.connect(cfg),
  disconnect: (id) => window.liushub.docker.disconnect(id),
  getBackendId: (s) => s.dockerId,
  setBackendId: (s, id) => { s.dockerId = id },
  state: () => ({ dockerId: null, containers: [], images: [], selectedContainer: null, activeTab: 'logs', logs: '', stats: null }),
  titleOf: (cfg) => `${cfg.host}:${cfg.port}`,
  onConnected: async (s) => {
    ElMessage.success('已连接 Docker')
    await loadAll(s)
  },
  onReconnected: async (s, cfg) => {
    rename(s.id, `${cfg.host}:${cfg.port}`)
    ElMessage.success('已重新连接 Docker')
    await loadAll(s)
  },
})

const assets = ref([])
const selectedAssetId = ref(null)
const manualForm = ref(false)
const editingId = ref(null)   // 正在编辑连接配置的会话 id（编辑后原地重连）
const editingSsh = ref(null)  // 编辑 ssh 隧道连接的原始 ssh 配置（表单中不展示，重连时保留）
const form = ref({ host: '127.0.0.1', port: 2375, protocol: 'http' })

let statsUnsub = null

onMounted(async () => {
  statsUnsub = window.liushub.docker.onStats(({ id, containerId, stats: raw, error }) => {
    // 只处理当前会话 + 当前容器的统计事件，避免残留流覆盖数据
    const s = sessions.value.find((x) => x.dockerId === id)
    if (!s || s.selectedContainer?.id !== containerId) return
    if (error) {
      ElMessage.error('资源统计失败: ' + error)
      s.stats = null
      return
    }
    s.stats = computeStats(raw)
  })
})

/** 资产下拉刷新：keep-alive 下 onMounted 只执行一次，改为每次切回本模块时重新拉取最新资产 */
async function refreshAssets() {
  await store.load('docker')
  assets.value = store.list
}
onActivated(refreshAssets)

// keep-alive 下切走时暂停 stats 推送，避免后台持续占用 IPC 与 CPU
onDeactivated(() => {
  const s = activeSession.value
  if (s && s.dockerId) window.liushub.docker.stopStats(s.dockerId)
})

onUnmounted(() => {
  if (statsUnsub) { statsUnsub(); statsUnsub = null }
  // 断开所有会话，避免连接累积泄漏
  for (const s of sessions.value) {
    if (s.dockerId) window.liushub.docker.disconnect(s.dockerId)
  }
})

async function onAssetSelect(id) {
  // 重置选择框，使"断开后再次选择同一资产"也能触发 change 重新连接
  selectedAssetId.value = null
  const a = await window.liushub.asset.get(id)
  if (!a) return
  if (a.secret?.decryptError) { ElMessage.warning(a.secret.decryptError); return }
  const cfg = {
    host: a.host, port: a.port,
    ssh: a.secret?.useSsh ? { host: a.host, port: a.port, username: a.username, ...a.secret } : null,
  }
  await connectWith(cfg)
}

async function onManualConnect() {
  manualForm.value = false
  const base = form.value.protocol === 'https'
    ? { host: form.value.host, port: form.value.port, tls: true }
    : { host: form.value.host, port: form.value.port }
  // 编辑模式：保留 ssh 隧道配置
  const ssh = editingSsh.value
  editingSsh.value = null
  const cfg = ssh ? { ...base, ssh } : base
  // 编辑连接：在同一个会话上原地重连
  const editId = editingId.value
  editingId.value = null
  const target = editId ? sessions.value.find((x) => x.id === editId) : null
  if (target) return reconnectSession(target, cfg)
  await connectWith(cfg)
}

/** 右键菜单：编辑已有会话的连接配置（原地重连，不新建 tab） */
function editSession(id) {
  const entry = sessionMap.get(id)
  if (!entry || !entry.cfg) { ElMessage.warning('该会话无连接配置，无法编辑'); return }
  const c = entry.cfg
  form.value = {
    host: c.host || '',
    port: c.port || 2375,
    protocol: c.tls ? 'https' : 'http',
  }
  editingSsh.value = c.ssh || null
  editingId.value = id
  manualForm.value = true
}

/** 在指定会话上用新配置原地重连（保留容器浏览状态）—— 由 useConnectionSessions 提供 */

function disconnect() {
  const s = activeSession.value
  if (!s) return
  if (s.dockerId) window.liushub.docker.disconnect(s.dockerId)
  s.dockerId = null
  s.connected = false
  s.containers = []
  s.images = []
  s.selectedContainer = null
  s.logs = ''
  s.stats = null
  setStatus(s.id, 'idle')
}

/** 选择容器：加载日志、重置资源统计 */
async function selectContainer(s, c) {
  if (!s) return
  s.selectedContainer = c
  s.activeTab = 'logs'
  s.stats = null
  await loadLogs(s, c)
}

async function loadLogs(s, c) {
  if (!s || !s.dockerId || !c) return
  try {
    const r = await window.liushub.docker.logs(s.dockerId, c.id, 500)
    s.logs = r.log || ''
  } catch (e) {
    s.logs = ''
    ElMessage.error('读取日志失败: ' + (e.message || e))
  }
}

function startStats(s) {
  if (!s || !s.dockerId || !s.selectedContainer) return
  window.liushub.docker.stats(s.dockerId, s.selectedContainer.id)
}

function computeStats(raw) {
  const cpuDelta = (raw.cpu_stats?.cpu_usage?.total_usage || 0) - (raw.precpu_stats?.cpu_usage?.total_usage || 0)
  const sysDelta = (raw.cpu_stats?.system_cpu_usage || 0) - (raw.precpu_stats?.system_cpu_usage || 0)
  const online = raw.cpu_stats?.online_cpus || 1
  let cpuPct = 0
  if (sysDelta > 0 && cpuDelta > 0) cpuPct = ((cpuDelta / sysDelta) * online * 100).toFixed(1)
  const mem = raw.memory_stats?.usage || 0
  const memLimit = raw.memory_stats?.limit || 1
  let netRx = 0, netTx = 0
  const nets = raw.networks || {}
  for (const k in nets) {
    netRx += nets[k].rx_bytes || 0
    netTx += nets[k].tx_bytes || 0
  }
  return {
    cpuPct,
    mem: formatSize(mem),
    memPct: ((mem / memLimit) * 100).toFixed(1),
    netRx: formatSize(netRx),
    netTx: formatSize(netTx),
  }
}

async function loadAll(s) {
  if (!s || !s.dockerId) return
  try {
    const [c, i] = await Promise.all([
      window.liushub.docker.listContainers(s.dockerId, true),
      window.liushub.docker.listImages(s.dockerId),
    ])
    s.containers = c
    s.images = i
  } catch (e) {
    ElMessage.error('加载失败: ' + e.message)
  }
}

async function startContainer(s, c) {
  try {
    await window.liushub.docker.start(s.dockerId, c.id)
    ElMessage.success('已发送启动命令')
  } catch (e) {
    ElMessage.error('启动失败: ' + (e?.message || e))
  }
  loadAll(s)
}
async function stopContainer(s, c) {
  try {
    await window.liushub.docker.stop(s.dockerId, c.id)
    ElMessage.success('已发送停止命令')
  } catch (e) {
    ElMessage.error('停止失败: ' + (e?.message || e))
  }
  loadAll(s)
}

function stateClass(st) {
  if (st === 'running') return 'success'
  if (st === 'exited' || st === 'dead') return 'danger'
  if (st === 'paused') return 'warning'
  return 'idle'
}

function formatSize(n) {
  if (!n) return '0'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB'
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB'
}
</script>

<style scoped>
.docker-view { display: flex; flex-direction: column; height: 100%; gap: 12px; }
.docker-grid { flex: 1; display: grid; grid-template-columns: 320px 1fr; gap: 12px; min-height: 0; }
.docker-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
.pane-header {
  padding: 8px 12px;
  border-bottom: 1px solid var(--glass-border);
  display: flex; align-items: center;
  background: var(--glass-bg-soft);
  -webkit-backdrop-filter: var(--backdrop-blur-soft);
  backdrop-filter: var(--backdrop-blur-soft);
  font-size: 13px;
}
.container-list, .image-list { max-height: calc(100vh - 260px); overflow: auto; }
.container-row {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--glass-border);
  cursor: pointer;
}
.container-row:hover { background: var(--accent-soft); }
.container-row.active { background: var(--accent-soft); }
.container-row .info { flex: 1; }
.container-row .name { font-size: 13px; font-weight: 500; }
.logs {
  background: #000;
  color: #c9d1d9;
  padding: 12px;
  border-radius: 6px;
  max-height: 60vh;
  overflow: auto;
  font-size: 12px;
  white-space: pre-wrap;
  margin: 0;
}
.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
  padding: 12px;
}
.stat-card { padding: 14px; }
.stat-card .value { font-size: 22px; font-weight: 600; margin: 4px 0; }
.image-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 8px 12px; border-bottom: 1px solid var(--glass-border);
  font-size: 13px;
}
</style>
