# Frontend Playback Requirements — Delivery Tiers (Epoch 16)

Audience: the **web frontend plus the React Native apps**. Server changes shipped in
jit-transcoder commits `2d004dc` + `0c2345e` (epoch 16). Until the clients adopt this
document, the visible regression is: **"Original" quality disappears from the menu and the
Dolby Vision badge stops lighting on Apple devices.** Everything else keeps working — Auto
actually improves (see the hi-fi rung, §7).

Background (one paragraph): auto-ABR steering browsers into the raw `-c:v copy` rung is what
froze Grandma's Boy at 35:54 — open-GOP H.264 disc remuxes have no legal browser random-access
points, and Chrome's hardware decoder hard-fails on them. The server now models three delivery
tiers (the Plex model): **transcoded HLS** (always, every client), **Original over HLS**
(explicit selection only, withheld from titles browsers can't decode), and the **raw file**
(native players). This is one server contract, but **not one app contract**: the web frontend,
the Apple React Native app, and the Android/TV React Native app do not all make the same source
selection decisions.

---

## 1. Which app owns which behavior

Treat the requirements below as **app-specific**, not "frontend" in the singular:

| Surface | Playback stack | What this document expects |
|---|---|---|
| Web frontend, non-Apple browsers | hls.js + MSE | Auto stays on the default transcode-only master; explicit Original swaps to `?direct=1` and pins the copy rung immediately (§4) |
| Web frontend, Safari | Native HLS in the browser | Load `?direct=1` by default so Apple restores Dolby Vision signaling, with the server gate protecting bad AVC copy rungs (§5) |
| React Native app on Apple platforms | AVPlayer wrapper | Same source policy as Safari: use `?direct=1` by default in the native player, and take badge/menu facts from `direct.json` (§5) |
| React Native app on Android / Android TV | ExoPlayer or native-player handoff | Use `direct.json` to decide whether "Original" means HLS-Original or the raw `/file` path; do not inherit the web app's hls.js re-init logic (§6) |

The important correction is: **sections with browser APIs or hls.js callbacks are web-only**.
The React Native apps consume the same server endpoints, but they should map them onto AVPlayer /
ExoPlayer behavior rather than trying to mirror the browser implementation literally.

---

## 2. What changed on the server

| Change | Frontend impact |
|---|---|
| Default `master.m3u8` is **transcode-only** (no copy rung, ever) | Auto never breaks again on raw source bytes; Original is no longer discoverable from the default master |
| `master.m3u8?direct=1` adds the copy rung, marked `STABLE-VARIANT-ID="original"` | "Original" selection must request this master and pin the marked level |
| **AVC random-access gate**: open-GOP H.264 titles (most disc remuxes) get **no copy rung at all**, even with `?direct=1` | The menu must not offer HLS-Original for these titles — `direct.json` says so, with a reason |
| `GET /stream/{key}/direct.json` — per-title verdict + reasons + DV facts | The quality menu's data source (replaces master-parsing heuristics) |
| `GET /stream/{key}/file` — original bytes, Range-capable | "Original (native player)" affordance for Shield/mpv/VLC/Infuse |
| **Hi-fi top rung**: sources ≥16 Mbps gain a 12/16/20 Mbps top transcode rung | Nothing to do — it appears as a new top level in auto-ABR |
| Dolby Vision discovery moved behind `?direct=1` (signaling only ever lived on the copy rung) | Apple devices need the `?direct=1` master to light the DV badge (§5) |

---

## 3. The decision surface: `GET /stream/{key}/direct.json`

Call it **when playback opens** (in parallel with the master fetch), not on library/browse
grids — for an eligible title it triggers the same one-time keyframe derivation the `?direct=1`
master pays (seconds on MP4, minutes on a huge un-indexed MKV; memoized forever after).

Every app should consume this payload, but not for the same purpose:

- Web frontend: gate the quality menu and decide whether the explicit Original action exists.
- Apple React Native app: gate the menu/badge, while still loading `?direct=1` by default.
- Android/TV React Native app: decide whether Original should stay in-app as HLS or hand off to
  the raw-file path.

**Offered (e.g. Backrooms — HEVC, DV P8):**

```json
{
  "hls": {
    "offered": true,
    "variantIndex": 6,
    "codecs": "hvc1.2.4.L123.B0",
    "bandwidth": 41500000,
    "averageBandwidth": 34000000,
    "videoRange": "PQ",
    "supplementalCodecs": "dvh1.08.06/db1p"
  },
  "file": { "available": true, "sizeBytes": 29400000000, "container": "mp4", "videoCodec": "hevc" }
}
```

**Withheld (e.g. Grandma's Boy — open-GOP AVC remux):**

```json
{
  "hls": { "offered": false, "reason": "open-gop-avc" },
  "file": { "available": true, "sizeBytes": 29400000000, "container": "mp4", "videoCodec": "h264" }
}
```

`videoRange`/`supplementalCodecs` derive from the **same predicates as the master line and the
init's `dvvC` box** — menu, manifest, and media can never disagree.

### Reason → user-facing copy

| `reason` | Suggested copy (tooltip/subtext) |
|---|---|
| `open-gop-avc` | "This file's format can't seek reliably in browsers. Playing in high-quality transcode — use a native player for the untouched original." |
| `segment-floor` / `segment-budget` | "This file's structure exceeds browser streaming limits." |
| `unscannable` | "The original stream couldn't be analyzed." |
| `ineligible-source` | "This format can't be streamed unmodified." |
| `poisoned` | "Original streaming was disabled for this title after a playback fault." |
| `disabled` | (hide the Original option entirely — server feature off) |

---

## 4. Web frontend only: quality menu + Original selection (hls.js / MSE)

**Rule: the default master drives Auto; the `?direct=1` master is loaded only when the user
explicitly picks Original — and the level is pinned immediately.** Loading the direct master
into hls.js *without* pinning would put the copy rung back into auto-ABR, recreating the exact
failure class this work removed.

This section is **web-frontend-specific**. The React Native apps should not copy the hls.js
destroy/recreate flow; they need the same policy, not the same mechanism.

```js
// Menu: show "Original" only when offered. Badge from the same payload.
const info = await fetch(`${base}/stream/${key}/direct.json`).then(r => r.json());
const showOriginal = info.hls.offered;
const originalLabel = info.hls.supplementalCodecs ? "Original (Dolby Vision)"
                    : info.hls.videoRange === "PQ" ? "Original (HDR10)"
                    : "Original";

// Selection: re-init hls.js on the ?direct=1 master, pin by identity, resume position.
function playOriginal(hls, video, key, base) {
  const t = video.currentTime;
  hls.destroy();
  const h = new Hls({ ...playerConfig, startPosition: t });
  h.on(Hls.Events.MANIFEST_PARSED, () => {
    const idx = h.levels.findIndex(l => l.attrs["STABLE-VARIANT-ID"] === "original");
    // Fallbacks in order: the marker, then direct.json's variantIndex, then bail to Auto.
    const pin = idx >= 0 ? idx
              : h.levels.findIndex(l => l.url[0]?.includes(`/v/${info.hls.variantIndex}/`));
    if (pin >= 0) h.currentLevel = pin;   // pins AND disables auto-ABR
    else revertToAuto(video, key, t);
  });
  h.loadSource(`${base}/stream/${key}/master.m3u8?direct=1`);
  h.attachMedia(video);
  return h;
}
```

Leaving Original (user picks Auto or any fixed rung) -> re-init on the **default** master at the
current position. Positions are identical across masters (same timeline), so switching is a
seek-free resume.

---

## 5. Apple-native stacks: load `?direct=1` by default

This policy applies to both:

- Safari in the web frontend.
- The Apple React Native app when it hands AVPlayer a source URL.

### Web frontend implementation (Safari)

For browser clients playing HLS **natively**, set the source to the `?direct=1` master
unconditionally:

```js
const nativeHls = video.canPlayType("application/vnd.apple.mpegurl") !== "" && !Hls.isSupported()
  /* or your existing "prefer native on Apple" policy */;
video.src = `${base}/stream/${key}/master.m3u8${nativeHls ? "?direct=1" : ""}`;
```

### React Native Apple app implementation

Use the **same source policy** in AVPlayer, but apply it where the app constructs the native
media URL rather than via the browser capability sniff above. `direct.json` still owns whether
Original is menu-visible and whether the badge says Dolby Vision / HDR10.

Why this is safe (and restores the old behavior exactly where it was always fine):

- Apple's players are the honest capability negotiators the old design assumed — and they are
  the **only** clients that honor `SUPPLEMENTAL-CODECS`, so this is what re-lights the **Dolby
  Vision badge** on P8 titles like Backrooms, in both Safari and AVPlayer.
- The incident class was hls.js/MSE + open-GOP **AVC**. Those titles now have **no copy rung on
  any master** (the server gate), so a native client can never self-select into one.
- HEVC/CRA Original on Apple devices is the shipped, production-verified path.

---

## 6. Native-player tier: `GET /stream/{key}/file`

The **only** bit-original path for gated titles (and the best path for Shield-class devices
generally). Range-capable; MIME by extension; gated server-side on `JIT_DIRECT_PLAY`.

- **Do not** feed it to browser `<video>`: remux audio (DTS-HD MA, TrueHD) is undecodable
  there, and seek behavior on open-GOP files is exactly what the gate protects against.
- Web frontend: surface it as **"Original (native player)"** when `file.available &&
  !hls.offered` (and optionally always, for the living-room crowd): copy-URL for mpv/VLC/Infuse,
  an `intent://` link on Android/Shield, etc.
- React Native apps: this is the deliberate escape hatch for a true direct-play experience.
  Android / Android TV are the primary fit; on Apple platforms it is optional product behavior,
  not a requirement to restore Dolby Vision or the in-app Original option.

---

## 7. Things that need **no** client work

- **Hi-fi rung**: high-bitrate sources now carry a 12/16/20 Mbps top transcode rung in the
  default master. Auto-ABR climbs to it by itself; a dynamically-built quality menu picks it up
  as a new fixed-quality entry automatically.
- **A/V sync**: transcoded video timing is now edit-list-free (CMAF negative CTS). This fixes
  the Chromecast lip-sync drift server-side; hls.js's "parsed timing vs playlist" drift log
  lines also disappear.
- **Heartbeats / UpdatePlayback**: unchanged.

---

## 8. Recommended for the web frontend: the decode-error descent

The Jellyfin/Plex resilience pattern, so *any* future decoder quirk degrades to a quality dip
instead of a frozen player. Only meaningful once Original playback exists in the app again:

```js
let recovered = false;
hls.on(Hls.Events.ERROR, (_e, data) => {
  if (!data.fatal) return;
  if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
    if (!recovered) { recovered = true; hls.recoverMediaError(); return; }
    // Second fatal media error: descend a tier — drop Original, resume on the default
    // master at the same position. (This is what would have saved the 35:54 freeze.)
    revertToAuto(video, key, video.currentTime);
  }
});
```

Optional polish: report the descent to the server-side log/analytics you already have, so
per-title client failures are visible next to the server's `jit.direct.verdicts` metric.

This exact hook is hls.js-specific. If the React Native apps expose HLS Original in-app, they
should implement the same **policy** in their native-player error handling: first attempt normal
player recovery, then fall back to the transcode-only path at the same position.

---

## 9. Capability detection — browser-only unless noted

This section is mostly for the **web frontend**. React Native apps should prefer their native
player and platform capability signals over browser APIs such as `MediaSource` or
`navigator.mediaCapabilities`.

| Question | Use | Notes |
|---|---|---|
| Native HLS vs MSE? | `video.canPlayType('application/vnd.apple.mpegurl')` + `Hls.isSupported()` | Drives the web split between §4 and §5 |
| Can this device decode codec X at W×H@fps? | `navigator.mediaCapabilities.decodingInfo(...)` — and hls.js already applies it (`useMediaCapabilities`, default on) | Fine for HEVC/AV1/HDR10 *ladder* filtering |
| Dolby Vision support? | **Don't probe** — undetectable in browsers. Badge from `supplementalCodecs`; Apple devices self-select via the manifest; everyone else safely plays the HDR10 base (that's the point of the P8 form) | |
| Open-GOP / random-access tolerance? | **Impossible client-side** — no API expresses it. That's why the server gates and `direct.json` reports | The core lesson of the incident |

## 10. Migration checklist by app

### Web frontend

1. [ ] Fetch `direct.json` at player-open; gate the "Original" menu entry on `hls.offered`,
  badge from `supplementalCodecs`/`videoRange`, tooltip from `reason` (§3).
2. [ ] Non-Apple / hls.js path: Original selection = `?direct=1` master + pin via
  `STABLE-VARIANT-ID` (§4); leaving it = default master, same position.
3. [ ] Safari path: native HLS gets `?direct=1` by default (§5) — restores the DV badge.
4. [ ] "Original (native player)" affordance from `file` when product wants browser handoff (§6).
5. [ ] Decode-error descent (§8).

### React Native apps

1. [ ] Fetch `direct.json` at playback-open; use it as the source of truth for menu visibility,
  Original eligibility, and Dolby Vision / HDR10 badging (§3).
2. [ ] Apple RN app: AVPlayer should load `?direct=1` by default (§5).
3. [ ] Android / TV RN app: decide explicitly whether in-app Original is HLS-Original or whether
  Original should hand off to `/file` for a native-player/direct-play path (§6).
4. [ ] If an RN app keeps Original in-app, implement the same recovery policy as §8 in native
  player error handling.

### Deploy ordering

1. [ ] Land the `direct.json` integration and Apple `?direct=1` defaulting with or before the
  server deploy — until then the menu simply lacks Original (nothing breaks harder than
  that).

---

## 11. Addendum (2026-08-31): React Native apps implemented — decisions + web/backend work items

The RN apps (this repo) have implemented their side of this contract. This section records
the decisions made where the doc left them open, and the work items that now sit with the
**web frontend / Next.js backend**. The authoritative client-side spec of the new endpoint is
`docs/frontend-api-contract.md` §12.4 in the RN repo.

### 11.1 Decisions the RN apps made

1. **The verdict is consumed through an authenticated Next.js proxy, not the transcoder
   origin.** The apps call `GET /api/authenticated/media/direct-info` (see 11.2) keyed by
   media identity, at playback-open only. They never fetch `direct.json` from the stream host.
2. **Apple (iOS/tvOS): menu is master-level, honestly labeled.** Neither AVPlayer nor
   expo-video can pin an HLS variant, so §4's rung-pinning has no native equivalent. The
   Apple menu is **"Auto (up to Original)"** (the `?direct=1` master, loaded by default per
   §5 — this re-lights the DV/HDR badge) vs **"Transcoded only"** (default master). No
   `STABLE-VARIANT-ID` parsing exists in the apps.
3. **Android / Android TV: "Original" = `/file` direct play in-app** whenever
   `file.available` — including gated titles (the §6 escape hatch). HLS-Original pinning via
   a native ExoPlayer patch was considered and deferred unless telemetry shows container
   failures.
4. **§8 descent implemented as policy**: one plain retry of the same source, then a
   position-preserving drop (Apple `?direct=1` → default master; Android `/file` → Auto),
   reported to `POST /api/authenticated/client-error` with a `tierDescent` detail field.
   An initial-load stall (the `?direct=1` master paying keyframe derivation) also descends.
5. **Watch-history/presence identity is the canonical master URL**: heartbeat `videoId` is
   always `videoURL` exactly as delivered, with tier surgery reversed (`direct` param
   stripped, `/file` mapped back to `master.m3u8`).
6. **Quality preferences are device-local** (global default + implicit remember-last-choice
   per title + cellular data-saver on phones). No server preferences API is required for v1;
   the store shape can sync later if cross-device preferences become a goal.

### 11.2 Work items for the Next.js backend

1. [ ] **Build `GET /api/authenticated/media/direct-info?mediaType=&mediaId=&season=&episode=`**
   — authenticated; resolves the stream key from media identity (episode-level for shows);
   proxies `GET /stream/{key}/direct.json`; returns an **enriched passthrough**: the raw
   verdict plus
   - `badgeLabel`: `"Original (Dolby Vision)"` | `"Original (HDR10)"` | `"Original"`
     (the §4 mapping, computed once server-side so no surface can diverge), and
   - `reasonCopy`: user-facing copy for `reason` per the §3 table.
   Requirements: long upstream timeout or an explicit pending semantic (first call pays the
   keyframe derivation — minutes on a big un-indexed MKV); response caching aligned with the
   transcoder's memoization; `Cache-Control: no-store` like the media routes. Until this
   endpoint exists the apps treat its 404 as "nothing offered" — the menu simply lacks
   Original, nothing else breaks.
2. [ ] **Normalize `videoId` defensively** in `sync/updatePlayback` / watch history: strip
   the query string when deriving the storage key (clients already send canonical URLs).
3. [ ] **Document the `/file` auth stance.** Client media fetches (masters, segments,
   `/file`) remain credential-less by design; `/file` serves full-bitrate originals, so
   either bless that deliberately or move it behind a URL token later — the apps' only
   touchpoint is deriving `…/stream/{key}/file` from `videoURL`.

### 11.3 Work items for the web frontend

1. [ ] Consume the **same** `direct-info` proxy for the quality menu, badge, and tooltip
   (instead of raw `direct.json`), so `badgeLabel`/`reasonCopy` stay centralized across web,
   Apple RN, and Android RN.
2. [ ] The §10 web checklist stands otherwise (hls.js pin flow §4, Safari `?direct=1` §5,
   `/file` affordance §6, decode-error descent §8).

### 11.4 Deploy ordering (updated)

Server (jit-transcoder epoch 16) → Next.js `direct-info` proxy → clients, in any overlap:
every step degrades gracefully for clients that are ahead or behind (missing endpoint =
Auto-only menu; `?direct=1` on an old server is an ignored query param).
