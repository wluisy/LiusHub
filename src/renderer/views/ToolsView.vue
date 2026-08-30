<template>
  <div class="tools-view">
    <div class="tools-toolbar glass-toolbar">
      <span>工具坞 — 常用快捷命令模板</span>
      <div style="flex: 1" />
      <el-button @click="addDialog = true"><el-icon><Plus /></el-icon><span>新增模板</span></el-button>
    </div>

    <div class="tools-grid">
      <div v-for="t in templates" :key="t.name" class="tool-card glass">
        <div class="row gap-8" style="margin-bottom: 6px;">
          <el-icon><component :is="iconFor(t.tag)" /></el-icon>
          <span class="title">{{ t.name }}</span>
        </div>
        <pre class="cmd mono">{{ t.command }}</pre>
        <div class="row gap-8" style="margin-top: 8px;">
          <el-tag size="small" v-if="t.tag">{{ t.tag }}</el-tag>
          <el-tag size="small" type="info" v-if="t.id">自定义</el-tag>
          <div style="flex: 1" />
          <el-button size="small" @click="copy(t)">复制</el-button>
          <el-button size="small" type="danger" v-if="t.id" @click="onDelete(t)">删除</el-button>
        </div>
      </div>
    </div>

    <el-dialog v-model="addDialog" title="新增模板" width="480px">
      <el-form :model="newTpl" label-width="80px">
        <el-form-item label="名称"><el-input v-model="newTpl.name" /></el-form-item>
        <el-form-item label="命令"><el-input v-model="newTpl.command" type="textarea" :rows="3" /></el-form-item>
        <el-form-item label="分类"><el-input v-model="newTpl.tag" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="addDialog=false">取消</el-button>
        <el-button type="primary" @click="onSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

const templates = ref([])
const addDialog = ref(false)
const newTpl = ref({ name: '', command: '', tag: '' })

onMounted(async () => {
  templates.value = await window.liushub.tool.listTemplates()
})

function iconFor(tag) {
  return { system: 'Cpu', network: 'Connection', docker: 'Box', db: 'DataAnalysis' }[tag] || 'Tools'
}

async function copy(t) {
  try {
    await navigator.clipboard.writeText(t.command)
    ElMessage.success('已复制到剪贴板')
  } catch {
    ElMessage.warning('复制失败')
  }
}

async function onSave() {
  if (!newTpl.value.name || !newTpl.value.command) {
    ElMessage.warning('请填写名称和命令')
    return
  }
  templates.value = await window.liushub.tool.saveTemplate({ ...newTpl.value })
  addDialog.value = false
  newTpl.value = { name: '', command: '', tag: '' }
  ElMessage.success('已保存')
}

async function onDelete(t) {
  try {
    await ElMessageBox.confirm(`确认删除模板「${t.name}」？`, '提示', { type: 'warning' })
    templates.value = await window.liushub.tool.deleteTemplate(t.id)
    ElMessage.success('已删除')
  } catch {/* cancel */}
}
</script>

<style scoped>
.tools-view { display: flex; flex-direction: column; gap: 12px; height: 100%; }
.tools-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
  overflow-y: auto;
}
.tool-card { padding: 14px; }
.tool-card .title { font-weight: 600; }
.cmd {
  background: var(--glass-bg-soft);
  -webkit-backdrop-filter: var(--backdrop-blur-soft);
  backdrop-filter: var(--backdrop-blur-soft);
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 12px;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--text-secondary);
  max-height: 120px;
  overflow: auto;
}
</style>
