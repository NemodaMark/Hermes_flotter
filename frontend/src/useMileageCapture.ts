import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Tenant } from './api'
import { mileageApi, mileageMonth } from './mileageApi'

export function useMileageCapture(tenant: Tenant, userId: string, date: string, enabled = true) {
  const month = mileageMonth(date)
  const allowed = enabled && (tenant.permissions.includes('mileage.record') || tenant.permissions.includes('mileage.manage'))
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date)
  const report = useQuery({ queryKey: ['mileage', tenant.id, userId, month], queryFn: ({ signal }) => mileageApi.read(tenant.id, userId, month, signal), enabled: allowed && validDate, retry: false })
  const [drafts, setDrafts] = useState<Record<string, { include: boolean; total: string; personal: string }>>({})
  const { include, total, personal } = drafts[month] ?? { include: true, total: '', personal: '0' }
  const change = (value: Partial<{ include: boolean; total: string; personal: string }>) => setDrafts(previous => ({ ...previous, [month]: { include, total, personal, ...value } }))
  const setInclude = (include: boolean) => change({ include })
  const setTotal = (total: string) => change({ total })
  const setPersonal = (personal: string) => change({ personal })
  const active = allowed && include && report.data?.mode === 'Entries' && !report.data.submittedAt
  return { allowed, report, include, setInclude, total, setTotal, personal, setPersonal, month, active,
    ready: !allowed || (validDate && report.isSuccess),
    usage: () => active ? { month, totalKm: Number(total), privateKm: Number(personal) } : null,
  }
}

