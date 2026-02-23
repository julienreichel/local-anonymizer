<template>
  <UContainer class="py-8 max-w-2xl">
    <div class="flex items-center gap-3 mb-6">
      <UButton to="/" variant="ghost" icon="i-heroicons-arrow-left" size="sm" />
      <h1 class="text-2xl font-bold">Configuration</h1>
    </div>

    <UCard>
      <template #header>
        <h2 class="text-lg font-semibold">Target Endpoint</h2>
        <p class="text-sm text-gray-500 mt-1">
          Anonymized payloads will be POSTed to this URL.
        </p>
      </template>

      <UForm :schema="schema" :state="form" @submit="save" class="flex flex-col gap-4">
        <UFormGroup label="Target URL" name="target_url" required>
          <UInput v-model="form.target_url" placeholder="https://your-target.example.com/ingest" />
        </UFormGroup>

        <UFormGroup label="Authorization Header" name="target_auth_header">
          <UInput
            v-model="form.target_auth_header"
            placeholder="Bearer <token>"
            type="password"
          />
        </UFormGroup>

        <UFormGroup label="Presidio Analyzer URL" name="presidio_analyzer_url">
          <UInput v-model="form.presidio_analyzer_url" placeholder="http://presidio-analyzer:5001" />
        </UFormGroup>

        <UFormGroup label="Presidio Anonymizer URL" name="presidio_anonymizer_url">
          <UInput v-model="form.presidio_anonymizer_url" placeholder="http://presidio-anonymizer:5002" />
        </UFormGroup>

        <UFormGroup label="Language" name="language">
          <UInput v-model="form.language" placeholder="en" />
        </UFormGroup>

        <UButton type="submit" :loading="saving" icon="i-heroicons-check">
          Save Configuration
        </UButton>
      </UForm>

      <UAlert v-if="saved" color="green" icon="i-heroicons-check-circle" class="mt-4">
        Configuration saved successfully.
      </UAlert>
      <UAlert v-if="error" color="red" icon="i-heroicons-x-circle" class="mt-4">
        {{ error }}
      </UAlert>
    </UCard>
  </UContainer>
</template>

<script setup lang="ts">
import { z } from 'zod'

const { apiBase } = useRuntimeConfig().public

const schema = z.object({
  target_url: z.string().url('Must be a valid URL').optional().or(z.literal('')),
  target_auth_header: z.string().optional(),
  presidio_analyzer_url: z.string().url().optional().or(z.literal('')),
  presidio_anonymizer_url: z.string().url().optional().or(z.literal('')),
  language: z.string().min(2).optional(),
})

const form = reactive({
  target_url: '',
  target_auth_header: '',
  presidio_analyzer_url: 'http://presidio-analyzer:5001',
  presidio_anonymizer_url: 'http://presidio-anonymizer:5002',
  language: 'en',
})

const saving = ref(false)
const saved = ref(false)
const error = ref('')

// Load existing config
const { data } = await useFetch<{ success: boolean; data: Record<string, string> }>(
  `${apiBase}/api/config`,
  { default: () => ({ success: true, data: {} }) },
)

watchEffect(() => {
  const cfg = data.value?.data ?? {}
  if (cfg.target_url) form.target_url = cfg.target_url
  if (cfg.target_auth_header) form.target_auth_header = cfg.target_auth_header
  if (cfg.presidio_analyzer_url) form.presidio_analyzer_url = cfg.presidio_analyzer_url
  if (cfg.presidio_anonymizer_url) form.presidio_anonymizer_url = cfg.presidio_anonymizer_url
  if (cfg.language) form.language = cfg.language
})

async function save() {
  saving.value = true
  saved.value = false
  error.value = ''
  try {
    await $fetch(`${apiBase}/api/config`, {
      method: 'PUT',
      body: form,
    })
    saved.value = true
  } catch (e) {
    error.value = (e as Error).message ?? 'Failed to save'
  } finally {
    saving.value = false
  }
}
</script>
