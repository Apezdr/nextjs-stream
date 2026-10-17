# 🏗️ Sync Architecture Migration Guide

> **Historical.** This migration is finished and most modules it names (SyncManager, `src/utils/flatSync/`, the traditional sync) are deleted.
> The sync now runs from `src/utils/sync/run/` (one server's pass: `run/serverPass.ts`); read the code there, not this guide.

This document outlines the migration from the traditional sync system to the new domain-driven architecture.

## 🎯 **Architecture Overview**

### **New Structure**
```
src/utils/sync/
├── core/                      # 🧠 Core domain types and interfaces
│   ├── types.ts              # Domain entities and contracts
│   ├── events.ts             # Event system for progress tracking
│   ├── validation.ts         # Cross-domain validation
│   └── index.ts              # Core exports
├── infrastructure/            # 🔧 Technical infrastructure
│   ├── database/             # Repository pattern implementation
│   │   ├── BaseRepository.ts
│   │   ├── MovieRepository.ts
│   │   ├── EpisodeRepository.ts
│   │   └── DatabaseAdapter.ts
│   ├── fileSystem/           # File server abstractions
│   │   ├── FileServerAdapter.ts
│   │   └── UrlBuilder.ts
│   └── index.ts
├── domain/                    # 🎬 Business logic by media type
│   ├── movies/
│   │   ├── MovieSyncService.ts
│   │   ├── strategies/
│   │   │   ├── MovieMetadataStrategy.ts
│   │   │   └── MovieAssetStrategy.ts
│   │   └── index.ts
│   └── index.ts
└── SyncManager.ts            # 🎭 Main orchestrator
```

## 🚀 **Key Benefits**

### **1. Performance Optimizations**
- **Database Repository Pattern**: Optimized queries with proper indexing
- **Smart Caching**: URL and availability caching in FileServerAdapter
- **Bulk Operations**: `bulkUpsertSeason()` for high-volume episode updates
- **Concurrent Processing**: Configurable concurrency limits
- **Event-Driven Progress**: Real-time sync monitoring

### **2. Better Organization**
- **Domain-Driven Design**: All movie logic in one place
- **Strategy Pattern**: Pluggable sync operations
- **Clean Separation**: Infrastructure vs business logic
- **Vertical Slices**: Complete feature ownership per domain

### **3. Enhanced Observability**
- **Event System**: Real-time progress tracking
- **Comprehensive Stats**: Database and performance metrics
- **Error Isolation**: Granular error handling per operation
- **Progress Monitoring**: Detailed sync progress reporting

## 📊 **Migration Strategy**

### **Phase 1: Parallel Implementation (Current)**
✅ **Complete** - New architecture runs alongside existing flat sync

### **Phase 2: Gradual Migration**
```typescript
// Example: Start using new architecture for movies
import { syncManager } from '@src/utils/sync/SyncManager'

// Replace flat sync calls
const results = await syncManager.syncMovies(
  movieTitles,
  serverConfig,
  fieldAvailability,
  {
    operations: [SyncOperation.Metadata, SyncOperation.Assets],
    concurrency: 5
  }
)
```

### **Phase 3: Performance Monitoring**
```typescript
// Compare performance
const comparison = await syncManager.performanceComparison(
  testMovies,
  serverConfig,
  fieldAvailability
)

console.log('Performance improvement:', comparison.comparison)
```

## 🔧 **Integration Points**

### **1. Replace Traditional Sync Calls**

**Old Approach:**
```javascript
// Traditional flat sync
import { syncToFlatStructure } from '@src/utils/flatSync'

const result = await syncToFlatStructure(
  fileServer, 
  serverConfig, 
  fieldAvailability
)
```

**New Approach:**
```typescript
// New domain-driven sync
import { syncManager } from '@src/utils/sync/SyncManager'

const result = await syncManager.syncMovies(
  movieTitles,
  serverConfig,
  fieldAvailability
)
```

### **2. Event Monitoring**
```typescript
import { SyncEvents } from '@src/utils/sync/core'

// Monitor sync progress
const unsubscribe = SyncEvents.onProgress((event) => {
  console.log(`${event.entityId}: ${event.data?.stage}`)
})

// Track specific movie
const tracker = SyncEvents.trackSync(movieTitle, MediaType.Movie, serverId)
```

### **3. Advanced Database Operations**
```typescript
// Direct repository access for complex queries
const dbAdapter = syncManager.getDatabaseAdapter()

// Find movies needing upgrade
const upgradeCandidates = await dbAdapter.movies.findUpgradeCandidates()

// Get detailed statistics
const stats = await dbAdapter.movies.getMovieStats()
```

## 🏃‍♂️ **Performance Improvements**

### **Database Optimizations**
- **Indexed Queries**: Proper indexing on all lookup fields
- **Bulk Operations**: Batch database writes
- **Connection Pooling**: Efficient MongoDB connections
- **Query Optimization**: Repository pattern with optimized queries

### **Caching Strategy**
- **URL Caching**: 10,000 URL cache with LRU eviction
- **Availability Caching**: 5-minute TTL for file availability
- **Memory Management**: Automatic cache cleanup

### **Concurrency Control**
- **Configurable Limits**: Control concurrent operations
- **Batch Processing**: Process items in batches
- **Error Isolation**: Failed items don't block others

## 🎯 **Migration Checklist**

### **Immediate Actions**
- [ ] Test new movie sync with sample data
- [ ] Monitor performance metrics
- [ ] Validate event tracking
- [ ] Test error handling scenarios

### **Short Term (Next Sprint)**
- [ ] Implement Episode domain service
- [ ] Create Season domain service
- [ ] Add TV Show domain service
- [ ] Performance comparison with flat sync

### **Medium Term**
- [ ] Migrate admin API endpoints
- [ ] Update webhook handlers
- [ ] Add advanced caching strategies
- [ ] Implement sync scheduling

### **Long Term**
- [ ] Remove traditional sync code
- [ ] Optimize database indexes
- [ ] Add observability dashboards
- [ ] Advanced error recovery

## 🔍 **Monitoring & Debugging**

### **Performance Metrics**
```typescript
// Get comprehensive stats
const stats = await syncManager.getSyncStats()

console.log('System stats:', stats.system)
console.log('Database stats:', stats.database)
console.log('Cache stats:', stats.cache)
```

### **Error Tracking**
```typescript
// Monitor errors
SyncEvents.onError((event) => {
  console.error(`Sync error for ${event.entityId}:`, event.error)
})
```

### **Progress Monitoring**
```typescript
// Real-time progress
SyncEvents.onProgress((event) => {
  const { entityId, data } = event
  console.log(`${entityId}: ${data?.stage} (${data?.progress}%)`)
})
```

## 🧪 **Testing Strategy**

### **Unit Testing**
- Repository pattern enables easy mocking
- Strategy pattern allows isolated testing
- Event system provides testable side effects

### **Integration Testing**
- Database adapter integration tests
- File server adapter tests
- End-to-end sync workflow tests

### **Performance Testing**
- Benchmark new vs old architecture
- Memory usage analysis
- Concurrency stress testing

## 🚦 **Rollback Plan**

If issues arise, the traditional sync system remains available:

```typescript
// Fallback to flat sync if needed
import { syncToFlatStructure } from '@src/utils/flatSync'

// Traditional approach still works
await syncToFlatStructure(fileServer, serverConfig, fieldAvailability)
```

## 📈 **Success Metrics**

### **Performance**
- Sync speed improvement: Target 30-50% faster
- Memory usage reduction: Target 20-30% less memory
- Error rate reduction: Target 50% fewer failures

### **Maintainability**
- Code organization: All movie logic in one domain
- Testing coverage: 90%+ test coverage on new code
- Developer experience: Faster feature development

### **Observability**
- Real-time progress tracking
- Detailed error reporting
- Comprehensive performance metrics

---

## 🎉 **Ready to Start!**

The new architecture is ready for testing and gradual migration. Start with movies, then expand to other media types as confidence builds.

```typescript
// Quick start example
import { syncMoviesWithNewArchitecture } from '@src/utils/sync/SyncManager'

const results = await syncMoviesWithNewArchitecture(
  ['Movie Title 1', 'Movie Title 2'],
  serverConfig,
  fieldAvailability
)

console.log('Sync results:', results.summary)
```