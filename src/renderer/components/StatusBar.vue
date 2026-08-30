<template>
  <footer class="lh-statusbar">
    <div class="row gap-12">
      <span class="dot success" />
      <span class="muted">就绪</span>
    </div>
    <div class="row gap-12" v-if="active">
      <el-icon style="font-size: 12px;"><Connection /></el-icon>
      <span class="mono">{{ active.label }}</span>
    </div>
    <div style="flex: 1" />
    <div class="row gap-12">
      <span class="muted">{{ now }}</span>
    </div>
  </footer>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const now = ref(formatNow(new Date()))
let timer = null

const active = ref(null)

function formatNow(d) {
  return d.toLocaleTimeString('zh-CN', { hour12: false })
}

onMounted(() => {
  timer = setInterval(() => {
    now.value = formatNow(new Date())
  }, 2000)
})
onUnmounted(() => { clearInterval(timer) })
</script>

<style scoped>
.lh-statusbar {
  height: 28px;
  display: flex;
  align-items: center;
  padding: 0 12px;
  margin: 0 14px 10px;
  gap: 16px;
  background: var(--glass-bg);
  -webkit-backdrop-filter: var(--backdrop-blur);
  backdrop-filter: var(--backdrop-blur);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-float);
  font-size: 12px;
  color: var(--text-secondary);
}
</style>
