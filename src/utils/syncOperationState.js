export function createSyncOperationState() {
  let activeRun = null

  return {
    get() {
      return activeRun
    },

    begin(operation, { startTime, forced }) {
      activeRun = {
        operation,
        startTime,
        forced: Boolean(forced),
      }
      return activeRun
    },

    abandon() {
      activeRun = null
    },

    isCurrent(operation) {
      return activeRun?.operation === operation
    },

    clear(operation) {
      if (activeRun?.operation !== operation) return false
      activeRun = null
      return true
    },
  }
}
