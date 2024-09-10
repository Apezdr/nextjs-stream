'use client'
import { CheckIcon, XCircleIcon } from '@heroicons/react/24/outline'
import { classNames } from '../../utils'
import {
  updateUserApprovedFlag,
  updateUserLimitedAccessFlag,
} from '@src/utils/admin_frontend_database'
import { memo, useState } from 'react'

function ListRecords({
  title,
  subtitle,
  headers,
  data,
  onAddClick,
  onEditClick,
  onDeleteClick,
  updateProcessedData,
}) {
  // State to track loading status
  const [loadingStates, setLoadingStates] = useState(data ? data.map(() => false) : [])

  // Function to handle approve/reject with loading indicator
  const handleActionClick = async (index, userID, approved) => {
    setLoadingStates((prev) => prev.map((loading, i) => (i === index ? true : loading)))
    await updateUserApprovedFlag({ userID, approved })
    await updateProcessedData('users')
    setLoadingStates((prev) => prev.map((loading, i) => (i === index ? false : loading)))
  }
  // Function to handle Limited Access with loading indicator
  const handleLimitedAccessClick = async (index, userID, limitedAccess) => {
    setLoadingStates((prev) => prev.map((loading, i) => (i === index ? true : loading)))
    await updateUserLimitedAccessFlag({ userID, limitedAccess })
    await updateProcessedData('users')
    setLoadingStates((prev) => prev.map((loading, i) => (i === index ? false : loading)))
  }
  return (
    <div>
      <div className="sm:flex sm:items-center">
        <div className="sm:flex-auto">
          <h1 className="text-base font-semibold leading-6 text-gray-200">{title}</h1>
          <p className="mt-2 text-sm text-gray-300">{subtitle}</p>
        </div>
        {onAddClick && (
          <div className="mt-4 sm:ml-16 sm:mt-0 sm:flex-none">
            <button
              type="button"
              className="block rounded-md bg-indigo-600 px-3 py-2 text-center text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
              onClick={onAddClick}
            >
              Add New
            </button>
          </div>
        )}
      </div>
      <div className="flow-root">
        <div className="-mx-4 -my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
          <div className="inline-block min-w-full py-2 align-middle sm:px-6 lg:px-8 w-[95vw] md:w-auto">
            <table className="min-w-full divide-y divide-gray-300">
              <thead>
                <tr key={`${title}-header`}>
                  {headers &&
                    headers.map((header) => (
                      <th
                        key={header}
                        scope="col"
                        className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-white sm:pl-2"
                      >
                        {header}
                      </th>
                    ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {data &&
                  data.map((item, index) => (
                    <tr
                      key={item.id}
                      className={classNames(item.imageUrl ? 'h-32' : '', 'even:bg-blue-600')}
                    >
                      {Object.entries(item).map(([key, value], valueIndex) => {
                        if (key === 'limitedAccess') {
                          // Cell for limited access
                          return (
                            <td
                              key={key + value + item.id}
                              className="py-4 pl-4 pr-3 text-sm font-medium text-gray-300 bg-gray-600 whitespace-nowrap"
                            >
                              <div className="flex flex-col">
                                <div className="self-center">
                                  {value === true ? (
                                    <CheckIcon
                                      className="text-green-500 h-12 w-12"
                                      aria-hidden="true"
                                    />
                                  ) : (
                                    <XCircleIcon
                                      className="text-red-500 h-12 w-12"
                                      aria-hidden="true"
                                    />
                                  )}
                                </div>
                                <div className="h-4">
                                  <div className="text-center cursor-pointer bg-blue-600 rounded-xl px-2">
                                    {loadingStates[index] ? (
                                      <div>Loading...</div> // Your loading overlay here
                                    ) : (
                                      <div>
                                        <button
                                          className="text-green-600"
                                          onClick={() =>
                                            handleLimitedAccessClick(index, item.id, false)
                                          }
                                        >
                                          Lift Limit
                                        </button>
                                        /
                                        <button
                                          className="text-red-300"
                                          onClick={() =>
                                            handleLimitedAccessClick(index, item.id, true)
                                          }
                                        >
                                          Limit Account
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </td>
                          )
                        } else if (
                          (key === 'posterURL' && value) ||
                          (key === 'imageUrl' && value)
                        ) {
                          // Cell for poster image
                          return (
                            <td
                              key={key + value + item.id}
                              style={{
                                backgroundImage: `url(${value
                                  .replaceAll(' ', '%20')
                                  .replaceAll('(', '%28')
                                  .replaceAll(')', '%29')
                                  .replaceAll("'", '%27')
                                  .replaceAll('"', '%22')})`,
                                backgroundSize: 'cover',
                              }}
                              className={classNames(
                                key === 'posterURL' ? 'h-40 min-w-[100px] bg-center' : '',
                                key === 'imageUrl' ? 'min-w-[120px]' : '',
                                'whitespace-nowrap py-4 pl-4 pr-3 sm:pl-2'
                              )}
                            />
                          )
                        } else if (key === 'approved') {
                          return (
                            <>
                              <td
                                key={key + value + item.id}
                                className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-blue-100 sm:pl-2 flex flex-col"
                              >
                                {value === 'true' ? (
                                  <CheckIcon key={`check-${value}`} className="text-green-600" />
                                ) : (
                                  <XCircleIcon key={`reject-${value}`} className="text-red-600" />
                                )}
                              </td>
                              <td
                                key={value + '-actions'}
                                className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-blue-100 sm:pl-2 bg-gray-800"
                              >
                                {loadingStates[index] ? (
                                  <div>Loading...</div> // Your loading overlay here
                                ) : (
                                  <div>
                                    <button
                                      className="text-green-600"
                                      onClick={() => handleActionClick(index, item.id, true)}
                                    >
                                      Approve
                                    </button>
                                    /
                                    <button
                                      className="text-red-300"
                                      onClick={() => handleActionClick(index, item.id, false)}
                                    >
                                      Reject
                                    </button>
                                  </div>
                                )}
                              </td>
                            </>
                          )
                        } else if (key !== 'id') {
                          // Regular text cell
                          return (
                            <td
                              key={key + value + item.id}
                              className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-blue-100 sm:pl-2 truncate max-w-xs"
                              title={value}
                            >
                              {value}
                            </td>
                          )
                        }
                        return null
                      })}
                      {onEditClick && (
                        <td key={`${item.id}-Edit`} className="py-4 pl-4 pr-3 text-sm font-medium">
                          <button
                            type="button"
                            className="text-orange-300 hover:text-orange-400"
                            onClick={() => onEditClick(item.id, index)}
                          >
                            Edit
                          </button>
                        </td>
                      )}
                      {onDeleteClick && (
                        <td
                          key={`${item.id}-Delete`}
                          className="py-4 pl-4 pr-3 text-sm font-medium sm:pl-0"
                        >
                          <button
                            type="button"
                            className="text-red-500 hover:text-red-600"
                            onClick={() => onDeleteClick(item.id, index)}
                          >
                            Delete
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

export default memo(ListRecords)
