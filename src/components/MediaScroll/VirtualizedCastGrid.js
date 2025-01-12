'use client'

import React, { useMemo, useCallback } from 'react'
import { FixedSizeGrid as Grid } from 'react-window'
import AutoSizer from 'react-virtualized-auto-sizer'
import CastGridCell from './CastGridCell'

const VirtualizedCastGrid = ({ cast }) => {
  if (!cast) return null

  const ITEM_WIDTH = 120
  const ITEM_HEIGHT = 200
  const GUTTER_SIZE = 8

  const castItems = useMemo(() => Object.values(cast), [cast])

  // Instead of managing loading state globally, we'll pass the handlers
  // and let each cell manage its own loading state
  const handleImageLoad = useCallback((actorId) => {
    // Individual cells will handle their own loading state
  }, [])

  const handleImageError = useCallback((actorId) => {
    // Individual cells will handle their own loading state
  }, [])

  return (
    <div className="w-full h-full">
      <AutoSizer>
        {({ height, width }) => {
          const columnCount = Math.floor(width / (ITEM_WIDTH + GUTTER_SIZE)) || 1
          const rowCount = Math.ceil(castItems.length / columnCount)

          return (
            <Grid
              columnCount={columnCount}
              columnWidth={ITEM_WIDTH + GUTTER_SIZE}
              height={431}
              rowCount={rowCount}
              rowHeight={ITEM_HEIGHT + GUTTER_SIZE}
              width={width}
            >
              {({ columnIndex, rowIndex, style }) => (
                <CastGridCell
                  columnIndex={columnIndex}
                  rowIndex={rowIndex}
                  style={style}
                  columnCount={columnCount}
                  castItems={castItems}
                  handleImageLoad={handleImageLoad}
                  handleImageError={handleImageError}
                />
              )}
            </Grid>
          )
        }}
      </AutoSizer>
    </div>
  )
}

export default VirtualizedCastGrid
