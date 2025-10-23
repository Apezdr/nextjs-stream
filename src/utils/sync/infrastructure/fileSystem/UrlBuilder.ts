/**
 * Specialized URL builder with advanced path handling and optimization
 * Extracted from the traditional sync utilities for better organization
 */

import { ServerConfig, NetworkError } from '../../core/types'

export class UrlBuilder {
  private static urlCache: Map<string, string> = new Map()
  private static readonly MAX_CACHE_SIZE = 10000

  /**
   * Create full URL from path and server configuration
   * Optimized version of the traditional createFullUrl function
   */
  static createFullUrl(path: string, serverConfig: ServerConfig): string {
    if (!path || !serverConfig) {
      throw new NetworkError('Path and server config are required')
    }

    // Generate cache key
    const cacheKey = `${serverConfig.id}:${path}`
    
    // Check cache first
    if (this.urlCache.has(cacheKey)) {
      return this.urlCache.get(cacheKey)!
    }

    let fullUrl: string

    try {
      // Handle already complete URLs
      if (this.isCompleteUrl(path)) {
        fullUrl = path
      } else {
        fullUrl = this.buildUrl(path, serverConfig)
      }

      // Cache the result
      this.cacheUrl(cacheKey, fullUrl)

      return fullUrl
    } catch (error) {
      throw new NetworkError(`Failed to create URL for path ${path}: ${error}`)
    }
  }

  /**
   * Build URL from components
   */
  private static buildUrl(path: string, serverConfig: ServerConfig): string {
    // Normalize base URL
    const baseUrl = this.normalizeBaseUrl(serverConfig.baseUrl)
    
    // Handle prefix
    const prefix = this.normalizePrefix(serverConfig.prefix)
    
    // Normalize path
    const normalizedPath = this.normalizePath(path)
    
    return `${baseUrl}${prefix}${normalizedPath}`
  }

  /**
   * Normalize base URL
   */
  private static normalizeBaseUrl(baseUrl: string): string {
    if (!baseUrl) {
      throw new NetworkError('Base URL is required')
    }

    // Remove trailing slash
    return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
  }

  /**
   * Normalize prefix path
   */
  private static normalizePrefix(prefix?: string): string {
    if (!prefix) {
      return ''
    }

    // Ensure prefix starts with / but doesn't end with /
    let normalizedPrefix = prefix.startsWith('/') ? prefix : `/${prefix}`
    return normalizedPrefix.endsWith('/') ? normalizedPrefix.slice(0, -1) : normalizedPrefix
  }

  /**
   * Normalize file path
   */
  private static normalizePath(path: string): string {
    if (!path) {
      return ''
    }

    // Ensure path starts with /
    return path.startsWith('/') ? path : `/${path}`
  }

  /**
   * Check if path is already a complete URL
   */
  private static isCompleteUrl(path: string): boolean {
    return path.startsWith('http://') || path.startsWith('https://')
  }

  /**
   * Cache URL with size management
   */
  private static cacheUrl(key: string, url: string): void {
    // Manage cache size
    if (this.urlCache.size >= this.MAX_CACHE_SIZE) {
      // Remove oldest entry (first in Map)
      const firstKey = this.urlCache.keys().next().value
      if (firstKey) {
        this.urlCache.delete(firstKey)
      }
    }

    this.urlCache.set(key, url)
  }

  /**
   * Process caption URLs with server configuration
   * Migrated from traditional sync utilities
   */
  static processCaptionURLs(subtitlesData: Record<string, any> | any[], serverConfig: ServerConfig): Record<string, any> | any[] {
    if (!subtitlesData || typeof subtitlesData !== 'object') {
      return subtitlesData
    }

    const processedData = { ...subtitlesData }

    // Handle different subtitle data formats
    if (Array.isArray(subtitlesData)) {
      return subtitlesData.map(subtitle => ({
        ...subtitle,
        url: subtitle.url ? this.createFullUrl(subtitle.url, serverConfig) : subtitle.url
      }))
    }

    // Handle object with subtitle properties
    Object.keys(processedData).forEach(key => {
      const subtitle = processedData[key]
      if (subtitle && typeof subtitle === 'object' && subtitle.url) {
        processedData[key] = {
          ...subtitle,
          url: this.createFullUrl(subtitle.url, serverConfig)
        }
      }
    })

    return processedData
  }

  /**
   * Build multiple URLs efficiently
   */
  static createMultipleUrls(paths: string[], serverConfig: ServerConfig): string[] {
    return paths.map(path => this.createFullUrl(path, serverConfig))
  }

  /**
   * Extract server ID from URL if possible
   */
  static extractServerId(url: string, serverConfigs: ServerConfig[]): string | null {
    if (!this.isCompleteUrl(url)) {
      return null
    }

    try {
      const urlObj = new URL(url)
      
      // Find matching server by hostname and port
      for (const config of serverConfigs) {
        const configUrl = new URL(config.baseUrl)
        if (configUrl.hostname === urlObj.hostname && configUrl.port === urlObj.port) {
          return config.id
        }
      }
    } catch (error) {
      // Invalid URL
    }

    return null
  }

  /**
   * Validate URL format
   */
  static validateUrl(url: string): boolean {
    try {
      new URL(url)
      return true
    } catch {
      return false
    }
  }

  /**
   * Get cache statistics
   */
  static getCacheStats(): {
    size: number
    maxSize: number
    hitRate?: number
  } {
    return {
      size: this.urlCache.size,
      maxSize: this.MAX_CACHE_SIZE
    }
  }

  /**
   * Clear URL cache
   */
  static clearCache(): void {
    this.urlCache.clear()
  }

  /**
   * Get relative path from full URL
   */
  static getRelativePath(fullUrl: string, serverConfig: ServerConfig): string | null {
    try {
      const url = new URL(fullUrl)
      const baseUrl = new URL(serverConfig.baseUrl)
      
      // Check if URLs match the same server
      if (url.hostname !== baseUrl.hostname || url.port !== baseUrl.port) {
        return null
      }
      
      let relativePath = url.pathname
      
      // Remove prefix if present
      if (serverConfig.prefix) {
        const prefix = this.normalizePrefix(serverConfig.prefix)
        if (relativePath.startsWith(prefix)) {
          relativePath = relativePath.substring(prefix.length)
        }
      }
      
      return relativePath
    } catch (error) {
      return null
    }
  }
}