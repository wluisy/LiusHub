<template>
  <header class="lh-topbar">
    <el-button text @click="$emit('toggleSidebar')" class="titlebar-no-drag" style="-webkit-app-region: no-drag;">
      <el-icon><Expand v-if="collapsed" /><Fold v-else /></el-icon>
    </el-button>

    <div class="lh-breadcrumb muted">
      <span v-for="(c, i) in crumbs" :key="i">
        <span v-if="i > 0"> / </span>{{ c }}
      </span>
    </div>

    <div style="flex: 1" />

    <el-input
      v-model="search"
      placeholder="搜索资产、命令、容器..."
      class="lh-search titlebar-no-drag"
      style="max-width: 320px;"
      clearable
    >
      <template #prefix><el-icon><Search /></el-icon></template>
    </el-input>

    <el-button text @click="toggleTheme" class="titlebar-no-drag" style="-webkit-app-region: no-drag;">
      <el-icon><Sunny v-if="theme==='dark'" /><Moon v-else /></el-icon>
    </el-button>

    <el-button text @click="openSettings" class="titlebar-no-drag" style="-webkit-app-region: no-drag;">
      <el-icon><Setting /></el-icon>
    </el-button>
  </header>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

defineProps({ theme: { type: String, default: 'dark' }, collapsed: Boolean })
const emit = defineEmits(['toggle-theme', 'toggleSidebar'])

const route = useRoute()
const router = useRouter()
const search = ref('')

const crumbs = computed(() => {
  const t = route.meta?.title || '首页'
  return ['LiusHub', t]
})

function toggleTheme() { emit('toggle-theme') }
function openSettings() { router.push('/settings') }
</script>

<style scoped>
.lh-search :deep(.el-input__wrapper) {
  background: var(--glass-bg-soft);
  border-radius: 8px;
  -webkit-backdrop-filter: var(--backdrop-blur-soft);
  backdrop-filter: var(--backdrop-blur-soft);
}
</style>
