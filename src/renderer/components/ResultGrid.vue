<template>
  <div class="result-grid">
    <div v-if="result?.error" class="rg-hint rg-error">{{ result.error }}</div>
    <template v-else-if="result">
      <div class="result-info muted">
        <span>{{ result.rows?.length || 0 }} 行</span>
        <span>·</span>
        <span>{{ result.durationMs }} ms</span>
        <span v-if="result.truncated">· 已截断（仅返回前 5000 行）</span>
      </div>
      <div class="result-table" v-if="result.rows?.length">
        <div class="result-row result-head">
          <div v-for="f in result.fields" :key="f.name" class="cell head">{{ f.name }}</div>
        </div>
        <div v-for="(row, i) in result.rows.slice(0, limit)" :key="i" class="result-row">
          <div v-for="f in result.fields" :key="f.name" class="cell">{{ formatValue(row[f.name]) }}</div>
        </div>
        <div v-if="result.rows.length > limit" class="muted rg-more">仅显示前 {{ limit }} 行</div>
      </div>
      <div v-else class="rg-hint">执行成功（{{ result.affectedRows ?? 0 }} 行受影响）</div>
    </template>
  </div>
</template>

<script setup>
defineProps({
  result: { type: Object, default: null },
  limit: { type: Number, default: 500 },
})

function formatValue(v) {
  if (v == null) return 'NULL'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}
</script>

<style scoped>
.result-info { display: flex; gap: 8px; margin-bottom: 8px; font-size: 12px; }
.result-table {
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  overflow: auto;
}
.result-row {
  display: flex;
  border-bottom: 1px solid var(--glass-border);
}
.result-row.result-head {
  position: sticky; top: 0;
  background: var(--glass-bg-soft);
  -webkit-backdrop-filter: var(--backdrop-blur-soft);
  backdrop-filter: var(--backdrop-blur-soft);
  font-weight: 600;
  font-size: 12px;
}
.cell {
  flex: 1;
  padding: 6px 10px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 100px;
  border-right: 1px solid var(--glass-border);
  font-size: 12px;
}
.cell.head { font-weight: 600; }
.rg-hint {
  padding: 3px 12px;
  font-size: 12px;
  color: var(--text-muted);
}
.rg-error { color: var(--danger); }
.rg-more { padding: 8px; }
</style>
