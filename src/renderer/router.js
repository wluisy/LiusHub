import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  { path: '/', name: 'home', component: () => import('./views/Home.vue'), meta: { title: '首页' } },
  { path: '/assets', name: 'assets', component: () => import('./views/AssetsView.vue'), meta: { title: '资产库' } },
  { path: '/ssh', name: 'ssh', component: () => import('./views/SshView.vue'), meta: { title: 'SSH 终端' } },
  { path: '/sftp', name: 'sftp', component: () => import('./views/SftpView.vue'), meta: { title: 'SFTP 文件' } },
  { path: '/database', name: 'database', component: () => import('./views/DatabaseView.vue'), meta: { title: '数据库' } },
  { path: '/docker', name: 'docker', component: () => import('./views/DockerView.vue'), meta: { title: 'Docker' } },
  { path: '/tools', name: 'tools', component: () => import('./views/ToolsView.vue'), meta: { title: '工具坞' } },
  { path: '/settings', name: 'settings', component: () => import('./views/SettingsView.vue'), meta: { title: '设置' } },
]

export default createRouter({
  history: createWebHashHistory(),
  routes,
})
