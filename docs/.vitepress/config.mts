import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Pravaha',
  description: 'Composable agentic AI workflows. No magic, no bloat.',
  base: '/pravaha/',
  ignoreDeadLinks: true,

  head: [
    ['link', { rel: 'icon', href: '/favicon.ico' }],
    ['meta', { name: 'og:title', content: 'Pravaha' }],
    ['meta', { name: 'og:description', content: 'Composable agentic AI workflows. No magic, no bloat.' }],
  ],

  themeConfig: {
    siteTitle: 'Pravaha',

    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'API Reference', link: '/api/core' },
      { text: 'Examples', link: '/examples/support-triage' },
      {
        text: 'v0.1.0',
        items: [
          { text: 'Changelog', link: '/changelog' },
          { text: 'GitHub', link: 'https://github.com/pravaham/pravaha' },
        ],
      },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Introduction',
          items: [
            { text: 'What is Pravaha?', link: '/guide/what-is-pravaha' },
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'Core Concepts', link: '/guide/core-concepts' },
          ],
        },
        {
          text: 'Building Pipelines',
          items: [
            { text: 'Steps', link: '/guide/steps' },
            { text: 'Routers', link: '/guide/routers' },
            { text: 'Pipelines', link: '/guide/pipelines' },
            { text: 'Agents', link: '/guide/agents' },
            { text: 'Tools', link: '/guide/tools' },
            { text: 'Memory', link: '/guide/memory' },
          ],
        },
        {
          text: 'Observability',
          items: [
            { text: 'Tracing', link: '/guide/tracing' },
            { text: 'Trace Viewer', link: '/guide/trace-viewer' },
            { text: 'Dry-Run Mode', link: '/guide/dry-run' },
            { text: 'Plugins', link: '/guide/plugins' },
          ],
        },
        {
          text: 'Resilience',
          items: [
            { text: 'Retry Policies', link: '/guide/retry' },
            { text: 'Error Handling', link: '/guide/errors' },
          ],
        },
        {
          text: 'Adapters',
          items: [
            { text: 'Claude (Anthropic)', link: '/guide/adapters/claude' },
            { text: 'Claude (Vertex AI)', link: '/guide/adapters/claude-vertex' },
            { text: 'OpenAI', link: '/guide/adapters/openai' },
            { text: 'Ollama', link: '/guide/adapters/ollama' },
            { text: 'Writing an Adapter', link: '/guide/adapters/custom' },
          ],
        },
        {
          text: 'Streaming',
          items: [
            { text: 'Streaming Responses', link: '/guide/streaming' },
          ],
        },
      ],
      '/api/': [
        {
          text: 'API Reference',
          items: [
            { text: '@pravaha/core', link: '/api/core' },
            { text: '@pravaha/adapter-claude', link: '/api/adapter-claude' },
            { text: '@pravaha/adapter-openai', link: '/api/adapter-openai' },
            { text: '@pravaha/adapter-ollama', link: '/api/adapter-ollama' },
            { text: '@pravaha/cli', link: '/api/cli' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/pravaham/pravaha' },
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2025 Pravaha Contributors',
    },

    editLink: {
      pattern: 'https://github.com/pravaham/pravaha/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },

    search: {
      provider: 'local',
    },
  },
})
