import { defineConfig, loadEnv } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { handleOutlineExtractionRequest } from './src/server/openaiOutlineExtractor'

function openAiOutlineExtractorPlugin() {
  return {
    name: 'goosecalendar-openai-outline-extractor',
    configureServer(server: any) {
      server.middlewares.use('/api/extract-outline-events', handleOutlineExtractionRequest)
    },
    configurePreviewServer(server: any) {
      server.middlewares.use('/api/extract-outline-events', handleOutlineExtractionRequest)
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  ;[
    'OPENAI_API_KEY',
    'OPENAI_MODEL',
    'OPENAI_API_BASE_URL',
    'OPENAI_OUTLINE_TEXT_LIMIT',
    'OPENAI_TIMEOUT_MS',
    'OPENAI_MAX_OUTPUT_TOKENS',
    'FIREBASE_PROJECT_ID',
    'FIREBASE_CLIENT_EMAIL',
    'FIREBASE_PRIVATE_KEY',
    'FIREBASE_SERVICE_ACCOUNT_JSON',
    'FIREBASE_ADMIN_CREDENTIALS',
    'AI_EXTRACTION_CACHE_ENABLED',
  ].forEach((key) => {
    if (!process.env[key] && env[key]) {
      process.env[key] = env[key]
    }
  })

  return {
    plugins: [
      // The React and Tailwind plugins are both required for Make, even if
      // Tailwind is not being actively used – do not remove them
      react(),
      tailwindcss(),
      openAiOutlineExtractorPlugin(),
    ],
    resolve: {
      alias: [
        {
          // Alias @ to the src directory
          find: '@',
          replacement: path.resolve(__dirname, './src'),
        },
        {
          // Resolve Figma Make asset specifiers to the exported local image files.
          find: /^figma:asset\//,
          replacement: `${path.resolve(__dirname, './src/assets')}/`,
        },
      ],
    },

    // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
    assetsInclude: ['**/*.svg', '**/*.csv'],
  }
})
