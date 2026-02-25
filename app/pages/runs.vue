<template>
  <UContainer class="py-8">
    <div class="flex items-center gap-3 mb-6">
      <UButton to="/" variant="ghost" icon="i-heroicons-arrow-left" size="sm" />
      <h1 class="text-2xl font-bold">Processing Runs</h1>
      <div class="ml-auto flex items-center gap-2">
        <UButton size="sm" variant="ghost" icon="i-heroicons-arrow-path" :loading="pending" @click="refresh">
          Refresh
        </UButton>
      </div>
    </div>

    <!-- Filters -->
    <UCard class="mb-4">
      <div class="flex flex-wrap gap-3 items-end">
        <UFormGroup label="Status" class="w-40">
          <USelect v-model="filterStatus" :options="statusOptions" />
        </UFormGroup>
        <UFormGroup label="File hash search" class="flex-1 min-w-40">
          <UInput v-model="filterQuery" placeholder="Search by file hash…" icon="i-heroicons-magnifying-glass" />
        </UFormGroup>
        <UButton variant="ghost" icon="i-heroicons-x-mark" @click="clearFilters">
          Clear
        </UButton>
      </div>
    </UCard>

    <!-- Table -->
    <UCard>
      <UTable :rows="runs" :columns="columns" :loading="pending" @select="openDetail">
        <template #status-data="{ row }">
          <UBadge :color="statusColor(row.status)" variant="soft" size="xs">
            {{ row.status }}
          </UBadge>
        </template>
        <template #sourceFileSize-data="{ row }">
          <span class="text-sm text-gray-500">{{ formatBytes(row.sourceFileSize) }}</span>
        </template>
        <template #durationMs-data="{ row }">
          <span class="text-sm text-gray-500">{{ row.durationMs != null ? `${row.durationMs} ms` : '–' }}</span>
        </template>
        <template #deliveryStatusCode-data="{ row }">
          <UBadge v-if="deliverySummary(row)" :color="deliverySummaryColor(row)" variant="soft" size="xs">
            {{ deliverySummary(row) }}
          </UBadge>
          <span v-else class="text-gray-400 text-sm">–</span>
        </template>
        <template #createdAt-data="{ row }">
          <span class="text-sm text-gray-500">{{ formatDate(row.createdAt) }}</span>
        </template>
        <template #actions-data="{ row }">
          <UButton size="xs" variant="ghost" icon="i-heroicons-eye" @click.stop="openDetail(row)">
            Details
          </UButton>
        </template>
        <template #empty-state>
          <div class="flex flex-col items-center justify-center py-10 text-gray-400">
            <UIcon name="i-heroicons-inbox" class="w-10 h-10 mb-3" />
            <p>No runs match the current filters.</p>
          </div>
        </template>
      </UTable>
    </UCard>

    <!-- Run detail modal -->
    <UModal v-model="showDetail" :ui="{ width: 'max-w-2xl' }">
      <UCard v-if="selectedRun">
        <template #header>
          <div class="flex items-start justify-between gap-2">
            <div>
              <h3 class="text-lg font-semibold">Run Details</h3>
              <p class="text-xs font-mono text-gray-400 mt-0.5">{{ selectedRun.id }}</p>
            </div>
            <UBadge :color="statusColor(selectedRun.status)" variant="soft">{{ selectedRun.status }}</UBadge>
          </div>
        </template>

        <!-- Safe diagnostics (copy-friendly) -->
        <div class="mb-4 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <div class="flex items-center justify-between mb-1">
            <p class="text-xs font-medium text-gray-500 uppercase tracking-wide">Safe Diagnostics</p>
            <UButton size="xs" variant="ghost" icon="i-heroicons-clipboard-document" @click="copyDiagnostics">
              Copy
            </UButton>
          </div>
          <pre class="text-xs overflow-x-auto whitespace-pre-wrap break-all">{{ diagnosticsText }}</pre>
        </div>

        <!-- Stats grid -->
        <dl class="grid grid-cols-2 gap-3 mb-4 text-sm">
          <div>
            <dt class="text-gray-500 text-xs">File hash</dt>
            <dd class="font-mono truncate">{{ selectedRun.sourceFileName }}</dd>
          </div>
          <div>
            <dt class="text-gray-500 text-xs">File size</dt>
            <dd>{{ formatBytes(selectedRun.sourceFileSize) }}</dd>
          </div>
          <div>
            <dt class="text-gray-500 text-xs">Duration</dt>
            <dd>{{ selectedRun.durationMs != null ? `${selectedRun.durationMs} ms` : '–' }}</dd>
          </div>
          <div>
            <dt class="text-gray-500 text-xs">Delivery</dt>
            <dd>
              <UBadge v-if="deliverySummary(selectedRun)" :color="deliverySummaryColor(selectedRun)" variant="soft" size="xs">
                {{ deliverySummary(selectedRun) }}
              </UBadge>
              <span v-else class="text-gray-400">–</span>
            </dd>
          </div>
          <div v-if="selectedRun.errorCode">
            <dt class="text-gray-500 text-xs">Error code</dt>
            <dd class="text-red-500 font-mono">{{ selectedRun.errorCode }}</dd>
          </div>
          <div v-if="selectedRun.errorMessageSafe">
            <dt class="text-gray-500 text-xs">Error message</dt>
            <dd class="text-red-500">{{ selectedRun.errorMessageSafe }}</dd>
          </div>
        </dl>

        <!-- Presidio stats -->
        <div v-if="selectedRun.presidioStats && Object.keys(selectedRun.presidioStats).length" class="mb-4">
          <p class="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Presidio Entity Stats</p>
          <div class="flex flex-wrap gap-2">
            <UBadge
              v-for="(count, entity) in selectedRun.presidioStats"
              :key="entity"
              color="purple"
              variant="soft"
              size="xs"
            >
              {{ entity }}: {{ count }}
            </UBadge>
          </div>
        </div>

        <!-- Audit timeline -->
        <div>
          <p class="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Audit Timeline</p>
          <div v-if="logsLoading" class="flex justify-center py-4">
            <UIcon name="i-heroicons-arrow-path" class="w-5 h-5 animate-spin text-gray-400" />
          </div>
          <ol v-else class="relative border-l border-gray-200 dark:border-gray-700 ml-3">
            <li
              v-for="event in auditLogs"
              :key="event.id"
              class="mb-4 ml-4"
            >
              <div
                class="absolute w-3 h-3 rounded-full mt-1 -left-1.5 border border-white"
                :class="eventDotColor(event.level)"
              />
              <p class="text-xs text-gray-400">{{ formatDate(event.timestamp) }}</p>
              <p class="text-sm font-medium">{{ formatEventType(event.eventType) }}</p>
              <div v-if="event.meta && Object.keys(event.meta).length" class="mt-1">
                <pre class="text-xs text-gray-500 bg-gray-50 dark:bg-gray-800 rounded px-2 py-1 overflow-x-auto">{{ JSON.stringify(event.meta, null, 2) }}</pre>
              </div>
            </li>
            <li v-if="!auditLogs.length" class="ml-4 text-sm text-gray-400">No audit events found.</li>
          </ol>
        </div>

        <template #footer>
          <div class="flex justify-end">
            <UButton variant="ghost" @click="showDetail = false">Close</UButton>
          </div>
        </template>
      </UCard>
    </UModal>
  </UContainer>
</template>

<script setup lang="ts">
import type { ProcessingRun } from '~/composables/useApi'

const api = useApi()
const route = useRoute()
const toast = useToast()

// Filters
const filterStatus = ref('')
const filterQuery = ref('')

const statusOptions = [
  { label: 'All statuses', value: '' },
  { label: 'Queued', value: 'queued' },
  { label: 'Processing', value: 'processing' },
  { label: 'Anonymized', value: 'anonymized' },
  { label: 'Delivered', value: 'delivered' },
  { label: 'Failed', value: 'failed' },
  { label: 'Deleted', value: 'deleted' },
]

const columns = [
  { key: 'sourceFileName', label: 'File Hash' },
  { key: 'sourceFileSize', label: 'Size' },
  { key: 'status', label: 'Status' },
  { key: 'durationMs', label: 'Duration' },
  { key: 'deliveryStatusCode', label: 'Delivery' },
  { key: 'createdAt', label: 'Created At' },
  { key: 'actions', label: '' },
]

const { data: runsData, pending, refresh } = await useLazyAsyncData(
  'runs',
  () =>
    api.getRuns({
      status: filterStatus.value || undefined,
      q: filterQuery.value || undefined,
      limit: 100,
    }),
  { default: () => [] as Awaited<ReturnType<typeof api.getRuns>>, watch: [filterStatus, filterQuery] },
)
const runs = computed(() => runsData.value ?? [])

function clearFilters() {
  filterStatus.value = ''
  filterQuery.value = ''
}

// Detail modal
const showDetail = ref(false)
const selectedRun = ref<ProcessingRun | null>(null)
const auditLogs = ref<Awaited<ReturnType<typeof api.getLogs>>>([])
const logsLoading = ref(false)

async function openDetail(run: ProcessingRun) {
  selectedRun.value = run
  showDetail.value = true
  logsLoading.value = true
  try {
    auditLogs.value = await api.getLogs({ runId: run.id })
  } catch {
    auditLogs.value = []
  } finally {
    logsLoading.value = false
  }
}

// If ?id= is in the URL, open that run automatically
onMounted(async () => {
  await refresh()
  const id = route.query.id as string | undefined
  if (id) {
    try {
      const run = await api.getRun(id)
      await openDetail(run)
    } catch {
      // ignore
    }
  }
})

// Safe diagnostics
const diagnosticsText = computed(() => {
  if (!selectedRun.value) return ''
  return JSON.stringify(
    {
      runId: selectedRun.value.id,
      status: selectedRun.value.status,
      createdAt: selectedRun.value.createdAt,
      updatedAt: selectedRun.value.updatedAt,
      sourceFileName: selectedRun.value.sourceFileName,
      errorCode: selectedRun.value.errorCode,
      deliveryTargetCount: selectedRun.value.deliveryTargetCount,
      deliverySuccessCount: selectedRun.value.deliverySuccessCount,
      deliveryFailureCount: selectedRun.value.deliveryFailureCount,
      deliveryStatusCode: selectedRun.value.deliveryStatusCode,
      durationMs: selectedRun.value.durationMs,
    },
    null,
    2,
  )
})

async function copyDiagnostics() {
  try {
    await navigator.clipboard.writeText(diagnosticsText.value)
    toast.add({ title: 'Diagnostics copied to clipboard', color: 'green', icon: 'i-heroicons-check-circle' })
  } catch {
    toast.add({ title: 'Failed to copy', color: 'red', icon: 'i-heroicons-x-circle' })
  }
}

// Helpers
function statusColor(status: string): 'green' | 'red' | 'blue' | 'purple' | 'yellow' | 'gray' {
  const map: Record<string, 'green' | 'red' | 'blue' | 'purple' | 'yellow' | 'gray'> = {
    delivered: 'green',
    failed: 'red',
    processing: 'blue',
    anonymized: 'purple',
    queued: 'yellow',
    deleted: 'gray',
  }
  return map[status] ?? 'gray'
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString()
}

function formatEventType(type: string) {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function deliveryColor(code: number): 'green' | 'red' {
  return code < 400 ? 'green' : 'red'
}

function deliverySummary(run: ProcessingRun): string {
  const targetCount = run.deliveryTargetCount ?? 0
  const successCount = run.deliverySuccessCount ?? 0
  const failureCount = run.deliveryFailureCount ?? 0
  if (targetCount > 1) {
    return `${successCount}/${targetCount} targets`
  }
  if (targetCount === 1 && run.deliveryStatusCode) {
    return `HTTP ${run.deliveryStatusCode}`
  }
  if (targetCount === 1 && failureCount > 0) {
    return '0/1 targets'
  }
  if (targetCount > 0) {
    return `${successCount}/${targetCount} targets`
  }
  if (run.deliveryStatusCode) {
    return `HTTP ${run.deliveryStatusCode}`
  }
  return ''
}

function deliverySummaryColor(run: ProcessingRun): 'green' | 'red' | 'yellow' {
  const targetCount = run.deliveryTargetCount ?? 0
  const failureCount = run.deliveryFailureCount ?? 0
  if (failureCount > 0) return 'red'
  if (targetCount > 1 && (run.deliverySuccessCount ?? 0) < targetCount) return 'yellow'
  if (run.deliveryStatusCode !== undefined) return deliveryColor(run.deliveryStatusCode)
  return 'green'
}

function eventDotColor(level: string) {
  if (level === 'error') return 'bg-red-500'
  if (level === 'warn') return 'bg-yellow-500'
  return 'bg-green-500'
}
</script>
