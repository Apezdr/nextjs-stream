/**
 * The admin overview's Active Processes card
 * (src/components/Admin/Stats/EnhancedServerProcesses.js). It must count only
 * running and queued rows: old error and interrupted rows used to keep it
 * permanently "active", and library scans need their progress shown.
 */

import { render, screen } from '@testing-library/react'

const mockUseSWR = jest.fn()
jest.mock('swr', () => ({ __esModule: true, default: (...args) => mockUseSWR(...args) }))

jest.mock('@src/utils', () => ({
  buildURL: (url) => url,
  fetcher: jest.fn(),
  classNames: (...args) => args.flat().filter(Boolean).join(' '),
}))

jest.mock('@components/Admin/Stats/ServerProcessesModal', () => ({
  __esModule: true,
  default: () => null,
}))

const EnhancedServerProcesses = require('@components/Admin/Stats/EnhancedServerProcesses').default

const staleRows = [
  { id: 1, file_key: 'movie_a_spritesheet', process_type: 'spritesheet', status: 'error', message: 'ffmpeg exited 1', current_step: 3, total_steps: 3 },
  { id: 2, file_key: 'movie_b_vtt', process_type: 'vtt', status: 'interrupted', message: '', current_step: 1, total_steps: 2 },
  { id: 3, file_key: 'movie_c_caption', process_type: 'caption', status: 'completed', message: 'done', current_step: 1, total_steps: 1 },
]

const tvScan = {
  id: 4,
  file_key: 'library_scan_tv',
  process_type: 'library-scan',
  status: 'in-progress',
  message: 'Futurama (65 of 230 shows)',
  current_step: 64,
  total_steps: 230,
}

function swrStates({ processes }) {
  mockUseSWR.mockImplementation((key) =>
    String(key).includes('server-processes')
      ? { data: [{ server: 'default', processes }], error: undefined }
      : { data: { active: false }, error: undefined }
  )
}

beforeEach(() => {
  mockUseSWR.mockReset()
})

describe('EnhancedServerProcesses', () => {
  it('asks only for active rows', () => {
    swrStates({ processes: [] })
    render(<EnhancedServerProcesses />)
    const keys = mockUseSWR.mock.calls.map(([key]) => String(key))
    expect(keys).toContain('/api/authenticated/admin/server-processes?active=true')
  })

  it('is idle when only error, interrupted and completed rows exist', () => {
    // A processor that predates ?active=true returns every row.
    swrStates({ processes: staleRows })
    render(<EnhancedServerProcesses />)
    expect(screen.getByText('No active processes')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View history' })).toBeInTheDocument()
  })

  it('shows a running library scan with its title and progress', () => {
    swrStates({ processes: [...staleRows, tvScan] })
    render(<EnhancedServerProcesses />)

    expect(screen.getByText('1 active processes')).toBeInTheDocument()
    expect(screen.getByText('library-scan')).toBeInTheDocument()
    expect(screen.getByText('In progress')).toBeInTheDocument()
    expect(screen.getByText('Futurama (65 of 230 shows)')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '28')
    expect(screen.queryByText('spritesheet')).not.toBeInTheDocument()
    expect(screen.queryByText('ffmpeg exited 1')).not.toBeInTheDocument()
  })

  it('lists the first three of a long queue and counts the rest', () => {
    const sprites = Array.from({ length: 5 }, (_, i) => ({
      id: 10 + i,
      file_key: `movie_${i}_spritesheet`,
      process_type: 'spritesheet',
      status: 'queued',
      message: `Movie ${i}`,
      current_step: 0,
      total_steps: 3,
    }))
    swrStates({ processes: sprites })
    render(<EnhancedServerProcesses />)

    expect(screen.getByText('Movie 0')).toBeInTheDocument()
    expect(screen.getByText('Movie 2')).toBeInTheDocument()
    expect(screen.queryByText('Movie 3')).not.toBeInTheDocument()
    expect(screen.getByText('+2 more')).toBeInTheDocument()
  })
})
