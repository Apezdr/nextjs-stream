'use client'

import { useState } from 'react'
import { buildURL } from '@src/utils'
import ListRecords from '../ListRecords'

export default function UserAdmin({ processedUserData }) {
  const [_processedUserData, setProcessedUserData] = useState(processedUserData)

  async function updateProcessedData() {
    const url = '/api/authenticated/admin/users'
    const res = await fetch(buildURL(url))
    const { processedUserData } = await res.json()
    setProcessedUserData(processedUserData)
  }

  return (
    <>
      <h1 className="block">User Management</h1>
      <div className="flex flex-col xl:flex-row w-full">
        <ListRecords
          title="Users"
          subtitle="Overview of all users"
          headers={_processedUserData.headers}
          data={_processedUserData.data}
          updateProcessedData={updateProcessedData}
        />
      </div>
    </>
  )
}
