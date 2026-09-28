'use client'

import { Dialog, DialogBackdrop, DialogPanel, DialogTitle, Tab, TabGroup, TabList, TabPanel, TabPanels, Transition } from '@headlessui/react'
import { XMarkIcon } from '@heroicons/react/24/outline'
import HomeRowsByPerson from './HomeRowsByPerson'
import HomeRowsByPlaylist from './HomeRowsByPlaylist'

const TAB_CLASSES =
  'border-b-2 border-transparent px-0.5 pb-3 text-sm font-medium text-gray-300 hover:text-white focus:outline-none data-[selected]:border-indigo-400 data-[selected]:font-semibold data-[selected]:text-white data-[focus]:outline data-[focus]:outline-2 data-[focus]:outline-offset-2 data-[focus]:outline-indigo-400'

// An inactive panel stays mounted but hidden; `hidden` alone loses to a flex class
const panelClasses = ({ selected }) =>
  selected ? 'flex min-h-0 flex-1 flex-col focus:outline-none' : 'hidden'

/**
 * Admin: home screen rows for people. "By playlist" puts one playlist on (or
 * takes it off) many people's home screens; "By person" edits one person's
 * rows the way they see them. `playlists` is every playlist, as the watchlist
 * page lists them for an admin.
 */
export default function HomeRowsAdminDialog({ open, onClose, playlists }) {
  return (
    <Transition show={open}>
      <Dialog onClose={onClose} className="relative z-50">
        <DialogBackdrop transition className="fixed inset-0 bg-black/60 transition-opacity duration-200 data-[closed]:opacity-0" />
        <div className="fixed inset-0 flex items-stretch justify-center lg:items-center lg:p-6">
          <DialogPanel
            transition
            className="flex h-full w-full flex-col bg-gray-800 transition duration-200 data-[closed]:opacity-0 lg:h-[min(820px,92vh)] lg:max-w-6xl lg:rounded-xl lg:border lg:border-gray-700 lg:shadow-2xl"
          >
            <TabGroup className="flex min-h-0 flex-1 flex-col">
              <header className="flex flex-col gap-4 border-b border-gray-700 px-4 pt-[max(1rem,env(safe-area-inset-top))] lg:px-7 lg:pt-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <DialogTitle className="text-lg font-semibold text-white lg:text-xl">Home screen rows for people</DialogTitle>
                    <p className="mt-1 text-sm text-gray-300">
                      Admin tool. Put a playlist on people&apos;s home screens, or change one person&apos;s rows.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close"
                    className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-gray-300 hover:text-white lg:h-9 lg:w-9"
                  >
                    <XMarkIcon className="h-5 w-5" aria-hidden="true" />
                  </button>
                </div>
                <TabList className="flex gap-6">
                  <Tab className={TAB_CLASSES}>By playlist</Tab>
                  <Tab className={TAB_CLASSES}>By person</Tab>
                </TabList>
              </header>
              <TabPanels className="flex min-h-0 flex-1 flex-col">
                {/* Kept mounted, so switching tabs doesn't drop someone's unsaved rows */}
                <TabPanel unmount={false} className={panelClasses}>
                  <HomeRowsByPlaylist playlists={playlists} onClose={onClose} />
                </TabPanel>
                <TabPanel unmount={false} className={panelClasses}>
                  <HomeRowsByPerson onClose={onClose} />
                </TabPanel>
              </TabPanels>
            </TabGroup>
          </DialogPanel>
        </div>
      </Dialog>
    </Transition>
  )
}
