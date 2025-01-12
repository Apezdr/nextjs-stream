'use client'

import React, { useMemo } from 'react';
import { FixedSizeGrid as Grid } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import Link from 'next/link';
import RetryImage from '@components/RetryImage';
import { getFullImageUrl } from '@src/utils';

const VirtualizedCastGrid = ({ cast }) => {
  // Define item size
  const ITEM_WIDTH = 120; // Width of each cast item
  const ITEM_HEIGHT = 200; // Height of each cast item
  const GUTTER_SIZE = 16; // Space between items

  // Memoize cast items to prevent unnecessary re-renders
  const castItems = useMemo(() => Object.values(cast), [cast]);

  // Calculate number of columns based on container width
  const Cell = ({ columnIndex, rowIndex, style, columnCount }) => {
    const index = rowIndex * columnCount + columnIndex;
    if (index >= castItems.length) return null;

    const actor = castItems[index];

    return (
      <div
        style={{
          ...style,
          left: style.left + GUTTER_SIZE,
          top: style.top + GUTTER_SIZE,
          width: style.width - GUTTER_SIZE,
          height: style.height - GUTTER_SIZE,
        }}
        className="flex flex-col items-center"
      >
        <Link
          href={actor.id ? `https://www.themoviedb.org/person/${actor.id}` : '#'}
          target="_blank"
          className="flex flex-col items-center w-full transition-transform duration-200 transform hover:scale-105 hover:shadow-lg"
        >
          <div className="w-20 h-20 relative rounded-full overflow-hidden bg-gray-200">
            {actor.profile_path ? (
              <RetryImage
                src={getFullImageUrl(actor.profile_path)}
                alt={actor.name}
                layout="fill"
                objectFit="cover"
                className="rounded-full"
                quality={40}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-gray-500 select-none pointer-events-none">
                N/A
              </div>
            )}
          </div>
          <div className="mt-2 text-center text-sm font-medium text-gray-700">
            {actor.name}
          </div>
          {actor.character && (
            <div className="text-center text-xs text-gray-500">as {actor.character}</div>
          )}
        </Link>
      </div>
    );
  };

  return (
    <div className="w-full h-full">
      <AutoSizer>
        {({ height, width }) => {
          // Calculate number of columns based on available width
          const columnCount = Math.floor(width / (ITEM_WIDTH + GUTTER_SIZE));
          const rowCount = Math.ceil(castItems.length / columnCount);

          return (
            <Grid
              columnCount={columnCount}
              columnWidth={ITEM_WIDTH + GUTTER_SIZE}
              height={height}
              rowCount={rowCount}
              rowHeight={ITEM_HEIGHT + GUTTER_SIZE}
              width={width}
            >
              {({ columnIndex, rowIndex, style }) => (
                <Cell
                  columnIndex={columnIndex}
                  rowIndex={rowIndex}
                  style={style}
                  columnCount={columnCount}
                />
              )}
            </Grid>
          );
        }}
      </AutoSizer>
    </div>
  );
};

export default VirtualizedCastGrid;
