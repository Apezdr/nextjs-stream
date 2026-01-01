'use client'

import { MaterialButton, StatusBadge } from './BaseComponents'
import { classNames } from '@src/utils'

/**
 * Compact User Management component designed to fit in sidebar space
 */
const CompactUserManagement = ({ 
  headers, 
  data, 
  updateProcessedData,
  onViewAll
}) => {
  // Take only first 3 users for compact view
  const compactData = data?.slice(0, 3) || []
  const totalUsers = data?.length || 0

  if (!data || data.length === 0) {
    return (
      <div className="text-center py-8">
        <div className="text-gray-400 mb-2">
          <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
          </svg>
        </div>
        <p className="text-gray-500 text-sm">No users found</p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Summary Stats */}
      <div className="mb-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-2xl font-bold text-blue-900">{totalUsers}</div>
            <div className="text-sm text-blue-700">Total Users</div>
          </div>
          <div className="text-blue-600">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </div>
        </div>
      </div>

      {/* User List */}
      <div className="flex-1 space-y-2 overflow-y-auto">
        {compactData.map((user, index) => (
          <UserCard key={index} user={user} headers={headers} />
        ))}
      </div>

      {/* View All Button */}
      {totalUsers > 5 && (
        <div className="mt-4 pt-3 border-t border-gray-200">
          <MaterialButton
            variant="outlined"
            color="primary"
            size="small"
            className="w-full"
            onClick={onViewAll}
          >
            View All {totalUsers} Users
          </MaterialButton>
        </div>
      )}
    </div>
  )
}

/**
 * Individual User Card
 */
const UserCard = ({ user, headers }) => {
  // Extract key information from user object properties
  const getName = () => {
    return user.name || user.displayName || user.username || 'Unknown User'
  }

  const getEmail = () => {
    return user.email || user.emailAddress || 'No email'
  }

  const getRole = () => {
    return user.role || user.userRole || user.type || 'User'
  }

  const getStatus = () => {
    if (user.approved === 'true' || user.approved === true) return 'active'
    if (user.approved === 'false' || user.approved === false) return 'unapproved'
    if (user.limitedAccess === true) return 'limited'
    return 'active'
  }

  const name = getName()
  const email = getEmail()
  const role = getRole()
  const status = getStatus()

  const getStatusColor = (status) => {
    switch (status.toLowerCase()) {
      case 'active': return 'success'
      case 'inactive': case 'disabled': return 'error'
      case 'unapproved': return 'warning'
      default: return 'neutral'
    }
  }

  return (
    <div className="bg-gray-50 rounded-lg p-3 border border-gray-200 hover:bg-gray-100 transition-colors duration-200">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
              <span className="text-sm font-medium text-blue-600">
                {name.charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-gray-900 text-sm truncate">
                {name}
              </div>
              <div className="text-xs text-gray-500 truncate">
                {email}
              </div>
            </div>
          </div>
          
          <div className="flex items-center justify-between mt-2">
            <span className="text-xs text-gray-600 bg-gray-200 px-2 py-1 rounded">
              {role}
            </span>
            <StatusBadge
              status={getStatusColor(status)}
              size="small"
              variant="soft"
            >
              {status}
            </StatusBadge>
          </div>
        </div>
      </div>
    </div>
  )
}

export default CompactUserManagement