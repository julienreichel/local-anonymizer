<template>
  <UContainer class="py-8">
    <div class="flex items-center gap-3 mb-6">
      <UButton to="/" variant="ghost" icon="i-heroicons-arrow-left" size="sm" />
      <h1 class="text-2xl font-bold">Delivery Targets</h1>
      <div class="ml-auto">
        <UButton icon="i-heroicons-plus" @click="openCreateModal">
          New Target
        </UButton>
      </div>
    </div>

    <!-- Targets list -->
    <div class="flex flex-col gap-4">
      <div v-if="pending" class="flex justify-center py-8">
        <UIcon name="i-heroicons-arrow-path" class="w-6 h-6 animate-spin text-gray-400" />
      </div>

      <div v-else-if="targets.length === 0" class="text-center py-12 text-gray-400">
        <UIcon name="i-heroicons-arrow-up-tray" class="w-10 h-10 mb-3 mx-auto" />
        <p>No delivery targets configured yet.</p>
        <UButton class="mt-4" variant="outline" icon="i-heroicons-plus" @click="openCreateModal">
          Add your first target
        </UButton>
      </div>

      <UCard v-for="target in targets" :key="target.id" class="relative">
        <div class="flex items-start justify-between gap-4">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1">
              <h3 class="font-semibold truncate">{{ target.name }}</h3>
              <UBadge :color="target.enabled ? 'green' : 'gray'" variant="soft" size="xs">
                {{ target.enabled ? 'enabled' : 'disabled' }}
              </UBadge>
              <UBadge color="blue" variant="subtle" size="xs">{{ target.method }}</UBadge>
            </div>
            <p class="text-sm text-gray-500 truncate font-mono">{{ target.url }}</p>
            <p class="text-xs text-gray-400 mt-1">
              Auth: {{ target.auth.type }} · Timeout: {{ target.timeoutMs }}ms · Retries: {{ target.retries }}
            </p>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <UTooltip :text="testResults[target.id]?.label ?? 'Send test request'">
              <UButton
                size="xs"
                variant="outline"
                icon="i-heroicons-signal"
                :loading="testing[target.id]"
                :color="testResults[target.id]?.color ?? 'gray'"
                @click="testTarget(target.id)"
              >
                Test
              </UButton>
            </UTooltip>
            <UButton size="xs" variant="ghost" icon="i-heroicons-pencil" @click="openEditModal(target)" />
            <UButton size="xs" variant="ghost" color="red" icon="i-heroicons-trash" @click="confirmDelete(target)" />
          </div>
        </div>
        <!-- Test result badge -->
        <div v-if="testResults[target.id]" class="mt-2">
          <UBadge :color="testResults[target.id]!.color" variant="soft" size="xs">
            {{ testResults[target.id]!.label }}
          </UBadge>
        </div>
      </UCard>
    </div>

    <!-- Test upload -->
    <UCard class="mt-6">
      <template #header>
        <h2 class="text-lg font-semibold">Test File Upload</h2>
      </template>
      <div
        class="rounded-lg border-2 border-dashed p-6 text-center transition-colors"
        :class="uploadHover ? 'border-blue-500 bg-blue-50/40 dark:bg-blue-900/10' : 'border-gray-300 dark:border-gray-700'"
        @dragenter.prevent="uploadHover = true"
        @dragover.prevent="uploadHover = true"
        @dragleave.prevent="uploadHover = false"
        @drop.prevent="onDropFile"
      >
        <UIcon name="i-heroicons-arrow-up-tray" class="w-8 h-8 mx-auto mb-2 text-blue-500" />
        <p class="text-sm">Drag and drop a <code>.json</code> file here</p>
        <p class="text-xs text-gray-500 mt-1">The worker will process it as if added to the watch folder.</p>
        <input
          ref="fileInput"
          type="file"
          accept=".json,application/json"
          class="hidden"
          @change="onFileInputChange"
        />
        <div class="mt-3">
          <UButton size="sm" variant="outline" :loading="uploading" @click="fileInput?.click()">
            Select file
          </UButton>
        </div>
      </div>
    </UCard>

    <!-- Create / Edit Modal -->
    <UModal v-model="showModal" :ui="{ width: 'max-w-xl' }">
      <UCard>
        <template #header>
          <h3 class="text-lg font-semibold">{{ editingTarget ? 'Edit Target' : 'New Target' }}</h3>
        </template>

        <UForm :state="modalForm" @submit="saveTarget" class="flex flex-col gap-4">
          <UFormGroup label="Name" name="name" required>
            <UInput v-model="modalForm.name" placeholder="My Webhook" />
          </UFormGroup>

          <UFormGroup label="URL" name="url" required>
            <UInput v-model="modalForm.url" placeholder="https://example.com/webhook" />
          </UFormGroup>

          <div class="grid grid-cols-2 gap-4">
            <UFormGroup label="Method" name="method">
              <USelect v-model="modalForm.method" :options="['POST', 'GET']" />
            </UFormGroup>
            <UFormGroup label="Timeout (ms)" name="timeoutMs">
              <UInput v-model.number="modalForm.timeoutMs" type="number" min="1000" />
            </UFormGroup>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <UFormGroup label="Retries" name="retries">
              <UInput v-model.number="modalForm.retries" type="number" min="0" max="10" />
            </UFormGroup>
            <UFormGroup label="Backoff (ms)" name="backoffMs">
              <UInput v-model.number="modalForm.backoffMs" type="number" min="0" />
            </UFormGroup>
          </div>

          <UFormGroup label="Auth type" name="authType">
            <USelect v-model="modalForm.authType" :options="authTypeOptions" />
          </UFormGroup>

          <template v-if="modalForm.authType === 'bearerToken'">
            <UFormGroup label="Bearer token" name="bearerToken">
              <UInput v-model="modalForm.bearerToken" type="password" placeholder="eyJ..." />
            </UFormGroup>
          </template>
          <template v-else-if="modalForm.authType === 'apiKeyHeader'">
            <div class="grid grid-cols-2 gap-4">
              <UFormGroup label="Header name" name="apiKeyHeader">
                <UInput v-model="modalForm.apiKeyHeader" placeholder="X-Api-Key" />
              </UFormGroup>
              <UFormGroup label="Key value" name="apiKeyValue">
                <UInput v-model="modalForm.apiKeyValue" type="password" placeholder="secret" />
              </UFormGroup>
            </div>
          </template>
          <template v-else-if="modalForm.authType === 'basic'">
            <div class="grid grid-cols-2 gap-4">
              <UFormGroup label="Username" name="basicUser">
                <UInput v-model="modalForm.basicUser" />
              </UFormGroup>
              <UFormGroup label="Password" name="basicPass">
                <UInput v-model="modalForm.basicPass" type="password" />
              </UFormGroup>
            </div>
          </template>

          <div class="flex items-center gap-2">
            <UToggle v-model="modalForm.enabled" />
            <span class="text-sm">Enabled</span>
          </div>

          <div class="flex gap-2 justify-end pt-2">
            <UButton variant="ghost" @click="showModal = false">Cancel</UButton>
            <UButton type="submit" :loading="saving">
              {{ editingTarget ? 'Update' : 'Create' }}
            </UButton>
          </div>
        </UForm>
      </UCard>
    </UModal>

    <!-- Delete confirmation modal -->
    <UModal v-model="showDeleteModal">
      <UCard>
        <template #header>
          <h3 class="text-lg font-semibold">Delete Target</h3>
        </template>
        <p class="text-sm text-gray-600">
          Are you sure you want to delete <strong>{{ deletingTarget?.name }}</strong>? This action cannot be undone.
        </p>
        <template #footer>
          <div class="flex gap-2 justify-end">
            <UButton variant="ghost" @click="showDeleteModal = false">Cancel</UButton>
            <UButton color="red" :loading="deleting" @click="deleteTarget">Delete</UButton>
          </div>
        </template>
      </UCard>
    </UModal>
  </UContainer>
</template>

<script setup lang="ts">
import type { DeliveryTarget } from '~/composables/useApi'

const api = useApi()
const toast = useToast()

const { data: targetsData, pending, refresh } = await useLazyAsyncData('targets', () => api.getTargets(), {
  default: () => [],
})
const targets = computed(() => targetsData.value ?? [])

// Test target
const testing = reactive<Record<string, boolean>>({})
const testResults = reactive<Record<string, { label: string; color: 'green' | 'red' | 'gray' }>>({})

async function testTarget(id: string) {
  testing[id] = true
  delete testResults[id]
  try {
    const result = await api.testTarget(id)
    const detail = (!result.ok && result.responsePreview) ? ` · ${result.responsePreview}` : ''
    const statusText = result.statusText ? ` ${result.statusText}` : ''
    const baseLabel = `HTTP ${result.statusCode}${statusText} – ${result.ok ? 'OK' : 'Error'}${detail}`
    testResults[id] = {
      label: baseLabel.length > 140 ? `${baseLabel.slice(0, 137)}...` : baseLabel,
      color: result.ok ? 'green' : 'red',
    }
  } catch (e) {
    const raw = (e as Error).message ?? 'Connection failed'
    const compact = raw.replace(/\s+/g, ' ').trim()
    testResults[id] = {
      label: compact.length > 140 ? `${compact.slice(0, 137)}...` : compact,
      color: 'red',
    }
  } finally {
    testing[id] = false
  }
}

// Modal state
const showModal = ref(false)
const editingTarget = ref<DeliveryTarget | null>(null)
const saving = ref(false)
const uploading = ref(false)
const uploadHover = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

const authTypeOptions = [
  { label: 'No auth', value: 'none' },
  { label: 'Bearer token', value: 'bearerToken' },
  { label: 'API key header', value: 'apiKeyHeader' },
  { label: 'Basic auth', value: 'basic' },
]

function defaultModalForm() {
  return {
    name: '',
    url: '',
    method: 'POST' as 'GET' | 'POST',
    timeoutMs: 15000,
    retries: 0,
    backoffMs: 1000,
    enabled: true,
    authType: 'none' as 'none' | 'bearerToken' | 'apiKeyHeader' | 'basic',
    bearerToken: '',
    apiKeyHeader: '',
    apiKeyValue: '',
    basicUser: '',
    basicPass: '',
  }
}

const modalForm = reactive(defaultModalForm())

function openCreateModal() {
  editingTarget.value = null
  Object.assign(modalForm, defaultModalForm())
  showModal.value = true
}

function openEditModal(target: DeliveryTarget) {
  editingTarget.value = target
  modalForm.name = target.name
  modalForm.url = target.url
  modalForm.method = target.method
  modalForm.timeoutMs = target.timeoutMs
  modalForm.retries = target.retries
  modalForm.backoffMs = target.backoffMs
  modalForm.enabled = target.enabled
  modalForm.authType = target.auth.type as typeof modalForm.authType
  if (target.auth.type === 'bearerToken') modalForm.bearerToken = target.auth.token
  if (target.auth.type === 'apiKeyHeader') {
    modalForm.apiKeyHeader = target.auth.header
    modalForm.apiKeyValue = target.auth.key
  }
  if (target.auth.type === 'basic') {
    modalForm.basicUser = target.auth.username
    modalForm.basicPass = target.auth.password
  }
  showModal.value = true
}

function buildAuth(): DeliveryTarget['auth'] {
  if (modalForm.authType === 'bearerToken') return { type: 'bearerToken', token: modalForm.bearerToken }
  if (modalForm.authType === 'apiKeyHeader')
    return { type: 'apiKeyHeader', header: modalForm.apiKeyHeader, key: modalForm.apiKeyValue }
  if (modalForm.authType === 'basic')
    return { type: 'basic', username: modalForm.basicUser, password: modalForm.basicPass }
  return { type: 'none' }
}

async function saveTarget() {
  saving.value = true
  try {
    const body = {
      name: modalForm.name,
      url: modalForm.url,
      method: modalForm.method,
      timeoutMs: modalForm.timeoutMs,
      retries: modalForm.retries,
      backoffMs: modalForm.backoffMs,
      enabled: modalForm.enabled,
      headers: {},
      auth: buildAuth(),
    }
    if (editingTarget.value) {
      await api.updateTarget(editingTarget.value.id, body)
      toast.add({ title: 'Target updated', color: 'green', icon: 'i-heroicons-check-circle' })
    } else {
      await api.createTarget(body)
      toast.add({ title: 'Target created', color: 'green', icon: 'i-heroicons-check-circle' })
    }
    showModal.value = false
    await refresh()
  } catch (e) {
    toast.add({
      title: 'Failed to save target',
      description: (e as Error).message,
      color: 'red',
      icon: 'i-heroicons-x-circle',
    })
  } finally {
    saving.value = false
  }
}

// Delete
const showDeleteModal = ref(false)
const deletingTarget = ref<DeliveryTarget | null>(null)
const deleting = ref(false)

function confirmDelete(target: DeliveryTarget) {
  deletingTarget.value = target
  showDeleteModal.value = true
}

async function deleteTarget() {
  if (!deletingTarget.value) return
  deleting.value = true
  try {
    await api.deleteTarget(deletingTarget.value.id)
    toast.add({ title: 'Target deleted', color: 'green', icon: 'i-heroicons-check-circle' })
    showDeleteModal.value = false
    await refresh()
  } catch (e) {
    toast.add({
      title: 'Failed to delete target',
      description: (e as Error).message,
      color: 'red',
      icon: 'i-heroicons-x-circle',
    })
  } finally {
    deleting.value = false
  }
}

async function uploadFile(file: File) {
  if (!file.name.toLowerCase().endsWith('.json')) {
    toast.add({
      title: 'Invalid file type',
      description: 'Only .json files are accepted.',
      color: 'red',
      icon: 'i-heroicons-x-circle',
    })
    return
  }

  uploading.value = true
  try {
    const content = await file.text()
    const result = await api.uploadFile({ fileName: file.name, content })
    if (result.queued) {
      toast.add({
        title: 'File uploaded',
        description: `${file.name} was queued for processing.`,
        color: 'green',
        icon: 'i-heroicons-check-circle',
      })
    } else if (result.reason === 'already_delivered') {
      toast.add({
        title: 'Duplicate content',
        description: `${file.name} was already delivered before (${result.sourceFileName}).`,
        color: 'gray',
        icon: 'i-heroicons-information-circle',
      })
    } else if (result.reason === 'already_queued') {
      toast.add({
        title: 'Already queued',
        description: `${file.name} is already waiting to be processed (${result.sourceFileName}).`,
        color: 'blue',
        icon: 'i-heroicons-clock',
      })
    }
  } catch (e) {
    toast.add({
      title: 'Upload failed',
      description: (e as Error).message,
      color: 'red',
      icon: 'i-heroicons-x-circle',
    })
  } finally {
    uploading.value = false
  }
}

async function onDropFile(event: DragEvent) {
  uploadHover.value = false
  const file = event.dataTransfer?.files?.[0]
  if (!file) return
  await uploadFile(file)
}

async function onFileInputChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  await uploadFile(file)
  input.value = ''
}

onMounted(() => {
  void refresh()
})
</script>
