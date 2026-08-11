import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';

// 聊天场景的 markdown 渲染器：html:false 关闭原始 HTML（防 XSS），
// linkify 自动识别链接，breaks 单换行即换行（更贴合聊天）。
const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  highlight(code: string, lang: string): string {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<pre class="hljs"><code>${hljs.highlight(code, { language: lang, ignoreIllegals: true }).value}</code></pre>`;
      } catch {
        // 高亮失败则退回转义纯文本
      }
    }
    return `<pre class="hljs"><code>${md.utils.escapeHtml(code)}</code></pre>`;
  },
});

// 链接一律新标签打开
const defaultLinkOpen =
  md.renderer.rules.link_open ||
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  token.attrSet('target', '_blank');
  token.attrSet('rel', 'noopener noreferrer');
  return defaultLinkOpen(tokens, idx, options, env, self);
};

const allowedChartImage = /^\/chart\/(?:artifacts\/)?[A-Za-z0-9][A-Za-z0-9._-]{0,180}\.png$/;
md.renderer.rules.image = (tokens, idx) => {
  const token = tokens[idx];
  const src = token.attrGet('src') || '';
  const alt = token.content || '图表';
  if (!allowedChartImage.test(src)) return md.utils.escapeHtml(alt);
  return `<img src="${md.utils.escapeHtml(src)}" alt="${md.utils.escapeHtml(alt)}" loading="lazy">`;
};

export function renderMarkdown(text: string): string {
  return md.render(text ?? '');
}
