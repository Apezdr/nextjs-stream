import { ArrowDownIcon, ArrowUpIcon } from '@heroicons/react/20/solid'
import React from 'react'

const ServerStatus = ({ _serverStatus }) => {
  return _serverStatus?.ok ? null : (
    <div className="absolute bottom-0 left-0 right-0 p-4 text-xs text-gray-400 bg-gray-900">
      <span className="font-semibold">Database status:</span>{' '}
      {_serverStatus?.db?.statusText === 'Down' || !_serverStatus?.db ? (
        <ArrowDownIcon className='text-red-700 h-4 inline-block' />
      ) : (
        <ArrowUpIcon className='text-green-700 h-4 inline-block' />
      )}
    </div>
  )
}

export default ServerStatus
