'use client'

import { useMemo, useState } from 'react'
import { buildURL } from '@src/utils'
import UserListRecords from './UserListRecords'
import {
  UsersIcon,
  CheckBadgeIcon,
  NoSymbolIcon,
  ClockIcon,
} from '@heroicons/react/24/outline'

function StatCard({ label, value, icon: Icon, accent = 'blue' }) {
  const accents = {
    blue: 'bg-blue-500/15 text-blue-300',
    emerald: 'bg-emerald-500/15 text-emerald-300',
    rose: 'bg-rose-500/15 text-rose-300',
    amber: 'bg-amber-500/15 text-amber-300',
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-md">
      <div className="flex items-center gap-3">
        <div className={`rounded-xl p-2.5 ${accents[accent]}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-slate-400">{label}</p>
          <p className="text-2xl font-bold text-white">{value}</p>
        </div>
      </div>
    </div>
  )
}

export default function UserAdmin({ processedUserData }) {
  const [_processedUserData, setProcessedUserData] = useState(processedUserData)

  async function updateProcessedData() {
    const url = '/api/authenticated/admin/users'
    const res = await fetch(buildURL(url), { cache: 'no-store' })
    const { processedUserData } = await res.json()
    setProcessedUserData(processedUserData)
  }

  const stats = useMemo(() => {
    const users = _processedUserData?.data || []

    return {
      total: users.length,
      approved: users.filter((u) => u.approved === 'true').length,
      limited: users.filter((u) => u.limitedAccess === true).length,
      pending: users.filter((u) => u.approved !== 'true').length,
    }
  }, [_processedUserData])

  return (
    <section className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-slate-950/50 p-6 shadow-2xl shadow-blue-500/10 backdrop-blur-xl sm:p-8">
        <div className="flex flex-col gap-5">
          <div className="space-y-1.5">
            <p className="text-xs font-medium uppercase tracking-[0.25em] text-blue-200/70">
              Admin
            </p>
            <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              User Management
            </h1>
            <p className="max-w-xl text-sm text-slate-300/90">
              Review access, approve new users, and manage limited-access accounts from one place.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Total Users" value={stats.total} icon={UsersIcon} accent="blue" />
            <StatCard label="Approved" value={stats.approved} icon={CheckBadgeIcon} accent="emerald" />
            <StatCard label="Limited Access" value={stats.limited} icon={NoSymbolIcon} accent="rose" />
            <StatCard label="Pending" value={stats.pending} icon={ClockIcon} accent="amber" />
          </div>
        </div>
      </div>

      <UserListRecords
        title="Users"
        subtitle="Overview of all users"
        data={_processedUserData.data}
        updateProcessedData={updateProcessedData}
      />
    </section>
  )
}