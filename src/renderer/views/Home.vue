<template>
  <div class="home">
    <div class="hero glass-card">
      <div class="hero-title">
        <h1>欢迎使用 LiusHub</h1>
        <p class="muted">一站式开发运维工作台 · 整合 SSH、SFTP、数据库、Docker</p>
      </div>
      <div class="row gap-12" style="margin-top: 16px;">
        <el-button type="primary" @click="$router.push('/assets')">
          <el-icon><Coin /></el-icon><span>管理资产</span>
        </el-button>
        <el-button @click="$router.push('/ssh')">
          <el-icon><Monitor /></el-icon><span>新建 SSH 会话</span>
        </el-button>
        <el-button @click="$router.push('/tools')">
          <el-icon><Tools /></el-icon><span>工具坞</span>
        </el-button>
      </div>
    </div>

    <div class="quick-grid">
      <div v-for="card in cards" :key="card.path" class="quick-card glass" @click="goto(card.path)">
        <div class="quick-icon" :style="{ background: card.color }">
          <el-icon><component :is="card.icon" /></el-icon>
        </div>
        <div class="quick-body">
          <div class="quick-title">{{ card.title }}</div>
          <div class="muted">{{ card.desc }}</div>
        </div>
      </div>
    </div>

    <div class="stats-row">
      <div class="stat glass" v-for="s in stats" :key="s.label">
        <div class="muted" style="font-size: 12px;">{{ s.label }}</div>
        <div class="stat-value">{{ s.value }}</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
const cards = [
  { path: '/ssh',      title: 'SSH 终端',  desc: 'xterm.js 高保真终端', icon: 'Monitor',      color: 'linear-gradient(135deg,#4f6df5,#8b5cf6)' },
  { path: '/sftp',     title: 'SFTP',      desc: '双栏文件管理',       icon: 'Folder',       color: 'linear-gradient(135deg,#10b981,#3b82f6)' },
  { path: '/database', title: '数据库',    desc: '5 种数据库支持',     icon: 'DataAnalysis', color: 'linear-gradient(135deg,#f97316,#ef4444)' },
  { path: '/docker',   title: 'Docker',    desc: '容器/镜像管理',      icon: 'Box',          color: 'linear-gradient(135deg,#0ea5e9,#22d3ee)' },
  { path: '/tools',    title: '工具坞',    desc: '快捷命令模板',       icon: 'Tools',        color: 'linear-gradient(135deg,#a855f7,#ec4899)' },
  { path: '/assets',   title: '资产库',    desc: '加密存储连接',       icon: 'Coin',         color: 'linear-gradient(135deg,#facc15,#f59e0b)' },
]
const stats = ref([
  { label: '保存的连接', value: 0 },
  { label: 'SSH 资产',   value: 0 },
  { label: '活跃会话',   value: 0 },
])

onMounted(async () => {
  try {
    const [all, ssh, sessions] = await Promise.all([
      window.liushub.asset.list(),
      window.liushub.asset.list('ssh'),
      window.liushub.ssh.listSessions(),
    ])
    stats.value[0].value = all.length
    stats.value[1].value = ssh.length
    stats.value[2].value = sessions.length
  } catch (e) { /* ignore */
  }
})

function goto(p) { router.push(p) }
</script>

<style scoped>
.home { display: flex; flex-direction: column; gap: 16px; }
.hero {
  padding: 28px 32px;
  background:
    radial-gradient(circle at 80% 0%, rgba(107, 138, 253, 0.25), transparent 50%),
    var(--glass-bg);
}
.hero h1 { margin: 0 0 4px; font-size: 22px; }
.hero p  { margin: 0; }

.quick-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
}
.quick-card {
  display: flex;
  gap: 12px;
  padding: 14px;
  cursor: pointer;
  transition: transform 200ms;
}
.quick-card:hover { transform: translateY(-3px); box-shadow: var(--shadow-lg); }
.quick-icon {
  width: 40px; height: 40px;
  border-radius: 10px;
  display: grid; place-items: center;
  color: white;
  font-size: 18px;
  flex-shrink: 0;
}
.quick-title { font-weight: 600; margin-bottom: 2px; }

.stats-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
}
.stat { padding: 14px 16px; }
.stat-value { font-size: 24px; font-weight: 600; margin-top: 4px; }
</style>
