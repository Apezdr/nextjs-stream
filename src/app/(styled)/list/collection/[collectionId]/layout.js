/**
 * Collection layout. It reads nothing, on purpose.
 *
 * It used to await the session for one cosmetic reason: to put the dark
 * background on its wrapper for signed-in viewers. A layout that awaits anything
 * keeps every page beneath it out of the prerendered shell, so this route had
 * an empty one. The wrapper was never needed for the colour: the page's own
 * root, and its skeleton, are both `min-h-screen bg-gray-950`, and the
 * signed-out view paints its own background.
 *
 * This layout never gated anything. The approval check lives in the page.
 */
export default function CollectionLayout({ children }) {
  return <div>{children}</div>
}
