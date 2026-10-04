import {
  ACTIVE_PROCESS_STATUSES,
  getProcessPercent,
  getProcessStatusBadge,
  isActiveProcess,
} from '@src/utils/processStatus'

// Statuses as the media processor writes them to process_queue.
describe('isActiveProcess', () => {
  it('counts running and queued processes', () => {
    expect(ACTIVE_PROCESS_STATUSES).toEqual(['in-progress', 'queued'])
    expect(isActiveProcess({ status: 'in-progress' })).toBe(true)
    expect(isActiveProcess({ status: 'queued' })).toBe(true)
  })

  it('treats finished, failed and interrupted rows as history', () => {
    expect(isActiveProcess({ status: 'completed' })).toBe(false)
    expect(isActiveProcess({ status: 'error' })).toBe(false)
    expect(isActiveProcess({ status: 'interrupted' })).toBe(false)
    expect(isActiveProcess({})).toBe(false)
    expect(isActiveProcess(null)).toBe(false)
  })
})

describe('getProcessStatusBadge', () => {
  it('maps the processor statuses, not running/pending', () => {
    expect(getProcessStatusBadge('in-progress')).toEqual({ status: 'info', text: 'In progress' })
    expect(getProcessStatusBadge('queued')).toEqual({ status: 'warning', text: 'Queued' })
    expect(getProcessStatusBadge('completed')).toEqual({ status: 'success', text: 'Completed' })
    expect(getProcessStatusBadge('error')).toEqual({ status: 'error', text: 'Error' })
    expect(getProcessStatusBadge('interrupted')).toEqual({ status: 'neutral', text: 'Interrupted' })
  })

  it('shows an unknown status as itself', () => {
    expect(getProcessStatusBadge('paused')).toEqual({ status: 'neutral', text: 'paused' })
    expect(getProcessStatusBadge(undefined)).toEqual({ status: 'neutral', text: 'Unknown' })
  })
})

describe('getProcessPercent', () => {
  it('derives percent from the step counters', () => {
    // A library scan 64 titles in: "Futurama (65 of 230 shows)".
    expect(getProcessPercent({ current_step: 64, total_steps: 230 })).toBe(28)
    expect(getProcessPercent({ current_step: 230, total_steps: 230 })).toBe(100)
  })

  it('returns null when there are no steps to measure', () => {
    expect(getProcessPercent({ current_step: 0, total_steps: 0 })).toBeNull()
    expect(getProcessPercent({})).toBeNull()
  })

  it('clamps counters that run past the total', () => {
    expect(getProcessPercent({ current_step: 5, total_steps: 3 })).toBe(100)
  })
})

describe('getProcessTypeLabel', () => {
  it('says what each process type is for', () => {
    const { getProcessTypeLabel } = require('@src/utils/processStatus')
    expect(getProcessTypeLabel('library-scan')).toBe('Library scan')
    expect(getProcessTypeLabel('spritesheet')).toBe('Seek preview images')
    expect(getProcessTypeLabel('vtt')).toBe('Seek preview index')
    expect(getProcessTypeLabel('caption')).toBe('Auto captions')
    expect(getProcessTypeLabel('something-new')).toBe('something-new')
  })
})
