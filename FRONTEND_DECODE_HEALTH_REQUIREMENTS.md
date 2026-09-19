# Frontend Requirements — Decode-Health Notice

Audience: the **nextjs-stream** player. No server change is required; this is a client-side
feature. Related server change: jit-transcoder `e3b2e5c` (epoch 17) lowers the worst-case
degradation for an HEVC-less client from 720p to **1080p** — the notice's wording assumes it.

## 1. The problem

A browser silently drops every HLS variant whose `CODECS` its decoder cannot open (hls.js filters
on `MediaSource.isTypeSupported`). Our 4K ladder is HEVC above 1080p, so a client without HEVC
plays a 4K title at the highest AVC rung and **nothing anywhere reports a problem** — no player
error, no server error, no client error report. The viewer just sees a soft picture.

Confirmed case (2026-08-29, desktop Chrome 151 on an RTX 3060): Chrome's GPU process crashed three
times (`RESULT_CODE_HUNG`) the previous evening, tripping *"GPU process was unable to boot: GPU
process crashed too many times with software GL → Disabled Features: all"*. The session ran
software-only for its remaining lifetime. Chrome's HEVC on Windows is platform-decoder-only, so
`MediaSource.isTypeSupported('video/mp4; codecs="hvc1.2.4.L123.90"')` returned `false`, every
`hvc1` rung was dropped, and the quality menu showed HD (720p) / High (480p) / 144p only. Edge on
the same machine returned `true` and got the full ladder. **Restarting Chrome fixes it** (the crash
counter resets). `chrome://gpu` still reported `Video Decode: Hardware accelerated` under its
separate *"for Hardware GPU"* section — capability intact, current process degraded.

Goal: tell the viewer why their picture is limited, and when a browser restart will fix it.

## 2. What to build

A dismissible notice in the player (near the quality control is ideal — that is where the symptom
shows). **Two tiers, different wording. Do not merge them.**

| Verdict | When | Message |
|---|---|---|
| `gpu-regressed` | This browser *used to* support HEVC and now doesn't, **or** it is Chromium with no working WebGL and no HEVC | "Hardware video acceleration isn't active in this browser, so this title is limited to 1080p. Restarting your browser usually fixes it." |
| `no-hevc` | No HEVC, no evidence of regression (Firefox/Linux etc. — a legitimately different setup) | "This browser can't play HEVC, so you're watching the 1080p AVC version." **No restart advice.** |
| `ok` | HEVC available | Nothing. |

**Only show it when it matters:** gate on the title actually being 4K-class (we have `dimensions`,
e.g. `3840x2160`, in our own metadata). A 1080p title loses nothing and must never trigger a
notice. An equally good gate: the player's max available quality height is below the title's.

## 3. Detection

Run once per playback start, client-side only.

1. **HEVC probe** — `MediaSource.isTypeSupported('video/mp4; codecs="hvc1.2.4.L123.90"')`. Use the
   exact CODECS string our master advertises for an HEVC rung; verify against a current 4K master
   rather than hardcoding from memory.
2. **Regression baseline** — persist the probe result in `localStorage` per browser. `'1'` stored
   previously and `false` now ⇒ `gpu-regressed`. This is the signal that earns the restart advice;
   a browser that never had HEVC never trips it.
3. **GPU liveness (corroboration)** — create a `webgl2` context and read
   `WEBGL_debug_renderer_info` → `UNMASKED_RENDERER_WEBGL`. Null context, or a renderer matching
   `/swiftshader|software|basic render/i`, means the GPU process is down. In the confirmed case
   `chrome://gpu` reported `WebGL: Disabled` alongside software video decode — same dead process.
   A healthy Firefox without HEVC still returns a real renderer, which is how the two tiers stay
   apart.
4. *(Optional, better than 1 if you prefer)* `navigator.mediaCapabilities.decodingInfo()` returns
   `{supported, smooth, powerEfficient}`. `powerEfficient: false` means software decode and catches
   more than HEVC — 4K AVC decoded on the CPU stutters too. Async, so it needs the effect anyway.

## 4. Rules

- **Client-side only.** `MediaSource` and `navigator.mediaCapabilities` do not exist during SSR.
  Detect inside `useEffect`, never during render, or you get a hydration mismatch. `'use client'`,
  or `dynamic(..., { ssr: false })`.
- **Skip on native HLS.** Safari/iOS uses `NativeHlsVideo`; `MediaSource` may be absent while
  Safari plays HEVC natively. Probing there produces a false positive on a perfectly healthy
  client. Branch on which provider is active.
- **Fail quiet.** No `localStorage` baseline (incognito, cleared data) and no corroborating signal
  ⇒ show nothing. A wrong "restart your browser" is worse than silence.
- **Recompute per load; never persist the warning.** The condition clears on browser restart.
  Persist only the capability baseline.
- **Never block or interrupt playback.** Dismissible, and dismissal should stick for the session.

## 5. Acceptance

- Chrome with hardware decode: no notice; 4K present in the quality menu.
- Chrome forced to software (`--disable-gpu`) on a 4K title, having previously played one
  normally in that profile: `gpu-regressed` notice, restart advice, playback continues at 1080p.
- Firefox/Linux without HEVC: `no-hevc` notice, **no** restart advice.
- Safari/iOS: no notice at all.
- Any 1080p title on any browser: no notice.
- SSR render and hydration produce no mismatch warning.

## 6. Optional tier 2 — dropped-frame monitoring

The honest "you are having trouble right now" signal, independent of codecs:
`videoEl.getVideoPlaybackQuality()` → `droppedVideoFrames / totalVideoFrames`. Sample over a
rolling ~10s window and require a sustained ratio (>5–10%) before showing anything — seeking and
tab-backgrounding both spike it. Worth adding only after §2 ships.

## 7. Unrelated bug found alongside this

The quality menu lists **each video rung once per audio group** ("4K, 4K, 4K, Full HD, Full HD…",
bandwidths differing only by the audio codec's bitrate). That is HLS behaving correctly — one
`EXT-X-STREAM-INF` per video-rung × audio-group is required — so the fix is client-side: dedupe by
video rendition (height + video bitrate) when building the menu, in
`src/components/MediaPlayer/menus.js` (`useQualityOptions` / `videoRenditionList`).
