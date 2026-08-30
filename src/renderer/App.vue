<template>
  <div class="lh-app">
    <div
      class="lh-app-bg"
      :class="{ fluid: glass.bgMode === 'fluid', wallpaper: glass.bgMode === 'wallpaper' && !!bgUrl }"
      :style="bgStyle"
    />
    <div class="titlebar-drag titlebar-no-drag-region" style="-webkit-app-region: drag;">
      <span style="opacity: 0.7; font-size: 12px;">LiusHub</span>
    </div>
    <div class="lh-main">
      <Sidebar :collapsed="sidebarCollapsed" @toggle="sidebarCollapsed = !sidebarCollapsed" />
      <div class="lh-content">
        <TopBar
          :theme="theme"
          :collapsed="sidebarCollapsed"
          @toggle-sidebar="sidebarCollapsed = !sidebarCollapsed"
          @toggle-theme="toggleTheme"
        />
        <!-- 浮空舞台：页签栏 + 页面合为一个整体圆角容器，玻璃拟态 + 新拟态浮空立体感 -->
        <div class="lh-stage">
          <TabBar />
          <main class="lh-page">
            <router-view v-slot="{ Component, route }">
              <!-- keep-alive：缓存组件，切换 Tab 时 SSH/SFTP/DB 连接不断开。
                   transition 不使用 mode="out-in"：该模式与 keep-alive 组合在 Vue 3 存在已知 bug，
                   二次切回同一路由时缓存内容被清空导致页面空白（vuejs/core#7121），
                   改为默认同时过渡（淡入淡出）即可正常保留组件缓存。 -->
              <transition name="fade">
                <keep-alive>
                  <component :is="Component" :key="route.fullPath" />
                </keep-alive>
              </transition>
            </router-view>
          </main>
        </div>
        <StatusBar />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useThemeStore } from './stores/theme'
import Sidebar from './components/Sidebar.vue'
import TopBar from './components/TopBar.vue'
import TabBar from './components/TabBar.vue'
import StatusBar from './components/StatusBar.vue'

const sidebarCollapsed = ref(false)
const themeStore = useThemeStore()
const theme = ref('dark')
// 通过 computed 读取 store，保证 store 状态更新后始终拿到最新值
const glass = computed(() => themeStore.glass)
const bgUrl = computed(() => themeStore.bgUrl)

async function loadBackground() {
  try {
    themeStore.setBackground(await window.liushub.settings.getBackground())
  } catch { themeStore.setBackground('') }
}

async function loadGlass() {
  try {
    const cfg = await window.liushub.settings.getGlass()
    themeStore.setGlass(cfg)
  } catch { /* 使用默认值 */ }
}

const bgStyle = computed(() => {
  if (glass.value.bgMode !== 'wallpaper' || !bgUrl.value) return {}
  return { backgroundImage: `url("${bgUrl.value}")` }
})

onMounted(async () => {
  if (window.liushub) {
    theme.value = await window.liushub.app.getTheme()
    themeStore.set(theme.value)
    loadBackground()
    loadGlass()
  }
  // 监听主进程主题变化广播
  window.liushub?.app.onThemeChange((t) => {
    theme.value = t
    themeStore.set(t)
  })
  // 设置页保存背景图后刷新
  window.addEventListener('liushub:bg-changed', loadBackground)
})

function toggleTheme() {
  theme.value = theme.value === 'dark' ? 'light' : 'dark'
  window.liushub?.app.setTheme(theme.value)
  themeStore.set(theme.value)
}

watch(theme, (v) => {
  document.documentElement.setAttribute('data-theme', v)
}, { immediate: true })
</script>

<style scoped>
.lh-app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  position: relative;
  /* 创建独立 stacking context：确保 .lh-app-bg (z-index:-1) 在自身背景之上、
     在内容之下绘制。否则它会逃逸到根上下文、被不透明背景盖住，导致壁纸/流体背景不可见。 */
  isolation: isolate;
  background: var(--bg-base);
}
.lh-main {
  flex: 1;
  display: flex;
  min-height: 0;
}
.lh-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
/* 浮空舞台：页签栏 + 页面合成一个整体，玻璃拟态 + 新拟态浮空立体感。
   四周留边距露出背景，配合底部投影 + 顶部内高光，呈现"浮起"的效果。 */
.lh-stage {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  margin: 10px 14px 6px;
  background: var(--glass-bg-soft);
  -webkit-backdrop-filter: var(--backdrop-blur-soft);
  backdrop-filter: var(--backdrop-blur-soft);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  overflow: hidden;
  box-shadow: var(--shadow-float);
}
.lh-page {
  flex: 1;
  overflow: auto;
  padding: 16px;
  position: relative;
}
.fade-enter-active, .fade-leave-active { transition: opacity 200ms ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
