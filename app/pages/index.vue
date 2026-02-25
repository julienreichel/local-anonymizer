<template>
  <UContainer class="py-8">
    <div class="flex items-center justify-between mb-8">
      <h1 class="text-2xl font-bold">Local Anonymizer</h1>
      <div class="flex items-center gap-2">
        <UBadge :color="apiStatusColor" variant="soft">
          {{ healthData?.status === 'ok' ? 'Running' : 'Unreachable' }}
        </UBadge>
        <UButton size="xs" variant="ghost" icon="i-heroicons-arrow-path" :loading="healthPending" @click="refreshAll">
          Refresh
        </UButton>
      </div>
    </div>

    <!-- System Status -->
    <UCard class="mb-6">
      <template #header>
        <h2 class="text-lg font-semibold">System Status</h2>
      </template>
      <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div class="flex flex-col items-center gap-1">
          <UIcon :name="serviceIcon('ok')" class="w-6 h-6 text-green-500" />
          <span class="text-xs font-medium">API</span>
          <UBadge color="green" variant="soft" size="xs">ok</UBadge>
        </div>
        <div class="flex flex-col items-center gap-1">
          <UIcon :name="serviceIcon(healthData?.services?.worker ?? 'unknown')" class="w-6 h-6" :class="serviceIconColor(healthData?.services?.worker ?? 'unknown')" />
          <span class="text-xs font-medium">Worker</span>
          <UBadge :color="serviceColor(healthData?.services?.worker ?? 'unknown')" variant="soft" size="xs">
            {{ healthData?.services?.worker ?? 'unknown' }}
          </UBadge>
        </div>
        <div class="flex flex-col items-center gap-1">
          <UIcon :name="serviceIcon(healthData?.services?.presidioAnalyzer ?? 'unknown')" class="w-6 h-6" :class="serviceIconColor(healthData?.services?.presidioAnalyzer ?? 'unknown')" />
          <span class="text-xs font-medium">Presidio Analyzer</span>
          <UBadge :color="serviceColor(healthData?.services?.presidioAnalyzer ?? 'unknown')" variant="soft" size="xs">
            {{ healthData?.services?.presidioAnalyzer ?? 'unknown' }}
          </UBadge>
        </div>
        <div class="flex flex-col items-center gap-1">
          <UIcon :name="serviceIcon(healthData?.services?.presidioAnonymizer ?? 'unknown')" class="w-6 h-6" :class="serviceIconColor(healthData?.services?.presidioAnonymizer ?? 'unknown')" />
          <span class="text-xs font-medium">Presidio Anonymizer</span>
          <UBadge :color="serviceColor(healthData?.services?.presidioAnonymizer ?? 'unknown')" variant="soft" size="xs">
            {{ healthData?.services?.presidioAnonymizer ?? 'unknown' }}
          </UBadge>
        </div>
      </div>
    </UCard>

    <div class="grid gap-6 md:grid-cols-2 mb-6">
      <!-- Stats card -->
      <UCard>
        <template #header>
          <h2 class="text-lg font-semibold">Processing Summary</h2>
        </template>
        <dl class="grid grid-cols-2 gap-4">
          <div>
            <dt class="text-sm text-gray-500">Total runs</dt>
            <dd class="text-2xl font-bold">{{ stats.total }}</dd>
          </div>
          <div>
            <dt class="text-sm text-gray-500">Delivered</dt>
            <dd class="text-2xl font-bold text-green-600">{{ stats.delivered }}</dd>
          </div>
          <div>
            <dt class="text-sm text-gray-500">Failed</dt>
            <dd class="text-2xl font-bold text-red-600">{{ stats.failed }}</dd>
          </div>
          <div>
            <dt class="text-sm text-gray-500">In progress</dt>
            <dd class="text-2xl font-bold text-yellow-600">{{ stats.pending }}</dd>
          </div>
        </dl>
      </UCard>

      <!-- Navigation card -->
      <UCard>
        <template #header>
          <h2 class="text-lg font-semibold">Quick Links</h2>
        </template>
        <div class="flex flex-col gap-3">
          <UButton to="/runs" variant="outline" icon="i-heroicons-list-bullet">
            View Runs
          </UButton>
          <UButton to="/targets" variant="outline" icon="i-heroicons-arrow-up-tray">
            Manage Targets
          </UButton>
          <UButton to="/config" variant="outline" icon="i-heroicons-cog-6-tooth">
            Configuration
          </UButton>
        </div>
      </UCard>
    </div>

    <!-- Recent runs -->
    <UCard>
      <template #header>
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold">Recent Runs</h2>
          <UButton size="xs" variant="ghost" icon="i-heroicons-arrow-path" @click="refreshAll">
            Refresh
          </UButton>
        </div>
      </template>
      <UTable :rows="recentRuns" :columns="columns" :loading="runsPending">
        <template #sourceFileName-data="{ row }">
          <span class="font-mono text-sm text-gray-500">{{ shortHash(row.sourceFileName) }}</span>
        </template>
        <template #status-data="{ row }">
          <UBadge :color="statusColor(row.status)" variant="soft" size="xs">
            {{ row.status }}
          </UBadge>
        </template>
        <template #durationMs-data="{ row }">
          <span class="text-sm text-gray-500">{{ row.durationMs != null ? `${row.durationMs} ms` : '–' }}</span>
        </template>
        <template #createdAt-data="{ row }">
          <span class="text-sm text-gray-500">{{ formatDate(row.createdAt) }}</span>
        </template>
        <template #actions-data="{ row }">
          <UButton size="xs" variant="ghost" icon="i-heroicons-eye" :to="`/runs?id=${row.id}`">
            Details
          </UButton>
        </template>
        <template #empty-state>
          <div class="flex flex-col items-center justify-center py-8 text-gray-400">
            <UIcon name="i-heroicons-inbox" class="w-8 h-8 mb-2" />
            <p>No runs yet. Drop a JSON chat log into the uploads folder.</p>
          </div>
        </template>
      </UTable>
    </UCard>
  </UContainer>
</template>

<script setup lang="ts">
const api = useApi()

// Health check
const { data: rawHealth, pending: healthPending, refresh: refreshHealth } = await useLazyAsyncData(
  'health',
  () => api.getHealth(),
  { default: () => null },
)
const healthData = computed(() => rawHealth.value)
const apiStatusColor = computed<'green' | 'red'>(() => (healthData.value?.status === 'ok' ? 'green' : 'red'))

// Runs list
const { data: rawRuns, pending: runsPending, refresh: refreshRuns } = await useLazyAsyncData(
  'dashboard-runs',
  () => api.getRuns({ limit: 10 }),
  { default: () => [] },
)

const recentRuns = computed(() => rawRuns.value ?? [])

const { data: rawStats, refresh: refreshStats } = await useLazyAsyncData(
  'dashboard-run-stats',
  () => api.getRunStats(),
  { default: () => ({ total: 0, delivered: 0, failed: 0, pending: 0 }) },
)

const stats = computed(() => {
  return rawStats.value ?? { total: 0, delivered: 0, failed: 0, pending: 0 }
})

const columns = [
  { key: 'sourceFileName', label: 'File Hash' },
  { key: 'status', label: 'Status' },
  { key: 'durationMs', label: 'Duration' },
  { key: 'createdAt', label: 'Created At' },
  { key: 'actions', label: '' },
]

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

type ServiceStatus = 'ok' | 'error' | 'unknown'

function serviceIcon(status: string) {
  if (status === 'ok') return 'i-heroicons-check-circle'
  if (status === 'error') return 'i-heroicons-x-circle'
  return 'i-heroicons-question-mark-circle'
}

function serviceIconColor(status: string) {
  if (status === 'ok') return 'text-green-500'
  if (status === 'error') return 'text-red-500'
  return 'text-gray-400'
}

function serviceColor(status: string): 'green' | 'red' | 'gray' {
  if (status === 'ok') return 'green'
  if (status === 'error') return 'red'
  return 'gray'
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString()
}

function shortHash(value: string): string {
  if (!value.startsWith('sha256:')) return value
  const prefix = 'sha256:'
  const hash = value.slice(prefix.length)
  if (hash.length <= 12) return value
  return `${prefix}${hash.slice(0, 4)}...${hash.slice(-4)}`
}

async function refreshAll() {
  await Promise.all([refreshHealth(), refreshRuns(), refreshStats()])
}

onMounted(() => {
  void refreshAll()
})
</script>
