import { defineConfig } from 'vitepress';

// Published to GitHub Pages at https://sukundev.github.io/matane/ (.github/workflows/docs.yml).
export default defineConfig({
  title: 'Matane',
  description: 'Open-source desktop manga reader with a sandboxed extension system',
  base: '/matane/',
  lang: 'en',
  cleanUrls: true,
  lastUpdated: true,
  head: [['link', { rel: 'icon', type: 'image/png', href: '/matane/logo.png' }]],
  themeConfig: {
    logo: '/logo.png',
    nav: [
      { text: 'Guide', link: '/guide/', activeMatch: '/guide/' },
      { text: 'Extensions', link: '/extensions/', activeMatch: '/extensions/' },
      { text: 'Download', link: 'https://github.com/SukunDev/matane/releases' },
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'Getting started',
          items: [
            { text: 'Introduction', link: '/guide/' },
            { text: 'Install', link: '/guide/install' },
          ],
        },
        {
          text: 'Using Matane',
          items: [
            { text: 'Library', link: '/guide/library' },
            { text: 'Reader', link: '/guide/reader' },
            { text: 'Downloads and offline', link: '/guide/downloads' },
            { text: 'Local files', link: '/guide/local' },
            { text: 'Trackers (AniList)', link: '/guide/tracking' },
            { text: 'Extensions and repositories', link: '/guide/extensions' },
            { text: 'Network (DNS-over-HTTPS, proxy)', link: '/guide/network' },
            { text: 'Backup and restore', link: '/guide/backup' },
          ],
        },
        { text: 'Help', items: [{ text: 'FAQ and troubleshooting', link: '/guide/faq' }] },
      ],
      '/extensions/': [
        {
          text: 'Extensions',
          items: [
            { text: 'Writing extensions', link: '/extensions/' },
            { text: 'Templates (Madara, MangaThemesia)', link: '/extensions/templates' },
            { text: 'Publishing a repository', link: '/extensions/repository' },
          ],
        },
      ],
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/SukunDev/matane' }],
    editLink: {
      pattern: 'https://github.com/SukunDev/matane/edit/main/apps/docs/:path',
      text: 'Edit this page on GitHub',
    },
    search: { provider: 'local' },
    footer: {
      message: 'Matane hosts no content: sources come from extensions. Released under the GPL-3.0 license.',
      copyright: 'Copyright © 2026 SukunDev',
    },
  },
});
