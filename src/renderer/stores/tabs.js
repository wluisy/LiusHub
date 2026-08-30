import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * 多标签管理 — 当前打开的功能标签页
 */
export const useTabsStore = defineStore('tabs', () => {
  const tabs = ref([
    { id: 'home', name: '首页', route: '/', closable: false },
  ])
  const activeId = ref('home')

  function open(route, name) {
    const existing = tabs.value.find((t) => t.route === route)
    if (existing) {
      activeId.value = existing.id
      return
    }
    const id = 'tab-' + Date.now()
    tabs.value.push({ id, name, route, closable: true })
    activeId.value = id
  }

  function close(id) {
    const idx = tabs.value.findIndex((t) => t.id === id)
    if (idx < 0 || !tabs.value[idx].closable) return
    tabs.value.splice(idx, 1)
    if (activeId.value === id) {
      const last = tabs.value[idx] || tabs.value[idx - 1] || tabs.value[0]
      activeId.value = last ? last.id : 'home'
    }
  }

  function activate(id) { activeId.value = id }

  return { tabs, activeId, open, close, activate }
})
