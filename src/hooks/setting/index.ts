import type { GlobConfig } from '/#/config';

import { getAppEnvConfig } from '/@/utils/env';

let globCache: Readonly<GlobConfig>;
export const useGlobSetting = (): Readonly<GlobConfig> => {
  if (globCache) return globCache;

  const {
    VITE_GLOB_APP_TITLE,
    VITE_GLOB_API_URL,
    VITE_GLOB_API_URL_WEBSOCKET,
    VITE_GLOB_APP_SHORT_NAME,
    VITE_GLOB_API_URL_PREFIX,
    VITE_GLOB_TB_BASE_URL,
  } = getAppEnvConfig();

  const ctxPath = ((): string => {
    let ctx = VITE_GLOB_API_URL + VITE_GLOB_API_URL_PREFIX;
    let idx = ctx.indexOf('://');
    if (idx != -1) {
      ctx = ctx.substring(idx + 3);
    }
    idx = ctx.indexOf('/');
    if (idx != -1) {
      ctx = ctx.substring(idx);
    } else {
      ctx = '';
    }
    return ctx;
  })();

  const websocketPath = ((): string => {
    // 始终基于当前页面 origin，让 WebSocket 走前端同源地址，
    // 由 vite 代理（dev，ws:true）或反向代理（prod）转发到后端。
    // 若硬编码代理目标（如 127.0.0.1:18080），局域网/多人访问时
    // 浏览器会直连后端端口而绕过代理，导致连接失败。
    return `${location.protocol.replace('https:', 'wss:').replace('http:', 'ws:')}//${location.host}${VITE_GLOB_API_URL_WEBSOCKET}`;
  })();

  // Take global configuration
  const glob: Readonly<GlobConfig> = {
    title: VITE_GLOB_APP_TITLE,
    apiUrl: VITE_GLOB_API_URL,
    shortName: VITE_GLOB_APP_SHORT_NAME,
    urlPrefix: VITE_GLOB_API_URL_PREFIX,
    ctxPath: ctxPath,
    ctxAdminPath: ctxPath,
    websocketPath: websocketPath,
    tbBaseUrl: VITE_GLOB_TB_BASE_URL,
  };
  globCache = glob;
  return glob as Readonly<GlobConfig>;
};
