import type { RouteRecordRaw } from 'vue-router';

import { Authority } from '#/enums';

const authority = [
  Authority.SYS_ADMIN,
  Authority.TENANT_ADMIN,
  Authority.CUSTOMER_USER,
];

const routes: RouteRecordRaw[] = [
  {
    path: '/openclaw/chat',
    name: 'OpenClawChat',
    component: () => import('#/views/openclaw/chat.vue'),
    meta: {
      authority,
      icon: 'ant-design:message-outlined',
      order: 2,
      title: '智能体对话',
    },
  },
  {
    path: '/ragflow/datasets',
    name: 'RagFlowDatasets',
    component: () => import('#/views/openclaw/ragflow/index.vue'),
    meta: {
      authority,
      icon: 'ant-design:database-outlined',
      order: 3,
      title: '知识库管理',
    },
  },
  {
    path: '/ragflow/dataset/:id',
    name: 'RagFlowDataset',
    component: () => import('#/views/openclaw/ragflow/dataset.vue'),
    meta: {
      activePath: '/ragflow/datasets',
      authority,
      hideInMenu: true,
      title: '知识库详情',
    },
  },
  {
    path: '/ragflow/dataset/:id/doc/:docId/chunks',
    name: 'RagFlowChunks',
    component: () => import('#/views/openclaw/ragflow/chunks.vue'),
    meta: {
      activePath: '/ragflow/datasets',
      authority,
      hideInMenu: true,
      title: '分块管理',
    },
  },
  {
    path: '/excel/editor',
    name: 'ExcelEditor',
    component: () => import('#/views/openclaw/excel.vue'),
    meta: {
      authority,
      icon: 'ant-design:file-excel-outlined',
      order: 5,
      title: '报表编辑',
    },
  },
  {
    path: '/knowledge/source/:docId',
    name: 'KnowledgeSourceReader',
    component: () => import('#/views/openclaw/source.vue'),
    meta: {
      activePath: '/openclaw/chat',
      authority,
      hideInMenu: true,
      title: '知识库原文',
    },
  },
  {
    path: '/dashboard/:dashboardId',
    name: 'DashboardViewer',
    component: () => import('#/views/tb/dashboard/editor.vue'),
    meta: {
      activePath: '/dashboards',
      authority: [Authority.TENANT_ADMIN, Authority.CUSTOMER_USER],
      hideInMenu: true,
      title: '仪表盘',
    },
  },
];

export default routes;
