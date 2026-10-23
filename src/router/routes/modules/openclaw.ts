import { LAYOUT } from '/@/router/constant';
import type { AppRouteModule } from '/@/router/types';
import { Authority } from '/@/enums/authorityEnum';

const ragflow: AppRouteModule = {
  path: '/ragflow',
  name: 'RagFlow',
  component: LAYOUT,
  redirect: '/ragflow/datasets',
  meta: {
    orderNo: 3,
    single: true,
    icon: 'i-ant-design:database-outlined',
    tabIcon: 'i-ant-design:database-outlined',
    title: '知识库管理',
    authority: [Authority.SYS_ADMIN, Authority.TENANT_ADMIN, Authority.CUSTOMER_USER],
  },
  children: [
    {
      path: '/ragflow/datasets',
      name: 'RagFlowDatasets',
      component: () => import('/@/views/openclaw/ragflow/index.vue'),
      meta: {
        icon: 'i-ant-design:database-outlined',
        tabIcon: 'i-ant-design:database-outlined',
        title: '知识库管理',
        authority: [Authority.SYS_ADMIN, Authority.TENANT_ADMIN, Authority.CUSTOMER_USER],
      },
    },
    {
      path: '/ragflow/dataset/:id',
      name: 'RagFlowDataset',
      component: () => import('/@/views/openclaw/ragflow/dataset.vue'),
      meta: {
        hideMenu: true,
        hideTab: true,
        title: '知识库详情',
        currentActiveMenu: '/ragflow/datasets',
        authority: [Authority.SYS_ADMIN, Authority.TENANT_ADMIN, Authority.CUSTOMER_USER],
      },
    },
    {
      path: '/ragflow/dataset/:id/doc/:docId/chunks',
      name: 'RagFlowChunks',
      component: () => import('/@/views/openclaw/ragflow/chunks.vue'),
      meta: {
        hideMenu: true,
        hideTab: true,
        title: '分块管理',
        currentActiveMenu: '/ragflow/datasets',
        authority: [Authority.SYS_ADMIN, Authority.TENANT_ADMIN, Authority.CUSTOMER_USER],
      },
    },
  ],
};

export default [ragflow] as AppRouteModule[];
