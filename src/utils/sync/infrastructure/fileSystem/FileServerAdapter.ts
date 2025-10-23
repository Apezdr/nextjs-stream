/**
 * File server adapter for handling URL operations and file validation
 * Abstracts file server interactions for better testability and performance
 */

import { 
  FileServerAdapter, 
  AvailabilityResult, 
  FileMetadata, 
  FileEntry, 
  ServerConfig,
  NetworkError 
} from '../../core/types'

export class DefaultFileServerAdapter implements FileServerAdapter {
  private urlCache: Map<string, string> = new Map()
  private availabilityCache: Map<string, { result: boolean; timestamp: number }> = new Map()
  private readonly CACHE_TTL = 5 * 60 * 1000 // 5 minutes

  /**
   * Build full URL from path and server configuration
   */
  buildUrl(path: string, serverConfig: ServerConfig): string {
    if (!path || !serverConfig) {
      throw new NetworkError('Path and server config are required for URL building')
    }

    // Check cache first
    const cacheKey = `${serverConfig.id}:${path}`
    if (this.urlCache.has(cacheKey)) {
      return this.urlCache.get(cacheKey)!
    }

    let fullUrl: string

    try {
      // Handle already complete URLs
      if (path.startsWith('http://') || path.startsWith('https://')) {
        fullUrl = path
      } else {
        // Normalize path
        const normalizedPath = path.startsWith('/') ? path : `/${path}`
        
        // Build URL with server config
        const baseUrl = serverConfig.baseUrl.endsWith('/') 
          ? serverConfig.baseUrl.slice(0, -1) 
          : serverConfig.baseUrl

        const prefix = serverConfig.prefix 
          ? (serverConfig.prefix.startsWith('/') ? serverConfig.prefix : `/${serverConfig.prefix}`)
          : ''

        fullUrl = `${baseUrl}${prefix}${normalizedPath}`
      }

      // Cache the result
      this.urlCache.set(cacheKey, fullUrl)

      // Prevent cache from growing too large
      if (this.urlCache.size > 10000) {
        const firstKey = this.urlCache.keys().next().value
        this.urlCache.delete(firstKey)
      }

      return fullUrl
    } catch (error) {
      throw new NetworkError(`Failed to build URL for path ${path}: ${error}`)
    }
  }

  /**
   * Validate availability of multiple URLs with caching
   */
  async validateAvailability(urls: string[]): Promise<AvailabilityResult> {
    const available: string[] = []
    const unavailable: string[] = []
    const errors: Record<string, string> = {}
    const urlsToCheck: string[] = []

    const now = Date.now()

    // Check cache first
    for (const url of urls) {
      const cached = this.availabilityCache.get(url)
      if (cached && (now - cached.timestamp) < this.CACHE_TTL) {
        if (cached.result) {
          available.push(url)
        } else {
          unavailable.push(url)
        }
      } else {
        urlsToCheck.push(url)
      }
    }

    // Check uncached URLs in parallel
    if (urlsToCheck.length > 0) {
      const checks = urlsToCheck.map(async (url) => {
        try {
          const isAvailable = await this.checkSingleUrl(url)
          
          // Cache the result
          this.availabilityCache.set(url, { result: isAvailable, timestamp: now })
          
          return { url, available: isAvailable, error: null }
        } catch (error) {
          // Cache negative result
          this.availabilityCache.set(url, { result: false, timestamp: now })
          
          return { 
            url, 
            available: false, 
            error: error instanceof Error ? error.message : String(error)
          }
        }
      })

      const results = await Promise.allSettled(checks)

      results.forEach((result) => {
        if (result.status === 'fulfilled') {
          const { url, available: isAvailable, error } = result.value
          
          if (isAvailable) {
            available.push(url)
          } else {
            unavailable.push(url)
            if (error) {
              errors[url] = error
            }
          }
        } else {
          // Promise rejected - treat as unavailable
          const url = urlsToCheck[results.indexOf(result)]
          unavailable.push(url)
          errors[url] = result.reason?.message || 'Unknown error'
        }
      })
    }

    // Clean up cache periodically
    this.cleanupCache()

    return { available, unavailable, errors }
  }

  /**
   * Get file metadata for a specific path
   */
  async getMetadata(path: string, serverConfig: ServerConfig): Promise<FileMetadata> {
    try {
      const url = this.buildUrl(path, serverConfig)
      
      // Use HEAD request to get metadata without downloading content
      const response = await fetch(url, { 
        method: 'HEAD',
        signal: AbortSignal.timeout(serverConfig.timeout || 10000)
      })

      const exists = response.ok
      const size = exists ? parseInt(response.headers.get('content-length') || '0', 10) : 0
      const lastModified = exists && response.headers.get('last-modified') 
        ? new Date(response.headers.get('last-modified')!)
        : new Date()
      const contentType = exists ? response.headers.get('content-type') || 'application/octet-stream' : ''

      return {
        size,
        lastModified,
        contentType,
        exists
      }
    } catch (error) {
      throw new NetworkError(`Failed to get metadata for ${path}: ${error}`)
    }
  }

  /**
   * List files in a directory (if supported by server)
   */
  async listFiles(path: string, serverConfig: ServerConfig): Promise<FileEntry[]> {
    try {
      const url = this.buildUrl(path, serverConfig)
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        },
        signal: AbortSignal.timeout(serverConfig.timeout || 10000)
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const contentType = response.headers.get('content-type') || ''
      
      if (contentType.includes('application/json')) {
        // Assume JSON response with file listing
        const data = await response.json()
        return this.parseFileList(data)
      } else {
        // Cannot list files from this server
        return []
      }
    } catch (error) {
      throw new NetworkError(`Failed to list files for ${path}: ${error}`)
    }
  }

  /**
   * Check if a single URL is available
   */
  private async checkSingleUrl(url: string): Promise<boolean> {
    try {
      const response = await fetch(url, { 
        method: 'HEAD',
        signal: AbortSignal.timeout(5000) // Shorter timeout for availability checks
      })
      
      return response.ok
    } catch (error) {
      return false
    }
  }

  /**
   * Parse file list from server response
   */
  private parseFileList(data: any): FileEntry[] {
    if (!Array.isArray(data)) {
      return []
    }

    return data.map((item: any) => ({
      name: item.name || '',
      path: item.path || item.name || '',
      isDirectory: item.isDirectory || item.type === 'directory' || false,
      size: item.size || undefined,
      lastModified: item.lastModified ? new Date(item.lastModified) : undefined
    })).filter(entry => entry.name) // Filter out invalid entries
  }

  /**
   * Clean up old cache entries
   */
  private cleanupCache(): void {
    const now = Date.now()
    
    // Clean URL cache if it gets too large
    if (this.urlCache.size > 5000) {
      // Remove oldest 25% of entries
      const entries = Array.from(this.urlCache.entries())
      const toRemove = Math.floor(entries.length * 0.25)
      
      for (let i = 0; i < toRemove; i++) {
        this.urlCache.delete(entries[i][0])
      }
    }

    // Clean availability cache of expired entries
    for (const [url, cached] of this.availabilityCache.entries()) {
      if ((now - cached.timestamp) > this.CACHE_TTL) {
        this.availabilityCache.delete(url)
      }
    }
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.urlCache.clear()
    this.availabilityCache.clear()
  }

  /**
   * Get cache statistics for monitoring
   */
  getCacheStats(): {
    urlCacheSize: number
    availabilityCacheSize: number
    urlCacheHitRate?: number
    availabilityCacheHitRate?: number
  } {
    return {
      urlCacheSize: this.urlCache.size,
      availabilityCacheSize: this.availabilityCache.size
      // Hit rates would require tracking hits/misses over time
    }
  }
}