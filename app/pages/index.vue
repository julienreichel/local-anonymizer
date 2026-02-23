<template>
  <UContainer class="py-8">
    <div class="flex items-center justify-between mb-8">
      <h1 class="text-2xl font-bold">Local Anonymizer</h1>
      <UBadge color="green" variant="soft">Running</UBadge>
    </div>

    <div class="grid gap-6 md:grid-cols-2">
      <!-- Stats card -->
      <UCard>
        <template #header>
          <h2 class="text-lg font-semibold">Processing Summary</h2>
        </template>
        <dl class="grid grid-cols-2 gap-4">
          <div>
            <dt class="text-sm text-gray-500">Total processed</dt>
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
            <dt class="text-sm text-gray-500">Pending</dt>
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
          <UButton to="/logs" variant="outline" icon="i-heroicons-document-text">
            View Processing Logs
          </UButton>
          <UButton to="/config" variant="outline" icon="i-heroicons-cog-6-tooth">
            Configure Target
          </UButton>
        </div>
      </UCard>
    </div>

    <!-- Recent activity -->
    <UCard class="mt-6">
      <template #header>
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold">Recent Activity</h2>
          <UButton size="xs" variant="ghost" icon="i-heroicons-arrow-path" @click="refresh">
            Refresh
          </UButton>
        </div>
      </template>
      <UTable :rows="recentLogs" :columns="columns" :loading="pending">
        <template #status-data="{ row }">
          <UBadge :color="statusColor(row.status)" variant="soft" size="xs">
            {{ row.status }}
          </UBadge>
        </template>
        <template #empty-state>
          <div class="flex flex-col items-center justify-center py-8 text-gray-400">
            <UIcon name="i-heroicons-inbox" class="w-8 h-8 mb-2" />
            <p>No files processed yet. Drop a JSON chat log into the uploads folder.</p>
          </div>
        </template>
      </UTable>
    </UCard>
  </UContainer>
</template>

<script setup lang="ts">
const { apiBase } = useRuntimeConfig().public

interface LogEntry {
  id: string
  file_name_hash: string
  byte_size: number
  status: string
  created_at: string
}

const { data, pending, refresh } = await useFetch<{ success: boolean; data: LogEntry[] }>(
  `${apiBase}/api/logs`,
  { default: () => ({ success: true, data: [] }) },
)

const recentLogs = computed(() => data.value?.data?.slice(0, 10) ?? [])

const stats = computed(() => {
  const logs = data.value?.data ?? []
  return {
    total: logs.length,
    delivered: logs.filter((l) => l.status === 'delivered').length,
    failed: logs.filter((l) => l.status === 'failed').length,
    pending: logs.filter((l) => ['pending', 'processing', 'anonymized'].includes(l.status)).length,
  }
})

const columns = [
  { key: 'file_name_hash', label: 'File Hash' },
  { key: 'byte_size', label: 'Size (bytes)' },
  { key: 'status', label: 'Status' },
  { key: 'created_at', label: 'Created At' },
]

function statusColor(status: string) {
  const map: Record<string, string> = {
    delivered: 'green',
    failed: 'red',
    processing: 'blue',
    anonymized: 'purple',
    pending: 'yellow',
  }
  return map[status] ?? 'gray'
}
</script>
