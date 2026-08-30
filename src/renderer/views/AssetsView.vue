<template>
  <div class="assets-view">
    <div class="assets-toolbar glass-toolbar">
      <el-segmented v-model="type" :options="types" @change="reload" />
      <el-input v-model="keyword" placeholder="搜索资产..." style="max-width: 240px;" clearable />
      <div style="flex: 1" />
      <el-button type="primary" @click="openEdit()">
        <el-icon><Plus /></el-icon><span>新增</span>
      </el-button>
    </div>

    <div class="assets-grid">
      <div v-for="a in filtered" :key="a.id" class="asset-card glass" @click="openEdit(a)">
        <div class="row gap-8">
          <el-icon :size="20" :color="iconColor(a.type)"><component :is="iconFor(a.type)" /></el-icon>
          <div class="title">{{ a.name }}</div>
        </div>
        <div class="meta mono">{{ a.username }}@{{ a.host }}:{{ a.port }}</div>
        <div class="meta">类型: {{ typeLabel(a.type) }}</div>
        <div class="row gap-8" style="margin-top: 8px;" @click.stop>
          <el-button size="small" @click="quickConnect(a)">连接</el-button>
          <el-button size="small" @click="openEdit(a)">编辑</el-button>
          <el-button size="small" type="danger" @click="onDelete(a)">删除</el-button>
        </div>
      </div>
      <div v-if="!filtered.length" class="empty muted" style="grid-column: 1/-1;">
        暂无资产，点击"新增"开始配置
      </div>
    </div>

    <el-dialog v-model="dialog" :title="form.id ? '编辑资产' : '新增资产'" width="560px">
      <el-form :model="form" label-width="72px" class="asset-form">
        <div class="form-grid">
          <el-form-item label="名称">
            <el-input v-model="form.name" placeholder="给资产起个名字" />
          </el-form-item>
          <el-form-item label="类型">
            <el-select v-model="form.type" style="width: 100%;">
              <el-option v-for="t in typesList" :key="t" :value="t" :label="typeLabel(t)" />
            </el-select>
          </el-form-item>
          <el-form-item label="主机">
            <el-input v-model="form.host" placeholder="192.168.1.1 或 example.com" />
          </el-form-item>
          <el-form-item label="端口">
            <el-input-number v-model="form.port" :min="1" :max="65535" controls-position="right" />
          </el-form-item>
          <el-form-item label="用户名">
            <el-input v-model="form.username" placeholder="root" />
          </el-form-item>
          <el-form-item v-if="form.type === 'database'" label="数据库类型" label-width="88px">
            <el-select v-model="form.extra.dbType" style="width: 100%;">
              <el-option v-for="t in ['mysql','postgres','sqlite','clickhouse','redis']" :key="t" :value="t" :label="t" />
            </el-select>
          </el-form-item>
        </div>
        <!-- 仅 SQLite 需要数据库文件路径；其他类型连接时无需数据库名 -->
        <el-form-item v-if="form.type === 'database' && form.extra.dbType === 'sqlite'" label="DB 文件路径">
          <el-input v-model="form.extra.database" placeholder="C:\\path\\to\\test.db" />
        </el-form-item>
        <el-form-item label="认证">
          <el-radio-group v-model="authMode">
            <el-radio-button value="password">密码</el-radio-button>
            <el-radio-button value="key">私钥</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="form.type === 'docker'" label="SSH 直连">
          <div class="row gap-12">
            <el-switch v-model="form.secret.useSsh" />
            <span class="muted" style="font-size: 12px;">通过 SSH 连接远端 Docker 守护进程（docker system dial-stdio）</span>
          </div>
        </el-form-item>
        <el-form-item v-if="authMode==='password'" label="密码">
          <el-input v-model="form.secret.password" type="password" show-password placeholder="连接密码" />
        </el-form-item>
        <el-form-item v-else label="私钥">
          <el-input v-model="form.secret.privateKey" type="textarea" :rows="5"
            placeholder="-----BEGIN OPENSSH PRIVATE KEY-----..." />
        </el-form-item>
        <el-form-item v-if="authMode==='key'" label="口令">
          <el-input v-model="form.secret.passphrase" type="password" show-password placeholder="私钥口令（如无留空）" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog=false">取消</el-button>
        <el-button type="primary" @click="onSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onActivated } from 'vue'
import { useAssetsStore } from '../stores/assets'
import { ElMessage, ElMessageBox } from 'element-plus'

const store = useAssetsStore()
const type = ref('all')
const keyword = ref('')
const dialog = ref(false)
const authMode = ref('password')

const types = [
  { label: '全部', value: 'all' },
  { label: 'SSH', value: 'ssh' },
  { label: 'SFTP', value: 'sftp' },
  { label: '数据库', value: 'database' },
  { label: 'Docker', value: 'docker' },
  { label: 'RDP', value: 'rdp' },
]
const typesList = types.slice(1).map((t) => t.value)

const form = ref(emptyForm())

function emptyForm() {
  return {
    id: null,
    type: 'ssh',
    name: '',
    host: '',
    port: 22,
    username: 'root',
    secret: { password: '', privateKey: '', passphrase: '', useSsh: false },
    extra: { dbType: 'mysql', database: '' },
  }
}

onMounted(() => reload())

// keep-alive 下 onMounted 只执行一次，而 store.list 是各模块共用的：
// SSH/SFTP/DB/Docker 模块切换时会用各自类型覆盖它。每次切回资产库必须重新拉取，
// 否则只会显示上一个模块的类型列表。
onActivated(() => reload())

async function reload() {
  const t = type.value === 'all' ? null : type.value
  await store.load(t)
}

const filtered = computed(() => {
  const k = keyword.value.toLowerCase().trim()
  if (!k) return store.list
  return store.list.filter((a) =>
    a.name.toLowerCase().includes(k) ||
    a.host.toLowerCase().includes(k) ||
    a.username.toLowerCase().includes(k),
  )
})

function typeLabel(t) {
  return types.find((x) => x.value === t)?.label || t
}

function iconFor(t) {
  return { ssh: 'Monitor', sftp: 'Folder', database: 'DataAnalysis', docker: 'Box', rdp: 'VideoCamera' }[t] || 'Connection'
}
function iconColor(t) {
  return { ssh: '#4f6df5', sftp: '#10b981', database: '#f97316', docker: '#0ea5e9', rdp: '#a855f7' }[t] || '#666'
}

async function openEdit(asset) {
  if (asset) {
    const full = await window.liushub.asset.get(asset.id)
    form.value = { ...emptyForm(), ...full, secret: full.secret || {} }
    authMode.value = full.secret?.privateKey ? 'key' : 'password'
  } else {
    form.value = emptyForm()
    authMode.value = 'password'
  }
  dialog.value = true
}

async function onSave() {
  if (!form.value.name) { ElMessage.warning('请输入名称'); return }
  if (!form.value.host) { ElMessage.warning('请输入主机'); return }
  if (authMode.value === 'password' && !form.value.secret?.password) {
    ElMessage.warning('请输入密码'); return
  }
  if (authMode.value === 'key' && !form.value.secret?.privateKey) {
    ElMessage.warning('请输入私钥'); return
  }
  const raw = {
    id: form.value.id || null,
    type: form.value.type || 'ssh',
    name: form.value.name.trim(),
    host: form.value.host.trim(),
    port: Number(form.value.port) || (form.value.type === 'database' ? 3306 : 22),
    username: form.value.username.trim(),
    extra: form.value.extra || {},
  }
  if (authMode.value === 'password') {
    raw.secret = { password: form.value.secret.password, useSsh: !!form.value.secret.useSsh && form.value.type === 'docker' }
  } else {
    raw.secret = {
      privateKey: form.value.secret.privateKey,
      passphrase: form.value.secret.passphrase,
      useSsh: !!form.value.secret.useSsh && form.value.type === 'docker',
    }
  }
  // 关键：必须深拷贝为纯 JSON 对象再发给主进程。
  // form.value 是 Vue 响应式 Proxy —— structured clone 无法克隆 Proxy，
  // 直接传递会报 "An object could not be cloned."（JSON.stringify 检测不出来）。
  let payload
  try {
    payload = JSON.parse(JSON.stringify(raw))
  } catch (e) {
    ElMessage.error('表单包含无法序列化的数据，请检查输入内容')
    return
  }
  try {
    await store.save(payload)
    ElMessage.success('已保存')
    dialog.value = false
    reload()
  } catch (e) {
    ElMessage.error('保存失败: ' + (e?.message || e))
  }
}

async function onDelete(asset) {
  try {
    await ElMessageBox.confirm(`确认删除资产「${asset.name}」？`, '提示', { type: 'warning' })
    await store.remove(asset.id)
    ElMessage.success('已删除')
  } catch {/* cancel */}
}

async function quickConnect(asset) {
  const full = await window.liushub.asset.get(asset.id)
  if (!full) return
  if (full.secret?.decryptError) { ElMessage.warning(full.secret.decryptError); return }
  if (asset.type === 'ssh') {
    // 内存级一次性传参（不落 sessionStorage，避免明文密码可被读取）
    const { setPendingSsh } = await import('../handoff')
    setPendingSsh(full)
    location.hash = '#/ssh'
    return
  }
  // 其他类型：跳转到对应模块（表单字段差异大，不自动填充）
  const routeMap = { sftp: '#/sftp', database: '#/database', docker: '#/docker', rdp: '#/ssh' }
  location.hash = routeMap[asset.type] || '#/assets'
  ElMessage.info(`请在「${typeLabel(asset.type)}」模块连接「${asset.name}」`)
}
</script>

<style scoped>
.assets-view { display: flex; flex-direction: column; gap: 12px; height: 100%; }
.assets-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
  overflow-y: auto;
}
.empty {
  text-align: center;
  padding: 40px;
  font-size: 13px;
}
/* 资产表单：短字段两列排布，更紧凑美观 */
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 16px;
}
.asset-form :deep(.el-form-item) { margin-bottom: 16px; }

</style>
