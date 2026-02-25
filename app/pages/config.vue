<template>
  <UContainer class="py-8 max-w-2xl">
    <div class="flex items-center gap-3 mb-6">
      <UButton to="/" variant="ghost" icon="i-heroicons-arrow-left" size="sm" />
      <h1 class="text-2xl font-bold">Configuration</h1>
    </div>

    <!-- Watch Folder Info -->
    <UCard class="mb-6">
      <template #header>
        <h2 class="text-lg font-semibold">Watch Folder</h2>
      </template>
      <div class="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
        <UIcon name="i-heroicons-folder-open" class="w-5 h-5 text-blue-500 shrink-0" />
        <div>
          <p class="text-sm font-medium">Folder on your machine (drop files here):</p>
          <p class="font-mono text-sm mt-1">{{ hostWatchFolder }}</p>
          <p class="text-xs text-gray-500 mt-2">
            Change this in <code>.env</code> with <code>UPLOADS_DIR=...</code>. Default is <code>./infra/volumes/uploads</code>.
          </p>
          <p class="text-xs text-gray-400 mt-2">
            Container path: <code>{{ form.watchFolderPath }}</code>
          </p>
        </div>
      </div>
    </UCard>

    <!-- Main Settings -->
    <UCard>
      <template #header>
        <h2 class="text-lg font-semibold">Processing Settings</h2>
      </template>

      <UForm :state="form" @submit="save" class="flex flex-col gap-5">

        <!-- Delete policies -->
        <fieldset class="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
          <legend class="text-sm font-medium px-1">Delete Policies</legend>
          <div class="flex flex-col gap-3 mt-2">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm font-medium">Delete after success</p>
                <p class="text-xs text-gray-500">Remove the source file once it has been delivered.</p>
              </div>
              <UToggle v-model="form.deleteAfterSuccess" />
            </div>
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm font-medium">Delete after failure</p>
                <p class="text-xs text-gray-500">Remove the source file when processing or delivery fails.</p>
              </div>
              <UToggle v-model="form.deleteAfterFailure" />
            </div>
          </div>
        </fieldset>

        <!-- Max file size -->
        <UFormGroup label="Max file size (bytes)" name="maxFileSizeBytes">
          <UInput
            v-model.number="form.maxFileSizeBytes"
            type="number"
            min="1"
            placeholder="10485760"
          />
          <template #hint>
            <span class="text-xs text-gray-400">{{ formatBytes(form.maxFileSizeBytes) }}</span>
          </template>
        </UFormGroup>

        <!-- Accepted extensions -->
        <UFormGroup label="Accepted extensions" name="acceptedExtensions">
          <UInput
            v-model="extensionsRaw"
            placeholder=".json, .txt"
          />
          <template #hint>
            <span class="text-xs text-gray-400">Comma-separated list, e.g. <code>.json</code></span>
          </template>
        </UFormGroup>

        <!-- Poll interval -->
        <UFormGroup label="Poll interval (ms)" name="pollIntervalMs">
          <UInput
            v-model.number="form.pollIntervalMs"
            type="number"
            min="500"
            placeholder="5000"
          />
          <template #hint>
            <span class="text-xs text-gray-400">How often to scan the watch folder (min 500 ms).</span>
          </template>
        </UFormGroup>

        <!-- Anonymization operator -->
        <UFormGroup label="Anonymization operator" name="anonymizationOperator">
          <USelect
            v-model="form.anonymizationOperator"
            :options="operatorOptions"
          />
        </UFormGroup>

        <UButton type="submit" :loading="saving" icon="i-heroicons-check">
          Save Configuration
        </UButton>
      </UForm>
    </UCard>
  </UContainer>
</template>

<script setup lang="ts">
const api = useApi()
const toast = useToast()
const hostWatchFolder = './infra/volumes/uploads'

const form = reactive({
  watchFolderPath: '/uploads',
  deleteAfterSuccess: false,
  deleteAfterFailure: false,
  maxFileSizeBytes: 10 * 1024 * 1024,
  acceptedExtensions: ['.json'] as string[],
  pollIntervalMs: 5000,
  anonymizationOperator: 'replace' as 'replace' | 'redact' | 'hash',
})

const extensionsRaw = computed({
  get: () => form.acceptedExtensions.join(', '),
  set: (val: string) => {
    form.acceptedExtensions = val
      .split(',')
      .map((s) => {
        const ext = s.trim().toLowerCase()
        return ext.startsWith('.') ? ext : `.${ext}`
      })
      .filter(Boolean)
  },
})

const operatorOptions = [
  { label: 'Replace (e.g. <PERSON>)', value: 'replace' },
  { label: 'Redact (remove entirely)', value: 'redact' },
  { label: 'Hash (SHA-256)', value: 'hash' },
]

const saving = ref(false)

// Load existing config
const { data } = await useAsyncData('config', () => api.getConfig())

watchEffect(() => {
  if (!data.value) return
  const cfg = data.value
  form.watchFolderPath = cfg.watchFolderPath
  form.deleteAfterSuccess = cfg.deleteAfterSuccess
  form.deleteAfterFailure = cfg.deleteAfterFailure
  form.maxFileSizeBytes = cfg.maxFileSizeBytes
  form.acceptedExtensions = cfg.acceptedExtensions
  form.pollIntervalMs = cfg.pollIntervalMs
  form.anonymizationOperator = cfg.anonymizationOperator
})

async function save() {
  saving.value = true
  try {
    await api.updateConfig({ ...form })
    toast.add({
      title: 'Configuration saved',
      icon: 'i-heroicons-check-circle',
      color: 'green',
    })
  } catch (e) {
    toast.add({
      title: 'Failed to save configuration',
      description: (e as Error).message,
      icon: 'i-heroicons-x-circle',
      color: 'red',
    })
  } finally {
    saving.value = false
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
</script>
