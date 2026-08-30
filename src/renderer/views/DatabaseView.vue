<template>
  <div class="db-view">
    <!-- 子 tab：所有数据库会话 -->
    <SessionTabs
      :sessions="sessions"
      :active-id="activeId"
      :extra-menu="tabExtraMenu"
      @select="activate"
      @close="closeSession"
      @copy="copySession"
      @edit="editSession"
      @menu-action="onTabMenuAction"
    />

    <div class="db-toolbar glass-toolbar">
      <el-select v-model="selectedAssetId" placeholder="选择数据库资产" style="width: 240px;" @change="onAssetSelect">
        <el-option v-for="a in assets" :key="a.id" :value="a.id" :label="a.name" />
      </el-select>
      <el-button @click="manualForm = true" plain>手动新建</el-button>
      <span v-if="activeSession?.connected" class="muted row gap-8"><span class="dot success" />已连接 {{ activeSession.connInfo }}</span>
      <div style="flex: 1" />
      <el-button :disabled="!activeSession?.connected" @click="loadSchema(activeSession)">
        <el-icon><Refresh /></el-icon><span>刷新</span>
      </el-button>
      <el-button :disabled="!activeSession?.connected" @click="exportTable">
        <el-icon><Download /></el-icon><span>导出</span>
      </el-button>
      <el-button :disabled="!activeSession?.connected" type="danger" plain @click="disconnect">
        <span>断开</span>
      </el-button>
    </div>

    <template v-if="activeSession">
      <div class="db-grid">
        <!-- 左侧：Navicat 式树形数据库/表 -->
        <div class="db-side glass">
          <div class="pane-header">数据库 / 表</div>
          <el-input v-model="activeSession.treeKeyword" placeholder="过滤..." size="small" clearable />
          <div class="db-tree">
            <div v-for="db in activeSession.databases" :key="db.name" class="db-node">
              <div
                class="db-name"
                @click="toggleDb(db)"
                @contextmenu.prevent.stop="openDbContextMenu($event, db)"
              >
                <el-icon><Folder v-if="!db.open" /><FolderOpened v-else /></el-icon>
                <span class="db-label">{{ db.name }}</span>
              </div>

              <div v-if="db.open" class="db-children">
                <!-- 表 -->
                <div class="db-cat">
                  <div class="db-cat-name" @click="toggleCat(db, 'tables')">
                    <el-icon><Coin /></el-icon><span>表</span>
                    <span v-if="db.loaded" class="db-count">{{ db.tables.length }}</span>
                  </div>
                  <div v-if="db.cats.tables" class="db-cat-children">
                    <div v-if="db.loading" class="db-hint"><el-icon class="is-loading"><Loading /></el-icon><span>加载中…</span></div>
                    <template v-else>
                      <div v-if="db.note" class="db-hint">{{ db.note }}</div>
                      <div v-for="t in filterTables(db)" :key="t.name" class="db-table-node">
                        <div
                          class="db-table"
                          @click="toggleTable(db, t)"
                          @dblclick="openTable(db, t)"
                          @contextmenu.prevent.stop="openTableContextMenu($event, db, t)"
                        >
                          <el-icon style="color: var(--accent);"><Document /></el-icon><span class="db-label">{{ t.name }}</span>
                        </div>
                        <!-- 表详情：字段 / 索引 / 外键 / 检查 / 触发器（Navicat 式文件树，分类可展开/收起） -->
                        <div v-if="t.open" class="db-table-detail" @click.stop>
                          <div v-if="t.detailLoading" class="db-hint"><el-icon class="is-loading"><Loading /></el-icon><span>加载中…</span></div>
                          <template v-else>
                            <div v-for="cat in DETAIL_CATS" :key="cat.key" class="db-sub">
                              <div class="db-sub-name" @click="toggleDetailCat(t, cat.key)">
                                <el-icon class="caret"><CaretRight v-if="!t.detailCats[cat.key]" /><CaretBottom v-else /></el-icon>
                                <el-icon class="cat-icon" :style="{ color: cat.color }"><component :is="cat.icon" /></el-icon>
                                <span>{{ cat.label }}</span>
                                <span class="db-count">{{ (t.detail?.[cat.key] || []).length }}</span>
                              </div>
                              <template v-if="t.detailCats[cat.key]">
                                <div v-for="(it, i) in (t.detail?.[cat.key] || [])" :key="i" class="db-leaf" :title="cat.title(it)">
                                  <span class="db-label">{{ cat.text(it) }}</span>
                                  <span class="db-leaf-type">{{ cat.sub(it) }}</span>
                                </div>
                                <div v-if="!(t.detail?.[cat.key]?.length)" class="db-hint">无{{ cat.label }}</div>
                              </template>
                            </div>
                          </template>
                        </div>
                      </div>
                      <div v-if="!db.note && !db.tables.length" class="db-hint">暂无表</div>
                    </template>
                  </div>
                </div>

                <!-- 视图 -->
                <div class="db-cat">
                  <div class="db-cat-name" @click="toggleCat(db, 'views')">
                    <el-icon><View /></el-icon><span>视图</span>
                    <span v-if="db.loaded" class="db-count">{{ db.views.length }}</span>
                  </div>
                  <div v-if="db.cats.views" class="db-cat-children">
                    <div v-if="db.loading" class="db-hint"><el-icon class="is-loading"><Loading /></el-icon><span>加载中…</span></div>
                    <template v-else>
                      <div v-if="db.note" class="db-hint">{{ db.note }}</div>
                      <div
                        v-for="v in db.views"
                        :key="v"
                        class="db-table"
                        @dblclick="openTable(db, { name: v })"
                        @contextmenu.prevent.stop="openViewContextMenu($event, db, v)"
                      >
                        <el-icon><View /></el-icon><span class="db-label">{{ v }}</span>
                      </div>
                      <div v-if="!db.note && !db.views.length" class="db-hint">暂无视图</div>
                    </template>
                  </div>
                </div>

                <!-- 函数 -->
                <div class="db-cat">
                  <div class="db-cat-name" @click="toggleCat(db, 'functions')">
                    <el-icon><Operation /></el-icon><span>函数</span>
                    <span v-if="db.loaded" class="db-count">{{ db.functions.length }}</span>
                  </div>
                  <div v-if="db.cats.functions" class="db-cat-children">
                    <div v-if="db.loading" class="db-hint"><el-icon class="is-loading"><Loading /></el-icon><span>加载中…</span></div>
                    <template v-else>
                      <div v-if="db.note" class="db-hint">{{ db.note }}</div>
                      <div v-for="f in db.functions" :key="f" class="db-table">
                        <el-icon><Operation /></el-icon><span class="db-label">{{ f }}</span>
                      </div>
                      <div v-if="!db.note && !db.functions.length" class="db-hint">暂无函数</div>
                    </template>
                  </div>
                </div>

                <!-- 查询（保存的查询项目） -->
                <div class="db-cat">
                  <div class="db-cat-name" @click="toggleCat(db, 'queries')">
                    <el-icon><Search /></el-icon><span>查询</span>
                    <span v-if="db.loaded" class="db-count">{{ (db.queries || []).length }}</span>
                  </div>
                  <div v-if="db.cats.queries" class="db-cat-children">
                    <div v-for="sq in db.queries || []" :key="sq.id" class="db-table" @dblclick="openSavedQuery(db, sq)">
                      <el-icon><Document /></el-icon><span class="db-label" :title="sq.sql">{{ sq.name }}</span>
                      <span class="db-saved-del" title="删除保存的查询" @click.stop="deleteSavedQuery(db, sq)">×</span>
                    </div>
                    <div v-if="!(db.queries && db.queries.length)" class="db-hint">暂无已保存查询</div>
                  </div>
                </div>
              </div>
            </div>
            <div v-if="!activeSession.databases.length" class="muted" style="padding: 20px; text-align: center;">尚未连接</div>
          </div>
        </div>

        <!-- 中间：SQL 编辑器（查询 tab 页，新建查询在此新增 tab 替换当前编辑器） -->
        <div class="db-center glass">
          <div class="pane-header">
            <span>SQL 编辑器</span>
            <div style="flex: 1" />
            <el-button size="small" type="primary" :disabled="!activeSession.connected" @click="runQuery">执行 (Ctrl+Enter)</el-button>
          </div>
          <!-- 查询 tab 栏 -->
          <div class="query-tabs">
            <div
              v-for="q in activeSession.queries"
              :key="q.id"
              class="query-tab"
              :class="{ active: q.id === activeSession.activeQueryId }"
              :title="q.title"
              @click="activeSession.activeQueryId = q.id"
            >
              <input
                v-if="editingQuery === q.id"
                :ref="setRenameRef"
                v-model="editTitle"
                class="q-rename"
                spellcheck="false"
                @click.stop
                @keydown.enter.prevent="saveRename(q)"
                @keydown.esc.stop="cancelRename"
                @blur="saveRename(q)"
              />
              <template v-else>
                <span class="q-title" :title="`双击重命名: ${q.title}`" @dblclick="startRename(q)">{{ q.title }}</span>
                <span v-if="activeSession.queries.length > 1" class="q-close" @click.stop="closeQuery(activeSession, q.id)">×</span>
              </template>
            </div>
            <div class="query-tab-add" title="新建查询" @click="newQuery()">＋</div>
          </div>
          <textarea
            ref="sqlEditorEl"
            :value="activeQ?.sql || ''"
            class="sql-editor mono"
            spellcheck="false"
            placeholder="SELECT * FROM ..."
            @input="onSqlInput($event.target.value)"
            @keydown.ctrl.enter.prevent="runQuery"
          />
          <!-- 结果框：仅在有执行结果时出现，可关闭 -->
          <div v-if="activeQ?.result" class="db-result">
            <div class="result-bar">
              <span class="muted">执行结果</span>
              <div style="flex: 1" />
              <span class="result-close" title="关闭结果" @click="closeResult">×</span>
            </div>
            <div class="db-result-body">
              <ResultGrid :result="activeQ?.result" />
            </div>
          </div>
        </div>
      </div>
    </template>
    <div v-else class="db-empty glass">
      <el-icon :size="48" color="var(--text-muted)"><DataAnalysis /></el-icon>
      <p class="muted" style="margin-top: 12px;">选择资产或手动新建数据库连接</p>
    </div>

    <!-- 手动连接 / 编辑连接对话框 -->
    <el-dialog v-model="manualForm" :title="editingId ? '编辑数据库连接' : '新建数据库连接'" width="520px">
      <el-form :model="form" label-width="80px">
        <el-form-item label="类型">
          <el-select v-model="form.type" @change="onTypeChange">
            <el-option v-for="t in dbTypes" :key="t" :value="t" :label="t" />
          </el-select>
        </el-form-item>
        <el-form-item label="主机" v-if="form.type!=='sqlite'"><el-input v-model="form.host" /></el-form-item>
        <el-form-item label="端口" v-if="form.type!=='sqlite'"><el-input-number v-model="form.port" :min="1" :max="65535" /></el-form-item>
        <el-form-item v-if="form.type==='sqlite'" label="DB 文件路径">
          <el-input v-model="form.database" placeholder="C:\\path\\to\\test.db" />
        </el-form-item>
        <el-form-item label="用户名" v-if="form.type!=='sqlite'"><el-input v-model="form.username" /></el-form-item>
        <el-form-item label="密码" v-if="form.type!=='sqlite'"><el-input v-model="form.password" type="password" show-password /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="manualForm=false">取消</el-button>
        <el-button type="primary" @click="onManualConnect">连接</el-button>
      </template>
    </el-dialog>

    <!-- 命令列界面（SQL 控制台） -->
    <el-dialog v-model="cmdDialog.visible" title="命令列界面" width="720px" top="8vh">
      <div class="cmd-console">
        <el-input v-model="cmdDialog.sql" type="textarea" :rows="4" placeholder="输入 SQL 命令，如：SHOW TABLES; / SELECT * FROM xxx;  Ctrl+Enter 执行" spellcheck="false" @keydown.ctrl.enter.prevent="runConsole" />
        <div class="cmd-actions">
          <el-button type="primary" size="small" :loading="cmdDialog.loading" @click="runConsole">执行 (Ctrl+Enter)</el-button>
          <el-button size="small" @click="cmdDialog.sql = ''">清空</el-button>
          <span v-if="cmdDialog.info" class="muted">{{ cmdDialog.info }}</span>
        </div>
        <div class="cmd-result" v-if="cmdDialog.result">
          <ResultGrid :result="cmdDialog.result" :limit="200" />
        </div>
      </div>
    </el-dialog>

    <!-- 数据字典 -->
    <el-dialog v-model="dictDialog.visible" title="数据字典" width="780px" top="5vh">
      <div class="dict-toolbar">
        <span class="muted">{{ dictDialog.loading ? '正在生成…' : (dictDialog.tables?.length || 0) + ' 张表' }}</span>
        <div style="flex: 1" />
        <el-button size="small" :loading="dictDialog.loading" @click="loadDataDict">刷新</el-button>
        <el-button size="small" type="primary" :disabled="!dictDialog.markdown" @click="exportDataDict">导出 Markdown</el-button>
      </div>
      <pre class="dict-preview mono">{{ dictDialog.markdown || (dictDialog.loading ? '正在生成数据字典…' : '') }}</pre>
    </el-dialog>

    <!-- 在数据库中查找 -->
    <el-dialog v-model="searchDialog.visible" title="在数据库中查找" width="760px" top="8vh">
      <div class="search-row">
        <el-input v-model="searchDialog.keyword" placeholder="输入要查找的文本，回车开始" clearable @keydown.enter="runSearch" />
        <el-button type="primary" :loading="searchDialog.loading" @click="runSearch">查找</el-button>
      </div>
      <div v-if="searchDialog.note" class="db-hint">{{ searchDialog.note }}</div>
      <div v-if="searchDialog.loading" class="db-hint"><el-icon class="is-loading"><Loading /></el-icon><span>正在搜索…</span></div>
      <template v-else-if="searchDialog.tables?.length">
        <div v-for="g in searchDialog.tables" :key="g.table" class="search-group">
          <div class="search-group-name">{{ g.table }} <span class="db-count">{{ g.rows.length }} 条</span></div>
          <div class="search-group-rows">
            <div v-for="(row, i) in g.rows.slice(0, 10)" :key="i" class="search-row-cell mono" :title="rowText(row)">{{ rowText(row) }}</div>
          </div>
        </div>
      </template>
      <div v-else-if="searchDialog.done" class="db-hint">未找到匹配内容</div>
    </el-dialog>

    <!-- 逆向数据库到模型（ER 图） -->
    <el-dialog v-model="erDialog.visible" title="逆向数据库到模型 (ER 图)" width="860px" top="4vh">
      <div class="dict-toolbar">
        <span class="muted">{{ erDialog.tables?.length || 0 }} 张表</span>
        <div style="flex: 1" />
        <el-button size="small" :loading="erDialog.loading" @click="loadErModel">重新生成</el-button>
        <el-button size="small" type="primary" :disabled="!erDialog.mermaid" @click="exportErModel">导出 Mermaid (.mmd)</el-button>
      </div>
      <div class="er-canvas">
        <div v-for="t in erDialog.tables || []" :key="t.name" class="er-table">
          <div class="er-table-name">{{ t.name }}</div>
          <div v-for="c in t.columns || []" :key="c.name" class="er-col" :class="{ pk: c.key === 'PRI' || c.pk, fk: isFkCol(t, c) }">
            <span v-if="c.key === 'PRI' || c.pk" class="er-col-key">PK</span>
            <span class="er-col-name">{{ c.name }}</span>
            <span class="er-col-type">{{ c.type }}</span>
          </div>
        </div>
      </div>
      <div v-if="erFks.length" class="er-fk-list">
        <div class="er-fk-title">外键关系</div>
        <div v-for="fk in erFks" :key="fk.name" class="er-fk mono">{{ fk.from }} → {{ fk.to }}</div>
      </div>
    </el-dialog>

    <!-- 共享连接 -->
    <el-dialog v-model="shareDialog.visible" title="共享连接" width="540px">
      <p class="muted" style="margin-bottom: 8px;">以下为脱敏后的连接信息（不含密码），可复制给他人，对方可通过「手动新建」使用。</p>
      <el-input v-model="shareDialog.text" type="textarea" :rows="7" readonly class="mono" />
      <template #footer>
        <el-button @click="shareDialog.visible = false">关闭</el-button>
        <el-button type="primary" @click="copyShare">复制</el-button>
      </template>
    </el-dialog>

    <!-- 新建表 / 设计表 -->
    <el-dialog v-model="tableEditor.visible" :title="tableEditor.isNew ? '新建表' : '设计表'" width="860px" top="6vh">
      <div class="te-bar">
        <span class="muted">表名</span>
        <el-input v-model="tableEditor.tableName" :disabled="!tableEditor.isNew" style="width: 280px;" spellcheck="false" />
        <div style="flex: 1" />
        <span class="muted">{{ tableEditor.isNew ? '创建新表' : '修改表结构（保存时自动生成并执行 ALTER SQL）' }}</span>
      </div>
      <div class="te-grid">
        <div class="te-head">
          <span class="te-cell te-name">字段名</span>
          <span class="te-cell te-type">类型</span>
          <span class="te-cell te-len">长度</span>
          <span class="te-cell te-null">允许空</span>
          <span class="te-cell te-key">主键</span>
          <span class="te-cell te-def">默认值</span>
          <span class="te-cell te-comment">说明</span>
          <span class="te-cell te-op">操作</span>
        </div>
        <div v-for="(col, i) in tableEditor.columns" :key="i" class="te-row">
          <span class="te-cell te-name"><el-input v-model="col.name" size="small" spellcheck="false" /></span>
          <span class="te-cell te-type">
            <el-select v-model="col.type" size="small" filterable allow-create default-first-option>
              <el-option v-for="ty in tableTypes" :key="ty" :value="ty" :label="ty" />
            </el-select>
          </span>
          <span class="te-cell te-len"><el-input-number v-model="col.length" size="small" :min="0" :max="65535" :controls="false" /></span>
          <span class="te-cell te-null"><el-checkbox v-model="col.nullable" /></span>
          <span class="te-cell te-key"><el-checkbox v-model="col.pk" /></span>
          <span class="te-cell te-def"><el-input v-model="col.default" size="small" spellcheck="false" /></span>
          <span class="te-cell te-comment"><el-input v-model="col.comment" size="small" spellcheck="false" /></span>
          <span class="te-cell te-op"><el-button link type="danger" size="small" @click="removeTableColumn(i)">删除</el-button></span>
        </div>
        <div class="te-add"><el-button size="small" plain @click="addTableColumn">＋ 添加字段</el-button></div>
      </div>
      <template #footer>
        <el-button @click="tableEditor.visible = false">取消</el-button>
        <el-button type="primary" :loading="tableEditor.loading" @click="saveTableEditor">{{ tableEditor.isNew ? '创建' : '保存' }}</el-button>
      </template>
    </el-dialog>

    <!-- 新建视图 / 设计视图 -->
    <el-dialog v-model="viewEditor.visible" :title="viewEditor.isNew ? '新建视图' : '设计视图'" width="720px" top="8vh">
      <div class="te-bar">
        <span class="muted">视图名</span>
        <el-input v-model="viewEditor.viewName" :disabled="!viewEditor.isNew" style="width: 280px;" spellcheck="false" />
      </div>
      <div class="muted" style="margin: 10px 0 4px;">SELECT 语句 / CREATE VIEW 语句</div>
      <el-input v-model="viewEditor.sql" type="textarea" :rows="10" class="mono" spellcheck="false" placeholder="SELECT * FROM ..." />
      <template #footer>
        <el-button @click="viewEditor.visible = false">取消</el-button>
        <el-button type="primary" :loading="viewEditor.loading" @click="saveViewEditor">保存</el-button>
      </template>
    </el-dialog>
  </div>

  <!-- 数据库节点右键菜单 -->
  <teleport to="body">
    <div
      v-if="dbMenu.visible"
      class="session-menu glass"
      :style="{ left: dbMenu.x + 'px', top: dbMenu.y + 'px' }"
      @click.stop
    >
      <div class="session-menu-item" @click="dbMenuItem('editDb')"><el-icon><EditPen /></el-icon><span>编辑数据库</span></div>
      <div class="session-menu-item" @click="dbMenuItem('newDb')"><el-icon><Plus /></el-icon><span>新建数据库</span></div>
      <div class="session-menu-item danger" @click="dbMenuItem('dropDb')"><el-icon><Delete /></el-icon><span>删除数据库</span></div>
      <div class="session-menu-sep" />
      <div class="session-menu-item" @click="dbMenuItem('newQuery')"><el-icon><EditPen /></el-icon><span>新建查询</span></div>
      <div class="session-menu-item" @click="dbMenuItem('cmdline')"><el-icon><Monitor /></el-icon><span>命令列界面</span></div>
      <div class="session-menu-item" @click="dbMenuItem('runSqlFile')"><el-icon><FolderOpened /></el-icon><span>运行 SQL 文件</span></div>
      <div class="session-menu-sep" />
      <div class="session-menu-item" @click="dbMenuItem('dataDict')"><el-icon><Document /></el-icon><span>数据字典</span></div>
      <div class="session-menu-item" @click="dbMenuItem('reverseModel')"><el-icon><Share /></el-icon><span>逆向数据库到模型..</span></div>
      <div class="session-menu-item" @click="dbMenuItem('searchInDb')"><el-icon><Search /></el-icon><span>在数据库中查找</span></div>
      <div class="session-menu-item" @click="dbMenuItem('share')"><el-icon><Share /></el-icon><span>共享</span></div>
      <div class="session-menu-sep" />
      <div class="session-menu-item" @click="dbMenuItem('refresh')"><el-icon><Refresh /></el-icon><span>刷新</span></div>
    </div>
  </teleport>

  <!-- 数据表右键菜单 -->
  <teleport to="body">
    <div
      v-if="tableMenu.visible"
      class="session-menu glass"
      :style="{ left: tableMenu.x + 'px', top: tableMenu.y + 'px' }"
      @click.stop
    >
      <div class="session-menu-item" @click="tableMenuItem('open')"><el-icon><View /></el-icon><span>打开表</span></div>
      <div class="session-menu-item" @click="tableMenuItem('design')"><el-icon><EditPen /></el-icon><span>设计表</span></div>
      <div class="session-menu-sep" />
      <div class="session-menu-item" @click="tableMenuItem('new')"><el-icon><Plus /></el-icon><span>新建表</span></div>
      <div class="session-menu-item" @click="tableMenuItem('copy')"><el-icon><CopyDocument /></el-icon><span>复制表</span></div>
      <div class="session-menu-item" @click="tableMenuItem('rename')"><el-icon><Edit /></el-icon><span>重命名表</span></div>
      <div class="session-menu-item danger" @click="tableMenuItem('truncate')"><el-icon><Delete /></el-icon><span>清空表</span></div>
      <div class="session-menu-item danger" @click="tableMenuItem('drop')"><el-icon><Delete /></el-icon><span>删除表</span></div>
      <div class="session-menu-sep" />
      <div class="session-menu-item" @click="tableMenuItem('refresh')"><el-icon><Refresh /></el-icon><span>刷新</span></div>
    </div>
  </teleport>

  <!-- 视图右键菜单 -->
  <teleport to="body">
    <div
      v-if="viewMenu.visible"
      class="session-menu glass"
      :style="{ left: viewMenu.x + 'px', top: viewMenu.y + 'px' }"
      @click.stop
    >
      <div class="session-menu-item" @click="viewMenuItem('open')"><el-icon><View /></el-icon><span>打开视图</span></div>
      <div class="session-menu-item" @click="viewMenuItem('design')"><el-icon><EditPen /></el-icon><span>设计视图</span></div>
      <div class="session-menu-sep" />
      <div class="session-menu-item" @click="viewMenuItem('new')"><el-icon><Plus /></el-icon><span>新建视图</span></div>
      <div class="session-menu-item" @click="viewMenuItem('rename')"><el-icon><Edit /></el-icon><span>重命名视图</span></div>
      <div class="session-menu-item danger" @click="viewMenuItem('drop')"><el-icon><Delete /></el-icon><span>删除视图</span></div>
      <div class="session-menu-sep" />
      <div class="session-menu-item" @click="viewMenuItem('refresh')"><el-icon><Refresh /></el-icon><span>刷新</span></div>
    </div>
  </teleport>
</template>

<script setup>
import { ref, computed, nextTick, onActivated, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAssetsStore } from '../stores/assets'
import { useConnectionSessions } from '../composables/useConnectionSessions'
import SessionTabs from '../components/SessionTabs.vue'
import ResultGrid from '../components/ResultGrid.vue'

const store = useAssetsStore()
const {
  sessions, activeId, activeSession, activate, setStatus, rename,
  sessionMap, connectWith, reconnectSession, closeSession, copySession,
} = useConnectionSessions({
  connect: (cfg) => window.liushub.db.connect(cfg),
  disconnect: (id) => window.liushub.db.disconnect(id),
  getBackendId: (s) => s.dbId,
  setBackendId: (s, id) => { s.dbId = id },
  state: (cfg) => {
    const initQuery = makeQuery('SELECT 1 AS hello, NOW() AS now;')
    return {
      dbId: null,
      dbType: cfg.type || 'mysql',
      connName: cfg.name || cfg.host || cfg.database || cfg.type || '',
      currentDb: cfg.database || '',
      databases: [],
      currentTable: null,
      treeKeyword: '',
      queries: [initQuery],
      activeQueryId: initQuery.id,
    }
  },
  titleOf: (cfg) => `${cfg.type || 'mysql'} · ${cfg.host || cfg.database || ''}`,
  onConnected: async (s, _r, cfg) => {
    s.connInfo = `${cfg.type || 'mysql'} · ${cfg.host || cfg.database || ''}:${cfg.port || ''}`
    ElMessage.success('已连接')
    await loadSchema(s)
  },
  onReconnected: async (s, cfg) => {
    s.dbType = cfg.type || 'mysql'
    s.connName = cfg.name || cfg.host || cfg.database || cfg.type || ''
    s.currentDb = cfg.database || ''
    s.connInfo = `${cfg.type || 'mysql'} · ${cfg.host || cfg.database || ''}:${cfg.port || ''}`
    rename(s.id, `${cfg.type || 'mysql'} · ${cfg.host || cfg.database || ''}`)
    ElMessage.success('已重新连接')
    await loadSchema(s)
  },
})

const assets = ref([])
const selectedAssetId = ref(null)
const manualForm = ref(false)
const editingId = ref(null)   // 正在编辑连接配置的会话 id（编辑后原地重连）
const sqlEditorEl = ref(null)

const dbTypes = ['mysql', 'postgres', 'sqlite', 'clickhouse', 'redis']
const form = ref(emptyForm())

// 命令列界面（SQL 控制台）
const cmdDialog = ref({ visible: false, sql: '', result: null, loading: false, info: '' })
// 数据字典
const dictDialog = ref({ visible: false, tables: [], markdown: '', loading: false })
// 在数据库中查找
const searchDialog = ref({ visible: false, keyword: '', tables: [], loading: false, done: false, note: '' })
// 逆向数据库到模型（ER 图）
const erDialog = ref({ visible: false, tables: [], mermaid: '', loading: false })
// 共享连接
const shareDialog = ref({ visible: false, text: '' })

/** ER 图外键列表（从当前 meta 中提取） */
const erFks = computed(() => {
  const list = []
  for (const t of erDialog.value.tables || []) {
    for (const fk of t.foreignKeys || []) {
      list.push({ name: fk.name || 'fk', from: `${t.name}.${fk.column}`, to: `${fk.refTable}.${fk.refColumn}` })
    }
  }
  return list
})
function isFkCol(t, c) {
  return (t.foreignKeys || []).some((fk) => fk.column === c.name)
}

// 查询 tab 重命名状态
const editingQuery = ref(null) // 正在重命名的查询 id
const editTitle = ref('')      // 重命名输入框内容
const renameEl = ref(null)
function setRenameRef(el) { renameEl.value = el }
function startRename(q) {
  editingQuery.value = q.id
  editTitle.value = q.title
  nextTick(() => renameEl.value?.focus())
}
function saveRename(q) {
  if (editingQuery.value !== q.id) return
  const v = editTitle.value.trim()
  if (v) q.title = v
  editingQuery.value = null
}
function cancelRename() {
  editingQuery.value = null
}

// 数据库节点右键菜单
const dbMenu = ref({ visible: false, x: 0, y: 0, db: null })
// 数据表 / 视图右键菜单
const tableMenu = ref({ visible: false, x: 0, y: 0, db: null, table: null })
const viewMenu = ref({ visible: false, x: 0, y: 0, db: null, view: null })
// 新建表 / 设计表 对话框
const tableEditor = ref({ visible: false, isNew: true, tableName: '', columns: [], original: [], db: null, loading: false })
// 新建视图 / 设计视图 对话框
const viewEditor = ref({ visible: false, isNew: true, viewName: '', sql: '', db: null, loading: false })

/** 各数据库类型的常用字段类型（可自选输入） */
const tableTypes = computed(() => {
  const t = activeSession.value?.dbType || 'mysql'
  if (t === 'postgres') {
    return ['integer', 'bigint', 'smallint', 'numeric', 'real', 'double precision', 'character varying', 'character', 'text', 'boolean', 'date', 'timestamp', 'time', 'uuid', 'jsonb', 'bytea']
  }
  if (t === 'sqlite') return ['INTEGER', 'TEXT', 'REAL', 'BLOB', 'NUMERIC']
  if (t === 'clickhouse') return ['UInt8', 'UInt32', 'Int32', 'Int64', 'Float64', 'String', 'DateTime', 'Date', 'Array(String)']
  return ['int', 'bigint', 'smallint', 'tinyint', 'varchar', 'char', 'text', 'mediumtext', 'longtext', 'decimal', 'float', 'double', 'boolean', 'date', 'datetime', 'timestamp', 'time', 'json', 'blob']
})

// 连接 tab 右键菜单的扩展项（由 SessionTabs 渲染在标准项之后）
const tabExtraMenu = [
  { label: '新建连接', action: 'newConnection', icon: 'Connection' },
  { label: '新建查询', action: 'newQuery', icon: 'EditPen' },
  { label: '新建数据库', action: 'newDb', icon: 'Plus' },
  { label: '命令列界面', action: 'cmdline', icon: 'Monitor' },
  { label: '运行 SQL 文件', action: 'runSqlFile', icon: 'FolderOpened' },
  { label: '添加星标', action: 'star', icon: 'Star' },
  { label: '刷新', action: 'refresh', icon: 'Refresh' },
  { label: '删除连接', action: 'deleteConnection', icon: 'Delete', danger: true },
]

/* ------------------------- 查询 tab 页（SQL 编辑器区） ------------------------- */

let queryUid = 0
/** 新建一个查询 tab 对象 */
function makeQuery(sql = '', title = null) {
  queryUid += 1
  return { id: `q_${queryUid}`, title: title || `查询 ${queryUid}`, sql, result: null }
}

/** 当前会话的激活查询 tab */
function activeQuery(s) {
  if (!s || !s.queries || !s.queries.length) return null
  return s.queries.find((q) => q.id === s.activeQueryId) || s.queries[0]
}

/** 当前激活会话的激活查询（供模板绑定编辑器/结果区） */
const activeQ = computed(() => activeQuery(activeSession.value))

/** 编辑器输入：写入当前查询 tab 的 sql */
function onSqlInput(v) {
  const q = activeQ.value
  if (q) q.sql = v
}

/** 查询编号：取当前未使用的第一个编号（查询1/2/3…，关闭后可复用，不跳号） */
function nextQueryNumber(s) {
  const used = new Set()
  ;(s.queries || []).forEach((q) => {
    const m = /^查询\s*(\d+)$/.exec(String(q.title || ''))
    if (m) used.add(Number(m[1]))
  })
  let n = 1
  while (used.has(n)) n += 1
  return n
}

/** 「新建查询」菜单命名：连接名·数据库名 */
function menuQueryTitle(s) {
  const conn = String(s.connName || s.title || '').replace(/^★\s*/, '')
  const db = s.currentDb || ''
  return db ? `${conn} · ${db}` : conn
}

/** 新建查询：在 SQL 编辑器区新增一个 tab 并激活。
 *  默认标题为「查询 N」（未保存的新查询），dbName 记录其归属数据库（用于保存定位） */
function newQuery(s, sql = '', title = null, dbName = null) {
  s = s || activeSession.value
  if (!s) return null
  if (!s.queries) s.queries = []
  if (!title) title = `查询 ${nextQueryNumber(s)}`
  const q = makeQuery(sql, title)
  q.db = dbName || s.currentDb || ''
  s.queries.push(q)
  s.activeQueryId = q.id
  nextTick(() => sqlEditorEl.value?.focus())
  return q
}

/** 保存查询到其归属数据库的「查询」分类下（已保存的则更新） */
function saveQuery(q) {
  const s = activeSession.value
  if (!s) return false
  const dbName = q.db || s.currentDb
  const db = (s.databases || []).find((d) => d.name === dbName)
  if (!db) { ElMessage.warning('请先展开并选中目标数据库'); return false }
  if (!db.queries) db.queries = []
  if (q.savedId) {
    const ex = db.queries.find((x) => x.id === q.savedId)
    if (ex) { ex.sql = q.sql; ex.name = q.title }
    return true
  }
  const sq = { id: `sq_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, name: q.title, sql: q.sql }
  db.queries.push(sq)
  q.savedId = sq.id
  return true
}

/** 关闭查询 tab（至少保留一个）。未保存的查询先询问是否保存 */
function closeQuery(s, qid) {
  if (!s || !s.queries || s.queries.length <= 1) return
  const q = s.queries.find((x) => x.id === qid)
  if (!q) return
  if (q.savedId) return doCloseQuery(s, qid) // 已保存的查询直接关闭
  ElMessageBox.confirm(`是否保存查询「${q.title}」？`, '关闭查询', {
    confirmButtonText: '保存并关闭',
    cancelButtonText: '直接关闭',
    distinguishCancelAndClose: true,
    type: 'warning',
  })
    .then(() => {
      if (saveQuery(q)) ElMessage.success('已保存查询')
      doCloseQuery(s, qid)
    })
    .catch((action) => {
      if (action === 'cancel') doCloseQuery(s, qid) // 「直接关闭」
      // action === 'close'（点右上角 X / Esc）→ 取消关闭，保留 tab
    })
}

function doCloseQuery(s, qid) {
  const i = s.queries.findIndex((q) => q.id === qid)
  if (i < 0) return
  s.queries.splice(i, 1)
  if (s.activeQueryId === qid) {
    s.activeQueryId = s.queries.length
      ? s.queries[Math.min(i, s.queries.length - 1)].id
      : null
  }
}

/** 双击树中保存的查询：以该名称/内容打开一个查询 tab（视为已保存） */
function openSavedQuery(db, sq) {
  const s = activeSession.value
  if (!s) return
  const q = newQuery(s, sq.sql, sq.name, db.name)
  q.savedId = sq.id
}

/** 删除树中保存的查询项目 */
async function deleteSavedQuery(db, sq) {
  try {
    await ElMessageBox.confirm(`确认删除保存的查询「${sq.name}」？`, '删除查询', {
      type: 'warning',
      confirmButtonText: '删除',
      confirmButtonClass: 'el-button--danger',
    })
  } catch { return }
  db.queries = (db.queries || []).filter((x) => x.id !== sq.id)
  ElMessage.success('已删除保存的查询')
}

/** 展开/收起表详情的分类子节点（字段/索引/外键/检查/触发器） */
function toggleDetailCat(t, cat) {
  if (t && t.detailCats) t.detailCats[cat] = !t.detailCats[cat]
}

/** 表详情分类配置（Navicat 式文件树） */
const DETAIL_CATS = [
  { key: 'columns', label: '字段', icon: 'Grid', color: '#e6a23c',
    text: (c) => c.name, sub: (c) => c.type || '', title: (c) => `${c.name} ${c.type || ''}` },
  { key: 'indexes', label: '索引', icon: 'Sort', color: '#4f9cf5',
    text: (x) => x.name, sub: (x) => [x.unique ? 'UNIQUE' : '', x.column || '', x.def || ''].filter(Boolean).join(' · '),
    title: (x) => x.def || x.name },
  { key: 'foreignKeys', label: '外键', icon: 'Link', color: '#4f9cf5',
    text: (x) => x.name, sub: (x) => `${x.column} → ${x.refTable}.${x.refColumn}`,
    title: (x) => `${x.column} → ${x.refTable}.${x.refColumn}` },
  { key: 'checks', label: '检查', icon: 'CircleCheck', color: '#4f9cf5',
    text: (x) => x.name, sub: (x) => x.def || '', title: (x) => x.def || x.name },
  { key: 'triggers', label: '触发器', icon: 'Lightning', color: '#e6a23c',
    text: (x) => x.name, sub: (x) => x.def || '', title: (x) => x.def || x.name },
]

function emptyForm() {
  return { type: 'mysql', host: '127.0.0.1', port: 3306, database: '', username: 'root', password: '' }
}

function onTypeChange() {
  const def = { mysql: 3306, postgres: 5432, clickhouse: 8123, redis: 6379 }
  if (def[form.value.type]) form.value.port = def[form.value.type]
}

/** 资产下拉刷新：keep-alive 下 onMounted 只执行一次，改为每次切回本模块时重新拉取最新资产 */
async function refreshAssets() {
  await store.load('database')
  assets.value = store.list
}
onActivated(refreshAssets)

async function onAssetSelect(id) {
  // 重置选择框，使"断开后再次选择同一资产"也能触发 change 重新连接
  selectedAssetId.value = null
  const a = await window.liushub.asset.get(id)
  if (!a) return
  if (a.secret?.decryptError) { ElMessage.warning(a.secret.decryptError); return }
  const cfg = {
    name: a.name,
    type: a.extra?.dbType || 'mysql',
    host: a.host, port: a.port, username: a.username,
    password: a.secret?.password,
    database: a.extra?.database,
  }
  await connectWith(cfg)
}

async function onManualConnect() {
  manualForm.value = false
  const cfg = { ...form.value }
  // 编辑连接：在同一个会话上原地重连
  const editId = editingId.value
  editingId.value = null
  const target = editId ? sessions.value.find((x) => x.id === editId) : null
  if (target) return reconnectSession(target, cfg)
  await connectWith(cfg)
}

/** 右键菜单：编辑已有会话的连接配置（原地重连，不新建 tab） */
function editSession(id) {
  const entry = sessionMap.get(id)
  if (!entry || !entry.cfg) { ElMessage.warning('该会话无连接配置，无法编辑'); return }
  const c = entry.cfg
  form.value = {
    type: c.type || 'mysql',
    host: c.host || '',
    port: c.port || 3306,
    database: c.database || '',
    username: c.username || '',
    password: c.password || '',
  }
  editingId.value = id
  manualForm.value = true
}

/** 在指定会话上用新配置原地重连（保留 SQL 编辑器内容）—— 由 useConnectionSessions 提供 */

function disconnect() {
  const s = activeSession.value
  if (!s) return
  if (s.dbId) window.liushub.db.disconnect(s.dbId)
  s.dbId = null
  s.connected = false
  s.connInfo = ''
  s.databases = []
  s.currentTable = null
  clearQueryResults(s)
  setStatus(s.id, 'idle')
}

/** 清空会话内所有查询 tab 的执行结果 */
function clearQueryResults(s) {
  ;(s.queries || []).forEach((q) => { q.result = null })
}

/**
 * 后端连接失效处理：主进程重启 / 连接被服务端断开时，主进程的连接表已清空，
 * 会话里的 dbId 会变成"幽灵连接"。此时把会话重置为断开状态，
 * 避免界面仍显示"已连接"并反复报「连接不存在」。
 * 传 err 时仅当错误为「连接不存在」才重置；不传（err 为空）视为已确认失效，直接重置。
 */
function resetIfConnectionGone(s, err) {
  if (!s || !s.dbId) return false
  if (err && !String(err?.message || err).includes('连接不存在')) return false
  window.liushub.db.disconnect(s.dbId) // 幂等：连接已不存在，无副作用
  s.dbId = null
  s.connected = false
  s.connInfo = ''
  s.databases = []
  s.currentTable = null
  clearQueryResults(s)
  setStatus(s.id, 'error')
  return true
}

/* closeSession / copySession / connectWith / reconnectSession 由 useConnectionSessions 提供 */

/** 连接后/刷新：只列出数据库名（Navicat 式，展开时按需加载分类内容） */
async function loadSchema(s) {
  if (!s || !s.dbId) return
  try {
    const r = await window.liushub.db.list(s.dbId)
    if (r?.gone) {
      resetIfConnectionGone(s)
      ElMessage.warning('连接已失效，请重新连接')
      return
    }
    s.databases = (r.databases || []).map((d) => ({
      name: d.name,
      open: false, loading: false, loaded: false, note: '',
      tables: [], views: [], functions: [], queries: [],
      cats: { tables: true, views: false, functions: false, queries: true },
    }))
  } catch (e) {
    if (resetIfConnectionGone(s, e)) {
      ElMessage.warning('连接已失效，请重新连接')
      return
    }
    ElMessage.error('加载失败: ' + e.message)
  }
}

/** 展开数据库：按需加载 表/视图/函数 分类 */
async function toggleDb(db) {
  if (db.open) { db.open = false; return }
  const s = activeSession.value
  if (s) s.currentDb = db.name // 记住当前数据库，用于新建查询命名
  db.open = true
  if (db.loaded || db.loading) return
  await loadSchemaCats(db)
}

async function loadSchemaCats(db) {
  const s = activeSession.value
  if (!s || !s.dbId) return
  db.loading = true
  try {
    const r = await window.liushub.db.schema(s.dbId, db.name)
    if (r?.gone) {
      resetIfConnectionGone(s)
      ElMessage.warning('连接已失效，请重新连接')
      return
    }
    db.tables = (r.tables || []).map((name) => ({
      name, open: false, detailLoaded: false, detailLoading: false, detail: null,
      detailCats: { columns: false, indexes: false, foreignKeys: false, checks: false, triggers: false },
    }))
    db.views = (r.views || []).map((v) => (typeof v === 'string' ? v : v?.name || v?.viewname || String(v)))
    db.functions = (r.functions || []).map((f) => (typeof f === 'string' ? f : f?.name || f?.routine_name || f?.proname || String(f)))
    db.note = r.note || ''
    db.loaded = true
  } catch (e) {
    if (resetIfConnectionGone(s, e)) {
      ElMessage.warning('连接已失效，请重新连接')
      return
    }
    db.tables = []
    db.views = []
    db.functions = []
    db.note = e.message
    db.loaded = true
  } finally {
    db.loading = false
  }
}

function toggleCat(db, cat) {
  db.cats[cat] = !db.cats[cat]
}

/** 单击表：展开/收起 字段、索引、外键（按需加载） */
async function toggleTable(db, t) {
  if (t.open) { t.open = false; return }
  t.open = true
  if (t.detailLoaded || t.detailLoading) return
  const s = activeSession.value
  if (!s || !s.dbId) return
  t.detailLoading = true
  try {
    const r = await window.liushub.db.tableDetail(s.dbId, db.name, t.name)
    if (r?.gone) {
      resetIfConnectionGone(s)
      ElMessage.warning('连接已失效，请重新连接')
      return
    }
    t.detail = r || { columns: [], indexes: [], foreignKeys: [] }
    t.detailLoaded = true
  } catch (e) {
    if (resetIfConnectionGone(s, e)) {
      ElMessage.warning('连接已失效，请重新连接')
      return
    }
    t.detail = { columns: [], indexes: [], foreignKeys: [], error: e.message }
    t.detailLoaded = true
  } finally {
    t.detailLoading = false
  }
}

/** 双击表/视图：打开数据。SQL 带库名限定，避免在连接默认库下查不到表。
 *  结果放入以表名为标题的查询 tab（已存在则复用），替换 SQL 编辑器区域。 */
async function openTable(db, t) {
  const s = activeSession.value
  if (!s || !s.dbId) return
  s.currentTable = t.name
  const sql = `SELECT * FROM ${quoteFull(db.name, t.name)} LIMIT 100;`
  let q = (s.queries || []).find((x) => x.title === t.name)
  if (q) {
    s.activeQueryId = q.id
  } else {
    q = newQuery(s, '', t.name)
  }
  q.sql = sql
  await runQuery()
}

function filterTables(db) {
  const k = (activeSession.value?.treeKeyword || '').toLowerCase().trim()
  if (!k) return db.tables
  return db.tables.filter((t) => t.name.toLowerCase().includes(k))
}

/**
 * 标识符转义：表名/库名可能包含空格、保留字等特殊字符，按数据库类型正确包裹。
 * 返回 `库`.`表` 限定形式（SQLite/Redis 无跨库概念，只返回表名）。
 */
function quoteFull(db, table) {
  const type = activeSession.value?.dbType || 'mysql'
  if (type === 'sqlite' || type === 'redis') return quoteId(table)
  const q = (s) => (type === 'postgres' ? '"' + String(s).replace(/"/g, '""') + '"' : '`' + String(s).replace(/`/g, '``') + '`')
  return `${q(db)}.${q(table)}`
}

function quoteId(t) {
  const name = String(t)
  const type = activeSession.value?.dbType || 'mysql'
  if (type === 'postgres' || type === 'sqlite') return '"' + name.replace(/"/g, '""') + '"'
  if (type === 'redis') return name
  return '`' + name.replace(/`/g, '``') + '`'
}

async function runQuery() {
  const s = activeSession.value
  const q = activeQuery(s)
  if (!s || !s.dbId || !q || !q.sql.trim()) return
  try {
    const r = await window.liushub.db.query(s.dbId, q.sql)
    if (r?.gone) {
      resetIfConnectionGone(s)
      ElMessage.warning('连接已失效，请重新连接')
      return
    }
    q.result = r
  } catch (e) {
    if (resetIfConnectionGone(s, e)) {
      ElMessage.warning('连接已失效，请重新连接')
      return
    }
    ElMessage.error('执行失败: ' + e.message)
    q.result = { rows: [], fields: [], error: e.message }
  }
}

/** 关闭结果框（清空当前查询 tab 的执行结果，编辑区重新占满） */
function closeResult() {
  const q = activeQuery(activeSession.value)
  if (q) q.result = null
}

async function exportTable() {
  const s = activeSession.value
  if (!s) return
  if (!s.currentTable) { ElMessage.warning('请先选择表'); return }
  // 通过系统保存对话框选择导出位置，避免硬编码路径导致 ENOENT
  const file = await window.liushub.fs.saveFile({
    defaultPath: `${s.currentTable}.csv`,
    filters: [
      { name: 'CSV', extensions: ['csv'] },
      { name: 'JSON', extensions: ['json'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  })
  if (!file) return
  const format = file.toLowerCase().endsWith('.json') ? 'json' : 'csv'
  try {
    const r = await window.liushub.db.export(s.dbId, s.currentTable, file, format)
    if (r?.gone) {
      resetIfConnectionGone(s)
      ElMessage.warning('连接已失效，请重新连接')
      return
    }
    ElMessage.success(`已导出 ${r.rows} 行到 ${file}${r.truncated ? '（已达导出上限 100000 行）' : ''}`)
  } catch (e) {
    if (resetIfConnectionGone(s, e)) {
      ElMessage.warning('连接已失效，请重新连接')
      return
    }
    ElMessage.error('导出失败: ' + e.message)
  }
}

/* ------------------------- 右键菜单 ------------------------- */

function openDbContextMenu(e, db) {
  const s = activeSession.value
  if (s) s.currentDb = db.name
  dbMenu.value = { visible: true, x: e.clientX, y: e.clientY, db }
}
function closeDbMenu() { dbMenu.value.visible = false }

/** 数据表右键菜单：记录所属数据库与表，并在侧栏标记当前数据库 */
function openTableContextMenu(e, db, t) {
  const s = activeSession.value
  if (s) s.currentDb = db.name
  tableMenu.value = { visible: true, x: e.clientX, y: e.clientY, db, table: t }
}
function closeTableMenu() { tableMenu.value.visible = false }

/** 视图右键菜单 */
function openViewContextMenu(e, db, v) {
  const s = activeSession.value
  if (s) s.currentDb = db.name
  viewMenu.value = { visible: true, x: e.clientX, y: e.clientY, db, view: v }
}
function closeViewMenu() { viewMenu.value.visible = false }

// 右键菜单：点击空白处 / 右键其它区域 / Esc 时自动关闭
function onWindowPointerDown() {
  closeDbMenu()
  closeTableMenu()
  closeViewMenu()
}
function onWindowKeydown(e) {
  if (e.key === 'Escape') {
    closeDbMenu()
    closeTableMenu()
    closeViewMenu()
  }
}
let statusUnsub = null
onMounted(() => {
  window.addEventListener('click', onWindowPointerDown)
  window.addEventListener('contextmenu', onWindowPointerDown)
  window.addEventListener('keydown', onWindowKeydown)
  // 连接级错误推送（Redis 断连等）：即时把会话重置为失效状态
  statusUnsub = window.liushub.db.onStatus(({ id, error }) => {
    const s = sessions.value.find((x) => x.dbId === id)
    if (!s) return
    ElMessage.warning(`数据库连接异常: ${error}，会话已断开`)
    resetIfConnectionGone(s)
  })
})
onBeforeUnmount(() => {
  window.removeEventListener('click', onWindowPointerDown)
  window.removeEventListener('contextmenu', onWindowPointerDown)
  window.removeEventListener('keydown', onWindowKeydown)
  if (statusUnsub) { statusUnsub(); statusUnsub = null }
})

/** 数据库节点右键菜单动作 */
async function dbMenuItem(action) {
  const { db } = dbMenu.value
  closeDbMenu()
  const s = activeSession.value
  if (!s || !s.dbId) { ElMessage.warning('请先连接数据库'); return }
  switch (action) {
    case 'editDb':
      return showDbInfo(s, db)
    case 'newDb':
      return createDatabase(s)
    case 'dropDb':
      return dropDatabase(s, db)
    case 'newQuery':
      newQuery(s, '', menuQueryTitle(s), s.currentDb)
      return
    case 'cmdline':
      return openCmdDialog()
    case 'runSqlFile':
      return runSqlFile(s)
    case 'dataDict':
      return openDataDict()
    case 'reverseModel':
      return openErModel()
    case 'searchInDb':
      return openSearchDialog()
    case 'share':
      return shareConnection(s)
    case 'refresh':
      await loadSchema(s)
      return
    default:
      ElMessage.info('该功能未实现')
  }
}

/* ------------------------- 数据表 / 视图右键菜单 ------------------------- */

/** 数据表右键菜单动作 */
async function tableMenuItem(action) {
  const { db, table } = tableMenu.value
  closeTableMenu()
  const s = activeSession.value
  if (!s || !s.dbId) { ElMessage.warning('请先连接数据库'); return }
  switch (action) {
    case 'open': return openTable(db, table)
    case 'design': return openDesignTable(s, db, table)
    case 'new': return openNewTable(s, db)
    case 'copy': return copyTable(s, db, table)
    case 'rename': return renameTable(s, db, table)
    case 'truncate': return truncateTable(s, db, table)
    case 'drop': return dropTable(s, db, table)
    case 'refresh': await loadSchemaCats(db); return
    default: ElMessage.info('该功能未实现')
  }
}

/** 视图右键菜单动作 */
async function viewMenuItem(action) {
  const { db, view } = viewMenu.value
  closeViewMenu()
  const s = activeSession.value
  if (!s || !s.dbId) { ElMessage.warning('请先连接数据库'); return }
  switch (action) {
    case 'open': return openTable(db, { name: view })
    case 'design': return openDesignView(s, db, view)
    case 'new': return openNewView(s, db)
    case 'rename': return renameView(s, db, view)
    case 'drop': return dropView(s, db, view)
    case 'refresh': await loadSchemaCats(db); return
    default: ElMessage.info('该功能未实现')
  }
}

/** 表/视图 DDL 中标识表名：PostgreSQL 单连接无法跨库，只用表名（当前 schema）；其余带库名限定 */
function qTable(db, table) {
  const type = activeSession.value?.dbType || 'mysql'
  if (type === 'postgres') return quoteId(table)
  return quoteFull(db, table)
}

/** 从 "varchar(255)" 之类的类型拆出基础类型与长度 */
function parseType(t) {
  const m = /^\s*([A-Za-z][A-Za-z0-9_ ]*?)\s*(?:\((\d+)(?:,\s*\d+)?\))?\s*.*$/.exec(String(t || ''))
  if (!m) return { type: String(t || 'text').trim(), length: null }
  return { type: m[1].trim(), length: m[2] ? Number(m[2]) : null }
}

/** 默认值格式化为 SQL 字面量：纯数字不加引号，其余用单引号包裹 */
function fmtDefault(v) {
  if (v == null || v === '') return null
  if (/^-?\d+(\.\d+)?$/.test(String(v))) return String(v)
  return "'" + String(v).replace(/'/g, "''") + "'"
}

/** 生成单个字段的 DDL 片段（按数据库类型） */
function colDdl(col) {
  const type = activeSession.value?.dbType || 'mysql'
  const q = quoteId(col.name)
  const len = col.length ? `(${col.length})` : ''
  const notNull = col.nullable ? '' : ' NOT NULL'
  const def = col.default != null && col.default !== '' ? ` DEFAULT ${fmtDefault(col.default)}` : ''
  if (type === 'postgres') return `${q} ${col.type}${len}${notNull}${def}`
  if (type === 'sqlite') return `${q} ${col.type}${notNull}${def}${col.pk ? ' PRIMARY KEY' : ''}`
  // mysql / clickhouse：主键 + 整数 → AUTO_INCREMENT（mysql）
  const auto = type === 'mysql' && col.pk && /int/i.test(String(col.type)) ? ' AUTO_INCREMENT' : ''
  const comment = col.comment ? ` COMMENT '${String(col.comment).replace(/'/g, "''")}'` : ''
  return `${q} ${col.type}${len}${notNull}${auto}${def}${comment}`
}

/** 组装 CREATE TABLE 语句 */
function buildCreateTable(db, table, cols) {
  const type = activeSession.value?.dbType || 'mysql'
  let colsDdl
  if (type === 'sqlite') {
    colsDdl = sqliteColsDdl(cols)
  } else {
    colsDdl = cols.map((c) => colDdl(c))
    const pkCols = cols.filter((c) => c.pk).map((c) => quoteId(c.name))
    if (pkCols.length) colsDdl.push(`PRIMARY KEY (${pkCols.join(', ')})`)
  }
  return `CREATE TABLE ${qTable(db.name, table)} (${colsDdl.join(', ')})`
}

/**
 * SQLite 列 DDL 列表：单列主键保持内联（INTEGER PRIMARY KEY 为 rowid 别名）；
 * 多列主键必须去掉内联并改用表级 PRIMARY KEY(a, b)，否则建表报错。
 */
function sqliteColsDdl(cols) {
  const pkNames = cols.filter((c) => c.pk).map((c) => c.name)
  let ddl = cols.map((c) => colDdl(c))
  if (pkNames.length > 1) {
    ddl = ddl.map((d) => d.replace(/\s+PRIMARY KEY$/i, ''))
    ddl.push(`PRIMARY KEY (${pkNames.map((n) => quoteId(n)).join(', ')})`)
  }
  return ddl
}

/**
 * 生成 ALTER TABLE 语句列表（设计表保存用）：按原字段与编辑后字段做增删改对比。
 * SQLite 无法直接修改列，采用"重建表"方案（拷贝同名列数据）。
 */
function buildAlterTable(db, table, orig, cols) {
  const type = activeSession.value?.dbType || 'mysql'
  const full = qTable(db.name, table)
  const origMap = new Map(orig.map((c) => [c.name, c]))
  const newMap = new Map(cols.map((c) => [c.name, c]))
  const stmts = []
  const unchanged = (o, n) =>
    o.type === n.type && o.nullable === n.nullable && String(o.default || '') === String(n.default || '') && String(o.comment || '') === String(n.comment || '') && o.length === n.length

  if (type === 'sqlite') {
    const copyCols = cols.map((c) => c.name).filter((n) => origMap.has(n))
    const tmp = `__new_${table}_${Date.now().toString(36)}`
    // sqliteColsDdl 处理主键：单列内联，多列改表级 PRIMARY KEY
    const ddl = sqliteColsDdl(cols)
    stmts.push(`CREATE TABLE ${qTable(db.name, tmp)} (${ddl.join(', ')})`)
    if (copyCols.length) {
      const quoted = copyCols.map((c) => quoteId(c))
      stmts.push(`INSERT INTO ${qTable(db.name, tmp)} (${quoted.join(', ')}) SELECT ${quoted.join(', ')} FROM ${full}`)
    }
    stmts.push(`DROP TABLE ${full}`)
    stmts.push(`ALTER TABLE ${qTable(db.name, tmp)} RENAME TO ${quoteId(table)}`)
    return stmts
  }

  // MySQL
  if (type === 'mysql') {
    for (const n of cols) {
      if (!origMap.has(n.name)) stmts.push(`ALTER TABLE ${full} ADD COLUMN ${colDdl(n)}`)
    }
    for (const o of orig) {
      if (!newMap.has(o.name)) stmts.push(`ALTER TABLE ${full} DROP COLUMN ${quoteId(o.name)}`)
    }
    for (const n of cols) {
      const o = origMap.get(n.name)
      if (o && !unchanged(o, n)) stmts.push(`ALTER TABLE ${full} MODIFY COLUMN ${colDdl(n)}`)
    }
    const pkChanged = JSON.stringify(orig.filter((c) => c.pk).map((c) => c.name).sort()) !== JSON.stringify(cols.filter((c) => c.pk).map((c) => c.name).sort())
    if (pkChanged) ElMessage.warning('主键变更未自动应用，请在保存后手动处理索引')
    return stmts
  }

  // PostgreSQL
  for (const n of cols) {
    if (!origMap.has(n.name)) stmts.push(`ALTER TABLE ${full} ADD COLUMN ${colDdl(n)}`)
  }
  for (const o of orig) {
    if (!newMap.has(o.name)) stmts.push(`ALTER TABLE ${full} DROP COLUMN IF EXISTS ${quoteId(o.name)}`)
  }
  for (const n of cols) {
    const o = origMap.get(n.name)
    if (!o) continue
    const typeChanged = String(o.type || '').trim() !== String(n.type || '').trim() || (o.length || null) !== (n.length || null)
    if (typeChanged) stmts.push(`ALTER TABLE ${full} ALTER COLUMN ${quoteId(n.name)} TYPE ${n.type}${n.length ? `(${n.length})` : ''}`)
    if (!!o.nullable !== !!n.nullable) {
      stmts.push(`ALTER TABLE ${full} ALTER COLUMN ${quoteId(n.name)} ${n.nullable ? 'DROP NOT NULL' : 'SET NOT NULL'}`)
    }
    if (String(o.default || '') !== String(n.default || '')) {
      stmts.push(`ALTER TABLE ${full} ALTER COLUMN ${quoteId(n.name)} ${n.default != null && n.default !== '' ? `SET DEFAULT ${fmtDefault(n.default)}` : 'DROP DEFAULT'}`)
    }
  }
  return stmts
}

/** 添加/删除字段行（表格编辑器） */
function addTableColumn() {
  tableEditor.value.columns.push({ name: '', type: tableTypes.value[0] || 'text', length: null, nullable: true, pk: false, default: '', comment: '' })
}
function removeTableColumn(i) {
  tableEditor.value.columns.splice(i, 1)
}

/** 新建表：打开编辑器（空字段模板） */
function openNewTable(s, db) {
  tableEditor.value = { visible: true, isNew: true, tableName: '', columns: [], original: [], db, loading: false }
  addTableColumn()
}

/** 设计表：读取当前结构 → 打开编辑器 */
async function openDesignTable(s, db, t) {
  const r = await window.liushub.db.tableDetail(s.dbId, db.name, t.name)
  if (r?.gone) { resetIfConnectionGone(s); return }
  const orig = (r?.columns || []).map((c) => {
    const { type, length } = parseType(c.type)
    return { name: c.name, type, length, nullable: c.nullable !== 'NO', pk: c.key === 'PRI', default: c.default ?? '', comment: c.comment || '' }
  })
  tableEditor.value = {
    visible: true, isNew: false, tableName: t.name,
    columns: orig.map((c) => ({ ...c })),
    original: orig, db, loading: false,
  }
}

/** 保存新建表 / 设计表 */
async function saveTableEditor() {
  const s = activeSession.value
  const { db, isNew } = tableEditor.value
  if (!s || !s.dbId) return
  const name = tableEditor.value.tableName.trim()
  if (!name) { ElMessage.warning('请输入表名'); return }
  const cols = tableEditor.value.columns.filter((c) => c.name && String(c.name).trim())
  if (!cols.length) { ElMessage.warning('请至少填写一个字段'); return }
  tableEditor.value.loading = true
  try {
    if (isNew) {
      await window.liushub.db.query(s.dbId, buildCreateTable(db, name, cols))
      ElMessage.success(`已创建表 ${name}`)
    } else {
      const stmts = buildAlterTable(db, name, tableEditor.value.original, cols)
      if (!stmts.length) { ElMessage.info('没有需要修改的内容'); tableEditor.value.visible = false; return }
      if ((activeSession.value?.dbType || 'mysql') === 'sqlite') {
        // SQLite 重建表方案：数据保留，但原表索引/触发器会丢失，先警示
        try {
          await ElMessageBox.confirm(
            'SQLite 改表结构采用「重建表」方案：数据会保留，但原表的索引与触发器将丢失。确认继续？',
            '注意', { type: 'warning', confirmButtonText: '继续' },
          )
        } catch { return }
      }
      for (const st of stmts) await window.liushub.db.query(s.dbId, st)
      ElMessage.success(`已保存表结构（${stmts.length} 条 SQL）`)
    }
    tableEditor.value.visible = false
    await loadSchemaCats(db)
  } catch (e) {
    ElMessage.error('保存失败: ' + (e?.message || e))
  } finally {
    tableEditor.value.loading = false
  }
}

/** 删除表 */
async function dropTable(s, db, t) {
  try {
    await ElMessageBox.confirm(`确认删除表「${t.name}」？该操作不可恢复！`, '删除表', {
      type: 'warning', confirmButtonText: '删除', confirmButtonClass: 'el-button--danger',
    })
  } catch { return }
  try {
    await window.liushub.db.query(s.dbId, `DROP TABLE ${qTable(db.name, t.name)}`)
    ElMessage.success(`已删除表 ${t.name}`)
    await loadSchemaCats(db)
  } catch (e) { ElMessage.error('删除失败: ' + (e?.message || e)) }
}

/** 清空表 */
async function truncateTable(s, db, t) {
  try {
    await ElMessageBox.confirm(`确认清空表「${t.name}」的全部数据？该操作不可恢复！`, '清空表', {
      type: 'warning', confirmButtonText: '清空', confirmButtonClass: 'el-button--danger',
    })
  } catch { return }
  const full = qTable(db.name, t.name)
  const sql = activeSession.value?.dbType === 'sqlite' || activeSession.value?.dbType === 'postgres'
    ? `DELETE FROM ${full}`
    : `TRUNCATE TABLE ${full}`
  try {
    await window.liushub.db.query(s.dbId, sql)
    ElMessage.success(`已清空表 ${t.name}`)
  } catch (e) { ElMessage.error('清空失败: ' + (e?.message || e)) }
}

/** 重命名表 */
async function renameTable(s, db, t) {
  let value
  try {
    const { value: v } = await ElMessageBox.prompt('请输入新表名', `重命名表「${t.name}」`, {
      inputPattern: /^[A-Za-z0-9_]+$/, inputErrorMessage: '名称仅支持字母、数字、下划线',
      confirmButtonText: '重命名', inputValue: t.name,
    })
    value = v
  } catch { return }
  if (!value || value === t.name) return
  const type = activeSession.value?.dbType || 'mysql'
  const sql = type === 'postgres' || type === 'sqlite'
    ? `ALTER TABLE ${qTable(db.name, t.name)} RENAME TO ${quoteId(value)}`
    : `RENAME TABLE ${qTable(db.name, t.name)} TO ${qTable(db.name, value)}`
  try {
    await window.liushub.db.query(s.dbId, sql)
    ElMessage.success(`已重命名为 ${value}`)
    await loadSchemaCats(db)
  } catch (e) { ElMessage.error('重命名失败: ' + (e?.message || e)) }
}

/** 复制表：复制结构与数据到新表 */
async function copyTable(s, db, t) {
  let value
  try {
    const { value: v } = await ElMessageBox.prompt('请输入新表名', `复制表「${t.name}」`, {
      inputPattern: /^[A-Za-z0-9_]+$/, inputErrorMessage: '名称仅支持字母、数字、下划线',
      confirmButtonText: '复制', inputValue: `${t.name}_copy`,
    })
    value = v
  } catch { return }
  if (!value) return
  const type = activeSession.value?.dbType || 'mysql'
  const newFull = qTable(db.name, value)
  const oldFull = qTable(db.name, t.name)
  let stmts
  if (type === 'sqlite') stmts = [`CREATE TABLE ${newFull} AS SELECT * FROM ${oldFull}`]
  else if (type === 'mysql') stmts = [`CREATE TABLE ${newFull} LIKE ${oldFull}`, `INSERT INTO ${newFull} SELECT * FROM ${oldFull}`]
  else if (type === 'postgres') stmts = [`CREATE TABLE ${newFull} (LIKE ${oldFull} INCLUDING ALL)`, `INSERT INTO ${newFull} SELECT * FROM ${oldFull}`]
  else stmts = [`CREATE TABLE ${newFull} AS ${oldFull}`]
  try {
    for (const st of stmts) await window.liushub.db.query(s.dbId, st)
    ElMessage.success(`已复制为 ${value}`)
    await loadSchemaCats(db)
  } catch (e) { ElMessage.error('复制失败: ' + (e?.message || e)) }
}

/** 新建视图：打开编辑器 */
function openNewView(s, db) {
  viewEditor.value = { visible: true, isNew: true, viewName: '', sql: '', db, loading: false }
}

/** 设计视图：拉取当前定义（尽力而为），填充编辑器 */
async function openDesignView(s, db, v) {
  const type = activeSession.value?.dbType || 'mysql'
  let sql = ''
  try {
    if (type === 'mysql') {
      const r = await window.liushub.db.query(s.dbId, `SHOW CREATE VIEW ${qTable(db.name, v)}`)
      const row = r?.rows?.[0]
      sql = row?.['Create View'] || row?.create_view || row?.view_definition || ''
    } else if (type === 'postgres') {
      const r = await window.liushub.db.query(s.dbId, `SELECT pg_get_viewdef('${String(v).replace(/'/g, "''")}'::regclass, true) AS def`)
      sql = r?.rows?.[0]?.def || ''
      if (sql) sql = `CREATE OR REPLACE VIEW ${qTable(db.name, v)} AS ${sql}`
    } else if (type === 'sqlite') {
      const r = await window.liushub.db.query(s.dbId, `SELECT sql FROM sqlite_master WHERE type='view' AND name = '${String(v).replace(/'/g, "''")}'`)
      sql = r?.rows?.[0]?.sql || ''
    } else if (type === 'clickhouse') {
      const r = await window.liushub.db.query(s.dbId, `SHOW CREATE VIEW ${qTable(db.name, v)}`)
      sql = r?.rows?.[0]?.[Object.keys(r?.rows?.[0] || {})[0]] || ''
    }
  } catch (e) { /* 取不到定义也不阻塞编辑 */ }
  if (!sql) ElMessage.info('未能读取视图定义，请手动填写 SQL')
  viewEditor.value = { visible: true, isNew: false, viewName: v, sql, db, loading: false }
}

/** 保存新建 / 设计视图 */
async function saveViewEditor() {
  const s = activeSession.value
  const { db, isNew } = viewEditor.value
  if (!s || !s.dbId) return
  const name = viewEditor.value.viewName.trim()
  let sql = viewEditor.value.sql.trim()
  if (!name) { ElMessage.warning('请输入视图名'); return }
  if (!sql) { ElMessage.warning('请输入视图 SQL'); return }
  viewEditor.value.loading = true
  try {
    const type = activeSession.value?.dbType || 'mysql'
    if (/^\s*create\s/i.test(sql)) {
      // 完整 CREATE 语句（设计视图拉回的是原始定义）→ 先删后建，保证可覆盖
      await window.liushub.db.query(s.dbId, `DROP VIEW IF EXISTS ${qTable(db.name, name)}`)
      await window.liushub.db.query(s.dbId, sql)
    } else if (type === 'postgres') {
      await window.liushub.db.query(s.dbId, `CREATE OR REPLACE VIEW ${qTable(db.name, name)} AS ${sql}`)
    } else {
      await window.liushub.db.query(s.dbId, `DROP VIEW IF EXISTS ${qTable(db.name, name)}`)
      await window.liushub.db.query(s.dbId, `CREATE VIEW ${qTable(db.name, name)} AS ${sql}`)
    }
    ElMessage.success(isNew ? `已创建视图 ${name}` : `已保存视图 ${name}`)
    viewEditor.value.visible = false
    await loadSchemaCats(db)
  } catch (e) {
    ElMessage.error('保存失败: ' + (e?.message || e))
  } finally {
    viewEditor.value.loading = false
  }
}

/** 删除视图 */
async function dropView(s, db, v) {
  try {
    await ElMessageBox.confirm(`确认删除视图「${v}」？`, '删除视图', {
      type: 'warning', confirmButtonText: '删除', confirmButtonClass: 'el-button--danger',
    })
  } catch { return }
  try {
    await window.liushub.db.query(s.dbId, `DROP VIEW IF EXISTS ${qTable(db.name, v)}`)
    ElMessage.success(`已删除视图 ${v}`)
    await loadSchemaCats(db)
  } catch (e) { ElMessage.error('删除失败: ' + (e?.message || e)) }
}

/** 重命名视图 */
async function renameView(s, db, v) {
  let value
  try {
    const { value: val } = await ElMessageBox.prompt('请输入新视图名', `重命名视图「${v}」`, {
      inputPattern: /^[A-Za-z0-9_]+$/, inputErrorMessage: '名称仅支持字母、数字、下划线',
      confirmButtonText: '重命名', inputValue: v,
    })
    value = val
  } catch { return }
  if (!value || value === v) return
  const type = activeSession.value?.dbType || 'mysql'
  const sql = type === 'postgres' || type === 'sqlite'
    ? `ALTER VIEW ${qTable(db.name, v)} RENAME TO ${quoteId(value)}`
    : `RENAME TABLE ${qTable(db.name, v)} TO ${qTable(db.name, value)}`
  try {
    await window.liushub.db.query(s.dbId, sql)
    ElMessage.success(`已重命名为 ${value}`)
    await loadSchemaCats(db)
  } catch (e) { ElMessage.error('重命名失败: ' + (e?.message || e)) }
}

/** 编辑数据库 → 展示数据库属性（名称 + 各类对象数量）。内容经 HTML 转义，防止库名注入 */
async function showDbInfo(s, db) {
  const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const fields = [
    ['数据库名', db.name],
    ['类型', s.dbType || '-'],
    ['表', String(db.tables?.length ?? 0)],
    ['视图', String(db.views?.length ?? 0)],
    ['函数', String(db.functions?.length ?? 0)],
  ]
  const html = fields.map(([k, v]) => `<div style="display:flex;justify-content:space-between;gap:24px;padding:4px 0;border-bottom:1px dashed var(--glass-border)"><span class="muted">${esc(k)}</span><span>${esc(v)}</span></div>`).join('')
  try {
    await ElMessageBox.alert(html, '数据库属性', {
      confirmButtonText: '确定',
      dangerouslyUseHTMLString: true,
    })
  } catch {}
}

/** 新建数据库（沿用当前连接的权限执行 DDL） */
async function createDatabase(s) {
  try {
    const { value } = await ElMessageBox.prompt('请输入数据库名称', '新建数据库', {
      inputPattern: /^[A-Za-z0-9_\-]+$/,
      inputErrorMessage: '名称仅支持字母、数字、下划线、中划线',
      confirmButtonText: '创建',
    })
    // 标识符按数据库类型包裹（反引号仅 MySQL/ClickHouse，PostgreSQL 需双引号）
    await window.liushub.db.query(s.dbId, `CREATE DATABASE ${quoteId(value)}`)
    ElMessage.success(`已创建数据库 ${value}`)
    await loadSchema(s)
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') ElMessage.error('创建失败: ' + (e?.message || e))
  }
}

/** 删除数据库 */
async function dropDatabase(s, db) {
  try {
    await ElMessageBox.confirm(`确认删除数据库「${db.name}」？该操作不可恢复！`, '删除数据库', {
      type: 'warning',
      confirmButtonText: '删除',
      confirmButtonClass: 'el-button--danger',
    })
    await window.liushub.db.query(s.dbId, `DROP DATABASE ${quoteId(db.name)}`)
    ElMessage.success(`已删除数据库 ${db.name}`)
    await loadSchema(s)
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') ElMessage.error('删除失败: ' + (e?.message || e))
  }
}

/** 连接 tab 右键菜单扩展项动作 */
function onTabMenuAction({ sid, action }) {
  // 先切换到被右键的会话，后续操作针对该会话
  if (sid && activeId.value !== sid) activate(sid)
  const s = activeSession.value
  if (!s) return
  switch (action) {
    case 'newConnection':
      openManualForm()
      return
    case 'newQuery':
      newQuery(s, '', menuQueryTitle(s), s.currentDb)
      return
    case 'newDb':
      createDatabase(s)
      return
    case 'deleteConnection':
      closeSession(sid)
      return
    case 'cmdline':
      openCmdDialog()
      return
    case 'runSqlFile':
      runSqlFile(s)
      return
    case 'star':
      toggleStar(s)
      return
    case 'refresh':
      loadSchema(s)
      return
    default:
      ElMessage.info('该功能未实现')
  }
}

/** 新建连接：弹出空白的连接表单 */
function openManualForm() {
  editingId.value = null
  form.value = emptyForm()
  manualForm.value = true
}

/** 添加星标：在会话标题前加 ★ */
function toggleStar(s) {
  if (!s) return
  s.starred = !s.starred
  s.title = (s.starred ? '★ ' : '') + String(s.title).replace(/^★\s*/, '')
  ElMessage.success(s.starred ? '已添加星标' : '已取消星标')
}

/**
 * 按 ';' 切分 SQL 脚本为语句列表。
 * 感知单引号/双引号/反引号字符串与 -- 、块注释，避免字符串内的分号被误切。
 */
function splitSqlStatements(text) {
  const out = []
  let cur = ''
  let i = 0
  let inS = false, inD = false, inB = false, inLine = false, inBlock = false
  while (i < text.length) {
    const c = text[i]
    const two = text.slice(i, i + 2)
    if (inLine) { if (c === '\n') { inLine = false; cur += c } i++; continue }
    if (inBlock) { if (two === '*/') { inBlock = false; i += 2 } else i++; continue }
    if (!inS && !inD && !inB) {
      if (two === '--') { inLine = true; i += 2; continue }
      if (two === '/*') { inBlock = true; i += 2; continue }
    }
    if (inS) {
      cur += c
      if (c === "'") { if (text[i + 1] === "'") { cur += "'"; i += 2; continue } inS = false }
      i++; continue
    }
    if (inD) {
      cur += c
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i += 2; continue } inD = false }
      i++; continue
    }
    if (inB) { cur += c; if (c === '`') inB = false; i++; continue }
    if (c === "'") { inS = true; cur += c; i++; continue }
    if (c === '"') { inD = true; cur += c; i++; continue }
    if (c === '`') { inB = true; cur += c; i++; continue }
    if (c === ';') {
      if (cur.trim()) out.push(cur.trim())
      cur = ''
      i++
      continue
    }
    cur += c
    i++
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

/** 运行 SQL 文件：选择 .sql 文件 → 切分语句 → 逐条执行（多语句脚本支持） */
async function runSqlFile(s) {
  if (!s || !s.dbId) { ElMessage.warning('请先连接数据库'); return }
  const file = await window.liushub.fs.choose('openFile')
  if (!file) return
  if (!/\.sql$/i.test(file)) { ElMessage.warning('请选择 .sql 文件'); return }
  try {
    const text = await window.liushub.fs.readText(file)
    const stmts = splitSqlStatements(text)
    if (!stmts.length) { ElMessage.warning('文件中没有可执行的 SQL 语句'); return }
    const q = activeQuery(s)
    if (!q) return
    q.sql = text
    q.result = null
    let ok = 0, lastErr = null
    for (let i = 0; i < stmts.length; i++) {
      try {
        await window.liushub.db.query(s.dbId, stmts[i])
        ok++
      } catch (e) {
        lastErr = { index: i + 1, message: e?.message || String(e) }
        break
      }
    }
    await runQuery()
    if (lastErr) {
      ElMessage.error(`已执行 ${ok}/${stmts.length} 条；第 ${lastErr.index} 条失败: ${lastErr.message}`)
    } else {
      ElMessage.success(`已执行 ${ok} 条语句（来自 ${file}）`)
    }
  } catch (e) {
    ElMessage.error('运行失败: ' + (e?.message || e))
  }
}

/* ------------------------- 命令列界面（SQL 控制台） ------------------------- */

function openCmdDialog() {
  if (!cmdDialog.value.sql) cmdDialog.value.sql = 'SHOW TABLES;'
  cmdDialog.value.visible = true
}

async function runConsole() {
  const s = activeSession.value
  if (!s || !s.dbId) { ElMessage.warning('请先连接数据库'); return }
  const sql = cmdDialog.value.sql.trim()
  if (!sql) return
  cmdDialog.value.loading = true
  cmdDialog.value.info = ''
  try {
    const r = await window.liushub.db.query(s.dbId, sql)
    if (r?.gone) {
      resetIfConnectionGone(s)
      ElMessage.warning('连接已失效，请重新连接')
      return
    }
    cmdDialog.value.result = r
    cmdDialog.value.info = `${r.rows?.length || 0} 行 · ${r.durationMs} ms`
  } catch (e) {
    if (resetIfConnectionGone(s, e)) {
      ElMessage.warning('连接已失效，请重新连接')
      return
    }
    cmdDialog.value.result = { rows: [], fields: [], error: e.message }
  } finally {
    cmdDialog.value.loading = false
  }
}

/* ------------------------- 数据字典 ------------------------- */

function openDataDict() {
  dictDialog.value.visible = true
  loadDataDict()
}

async function loadDataDict() {
  const s = activeSession.value
  if (!s || !s.dbId) { ElMessage.warning('请先连接数据库'); return }
  const db = s.currentDb
  if (!db) { ElMessage.warning('请先在左侧展开并选中数据库'); return }
  dictDialog.value.loading = true
  dictDialog.value.markdown = ''
  try {
    const r = await window.liushub.db.meta(s.dbId, db)
    if (r?.gone) {
      resetIfConnectionGone(s)
      ElMessage.warning('连接已失效，请重新连接')
      return
    }
    dictDialog.value.tables = r.tables || []
    dictDialog.value.markdown = buildDictMarkdown(db, r.tables || [])
  } catch (e) {
    if (resetIfConnectionGone(s, e)) {
      ElMessage.warning('连接已失效，请重新连接')
      return
    }
    ElMessage.error('生成失败: ' + (e?.message || e))
  } finally {
    dictDialog.value.loading = false
  }
}

/** 把数据库元数据生成为 Markdown 数据字典文档 */
function buildDictMarkdown(db, tables) {
  const esc = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
  const lines = [`# ${db} 数据字典`, '', `> 共 ${tables.length} 张表`, '']
  for (const t of tables) {
    lines.push(`## 表：${t.name}`, '')
    lines.push('| 字段 | 类型 | 允许空 | 键 | 默认值 | 说明 |', '| --- | --- | --- | --- | --- | --- |')
    for (const c of t.columns || []) {
      lines.push(`| ${esc(c.name)} | ${esc(c.type)} | ${esc(c.nullable)} | ${esc(c.key || '')} | ${esc(c.default)} | ${esc(c.comment || '')} |`)
    }
    if (t.indexes?.length) {
      lines.push('', '索引：' + (t.indexes || []).map((x) => `${x.name}${x.unique ? '(UNIQUE)' : ''}`).join('、'))
    }
    if (t.foreignKeys?.length) {
      lines.push('', '外键：')
      for (const fk of t.foreignKeys || []) {
        lines.push(`- ${fk.name || 'fk'}: ${t.name}.${fk.column} → ${fk.refTable}.${fk.refColumn}`)
      }
    }
    lines.push('')
  }
  return lines.join('\n')
}

async function exportDataDict() {
  const db = activeSession.value?.currentDb || 'database'
  const file = await window.liushub.fs.saveFile({
    defaultPath: `${db}_数据字典.md`,
    filters: [{ name: 'Markdown', extensions: ['md'] }, { name: 'All Files', extensions: ['*'] }],
  })
  if (!file) return
  try {
    await window.liushub.fs.writeText(file, dictDialog.value.markdown)
    ElMessage.success('已导出到 ' + file)
  } catch (e) {
    ElMessage.error('导出失败: ' + (e?.message || e))
  }
}

/* ------------------------- 在数据库中查找 ------------------------- */

function openSearchDialog() {
  searchDialog.value.visible = true
  searchDialog.value.done = false
}

async function runSearch() {
  const s = activeSession.value
  if (!s || !s.dbId) { ElMessage.warning('请先连接数据库'); return }
  const db = s.currentDb
  const kw = searchDialog.value.keyword.trim()
  if (!db) { ElMessage.warning('请先在左侧展开并选中数据库'); return }
  if (!kw) { ElMessage.warning('请输入查找内容'); return }
  searchDialog.value.loading = true
  searchDialog.value.done = false
  searchDialog.value.note = ''
  try {
    const r = await window.liushub.db.search(s.dbId, db, kw)
    if (r?.gone) {
      resetIfConnectionGone(s)
      ElMessage.warning('连接已失效，请重新连接')
      return
    }
    searchDialog.value.tables = r.tables || []
    searchDialog.value.note = r.note || ''
    searchDialog.value.done = true
  } catch (e) {
    if (resetIfConnectionGone(s, e)) {
      ElMessage.warning('连接已失效，请重新连接')
      return
    }
    searchDialog.value.tables = []
    searchDialog.value.done = true
    ElMessage.error('查找失败: ' + (e?.message || e))
  } finally {
    searchDialog.value.loading = false
  }
}

/** 把一行结果格式化为 "col=val  col2=val2" */
function rowText(row) {
  return Object.keys(row || {})
    .map((k) => {
      let v = row[k]
      if (v && typeof v === 'object') v = JSON.stringify(v)
      return `${k}=${v == null ? 'NULL' : v}`
    })
    .join('  ')
}

/* ------------------------- 逆向数据库到模型（ER 图） ------------------------- */

function openErModel() {
  erDialog.value.visible = true
  loadErModel()
}

async function loadErModel() {
  const s = activeSession.value
  if (!s || !s.dbId) { ElMessage.warning('请先连接数据库'); return }
  const db = s.currentDb
  if (!db) { ElMessage.warning('请先在左侧展开并选中数据库'); return }
  erDialog.value.loading = true
  erDialog.value.mermaid = ''
  try {
    const r = await window.liushub.db.meta(s.dbId, db)
    if (r?.gone) {
      resetIfConnectionGone(s)
      ElMessage.warning('连接已失效，请重新连接')
      return
    }
    erDialog.value.tables = r.tables || []
    erDialog.value.mermaid = buildErMermaid(r.tables || [])
  } catch (e) {
    if (resetIfConnectionGone(s, e)) {
      ElMessage.warning('连接已失效，请重新连接')
      return
    }
    ElMessage.error('生成失败: ' + (e?.message || e))
  } finally {
    erDialog.value.loading = false
  }
}

/** 生成 Mermaid erDiagram 文本（可导出 .mmd 用于 draw.io / mermaid 工具） */
function buildErMermaid(tables) {
  const safe = (s) => String(s ?? '').replace(/[^A-Za-z0-9_]/g, '_')
  const lines = ['erDiagram']
  for (const t of tables) {
    lines.push(`  ${safe(t.name)} {`)
    for (const c of t.columns || []) {
      const isPk = c.key === 'PRI' || c.pk
      lines.push(`    ${c.type || 'unknown'} ${safe(c.name)}${isPk ? ' PK' : ''} "${isPk ? '主键' : ''}"`)
    }
    lines.push('  }')
  }
  for (const t of tables) {
    for (const fk of t.foreignKeys || []) {
      lines.push(`  ${safe(t.name)} ||--o{ ${safe(fk.refTable)} : "${fk.column}"`)
    }
  }
  return lines.join('\n')
}

async function exportErModel() {
  const db = activeSession.value?.currentDb || 'database'
  const file = await window.liushub.fs.saveFile({
    defaultPath: `${db}_ER模型.mmd`,
    filters: [{ name: 'Mermaid', extensions: ['mmd'] }, { name: 'All Files', extensions: ['*'] }],
  })
  if (!file) return
  try {
    await window.liushub.fs.writeText(file, erDialog.value.mermaid)
    ElMessage.success('已导出到 ' + file)
  } catch (e) {
    ElMessage.error('导出失败: ' + (e?.message || e))
  }
}

/* ------------------------- 共享连接 ------------------------- */

function shareConnection(s) {
  s = s || activeSession.value
  const entry = sessionMap.get(s?.id)
  if (!entry || !entry.cfg) { ElMessage.warning('该会话无连接配置，无法共享'); return }
  const c = entry.cfg
  const lines = [`类型: ${c.type || 'mysql'}`]
  if (c.type !== 'sqlite') {
    lines.push(`主机: ${c.host || ''}`, `端口: ${c.port || ''}`, `用户名: ${c.username || ''}`)
  } else {
    lines.push(`DB 文件: ${c.database || ''}`)
  }
  lines.push(`数据库: ${c.database || ''}`, '密码: (已隐藏)')
  shareDialog.value.text = lines.join('\n')
  shareDialog.value.visible = true
}

async function copyShare() {
  try {
    await navigator.clipboard.writeText(shareDialog.value.text)
    ElMessage.success('已复制到剪贴板')
  } catch {
    ElMessage.warning('复制失败，请手动选择复制')
  }
}
</script>

<style scoped>
.db-view { display: flex; flex-direction: column; height: 100%; gap: 12px; }
.db-grid {
  flex: 1;
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 12px;
  min-height: 0;
}
.db-side, .db-center { display: flex; flex-direction: column; overflow: hidden; }
.db-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
.pane-header {
  padding: 8px 12px;
  border-bottom: 1px solid var(--glass-border);
  display: flex; align-items: center; gap: 8px;
  font-size: 13px;
  background: var(--glass-bg-soft);
  -webkit-backdrop-filter: var(--backdrop-blur-soft);
  backdrop-filter: var(--backdrop-blur-soft);
}
.db-tree { flex: 1; overflow-y: auto; padding: 4px 0; }
.db-name {
  padding: 4px 12px;
  display: flex; align-items: center; gap: 6px;
  cursor: pointer; font-size: 13px;
  font-weight: 500;
  border-radius: var(--radius-sm);
  margin: 1px 4px;
}
.db-name:hover { background: var(--accent-soft); }
.db-children { padding-left: 12px; }
.db-cat-name {
  padding: 3px 10px;
  display: flex; align-items: center; gap: 6px;
  cursor: pointer; font-size: 12.5px;
  border-radius: var(--radius-sm);
  margin: 1px 2px;
}
.db-cat-name:hover { background: var(--accent-soft); }
.db-cat-children { padding-left: 18px; }
.db-count {
  margin-left: auto;
  margin-right: 4px;
  font-size: 11px;
  color: var(--text-muted);
  background: var(--glass-bg-soft);
  border: 1px solid var(--glass-border);
  border-radius: 10px;
  padding: 0 6px;
  line-height: 16px;
}
.db-hint {
  padding: 3px 12px;
  font-size: 12px;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  gap: 6px;
}
.db-table-node { min-width: 0; }
.db-table {
  padding: 3px 12px;
  font-size: 12px;
  cursor: pointer;
  border-radius: 4px;
  margin: 1px 4px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.db-table:hover { background: var(--accent-soft); }
.db-table-detail {
  margin: 0 0 2px 20px; /* 缩进到表名下方，形成目录层级 */
  padding: 2px 0;
  border-left: 2px solid var(--glass-border);
}
.db-sub-name {
  padding: 3px 10px;
  display: flex; align-items: center; gap: 6px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  color: var(--text-secondary);
  border-radius: 4px;
}
.db-sub-name:hover { background: var(--accent-soft); }
.db-leaf {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 10px 2px 26px;
  font-size: 12px;
  color: var(--text-secondary);
}
.db-leaf-type {
  font-size: 11px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sql-editor {
  flex: 1 1 auto;      /* 无结果时占满整个编辑器区域；有结果时与结果框分栏 */
  min-height: 96px;
  width: 100%;
  padding: 12px;
  border: none;
  outline: none;
  background: var(--glass-bg-soft);
  -webkit-backdrop-filter: var(--backdrop-blur-soft);
  backdrop-filter: var(--backdrop-blur-soft);
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 13px;
  resize: none;
  border-bottom: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  margin: 8px;
}
/* 结果框：执行后出现，可关闭 */
.db-result {
  flex: 1 1 45%;
  min-height: 140px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  padding: 0 8px 8px;
  margin: 0 8px 8px;
}
.result-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 2px 6px;
  flex-shrink: 0;
  font-size: 12px;
}
.result-close {
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  color: var(--text-muted);
  padding: 0 4px;
  user-select: none;
}
.result-close:hover { color: var(--danger); }
.db-result-body { flex: 1; overflow: auto; min-height: 0; }

/* 查询 tab 页（SQL 编辑器区） */
.query-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px 0;
  overflow-x: auto;
  flex-shrink: 0;
}
.query-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  font-size: 12px;
  color: var(--text-secondary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  background: var(--glass-bg-soft);
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
}
.query-tab:hover { background: var(--accent-soft); }
.query-tab.active {
  background: var(--accent-soft);
  color: var(--accent);
  border-color: var(--accent);
}
.query-tab .q-title { max-width: 160px; overflow: hidden; text-overflow: ellipsis; }
.query-tab .q-rename {
  width: 120px;
  padding: 0 2px;
  border: 1px solid var(--accent);
  border-radius: 3px;
  outline: none;
  background: var(--glass-bg);
  color: var(--text-primary);
  font-size: 12px;
}
.query-tab .q-close {
  font-size: 13px;
  line-height: 1;
  opacity: 0.6;
}
.query-tab .q-close:hover { opacity: 1; color: var(--danger); }
.query-tab-add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  font-size: 14px;
  color: var(--text-muted);
  border: 1px dashed var(--glass-border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  user-select: none;
}
.query-tab-add:hover { color: var(--accent); border-color: var(--accent); }

/* 树形子节点展开箭头 */
.db-sub-name .caret { color: var(--text-muted); font-size: 12px; }
.db-sub-name .cat-icon { font-size: 13px; flex-shrink: 0; }

/* 命令列界面 */
.cmd-console { display: flex; flex-direction: column; gap: 10px; }
.cmd-console :deep(.el-textarea__inner) { font-family: var(--font-mono); font-size: 13px; }
.cmd-actions { display: flex; align-items: center; gap: 8px; }
.cmd-result { max-height: 320px; overflow: auto; border: 1px solid var(--glass-border); border-radius: var(--radius-sm); }

/* 数据字典 */
.dict-toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.dict-preview {
  max-height: 60vh; overflow: auto; padding: 12px; margin: 0;
  background: var(--glass-bg-soft);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-primary);
}

/* 在数据库中查找 */
.search-row { display: flex; gap: 8px; margin-bottom: 10px; }
.search-group { margin-bottom: 10px; }
.search-group-name {
  font-size: 13px; font-weight: 600; padding: 4px 0;
  display: flex; align-items: center; gap: 8px;
  border-bottom: 1px solid var(--glass-border);
}
.search-group-rows { display: flex; flex-direction: column; }
.search-row-cell {
  padding: 4px 8px; font-size: 12px; color: var(--text-secondary);
  border-bottom: 1px dashed var(--glass-border);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

/* 逆向数据库到模型（ER 图） */
.er-canvas {
  display: flex; flex-wrap: wrap; gap: 14px; padding: 8px 0;
  max-height: 52vh; overflow: auto; align-items: flex-start;
}
.er-table {
  width: 220px; border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm); overflow: hidden;
  background: var(--glass-bg-soft);
}
.er-table-name {
  padding: 6px 10px; font-size: 13px; font-weight: 600; text-align: center;
  background: var(--accent-soft); color: var(--accent);
}
.er-col { display: flex; gap: 6px; padding: 3px 10px; font-size: 12px; border-top: 1px solid var(--glass-border); }
.er-col.pk { color: var(--accent); font-weight: 600; }
.er-col.fk { color: #b8860b; }
.er-col-key { font-size: 10px; color: var(--accent); }
.er-col-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.er-col-type { font-size: 11px; color: var(--text-muted); }
.er-fk-list { margin-top: 10px; }
.er-fk-title { font-size: 13px; font-weight: 600; margin-bottom: 4px; }
.er-fk { font-size: 12px; color: var(--text-secondary); padding: 2px 0; }

/* 新建表 / 设计表 编辑器 */
.te-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.te-grid {
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  overflow: auto;
  max-height: 50vh;
}
.te-head, .te-row {
  display: flex;
  align-items: center;
  border-bottom: 1px solid var(--glass-border);
  min-width: 720px;
}
.te-head {
  background: var(--glass-bg-soft);
  -webkit-backdrop-filter: var(--backdrop-blur-soft);
  backdrop-filter: var(--backdrop-blur-soft);
  font-size: 12px;
  font-weight: 600;
  position: sticky;
  top: 0;
  z-index: 1;
  color: var(--text-secondary);
}
.te-row:hover { background: var(--accent-soft); }
.te-cell { padding: 4px 6px; display: flex; align-items: center; }
.te-name { width: 150px; flex-shrink: 0; }
.te-type { width: 170px; flex-shrink: 0; }
.te-len { width: 70px; flex-shrink: 0; }
.te-null, .te-key { width: 70px; flex-shrink: 0; justify-content: center; }
.te-def { width: 130px; flex-shrink: 0; }
.te-comment { flex: 1; min-width: 140px; }
.te-op { width: 60px; flex-shrink: 0; justify-content: center; }
.te-add { padding: 8px; }
.te-grid :deep(.el-input-number) { width: 100%; }
.te-grid :deep(.el-select) { width: 100%; }
</style>
