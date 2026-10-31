/**
 * Frosted glass, the way iOS draws a material: whatever is behind it blurred
 * and a little more saturated (the class), under the pane itself (the style).
 * The one surface for an image that is missing or failed: RetryImage's
 * stand-in and an episode with no still (EpisodeThumbnail).
 *
 * The pane carries its own depth, because most slots sit on a flat panel
 * where a backdrop blur alone has nothing to frost and reads as a grey disc:
 * a diagonal sheen, two soft cool glows standing in for light through the
 * glass, a white tint, a bright top edge, a hairline rim and a little shade
 * at the bottom for thickness. Inline, so a caller's ring or shadow class
 * cannot overwrite the rim.
 *
 * A plain module, not 'use client': server components (EpisodeThumbnail) need
 * the values, and an export of a client module is a reference on the server.
 */
export const FROSTED_GLASS = 'backdrop-blur-xl backdrop-saturate-150'

export const FROSTED_GLASS_STYLE = {
  backgroundImage: [
    'linear-gradient(135deg, rgba(255,255,255,0.30) 0%, rgba(255,255,255,0.08) 38%, rgba(255,255,255,0) 52%, rgba(255,255,255,0.06) 100%)',
    'radial-gradient(120% 90% at 15% 0%, rgba(165,180,252,0.35) 0%, rgba(165,180,252,0) 60%)',
    'radial-gradient(110% 90% at 100% 100%, rgba(125,211,252,0.22) 0%, rgba(125,211,252,0) 55%)',
    'linear-gradient(rgba(255,255,255,0.10), rgba(255,255,255,0.10))',
  ].join(', '),
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.45), inset 0 0 0 1px rgba(255,255,255,0.16), inset 0 -10px 20px -12px rgba(0,0,0,0.35)',
}
