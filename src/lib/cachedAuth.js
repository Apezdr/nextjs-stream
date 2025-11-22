import { cache } from 'react';
import { auth as nextAuth } from '@src/lib/auth';

/**
 * Request-level cached auth function.
 * Deduplicates multiple auth() calls within a single server request.
 * All RSC components should import this instead of the original auth.
 * 
 * Benefits:
 * - Single auth check per request across all components
 * - Maintains Auth.js session optimization (JWT cookies, session tokens)
 * - Preserves existing "use cache" cross-request caching
 * - PPR-compatible (server-side only)
 */
export const auth = cache(nextAuth);
