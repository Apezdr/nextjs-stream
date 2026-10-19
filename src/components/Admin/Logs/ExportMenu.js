'use client'

import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { ArrowDownTrayIcon, ChevronDownIcon, ClipboardDocumentIcon } from '@heroicons/react/20/solid'
import { toast } from 'react-toastify'
import { downloadFile, exportFileName, toJson, toMarkdown, toText } from './logExport'

/**
 * Copy or download the lines the page shows. `context` names the server and
 * the filters, for the Markdown heading and the JSON file.
 */
export default function ExportMenu({ entries, context }) {
  const count = `${entries.length.toLocaleString()} ${entries.length === 1 ? 'line' : 'lines'}`

  async function copy(content, format) {
    try {
      await navigator.clipboard.writeText(content)
      toast.success(`Copied ${count} as ${format}`)
    } catch (error) {
      toast.error(`Couldn't copy the log: ${error.message}`)
    }
  }

  const items = [
    { label: 'Copy as text', icon: ClipboardDocumentIcon, run: () => copy(toText(entries), 'text') },
    { label: 'Copy as Markdown', icon: ClipboardDocumentIcon, run: () => copy(toMarkdown(entries, context), 'Markdown') },
    {
      label: 'Download .log',
      icon: ArrowDownTrayIcon,
      run: () => downloadFile(exportFileName(context.serverId, 'log'), toText(entries), 'text/plain'),
    },
    {
      label: 'Download .json',
      icon: ArrowDownTrayIcon,
      run: () => downloadFile(exportFileName(context.serverId, 'json'), toJson(entries, context), 'application/json'),
    },
  ]

  return (
    <Menu as="div" className="relative">
      <MenuButton
        disabled={entries.length === 0}
        className="inline-flex items-center gap-1 rounded-md bg-white px-3 py-1.5 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 disabled:opacity-50"
      >
        Export
        <ChevronDownIcon className="h-4 w-4 text-gray-400" aria-hidden="true" />
      </MenuButton>
      <MenuItems
        anchor="bottom end"
        className="z-20 w-56 rounded-md bg-white py-1 text-sm shadow-lg ring-1 ring-black/10 [--anchor-gap:4px] focus:outline-none"
      >
        <p className="px-3 py-1.5 text-xs text-gray-500">The {count} shown, with the filters</p>
        {items.map(({ label, icon: Icon, run }) => (
          <MenuItem key={label}>
            <button type="button" onClick={run} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-gray-700 data-[focus]:bg-gray-100">
              <Icon className="h-4 w-4 text-gray-400" aria-hidden="true" />
              {label}
            </button>
          </MenuItem>
        ))}
      </MenuItems>
    </Menu>
  )
}
