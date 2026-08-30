<template>
  <div class="session-tabs">
    <div class="session-tabs-scroll">
      <div
        v-for="s in sessions"
        :key="s.id"
        class="session-tab"
        :class="{ active: s.id === activeId }"
        :title="s.title"
        @click="emit('select', s.id)"
        @mousedown.middle="emit('close', s.id)"
        @contextmenu.prevent.stop="openMenu($event, s)"
      >
        <span class="dot" :class="dotClass(s.status)" />
        <span class="title">{{ s.title }}</span>
        <span v-if="s.closable !== false" class="close" @click.stop="emit('close', s.id)">×</span>
      </div>
      <span v-if="!sessions.length" class="session-empty muted">暂无连接</span>
    </div>
  </div>

  <!-- 右键菜单：标准项（编辑/复制/关闭）+ 各视图通过 extra-menu 注入的扩展项 -->
  <teleport to="body">
    <div
      v-if="menu.visible"
      class="session-menu glass"
      :style="{ left: menu.x + 'px', top: menu.y + 'px' }"
      @click.stop
    >
      <div class="session-menu-item" @click="doEdit">
        <el-icon><EditPen /></el-icon><span>编辑连接</span>
      </div>
      <div class="session-menu-item" @click="doCopy">
        <el-icon><CopyDocument /></el-icon><span>复制连接</span>
      </div>
      <div class="session-menu-item danger" @click="doClose">
        <el-icon><Close /></el-icon><span>关闭连接</span>
      </div>
      <template v-if="extraMenu.length">
        <div class="session-menu-sep" />
        <div
          v-for="item in extraMenu"
          :key="item.action"
          class="session-menu-item"
          :class="{ danger: item.danger }"
          @click="doExtra(item)"
        >
          <el-icon v-if="item.icon"><component :is="item.icon" /></el-icon>
          <span>{{ item.label }}</span>
        </div>
      </template>
    </div>
  </teleport>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps({
  sessions: { type: Array, default: () => [] },
  activeId: { type: String, default: null },
  extraMenu: { type: Array, default: () => [] }, // [{ label, action, icon?, danger? }]
})
const emit = defineEmits(['select', 'close', 'copy', 'edit', 'menu-action'])

const menu = ref({ visible: false, x: 0, y: 0, sid: null })

// 会话状态 → 状态点颜色：connecting 黄色、connected 绿色、error 红色、其余灰
function dotClass(status) {
  return { connected: 'success', connecting: 'warning', error: 'danger', idle: 'idle' }[status] || 'idle'
}

function openMenu(e, s) {
  // 边界钳制：防止菜单在屏幕右/下缘溢出
  const x = Math.min(e.clientX, window.innerWidth - 170)
  const y = Math.min(e.clientY, window.innerHeight - 180)
  menu.value = { visible: true, x, y, sid: s.id }
}
function closeMenu() { menu.value.visible = false }
function doEdit() { emit('edit', menu.value.sid); closeMenu() }
function doCopy() { emit('copy', menu.value.sid); closeMenu() }
function doClose() { emit('close', menu.value.sid); closeMenu() }
function doExtra(item) { emit('menu-action', { sid: menu.value.sid, action: item.action }); closeMenu() }

onMounted(() => window.addEventListener('click', closeMenu))
onBeforeUnmount(() => window.removeEventListener('click', closeMenu))
</script>

<style scoped>
.session-tabs {
  flex-shrink: 0;
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 6px 8px;
  margin-left: 28px; /* 缩进，体现"功能模块 tab 下的子 tab"层级 */
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  background: var(--glass-bg-soft);
  -webkit-backdrop-filter: var(--backdrop-blur-soft);
  backdrop-filter: var(--backdrop-blur-soft);
  overflow-x: auto;
}
.session-tabs-scroll { display: flex; gap: 6px; align-items: center; }
.session-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  font-size: 12px;
  color: var(--text-secondary);
  border: 1px solid transparent;
  border-radius: var(--radius-sm, 6px);
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
  background: transparent;
  transition: background var(--transition), color var(--transition);
}
.session-tab:hover { background: var(--accent-soft); }
.session-tab.active {
  background: var(--accent-soft);
  color: var(--accent);
  border-color: var(--accent);
}
.session-tab .title { max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
.session-tab .close {
  margin-left: 2px;
  font-size: 14px;
  line-height: 1;
  opacity: 0.6;
}
.session-tab .close:hover { opacity: 1; color: var(--danger); }
.session-empty { font-size: 12px; color: var(--text-muted); }
</style>
