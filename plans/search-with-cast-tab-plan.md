# Search with Cast/Actors Tab Plan

## Overview
Transform search to include **cast members as searchable items** that appear in their own "Actors" tab, allowing users to:
1. Search for partial actor names (e.g., "brend" → "Brendan Fraser")
2. See matching actors in a dedicated "Actors" tab
3. Click an actor to view all their media

## UI Flow Example

### User types "brend":

```
┌──────────────────────────────────────────────────────┐
│  🔍 brend                                        ✕  │
├──────────────────────────────────────────────────────┤
│  ┌─All (12)─┬─Title (0)─┬─Actors (2)─┬─Genre (10)┐  │
│  │          │           │   ^^^^^^   │           │  │
│  └──────────────────────────────────────────────────┘│
│                                                      │
│  [Actors Tab Selected]                               │
│                                                      │
│  📸 Brendan Fraser                                   │
│     12 titles                                        │
│                                                      │
│  📸 Brendan Gleeson                                  │
│     8 titles                                         │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### User clicks "Brendan Fraser":

```
┌──────────────────────────────────────────────────────┐
│  🔍 Brendan Fraser                               ✕  │
├──────────────────────────────────────────────────────┤
│  ┌─All (12)─┬─Title (0)─┬─Cast (12)─┬─Actors (1)┐  │
│  │          │           │  ^^^^^^   │           │  │
│  └──────────────────────────────────────────────────┘│
│                                                      │
│  [Cast Tab Auto-Selected - Shows his movies/TV]     │
│                                                      │
│  🎬 The Mummy (1999)                                 │
│  🎬 George of the Jungle (1997)                      │
│  🎬 Airheads (1994)                                  │
│  ...                                                 │
│                                                      │
└──────────────────────────────────────────────────────┘
```

---

## Implementation Architecture

### Backend Changes

#### 1. Add "Cast Names" Search Type

**File**: [`src/app/api/authenticated/search/route.js`](../src/app/api/authenticated/search/route.js)

```javascript
async function searchMedia(query) {
  // ... existing code ...

  // Execute searches for each match type in parallel
  const [
    titleMatches,
    genreMatches,
    castMatches,          // Media with this cast member
    castNameMatches,      // ⭐ NEW: Cast members themselves
    yearMatches,
    hdrMatches,
    resolutionMatches
  ] = await Promise.all([
    searchByTitle(db, query),
    searchByGenre(db, query),
    searchByCast(db, query),
    searchByCastNames(db, query),  // ⭐ NEW
    searchByYear(db, query),
    searchByHDR(db, query),
    searchByResolution(db, query)
  ])

  // Tag each result with its matchType
  const taggedResults = [
    ...titleMatches.map(r => ({ ...r, matchType: 'title' })),
    ...genreMatches.map(r => ({ ...r, matchType: 'genre' })),
    ...castMatches.map(r => ({ ...r, matchType: 'cast' })),
    ...castNameMatches.map(r => ({ ...r, matchType: 'castName' })), // ⭐ NEW
    ...yearMatches.map(r => ({ ...r, matchType: 'year' })),
    ...hdrMatches.map(r => ({ ...r, matchType: 'hdr' })),
    ...resolutionMatches.map(r => ({ ...r, matchType: 'resolution' }))
  ]

  // ... rest of function ...
}

// ⭐ NEW: Search for cast members by name
async function searchByCastNames(db, query) {
  if (query.length < 2) return []
  
  const [movieCast, tvCast] = await Promise.all([
    db.collection('FlatMovies').aggregate([
      { $match: { 'metadata.cast.name': { $regex: query, $options: 'i' } } },
      { $unwind: '$metadata.cast' },
      { $match: { 'metadata.cast.name': { $regex: query, $options: 'i' } } },
      {
        $group: {
          _id: {
            id: '$metadata.cast.id',
            name: '$metadata.cast.name'
          },
          count: { $sum: 1 },
          profile_path: { $first: '$metadata.cast.profile_path' }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 50 }
    ]).toArray(),
    
    db.collection('FlatTVShows').aggregate([
      { $match: { 'metadata.cast.name': { $regex: query, $options: 'i' } } },
      { $unwind: '$metadata.cast' },
      { $match: { 'metadata.cast.name': { $regex: query, $options: 'i' } } },
      {
        $group: {
          _id: {
            id: '$metadata.cast.id',
            name: '$metadata.cast.name'
          },
          count: { $sum: 1 },
          profile_path: { $first: '$metadata.cast.profile_path' }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 50 }
    ]).toArray()
  ])
  
  // Merge and deduplicate by cast member ID
  const allCast = [...movieCast, ...tvCast]
  const uniqueCast = new Map()
  
  for (const cast of allCast) {
    const castId = cast._id.id
    const existing = uniqueCast.get(castId)
    
    if (!existing) {
      uniqueCast.set(castId, {
        _id: castId,  // Use cast ID as unique identifier
        type: 'castName',  // Special type for cast members
        name: cast._id.name,
        profile_path: cast.profile_path,
        count: cast.count,
        // Add properties expected by frontend
        title: cast._id.name,  // Display name in results
        posterURL: cast.profile_path || '/sorry-image-not-available.jpg'
      })
    } else {
      existing.count += cast.count
    }
  }
  
  return Array.from(uniqueCast.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 50)
}
```

#### 2. Update Deduplication

Cast name results shouldn't be deduplicated with media results since they're different entity types:

```javascript
function deduplicateResults(results) {
  const mediaResults = []
  const castNameResults = []
  const seen = new Map()
  const matchTypePriority = { 
    title: 1, 
    cast: 2, 
    genre: 3, 
    year: 4, 
    hdr: 5, 
    resolution: 6 
  }
  
  for (const result of results) {
    // Cast names are separate entities, don't deduplicate
    if (result.matchType === 'castName') {
      castNameResults.push(result)
      continue
    }
    
    // Deduplicate media items
    const key = result._id.toString()
    const existing = seen.get(key)
    
    if (!existing || matchTypePriority[result.matchType] < matchTypePriority[existing.matchType]) {
      seen.set(key, result)
    }
  }
  
  mediaResults.push(...Array.from(seen.values()))
  
  return [...mediaResults, ...castNameResults]
}
```

---

### Frontend Changes

#### 1. Add "Actors" Tab to Tab Structure

**File**: [`src/components/Search/SearchModal.js`](../src/components/Search/SearchModal.js)

```javascript
// Create tabs structure from results
const searchTabs = useMemo(() => {
  if (!query) {
    return [
      { key: 'all', label: 'Recent', items: recentlyAddedMedia }
    ]
  }
  
  // Group results by matchType
  const groups = {
    all: searchResults.filter(r => r.matchType !== 'castName'), // Don't include cast names in "All"
    title: searchResults.filter(r => r.matchType === 'title'),
    cast: searchResults.filter(r => r.matchType === 'cast'),
    castNames: searchResults.filter(r => r.matchType === 'castName'),  // ⭐ NEW
    genre: searchResults.filter(r => r.matchType === 'genre'),
    year: searchResults.filter(r => r.matchType === 'year'),
    hdr: searchResults.filter(r => r.matchType === 'hdr'),
    resolution: searchResults.filter(r => r.matchType === 'resolution')
  }
  
  // Create tab configuration
  return [
    { key: 'all', label: 'All', items: groups.all },
    { key: 'title', label: 'Title', items: groups.title },
    { key: 'cast', label: 'Cast', items: groups.cast },
    { key: 'castNames', label: 'Actors', items: groups.castNames },  // ⭐ NEW
    { key: 'genre', label: 'Genre', items: groups.genre },
    { key: 'year', label: 'Year', items: groups.year },
    { key: 'hdr', label: 'HDR', items: groups.hdr },
    { key: 'resolution', label: 'Resolution', items: groups.resolution }
  ].filter(tab => tab.items.length > 0)
}, [query, searchResults, recentlyAddedMedia])
```

#### 2. Custom Rendering for Cast Name Items

```javascript
{/* Render prop function */}
{({ option: item }) => {
  // Special rendering for cast members
  if (item.type === 'castName') {
    return (
      <ComboboxOption
        value={item}
        className="-mx-2 flex cursor-default select-none items-center rounded-md p-2 h-20 data-[focus]:bg-gray-100 data-[focus]:text-gray-900 w-full max-w-full"
      >
        <button
          className="flex items-center w-full min-w-0 group"
          onClick={() => handleCastMemberClick(item.name)}
        >
          {item.profile_path && (
            <img
              src={item.profile_path}
              alt={item.name}
              className="w-12 h-12 rounded-full object-cover flex-shrink-0"
            />
          )}
          <div className="ml-3 flex flex-col flex-1 min-w-0">
            <span className="truncate block font-medium">{item.name}</span>
            <span className="text-gray-400 text-xs truncate block">
              {item.count} {item.count === 1 ? 'title' : 'titles'}
            </span>
          </div>
          <ChevronRightIcon
            className="ml-3 h-5 w-5 flex-shrink-0 text-gray-400 opacity-0 group-data-[focus]:opacity-100"
            aria-hidden="true"
          />
        </button>
      </ComboboxOption>
    )
  }
  
  // Standard media item rendering
  const media = item
  return (
    <ComboboxOption value={media} ...>
      {/* Existing media rendering */}
    </ComboboxOption>
  )
}}
```

#### 3. Handle Cast Member Click

```javascript
// Handle clicking a cast member - triggers new search
const handleCastMemberClick = useCallback((castName) => {
  setQuery(castName)
  
  // Switch to Cast tab to show their media
  setTimeout(() => {
    const castTabIndex = searchTabs.findIndex(t => t.key === 'cast')
    if (castTabIndex !== -1) {
      setManualTabIndex(castTabIndex)
    }
  }, 500) // Wait for search to complete
}, [setQuery, searchTabs])
```

#### 4. Preview Pane for Cast Members

When hovering over a cast member in the Actors tab, show their profile instead of a media poster:

```javascript
{activeMedia && activeMedia.type === 'castName' ? (
  <div className="space-y-3">
    {activeMedia.profile_path && (
      <img
        src={activeMedia.profile_path}
        alt={activeMedia.name}
        className="w-48 h-48 mx-auto rounded-full object-cover"
      />
    )}
    <h2 className="text-xl font-semibold text-gray-900">
      {activeMedia.name}
    </h2>
    <p className="text-sm text-gray-500">
      {activeMedia.count} {activeMedia.count === 1 ? 'title' : 'titles'} in library
    </p>
    <button
      onClick={() => handleCastMemberClick(activeMedia.name)}
      className="w-full rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
    >
      View all titles
    </button>
  </div>
) : (
  /* Existing media preview */
)}
```

---

## Updated Tab Structure

With this approach, tabs will be:

1. **All** - All media results (excludes cast names)
2. **Title** - Media matching by title
3. **Cast** - Media featuring searched cast member
4. **Actors** ⭐ - Cast members matching search (clickable to view their media)
5. **Genre** - Media matching by genre
6. **Year** - Media from searched year
7. **HDR** - HDR content
8. **Resolution** - Media at searched resolution

---

## Benefits

✅ **Discoverability**: Users can browse matching actors even with partial names  
✅ **Visual Feedback**: See actor photos and title counts before committing  
✅ **Two-Step Flow**: Search actors → Click actor → See their media  
✅ **Clear Separation**: "Cast" tab = media, "Actors" tab = people  
✅ **No Popup**: Everything in clean tab interface  
✅ **Consistent UX**: Same interaction pattern for all search types  

---

## Data Structure

Cast name items returned from backend:

```javascript
{
  _id: 18269,  // Cast member's TMDB ID
  type: 'castName',
  matchType: 'castName',
  name: 'Brendan Fraser',
  title: 'Brendan Fraser',  // For display
  profile_path: 'https://image.tmdb.org/t/p/original/...',
  posterURL: 'https://image.tmdb.org/t/p/original/...',  // Same as profile_path
  count: 12,  // Number of titles featuring this actor
  url: null  // Not clickable link, handled by button
}
```

---

## Implementation Checklist

### Backend
- [x] Create cast autocomplete API (can be repurposed or removed)
- [ ] Add `searchByCastNames` function to search route
- [ ] Update `deduplicateResults` to handle cast names separately
- [ ] Ensure cast name results include all required fields

### Frontend
- [ ] Add "Actors" tab to `searchTabs` structure
- [ ] Implement conditional rendering for cast name items
- [ ] Add `handleCastMemberClick` to trigger search by cast name
- [ ] Update preview pane to show cast member profile
- [ ] Remove/simplify cast autocomplete dropdown (no longer needed)
- [ ] Test full flow: search partial → see actors → click actor → see media

---

## Simplified User Flow

1.  **User types**: "brend"
2. **Backend returns**:
   - 0 title matches
   - 10 genre matches (e.g., "adventure" contains "adven")
   - 2 cast name matches (Brendan Fraser, Brendan Gleeson)
   - 0 cast media matches (no exact search yet)
3. **UI shows tabs**: All (10), Actors (2), Genre (10)
4. **User clicks**: "Actors" tab
5. **UI shows**: Brendan Fraser (12 titles), Brendan Gleeson (8 titles)
6. **User clicks**: "Brendan Fraser"
7. **Query updates**: "Brendan Fraser"
8. **Backend returns**: 12 cast matches (his movies/TV)
9. **UI auto-switches**: to "Cast" tab showing all 12 titles

---

## Remove Autocomplete Dropdown

Since cast members now appear in their own tab, we can **remove** the autocomplete dropdown entirely. This simplifies the UI and makes it more consistent.

**Benefits**:
- ✅ Less visual clutter
- ✅ Consistent interaction (tabs for everything)
- ✅ Better mobile experience
- ✅ Easier to maintain

---

## Code Changes Summary

### Backend ([`src/app/api/authenticated/search/route.js`](../src/app/api/authenticated/search/route.js))
1. Add `searchByCastNames` function
2. Include in parallel Promise.all
3. Tag results with `matchType: 'castName'`
4. Update deduplication logic

### Frontend ([`src/components/Search/SearchModal.js`](../src/components/Search/SearchModal.js))
1. Remove cast autocomplete dropdown and related state
2. Add "Actors" to searchTabs
3. Add conditional rendering for `type === 'castName'`
4. Add `handleCastMemberClick` function
5. Update preview pane for cast members
6. Simplify component (less state, no dropdown)

---

## Testing Plan

1. **Partial Name Search**: "brend" → Shows Actors tab with matching cast
2. **Full Name Search**: "Brendan Fraser" → Shows Cast tab with his media
3. **Click Flow**: Search "brend" → Click Actors tab → Click "Brendan Fraser" → Auto-switch to Cast tab
4. **No Actors**: Search "zzzz" → No Actors tab appears
5. **Mixed Results**: Search "action" → Shows Title, Genre tabs (no Actors for this query)
6. **Profile Images**: Verify cast photos load correctly
7. **Counts**: Verify title counts are accurate
8. **Preview**: Hover cast member → See large profile photo and title count

---

## Migration from Current Implementation

Current state has:
- ✅ Grouped headers (being replaced with tabs)
- ✅ Cast autocomplete API endpoint (can be removed or repurposed)
- ✅ Cast autocomplete dropdown (will be removed)

New state will have:
- ✅ Clean tab-based UI
- ✅ Actors as first-class searchable items
- ✅ Simpler component (less state)
- ✅ More intuitive UX

This is a cleaner, more maintainable solution that better aligns with the tab-based architecture!
