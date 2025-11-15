import type { Config } from '@docusaurus/types';
import type { Preset } from '@docusaurus/preset-classic';

const config: Config = {
  title: 'LaForge',
  tagline: 'Policy-first backend compiler',
  url: 'https://your-domain.com',
  baseUrl: '/',
  onBrokenLinks: 'warn',
  onBrokenMarkdownLinks: 'warn',
  favicon: 'img/favicon.ico',
  trailingSlash: false,

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: require.resolve('./sidebars.ts'),
          editUrl: undefined,
          routeBasePath: '/',
        },
        blog: false,
        theme: {
          customCss: require.resolve('./src/css/custom.css'),
        },
      } satisfies Preset.Options,
    ],
  ],
  themeConfig: {
    image: 'img/social-card.png',
    navbar: {
      title: 'LaForge',
      items: [
        { type: 'doc', docId: 'handbook', position: 'left', label: 'Handbook' },
        { href: 'https://github.com/Neon-Nomad/laforge-framework', label: 'GitHub', position: 'right' },
      ],
    },
    footer: {
      style: 'dark',
      copyright: `© ${new Date().getFullYear()} LaForge.`,
    },
  },
};

export default config;
