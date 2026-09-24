import { createSyncOperationState } from '@src/utils/syncOperationState'

describe('sync operation state', () => {
  it('does not let an abandoned operation clear a newer forced run', () => {
    const state = createSyncOperationState()
    const abandonedOperation = Promise.resolve('abandoned')
    const currentOperation = Promise.resolve('current')

    state.begin(abandonedOperation, {
      startTime: '2026-08-16T10:00:00.000Z',
      forced: false,
    })
    state.abandon()
    state.begin(currentOperation, {
      startTime: '2026-08-16T10:05:00.000Z',
      forced: true,
    })

    expect(state.clear(abandonedOperation)).toBe(false)
    expect(state.get()).toEqual({
      operation: currentOperation,
      startTime: '2026-08-16T10:05:00.000Z',
      forced: true,
    })

    expect(state.clear(currentOperation)).toBe(true)
    expect(state.get()).toBeNull()
  })

  it('normalizes forced metadata to a boolean', () => {
    const state = createSyncOperationState()
    const operation = Promise.resolve()

    state.begin(operation, {
      startTime: '2026-08-16T10:00:00.000Z',
      forced: 'yes',
    })

    expect(state.get().forced).toBe(true)
    expect(state.isCurrent(operation)).toBe(true)
  })
})
