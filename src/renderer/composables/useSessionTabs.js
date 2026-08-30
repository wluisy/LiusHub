import { ref, computed, reactive } from 'vue'

/**
 * 子 tab 会话管理 — 所有功能模块（SSH / SFTP / 数据库 / Docker）共用。
 * 每个连接成功后生成一个子 tab，支持切换、复制连接、关闭。
 * sessions 中的每个会话对象是响应式的，展示用状态（标题、状态、各模块数据）放在会话对象上，
 * 会话无关的技术状态（终端实例、订阅、后端 id 等）由各视图自行用 Map 维护。
 */
let uid = 0

export function useSessionTabs() {
  const sessions = ref([])
  const activeId = ref(null)

  const activeSession = computed(() =>
    sessions.value.find((s) => s.id === activeId.value) || null,
  )

  /** 新增一个会话 tab 并设为激活，返回会话对象 */
  function addSession(title, extra = {}) {
    // 用 reactive 创建会话对象：返回的 s 本身就是响应式代理，
    // 各视图后续对 s.xxx 的赋值才能被 Vue 追踪到，避免 UI 延迟刷新
    const s = reactive({ id: `sess_${++uid}_${Date.now()}`, title, status: 'idle', ...extra })
    sessions.value.push(s)
    activeId.value = s.id
    return s
  }

  function activate(id) {
    if (sessions.value.some((s) => s.id === id)) activeId.value = id
  }

  function setStatus(id, status) {
    const s = sessions.value.find((x) => x.id === id)
    if (s) s.status = status
  }

  function rename(id, title) {
    const s = sessions.value.find((x) => x.id === id)
    if (s && title) s.title = title
  }

  /** 移除会话 tab；若移除的是激活项，自动激活相邻 tab */
  function removeSession(id) {
    const i = sessions.value.findIndex((s) => s.id === id)
    if (i < 0) return id
    sessions.value.splice(i, 1)
    if (activeId.value === id) {
      activeId.value = sessions.value.length
        ? sessions.value[Math.min(i, sessions.value.length - 1)].id
        : null
    }
    return id
  }

  return {
    sessions,
    activeId,
    activeSession,
    addSession,
    activate,
    setStatus,
    rename,
    removeSession,
  }
}
