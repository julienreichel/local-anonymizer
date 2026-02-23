<template>
  <UContainer class="py-8">
    <div class="flex items-center gap-3 mb-6">
      <UButton to="/" variant="ghost" icon="i-heroicons-arrow-left" size="sm" />
      <h1 class="text-2xl font-bold">Processing Logs</h1>
    </div>

    <UCard>
      <UTable :rows="logs" :columns="columns" :loading="pending">
        <template #status-data="{ row }">
          <UBadge :color="statusColor(row.status)" variant="soft" size="xs">
            {{ row.status }}
          </UBadge>
        </template>
        <template #error_message-data="{ row }">
          <span class="text-red-500 text-xs">{{ row.error_message ?? '–' }}</span>
        </template>
        <template #empty-state>
          <div class="flex flex-col items-center justify-center py-8 text-gray-400">
            <UIcon name="i-heroicons-inbox" class="w-8 h-8 mb-2" />
            <p>No log entries yet.</p>
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
  error_message?: string
  created_at: string
  updated_at: string
}

const { data, pending } = await useFetch<{ success: boolean; data: LogEntry[] }>(
  `${apiBase}/api/logs`,
  { default: () => ({ success: true, data: [] }) },
)

const logs = computed(() => data.value?.data ?? [])

const columns = [
  { key: 'file_name_hash', label: 'File Hash' },
  { key: 'byte_size', label: 'Size (bytes)' },
  { key: 'status', label: 'Status' },
  { key: 'error_message', label: 'Error' },
  { key: 'created_at', label: 'Created At' },
  { key: 'updated_at', label: 'Updated At' },
]

function statusColor(status: string): 'green' | 'red' | 'blue' | 'purple' | 'yellow' | 'gray' {
  const map: Record<string, 'green' | 'red' | 'blue' | 'purple' | 'yellow' | 'gray'> = {
    delivered: 'green',
    failed: 'red',
    processing: 'blue',
    anonymized: 'purple',
    pending: 'yellow',
  }
  return map[status] ?? 'gray'
}
</script>
