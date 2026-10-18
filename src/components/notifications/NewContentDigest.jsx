'use client';

import Image from 'next/image';
import Link from 'next/link';

/**
 * Whether a notification is a new-content digest that lists its titles
 * (the payload NewContentNotificationGenerator.createNewContentDigest writes).
 *
 * @param {Object} notification
 * @returns {boolean}
 */
export function isNewContentDigest(notification) {
  return notification?.subtype === 'new_content_digest' && Array.isArray(notification?.data?.items);
}

/**
 * The titles a new-content digest covers, each linking to its media page. The
 * list travels with the notification, so there is nothing to load: a poster
 * box stays grey until its image arrives, and a title without a poster keeps
 * the grey box with its initial.
 *
 * @param {Object} props
 * @param {Object} props.data - The digest's `data` (see createNewContentDigest)
 * @param {string} [props.id] - For the button that shows it (aria-controls)
 * @param {() => void} [props.onNavigate] - Called when a title is opened
 */
export default function NewContentDigest({ data, id, onNavigate }) {
  const items = Array.isArray(data?.items) ? data.items : [];
  const moreCount = Number.isInteger(data?.moreCount) ? data.moreCount : 0;

  return (
    <div id={id} className="mt-3" onClick={(e) => e.stopPropagation()}>
      <ul
        aria-label="Titles added"
        className="grid grid-cols-[repeat(auto-fill,minmax(5rem,1fr))] gap-3"
      >
        {items.map((item) => (
          <li key={`${item.kind}:${item.originalTitle}`}>
            <Link
              href={item.href}
              onClick={() => onNavigate?.()}
              className="group block rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <div className="relative aspect-[2/3] w-full overflow-hidden rounded-md bg-gray-200 dark:bg-gray-700">
                {item.posterURL ? (
                  <Image
                    src={item.posterURL}
                    alt=""
                    fill
                    sizes="96px"
                    className="object-cover transition-opacity group-hover:opacity-90"
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className="absolute inset-0 flex items-center justify-center text-lg font-semibold text-gray-500 dark:text-gray-400"
                  >
                    {String(item.title || '?').charAt(0)}
                  </span>
                )}
              </div>
              <p className="mt-1 truncate text-xs font-medium text-gray-900 dark:text-gray-100" title={item.title}>
                {item.title}
              </p>
              {item.kind === 'show' && item.newEpisodes > 0 && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {item.newEpisodes} new episode{item.newEpisodes === 1 ? '' : 's'}
                </p>
              )}
            </Link>
          </li>
        ))}
      </ul>
      {moreCount > 0 && (
        <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">+{moreCount} more</p>
      )}
    </div>
  );
}
