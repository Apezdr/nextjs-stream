'use client'

import { useMemo, useState } from 'react'
import MediaToolbar from './MediaToolbar'
import MediaViewControls from './MediaViewControls'
import MediaCollectionView from './MediaCollectionView'
import {
  getDefaultVisibleColumns,
  getMediaColumnDefinitions,
  groupMediaItems,
} from './mediaBrowserConfig'

export default function MediaBrowser({ type, items, total, page, pageSize, q, sort, dir, servers, serverId, quality, year, video, hdr }) {
  const hasMultipleServers = servers.length > 1
  const columns = useMemo(
    () => getMediaColumnDefinitions(type, hasMultipleServers),
    [type, hasMultipleServers]
  )
  const [view, setView] = useState('list')
  const [gridSize, setGridSize] = useState(180)
  const [visibleColumns, setVisibleColumns] = useState(() => getDefaultVisibleColumns(columns))
  const [groupBy, setGroupBy] = useState('')
  const groups = useMemo(
    () => groupMediaItems(items, groupBy, servers),
    [items, groupBy, servers]
  )

  const toggleColumn = (columnId) => {
    setVisibleColumns(current => current.includes(columnId)
      ? current.filter(id => id !== columnId)
      : [...current, columnId])
  }

  return (
    <>
      <MediaToolbar
        type={type}
        total={total}
        page={page}
        pageSize={pageSize}
        q={q}
        sort={sort}
        servers={servers}
        serverId={serverId}
        quality={quality}
        year={year}
        video={video}
        hdr={hdr}
      />
      <MediaViewControls
        view={view}
        onViewChange={setView}
        gridSize={gridSize}
        onGridSizeChange={setGridSize}
        columns={columns}
        visibleColumns={visibleColumns}
        onToggleColumn={toggleColumn}
        hasMultipleServers={hasMultipleServers}
        groupBy={groupBy}
        onGroupByChange={setGroupBy}
        isPaginated={total > pageSize}
      />
      <div className="space-y-6">
        {groups.map(group => (
          <section key={group.key}>
            {group.label && (
              <h2 className="mb-2 text-sm font-semibold text-gray-700">
                {group.label}{' '}
                <span className="font-normal text-gray-500">
                  ({group.items.length}
                  {total > pageSize ? ' on this page' : ''})
                </span>
              </h2>
            )}
            <MediaCollectionView
              type={type}
              items={group.items}
              view={view}
              gridSize={gridSize}
              visibleColumns={visibleColumns}
              servers={servers}
              sort={sort}
              dir={dir}
            />
          </section>
        ))}
      </div>
    </>
  )
}