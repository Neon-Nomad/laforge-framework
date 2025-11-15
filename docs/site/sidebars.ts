import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  handbook: [
    'handbook',
    'why-laforge',
    'architecture',
    {
      type: 'category',
      label: 'Guides',
      items: ['dsl-guide', 'migration-workflow', 'multi-db-guide', 'cli', 'runtime-api', 'plugins'],
    },
    'roadmap',
  ],
};

export default sidebars;
