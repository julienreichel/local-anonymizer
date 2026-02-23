// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: ['@nuxt/ui'],
  devtools: { enabled: process.env.NODE_ENV !== 'production' },
  runtimeConfig: {
    public: {
      apiBase: process.env.NUXT_PUBLIC_API_BASE ?? 'http://localhost:3001',
    },
  },
  nitro: {
    // Ensure compatibility with containerised environment
    preset: 'node-server',
  },
})
