<template>
  <div class="lh-tabbar">
    <div
      v-for="t in tabs.tabs"
      :key="t.id"
      class="lh-tab"
      :class="{ active: tabs.activeId === t.id }"
      @click="activate(t)"
      @mousedown.middle="close(t.id)"
    >
      <span class="dot" :class="{ success: route.path === t.route }" />
      <span style="font-size: 12px;">{{ t.name }}</span>
      <span v-if="t.closable" class="close" @click.stop="close(t.id)">×</span>
    </div>
  </div>
</template>

<script setup>
import { useRouter, useRoute } from 'vue-router'
import { useTabsStore } from '../stores/tabs'

const router = useRouter()
const route = useRoute()
const tabs = useTabsStore()

function activate(t) {
  tabs.activate(t.id)
  router.push(t.route)
}

function close(id) {
  // 关闭时切换到下一个 tab
  const closing = tabs.tabs.find((t) => t.id === id)
  tabs.close(id)
  if (closing && route.path === closing.route) {
    const next = tabs.tabs.find((t) => t.id === tabs.activeId)
    if (next) router.push(next.route)
  }
}
</script>
