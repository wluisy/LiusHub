<template>
  <aside class="lh-sidebar" :class="{ collapsed }">
    <div class="lh-sidebar-brand">
      <img class="logo" src="../assets/logo.png" alt="LiusHub" draggable="false" />
      <span class="label" v-show="!collapsed">LiusHub</span>
    </div>

    <nav class="lh-nav" @click="onNav">
      <div
        v-for="item in items"
        :key="item.path"
        :data-path="item.path"
        :data-name="item.label"
        class="lh-nav-item"
        :class="{ active: isActive(item.path) }"
        :title="item.label"
      >
        <el-icon class="icon"><component :is="item.icon" /></el-icon>
        <span class="label" v-show="!collapsed">{{ item.label }}</span>
      </div>
    </nav>

    <div class="lh-sidebar-footer" v-show="!collapsed">
      <div class="muted" style="font-size: 11px; padding: 8px 12px;">
        v{{ appVersion }} · liushub
      </div>
    </div>
  </aside>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'

// 版本号统一取自 package.json（主进程 app.getVersion()），改版本只动 package.json
const appVersion = ref('0.1.0')
onMounted(async () => {
  try { appVersion.value = (await window.liushub.app.ready()).version } catch {}
})

defineProps({ collapsed: Boolean })
const emit = defineEmits(['toggle'])

const route = useRoute()
const router = useRouter()

const items = [
  { path: '/',          label: '首页',      icon: 'House' },
  { path: '/assets',    label: '资产库',    icon: 'Coin' },
  { path: '/ssh',       label: 'SSH 终端',  icon: 'Monitor' },
  { path: '/sftp',      label: 'SFTP',      icon: 'Folder' },
  { path: '/database',  label: '数据库',    icon: 'DataAnalysis' },
  { path: '/docker',    label: 'Docker',    icon: 'Box' },
  { path: '/tools',     label: '工具坞',    icon: 'Tools' },
  { path: '/settings',  label: '设置',      icon: 'Setting' },
]

function isActive(p) {
  if (p === '/') return route.path === '/'
  return route.path.startsWith(p)
}

function onNav(e) {
  const target = e.target.closest('.lh-nav-item')
  if (!target) return
  const path = target.dataset.path
  if (path) {
    router.push(path)
    // 同步打开 Tab
    const name = target.dataset.name
    if (name) {
      import('../stores/tabs').then(({ useTabsStore }) => {
        const tabs = useTabsStore()
        if (!tabs.tabs.find((t) => t.route === path)) {
          tabs.open(path, name)
        } else {
          tabs.activate(tabs.tabs.find((t) => t.route === path).id)
        }
      })
    }
  }
}
</script>

<style scoped>
.lh-sidebar-footer {
  border-top: 1px solid var(--glass-border);
}
</style>
