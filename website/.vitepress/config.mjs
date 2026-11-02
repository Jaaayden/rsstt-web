import { defineConfig } from 'vitepress';
import { readFileSync } from 'node:fs';

const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const github = 'https://github.com/Jaaayden/rsstt-web';

const zhSidebar = [
  { text: '开始使用', items: [
    { text: '文档总览', link: '/guide/' },
    { text: '快速部署', link: '/guide/deployment' },
    { text: '从原版迁移与回退', link: '/guide/migration' },
    { text: 'Nginx 与 HTTPS', link: '/guide/https' }
  ] },
  { text: '使用与配置', items: [
    { text: '使用管理台', link: '/guide/console' },
    { text: '配置参考', link: '/guide/configuration' },
    { text: 'API 与 Agent', link: '/guide/api' }
  ] },
  { text: '维护', items: [
    { text: '升级、备份与维护', link: '/guide/maintenance' },
    { text: '故障排查', link: '/guide/troubleshooting' },
    { text: '更新日志', link: '/changelog' }
  ] }
];
const enSidebar = [
  { text: 'Get started', items: [
    { text: 'Overview', link: '/en/' },
    { text: 'Quick start', link: '/en/guide/deployment' },
    { text: 'Migrate & roll back', link: '/en/guide/migration' }
  ] },
  { text: 'More (Chinese)', items: [
    { text: 'Nginx & HTTPS', link: '/guide/https' },
    { text: 'Using the console', link: '/guide/console' },
    { text: 'Configuration', link: '/guide/configuration' },
    { text: 'API & agents', link: '/guide/api' },
    { text: 'Troubleshooting', link: '/guide/troubleshooting' },
    { text: 'Changelog', link: '/changelog' }
  ] }
];

export default defineConfig({
  title: 'RSStT Web',
  description: '带网页管理台的自托管 Telegram RSS 机器人：订阅、会话与推送，一处掌握。',
  base: '/rsstt-web/',
  cleanUrls: false,
  // public/deploy.md is served verbatim for AI agents, not rendered as a page.
  srcExclude: ['public/**', 'README.md'],
  lastUpdated: true,
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/rsstt-web/favicon.svg' }],
    ['meta', { name: 'theme-color', content: '#e8590c' }],
    ['link', { rel: 'alternate', type: 'text/markdown', title: 'Deployment instructions for AI agents', href: '/rsstt-web/deploy.md' }]
  ],
  sitemap: { hostname: 'https://jaaayden.github.io/rsstt-web/' },
  locales: {
    root: {
      label: '简体中文', lang: 'zh-CN',
      themeConfig: {
        nav: [
          { text: '指南', link: '/guide/' },
          { text: '交给 AI 部署', link: '/guide/deployment#交给-ai-部署' },
          { text: '更新日志', link: '/changelog' },
          { text: `v${version}`, link: `${github}/releases/latest` }
        ],
        sidebar: zhSidebar,
        outline: { label: '本页内容', level: [2, 3] },
        docFooter: { prev: '上一页', next: '下一页' },
        lastUpdated: { text: '最后更新' },
        returnToTopLabel: '回到顶部',
        sidebarMenuLabel: '目录',
        darkModeSwitchLabel: '外观',
        lightModeSwitchTitle: '切换到浅色模式',
        darkModeSwitchTitle: '切换到深色模式',
        langMenuLabel: '语言',
        skipToContentLabel: '跳转到内容',
        editLink: { text: '在 GitHub 上编辑此页', pattern: `${github}/edit/main/website/:path` },
        footer: { message: '基于 AGPL-3.0 开源 · 基于 RSS-to-Telegram-Bot', copyright: 'RSStT Web' }
      }
    },
    en: {
      label: 'English', lang: 'en',
      description: 'A self-hosted Telegram RSS bot with a web console: feeds, chats and deliveries in one place.',
      themeConfig: {
        nav: [
          { text: 'Guide', link: '/en/guide/deployment' },
          { text: 'Deploy with AI', link: '/en/guide/deployment#deploy-with-an-ai-agent' },
          { text: `v${version}`, link: `${github}/releases/latest` }
        ],
        sidebar: enSidebar,
        outline: { level: [2, 3] },
        editLink: { text: 'Edit this page on GitHub', pattern: `${github}/edit/main/website/:path` },
        footer: { message: 'AGPL-3.0 · Based on RSS-to-Telegram-Bot', copyright: 'RSStT Web' }
      }
    }
  },
  themeConfig: {
    logo: '/favicon.svg',
    i18nRouting: false,
    siteTitle: 'RSStT Web',
    socialLinks: [{ icon: 'github', link: github }],
    search: {
      provider: 'local',
      options: {
        locales: {
          root: { translations: {
            button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
            modal: { noResultsText: '没有找到相关内容', resetButtonTitle: '清除搜索', footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' } }
          } }
        }
      }
    }
  }
});
