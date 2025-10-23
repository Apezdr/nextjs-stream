/**
 * Event system for sync progress tracking and notifications
 * Provides a publish-subscribe mechanism for sync operations
 */

import { SyncEvent, SyncEventType, MediaType, SyncOperation } from './types'

export class SyncEventBus {
  private listeners: Map<string, Array<(event: SyncEvent) => void>> = new Map()
  private eventHistory: SyncEvent[] = []
  private readonly maxHistorySize: number = 1000

  /**
   * Subscribe to specific event types
   */
  subscribe(eventType: SyncEventType, callback: (event: SyncEvent) => void): () => void {
    const eventTypeStr = eventType.toString()
    
    if (!this.listeners.has(eventTypeStr)) {
      this.listeners.set(eventTypeStr, [])
    }
    
    this.listeners.get(eventTypeStr)!.push(callback)
    
    // Return unsubscribe function
    return () => {
      const callbacks = this.listeners.get(eventTypeStr)
      if (callbacks) {
        const index = callbacks.indexOf(callback)
        if (index > -1) {
          callbacks.splice(index, 1)
        }
      }
    }
  }

  /**
   * Subscribe to all events for a specific entity
   */
  subscribeToEntity(entityId: string, callback: (event: SyncEvent) => void): () => void {
    return this.subscribe(SyncEventType.Progress, (event) => {
      if (event.entityId === entityId) {
        callback(event)
      }
    })
  }

  /**
   * Emit an event to all subscribers
   */
  emit(event: SyncEvent): void {
    // Add to history
    this.eventHistory.push(event)
    
    // Trim history if it gets too large
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory = this.eventHistory.slice(-this.maxHistorySize)
    }

    // Notify subscribers
    const eventTypeStr = event.type.toString()
    const callbacks = this.listeners.get(eventTypeStr)
    
    if (callbacks) {
      callbacks.forEach(callback => {
        try {
          callback(event)
        } catch (error) {
          console.error('Error in sync event callback:', error)
        }
      })
    }
  }

  /**
   * Create and emit a progress event
   */
  emitProgress(
    entityId: string,
    mediaType: MediaType,
    serverId: string,
    operation?: SyncOperation,
    data?: any
  ): void {
    this.emit({
      type: SyncEventType.Progress,
      entityId,
      mediaType,
      operation,
      serverId,
      timestamp: new Date(),
      data
    })
  }

  /**
   * Create and emit an error event
   */
  emitError(
    entityId: string,
    mediaType: MediaType,
    serverId: string,
    error: string,
    operation?: SyncOperation
  ): void {
    this.emit({
      type: SyncEventType.Error,
      entityId,
      mediaType,
      operation,
      serverId,
      timestamp: new Date(),
      error
    })
  }

  /**
   * Create and emit a completion event
   */
  emitComplete(
    entityId: string,
    mediaType: MediaType,
    serverId: string,
    operation?: SyncOperation,
    data?: any
  ): void {
    this.emit({
      type: SyncEventType.Complete,
      entityId,
      mediaType,
      operation,
      serverId,
      timestamp: new Date(),
      data
    })
  }

  /**
   * Create and emit a started event
   */
  emitStarted(
    entityId: string,
    mediaType: MediaType,
    serverId: string,
    operation?: SyncOperation
  ): void {
    this.emit({
      type: SyncEventType.Started,
      entityId,
      mediaType,
      operation,
      serverId,
      timestamp: new Date()
    })
  }

  /**
   * Create and emit a warning event
   */
  emitWarning(
    entityId: string,
    mediaType: MediaType,
    serverId: string,
    warning: string,
    operation?: SyncOperation
  ): void {
    this.emit({
      type: SyncEventType.Warning,
      entityId,
      mediaType,
      operation,
      serverId,
      timestamp: new Date(),
      data: { warning }
    })
  }

  /**
   * Get recent events for debugging
   */
  getRecentEvents(limit: number = 100): SyncEvent[] {
    return this.eventHistory.slice(-limit)
  }

  /**
   * Get events for a specific entity
   */
  getEventsForEntity(entityId: string, limit: number = 50): SyncEvent[] {
    return this.eventHistory
      .filter(event => event.entityId === entityId)
      .slice(-limit)
  }

  /**
   * Clear event history
   */
  clearHistory(): void {
    this.eventHistory = []
  }

  /**
   * Get current listener count for debugging
   */
  getListenerCount(): Record<string, number> {
    const counts: Record<string, number> = {}
    this.listeners.forEach((callbacks, eventType) => {
      counts[eventType] = callbacks.length
    })
    return counts
  }
}

// Global event bus instance
export const syncEventBus = new SyncEventBus()

// Convenience functions for common event patterns
export const SyncEvents = {
  onProgress: (callback: (event: SyncEvent) => void) => 
    syncEventBus.subscribe(SyncEventType.Progress, callback),
    
  onError: (callback: (event: SyncEvent) => void) => 
    syncEventBus.subscribe(SyncEventType.Error, callback),
    
  onComplete: (callback: (event: SyncEvent) => void) => 
    syncEventBus.subscribe(SyncEventType.Complete, callback),

  forEntity: (entityId: string, callback: (event: SyncEvent) => void) =>
    syncEventBus.subscribeToEntity(entityId, callback),

  // Utility to track sync progress
  trackSync: (entityId: string, mediaType: MediaType, serverId: string) => {
    const events: SyncEvent[] = []
    
    const unsubscribe = syncEventBus.subscribeToEntity(entityId, (event) => {
      events.push(event)
    })

    return {
      events,
      unsubscribe,
      getProgress: () => events.filter(e => e.type === SyncEventType.Progress),
      getErrors: () => events.filter(e => e.type === SyncEventType.Error),
      isComplete: () => events.some(e => e.type === SyncEventType.Complete),
      hasErrors: () => events.some(e => e.type === SyncEventType.Error)
    }
  }
}