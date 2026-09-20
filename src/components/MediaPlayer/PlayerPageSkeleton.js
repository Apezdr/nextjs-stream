/**
 * The player page with no player in it yet: a black frame where the video will
 * be. It is the Suspense fallback on both player routes and therefore their
 * prerendered shell, which is what the Play button has ready before the click.
 * Without it the click did nothing visible until the server had answered:
 * nothing of these routes could be prefetched, so the old page just sat there.
 *
 * It mirrors the frame in MoviePlayerView / TVEpisodePlayerView (the centred
 * min-h-screen column) and the player's own container in MainVideoPlayer
 * (full width, 16:9, never taller than the screen). Change them together.
 *
 * Server-safe; no data, no hooks.
 */
export default function PlayerPageSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading player"
      className="flex flex-col items-center justify-center min-h-screen"
    >
      <div className="relative z-10 flex aspect-[16/9] max-h-screen w-full items-center justify-center bg-black">
        <span className="size-10 rounded-full border-2 border-white/20 border-t-white/70 motion-safe:animate-spin" />
        <span className="sr-only">Loading player…</span>
      </div>
    </div>
  )
}
