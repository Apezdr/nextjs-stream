# Search Modal UI Alignment Plan

## Overview
Align [`SearchModal.js`](../src/components/Search/SearchModal.js) with the design language from the HTML mockups ([`.roo/SearchModal-list.example.html`](.roo/SearchModal-list.example.html) and [`.roo/SearchModal-cast.example.html`](.roo/SearchModal-cast.example.html)).

**Focus**: UI alignment first, backend stays unchanged.

---

## Key Design Elements from Mockups

### Visual Theme
- ✨ **Glassmorphism**: Translucent backgrounds with backdrop blur
- 🎨 **Soft gradients**: Radial gradients for depth
- 📦 **Rounded corners**: 18px (xl), 14px (lg), 12px (md)
- 🔘 **Pill-based metadata**: Genre, type, duration as rounded pills
- 🏷️ **Quality badges**: 4K (green), HDR (purple) as colored badges
- 💫 **Elevated surfaces**: Subtle shadows and borders

### Layout Structure
1. **Top Bar** - Search input + Filters button (with count badge)
2. **Filter Chips Row** - Active filters displayed as removable chips
3. **Body** - Two-pane split (420px list + flex inspector)
4. **Left Pane**: Tabs → Results list
5. **Right Pane**: Inspector with sticky header + scrollable content

---

## Current vs Target Comparison

### Current Implementation
```
┌─────────────────────────────────────────┐
│ 🔍 Search...                        ✕ │ ← Plain input
├─────────────────────────────────────────┤
│ All(158) Title(1) Cast(157) Actors(50) │ ← Basic tabs
├─────────────────────────────────────────┤
│ [Results - basic styling]              │
└─────────────────────────────────────────┘
```

### Target Design
```
┌───────────────────────────────────────────────┐
│ [🔍 Search...]        [Filters 3] [✕]       │ ← Rounded, elevated
├───────────────────────────────────────────────┤
│ Filter chips: HDR: DV ×  Res: 4K ×  [Clear] │ ← Active filter row
├───────────────────────────────────────────────┤
│ All 128 | Titles 92 | People 36             │ ← Rounded tabs
├─────────────────┬─────────────────────────────┤
│ Results         │ Inspector                  │
│ [Rich items]    │ [Detailed preview]         │
│                 │                            │
└─────────────────┴─────────────────────────────┘
```

---

## Phase 1: Core Layout & Structure

### 1.1 Update Modal Container
**Current**: Basic white background
**Target**: Glassmorphism with backdrop blur

```jsx
<DialogPanel className="mx-auto max-w-7xl transform overflow-hidden rounded-[18px] bg-white/95 shadow-[0_30px_80px_rgba(0,0,0,0.38)] ring-1 ring-black/10 transition-all backdrop-blur-xl">
```

### 1.2 Update Top Bar
**Current**: Basic border and padding
**Target**: Gradient background, rounded search input, filter button

```jsx
{/* Top bar */}
<div className="flex items-center gap-3 px-4 py-3.5 border-b border-black/6 bg-gradient-to-b from-white/92 to-white/86">
  {/* Rounded search container */}
  <div className="flex-1 flex items-center gap-2.5 px-3 py-3 rounded-full bg-black/5 border border-black/7 focus-within:shadow-[0_0_0_4px_rgba(59,130,246,0.25)]">
    <MagnifyingGlassIcon className="h-[18px] w-[18px] text-black/70" />
    <input
      className="flex-1 border-0 outline-0 bg-transparent text-sm text-black placeholder:text-black/60"
      placeholder="Search by title, actor, genre, year, HDR, or resolution..."
    />
  </div>
  
  {/* Filter button */}
  <button className="h-9 px-2.5 rounded-xl border border-black/8 bg-white/80 hover:bg-white/96 inline-flex items-center gap-2 text-[13px] text-black/86">
    <FilterIcon className="h-4 w-4" />
    <span>Filters</span>
    <span className="h-[18px] px-1.5 rounded-full bg-blue-500/14 border border-blue-500/22 text-black/78 text-xs font-semibold">
      3
    </span>
  </button>
  
  {/* Close button */}
  <button className="h-9 px-2.5 rounded-xl border border-black/8 bg-white/80 hover:bg-white/96" onClick={handleClose}>
    ✕
  </button>
</div>
```

### 1.3 Add Filter Chips Row
**New Section**: Below top bar, shows active filters

```jsx
{hasActiveFilters && (
  <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-black/6 bg-white/78 min-h-[52px] flex-nowrap overflow-hidden">
    <span className="text-xs text-black/56 font-extrabold uppercase tracking-wider mr-0.5 flex-none">
      Filters
    </span>
    <div className="flex items-center gap-2 overflow-x-auto flex-1 min-w-0 py-0.5 whitespace-nowrap scrollbar-none">
      <span className="flex items-center gap-2 px-2.5 py-1.5 rounded-full bg-black/6 border border-black/8 text-black/78 text-xs flex-none">
        <strong className="font-extrabold">HDR</strong>: Dolby Vision
        <span className="w-[18px] h-[18px] rounded-full grid place-items-center bg-black/6 border border-black/6 text-xs opacity-85">
          ×
        </span>
      </span>
      {/* More chips... */}
    </div>
    <button className="flex-none h-8 px-3 rounded-full border border-black/10 bg-black/3 hover:bg-black/5 text-black/74 font-bold text-xs">
      Clear
    </button>
  </div>
)}
```

### 1.4 Update Body Grid
**Current**: flex divide-x
**Target**: CSS Grid with fixed dimensions

```jsx
<div className="flex-1 grid grid-cols-[420px_1fr] min-h-0">
  {/* Left pane */}
  <div className="min-w-0 border-r border-black/6 flex flex-col min-h-0">
    {/* Tabs, Results */}
  </div>
  
  {/* Right inspector */}
  <div className="min-w-0 bg-gradient-to-b from-[rgba(12,16,24,0.04)] to-transparent flex justify-center min-h-0">
    {/* Inspector content */}
  </div>
</div>
```

---

## Phase 2: Tab Styling

### 2.1 Update Tab List
**Current**: Basic tabs with borders
**Target**: Rounded pill-style tabs with subtle backgrounds

```jsx
<TabList className="flex gap-2 px-3 py-2.5 border-b border-black/6">
  {searchTabs.map((tab) => (
    <Tab
      key={tab.key}
      className={({ selected }) =>
        classNames(
          'inline-flex items-center gap-2 px-2.5 py-2 rounded-full text-[13px] select-none transition-all',
          'border border-transparent',
          selected
            ? 'bg-blue-500/12 border-blue-500/18 text-black/92'
            : 'bg-transparent text-black/70 hover:text-black/80 hover:bg-black/3'
        )
      }
    >
      {tab.label}
      <span className="text-xs px-2 py-0.5 rounded-full bg-black/6 text-black/60">
        {tab.items.length}
      </span>
    </Tab>
  ))}
</TabList>
```

---

## Phase 3: Results List Styling

### 3.1 Media Row (Standard Tabs)
**Current**: Small 32x48 thumbnails, basic text
**Target**: Larger 44x66 thumbnails, pills for metadata, quality badges

```jsx
<div className="flex items-center gap-3 px-2.5 py-2.5 rounded-xl border border-transparent hover:bg-black/3 data-[focus]:bg-blue-500/8 data-[focus]:border-blue-500/16">
  {/* Larger thumbnail with gradient  placeholder */}
  <div className="relative w-11 h-[66px] rounded-[10px] bg-gradient-to-br from-black/25 to-black/5 border border-black/8 shadow-[0_10px_22px_rgba(0,0,0,0.12)] flex-none overflow-hidden">
    <RetryImage src={media.posterURL} fill alt={media.title} className="object-cover" />
    {/* Shine effect */}
    <div className="absolute inset-[-40%] rotate-[10deg] bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.35),transparent_55%)] pointer-events-none" />
  </div>
  
  <div className="min-w-0 flex-1">
    <div className="font-semibold text-sm whitespace-nowrap overflow-hidden text-ellipsis mb-0.5">
      {media.title}
    </div>
    <div className="flex items-center gap-2 text-xs text-black/62 flex-wrap">
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-black/8 border border-black/6 text-black/72 text-xs leading-[18px]">
        {media.type === 'movie' ? 'Movie' : 'TV Show'}
      </span>
      {media.metadata?.release_date && (
        <span>{new Date(media.metadata.release_date).getFullYear()}</span>
      )}
      {media.duration && (
        <>
          <span>•</span>
          <span>{formatDuration(media.duration)}</span>
        </>
      )}
    </div>
  </div>
  
  {/* Quality badges */}
  <div className="flex gap-1.5 items-center">
    {media.hdr && (
      <span className="px-2 py-0.5 rounded-full bg-purple-500/10 border border-purple-500/14 text-xs">
        {media.hdr === 'Dolby Vision' ? 'DV' : 'HDR'}
      </span>
    )}
    {media.dimensions?.startsWith('3840') && (
      <span className="px-2 py-0.5 rounded-full bg-green-500/10 border border-green-500/14 text-xs">
        4K
      </span>
    )}
  </div>
</div>
```

### 3.2 Actor Row (Actors Tab)
**Current**: Small expandable groups
**Target**: List items showing person, roles, title count - NO expansion (use inspector instead)

```jsx
<div className="flex items-center gap-3 px-2.5 py-2.5 rounded-xl border border-transparent hover:bg-black/3 data-[selected]:bg-blue-500/8 data-[selected]:border-blue-500/16">
  {/* Round profile photo */}
  <div className="relative w-11 h-11 rounded-full bg-gradient-to-br from-black/20 to-black/6 border border-black/10 shadow-[0_10px_22px_rgba(0,0,0,0.12)] flex-none overflow-hidden">
    <img src={person.profile_path} alt={person.name} className="w-full h-full object-cover" />
    {/* Shine effect */}
    <div className="absolute inset-[-40%] bg-[radial-gradient(circle_at_30%_25%,rgba(255,255,255,0.35),transparent_55%)] pointer-events-none" />
  </div>
  
  <div className="min-w-0 flex-1">
    <div className="font-semibold text-sm whitespace-nowrap overflow-hidden text-ellipsis mb-0.5">
      {person.name}
    </div>
    <div className="flex items-center gap-2 text-xs text-black/62 flex-wrap">
      <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-black/8">
        Actor
      </span>
      <span>•</span>
      <span>Known for: {person.knownForTitle || 'Multiple titles'}</span>
    </div>
  </div>
  
  <div className="flex gap-1.5 items-center flex-none">
    <span className="px-2 py-0.5 rounded-full bg-black/6 border border-black/6 text-xs">
      {person.count} titles
    </span>
  </div>
</div>
```

---

## Phase 4: Inspector Panel Redesign

### 4.1 Inspector for Media Items
**Current**: Basic preview with white background
**Target**: Sticky header + hero card + action buttons

```jsx
<div className="w-full max-w-[620px] px-4 py-3.5 flex flex-col min-h-0 gap-3">
  {/* Sticky header */}
  <div className="sticky top-0 z-10 px-2.5 py-2.5 border border-black/8 rounded-[14px] bg-white/88 backdrop-blur-[10px] shadow-[0_10px_26px_rgba(0,0,0,0.08)]">
    <div className="flex items-start justify-between gap-2.5">
      <div className="min-w-0 flex-1">
        <h2 className="text-lg font-bold tracking-tight mb-1 whitespace-nowrap overflow-hidden text-ellipsis">
          {media.title} <span className="font-semibold text-black/45">(2022)</span>
        </h2>
        <div className="flex gap-2 items-center flex-wrap text-[13px] text-black/62">
          <span className="pill">Movie</span>
          <span className="pill">Action</span>
          <span className="pill">2h 11m</span>
          <span className="pill bg-purple-500/10 border-purple-500/14">DV</span>
          <span className="pill bg-green-500/10 border-green-500/14">4K</span>
        </div>
      </div>
      <span className="pill flex-none">Matched: Title</span>
    </div>
  </div>
  
  {/* Hero card */}
  <div className="rounded-[18px] border border-black/8 overflow-hidden shadow-[0_12px_40px_rgba(0,0,0,0.18)] bg-black/5">
    {/* Backdrop with poster overlay */}
    <div className="relative h-[210px] bg-gradient-to-br from-black/60 to-black/15">
      {media.backdrop && (
        <RetryImage src={media.backdrop} fill className="object-cover opacity-60" />
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/38" />
      
      {/* Floating poster */}
      <div className="absolute left-3.5 bottom-[-42px] w-[98px] h-[145px] rounded-[14px] bg-white/20 border border-white/26 shadow-[0_22px_55px_rgba(0,0,0,0.45)] overflow-hidden">
        <RetryImage src={media.posterURL} fill className="object-cover" />
        <div className="absolute inset-[-50%] -rotate-12 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.35),transparent_60%)] pointer-events-none" />
      </div>
    </div>
    
    {/* Content */}
    <div className="pt-[58px] px-3.5 pb-3.5 flex flex-col gap-2.5 bg-white/90">
      {/* Genre chips */}
      <div className="flex gap-2 flex-wrap">
        {media.metadata?.genres?.map(g => (
          <span key={g.id} className="pill">{g.name}</span>
        ))}
      </div>
      
      {/* Overview */}
      <p className="text-black/62 text-[13px] leading-relaxed line-clamp-3">
        {media.metadata?.overview}
      </p>
    </div>
  </div>
  
  {/* Action buttons - sticky at bottom */}
  <div className="sticky bottom-0 z-10 mt-auto pt-3 pb-3.5">
    <div className="flex gap-2.5 px-3 py-3 rounded-[18px] bg-white/92 border border-black/8 shadow-[0_18px_55px_rgba(0,0,0,0.12)] backdrop-blur-[10px]">
      <Link href={buildURL(media.url)} className="btn-primary">
        ▶ Play
      </Link>
      <button className="btn-secondary">Details</button>
      <button className="btn-secondary">+ Watchlist</button>
    </div>
  </div>
</div>
```

### 4.2 Inspector for Cast Members
**Target**: Profile photo + bio + "Known for" carousel + "Top credits" list

```jsx
<div className="w-full max-w-[620px] px-4 py-3.5 flex flex-col min-h-0 gap-3">
  {/* Sticky header */}
  <div className="sticky top-0 z-10 px-2.5 py-2.5 border border-black/8 rounded-[14px] bg-white/88 backdrop-blur-[10px] shadow-[0_10px_26px_rgba(0,0,0,0.08)]">
    <div className="flex items-start justify-between gap-2.5">
      <div className="min-w-0">
        <h2 className="text-lg font-bold tracking-tight mb-1">{person.name}</h2>
        <div className="flex gap-2 items-center flex-wrap text-[13px] text-black/62">
          <span className="pill bg-black/8">Actor</span>
          <span className="pill">Producer</span>
          <span className="pill">32 titles</span>
        </div>
      </div>
      <span className="pill flex-none">Matched: People</span>
    </div>
  </div>
  
  {/* Person hero card */}
  <div className="rounded-[18px] border border-black/8 overflow-hidden shadow-[0_12px_40px_rgba(0,0,0,0.18)] bg-white/92">
    {/* Top section with photo */}
    <div className="flex gap-3.5 px-3.5 py-3.5 bg-gradient-to-b from-black/6 to-black/2">
      <div className="w-[92px] h-[92px] rounded-full bg-gradient-to-br from-black/25 to-black/6 border border-black/10 shadow-[0_18px_45px_rgba(0,0,0,0.18)] flex-none overflow-hidden">
        <img src={person.profile_path} className="w-full h-full object-cover" />
      </div>
      <div className="min-w-0 flex-1 flex flex-col gap-2">
        <div className="text-lg font-extrabold tracking-tight">{person.name}</div>
        <div className="flex gap-2 flex-wrap text-black/62 text-[13px]">
          <span>Actor • Producer</span>
          <span>•</span>
          <span>Born 1962</span>
        </div>
        <div className="flex gap-2 flex-wrap">
          <span className="pill">Action</span>
          <span className="pill">Thriller</span>
        </div>
      </div>
    </div>
    
    {/* Bio */}
    <div className="px-3.5 pb-3.5 text-black/62 text-[13px] leading-relaxed line-clamp-4">
      {person.biography || 'Known for high-intensity action roles...'}
    </div>
    
    {/* Known for section */}
    <div className="px-3.5 py-3 border-t border-black/8 bg-white/92">
      <div className="text-xs font-extrabold uppercase tracking-wider text-black/58 mb-2.5 flex justify-between">
        <span>Known for</span>
        <span className="text-black/62 font-bold normal-case tracking-normal">(scroll)</span>
      </div>
      <div className="flex gap-2.5 overflow-x-auto pb-1.5 scrollbar-none">
        {person.media?.slice(0, 5).map(m => (
          <Link key={m._id} href={buildURL(m.url)} className="w-28 flex-none rounded-[14px] overflow-hidden border border-black/8 bg-black/4 shadow-[0_14px_40px_rgba(0,0,0,0.10)]">
            <div className="relative h-[152px] bg-gradient-to-br from-black/55 to-black/10">
              <RetryImage src={m.posterURL} fill className="object-cover" />
              <div className="absolute inset-[-40%] rotate-[10deg] bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.28),transparent_58%)] pointer-events-none" />
            </div>
            <div className="px-2 py-2 text-xs font-bold text-black/84 whitespace-nowrap overflow-hidden text-ellipsis bg-white/92">
              {m.title}
            </div>
          </Link>
        ))}
      </div>
    </div>
    
    {/* Top credits section */}
    <div className="px-3.5 py-3 border-t border-black/8 bg-white/92">
      <div className="text-xs font-extrabold uppercase tracking-wider text-black/58 mb-2.5">
        Top credits
      </div>
      <div className="flex flex-col gap-2.5">
        {person.media?.slice(0, 3).map(m => (
          <div key={m._id} className="flex items-start justify-between gap-2.5 px-2.5 py-2.5 rounded-[14px] border border-black/8 bg-black/3">
            <div className="min-w-0">
              <div className="font-bold whitespace-nowrap overflow-hidden text-ellipsis">
                {m.title}
              </div>
              <div className="text-black/62 text-xs mt-0.5 flex gap-2 flex-wrap">
                <span className="pill bg-black/8">Actor</span>
                <span>{new Date(m.metadata?.release_date).getFullYear()}</span>
                <span>•</span>
                <span>{m.character || 'Lead role'}</span>
              </div>
            </div>
            {m.dimensions?.startsWith('3840') && (
              <span className="pill bg-green-500/10 border-green-500/14 flex-none">4K</span>
            )}
          </div>
        ))}
      </div>
    </div>
  </div>
  
  {/* Actions */}
  <div className="sticky bottom-0 z-10 mt-auto pt-3 pb-3.5">
    <div className="flex gap-2.5 px-3 py-3 rounded-[18px] bg-white/92 border border-black/8 shadow-[0_18px_55px_rgba(0,0,0,0.12)] backdrop-blur-[10px]">
      <button className="btn-primary">Filmography</button>
      <button className="btn-secondary">Open person</button>
      <button className="btn-secondary">+ Follow</button>
    </div>
  </div>
</div>
```

---

## Phase 5: Tailwind Utilities Needed

Create these utility classes in your global CSS or use arbitrary values:

```css
/* Custom scrollbar hiding */
.scrollbar-none::-webkit-scrollbar {
  display: none;
}
.scrollbar-none {
  -ms-overflow-style: none;
  scrollbar-width: none;
}

/* Button styles */
.btn-primary {
  @apply flex-1 border border-blue-500/35 bg-blue-500 text-white px-3 py-2.5 rounded-[14px] font-semibold text-[13px] inline-flex items-center justify-center gap-2 select-none whitespace-nowrap hover:bg-blue-600 transition-colors;
}

.btn-secondary {
  @apply border border-black/10 bg-black/4 text-black/86 px-3 py-2.5 rounded-[14px] font-semibold text-[13px] inline-flex items-center justify-center gap-2 select-none whitespace-nowrap hover:bg-black/6 transition-colors;
}

.pill {
  @apply inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-black/6 border border-black/6 text-black/72 text-xs leading-[18px];
}
```

---

## Implementation Checklist

### Structure
- [ ] Update DialogPanel with glassmorphism styles
- [ ] Redesign top bar with rounded search and filter button
- [ ] Add filter chips row (conditional)
- [ ] Update body grid to use CSS Grid (420px + 1fr)
- [ ] Update tab list styling to pill style

### Results List
- [ ] Update media row thumbnail size (32x48 → 44x66)
- [ ] Add gradient placeholder with shine effect
- [ ] Replace text metadata with pills
- [ ] Add HDR/4K quality badges as colored pills
- [ ] Update actor rows with round photos (no expansion)

### Inspector Panel
- [ ] Add sticky header with title and metadata pills
- [ ] Redesign media hero with backdrop + floating poster
- [ ] Add genre chips and clamped overview
- [ ] Add sticky action buttons at bottom
- [ ] Create person inspector view:
  - Large round profile photo
  - "Known for" horizontal scroll
  - "Top credits" list with character names
  - Person-specific action buttons

### Utilities
- [ ] Add custom button utility classes
- [ ] Add pill utility class
- [ ] Add scrollbar-none utility
- [ ] Verify all arbitrary Tailwind values work

---

## Key Design Principles from Mockups

1. **Visual Hierarchy**: Use shadows, borders, and backgrounds to create depth
2. **Consistent Spacing**: 8px, 10px, 12px, 14px, 16px system
3. **Rounded Corners**: 18px, 14px, 12px, 10px for different elements
4. **Subtle Transparency**: white/95, white/92, white/88, black/6, black/8
5. **Quality Indicators**: Always use colored badges (purple for HDR, green for 4K)
6. **Touch Targets**: Minimum 36px height for clickable elements
7. **Overflow Strategy**: Horizontal scroll for chips and carousels, never wrap
8. **Pill Pattern**: Metadata as small rounded pills, not plain text

---

## Mobile Responsiveness

The mockups show mobile behavior:
```css
@media (max-width: 880px) {
  - Hide right inspector panel
  - Full-width left panel
  - Filter sheet (bottom drawer) instead of popover
}
```

In React:
```jsx
<div className="hidden sm:grid sm:grid-cols-[420px_1fr] lg:grid-cols-[480px_1fr]">
  {/* Two-pane for desktop */}
</div>

<div className="sm:hidden">
  {/* Single pane for mobile */}
</div>
```

---

## Out of Scope (For Now)

These features are in the mockups but can be added later:
- ❌ Filter popover/sheet implementation
- ❌ Filter chip removal functionality
- ❌ "Clear all" filters button
- ❌ Known for carousel in person view
- ❌ Top credits section in person view
- ❌ Filmography / Follow buttons
- ❌ Person biography text

**Focus**: Get the core visual design aligned first, then add interactive features.

---

## Next Steps

1. Start with Phase 1 (Core layout)
2. Move to Phase 2 (Tab styling)
3. Implement Phase 3 (Results list)
4. Complete Phase 4 (Inspector)
5. Add utilities in Phase 5
6. Test responsive behavior

Ready to proceed with implementation in Code mode?
