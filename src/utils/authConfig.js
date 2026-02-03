/**
 * Authentication configuration utilities
 * Handles validation and setup for cross-domain authentication
 */

/**
 * Validates and returns auth cookie domain configuration
 * @returns {string|undefined} Cookie domain or undefined for default behavior
 */
export function getAuthCookieDomain() {
  const cookieDomain = process.env.AUTH_COOKIE_DOMAIN?.trim();
  
  if (!cookieDomain) {
    return undefined; // Default behavior - single domain
  }
  
  // Validate cookie domain format
  if (!cookieDomain.startsWith('.')) {
    console.warn(
      `[AUTH CONFIG] AUTH_COOKIE_DOMAIN should start with a dot (e.g., ".example.com"). ` +
      `Current value: "${cookieDomain}". Cookies may not work across subdomains.`
    );
  }
  
  // Security warning for broad domains
  const domainParts = cookieDomain.split('.').filter(Boolean);
  if (domainParts.length < 2) {
    console.error(
      `[AUTH CONFIG] AUTH_COOKIE_DOMAIN "${cookieDomain}" appears too broad. ` +
      `Use a specific domain like ".example.com" to avoid security issues.`
    );
    return undefined; // Don't use potentially dangerous domains
  }
  
  // Validate domain format (basic check for valid characters)
  if (!/^\.[\w.-]+\.\w{2,}$/.test(cookieDomain)) {
    console.error(
      `[AUTH CONFIG] AUTH_COOKIE_DOMAIN "${cookieDomain}" has invalid format. ` +
      `Expected format: ".example.com"`
    );
    return undefined;
  }
  
  console.info(
    `[AUTH CONFIG] Cross-subdomain authentication enabled. ` +
    `Cookies will be shared across all subdomains of "${cookieDomain}"`
  );
  
  return cookieDomain;
}

/**
 * Gets the appropriate cookie configuration for NextAuth
 * @returns {object|undefined} Cookie configuration object or undefined for default
 */
export function getAuthCookieConfig() {
  const cookieDomain = getAuthCookieDomain();
  
  if (!cookieDomain) {
    return undefined; // Use NextAuth defaults
  }
  
  return {
    sessionToken: {
      name: `__Secure-authjs.session-token`,
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: true,
        domain: cookieDomain,
      },
    },
  };
}

/**
 * Logs the current authentication configuration status
 * Useful for debugging and deployment verification
 */
export function logAuthConfig() {
  const cookieDomain = getAuthCookieDomain();
  
  if (cookieDomain) {
    console.info(`[AUTH CONFIG] Cross-domain cookies enabled for: ${cookieDomain}`);
    console.info(`[AUTH CONFIG] Sessions will work across all subdomains of ${cookieDomain}`);
    console.info(`[AUTH CONFIG] Ensure both domains use HTTPS for secure cookies`);
  } else {
    console.info(`[AUTH CONFIG] Single-domain cookies enabled (default behavior)`);
    console.info(`[AUTH CONFIG] To enable cross-subdomain auth, set AUTH_COOKIE_DOMAIN=.yourdomain.com`);
  }
  
  // Additional environment info
  const nextAuthUrl = process.env.NEXTAUTH_URL;
  const nodeServerUrl = process.env.NODE_SERVER_URL;
  
  if (nextAuthUrl) {
    console.info(`[AUTH CONFIG] NextAuth URL: ${nextAuthUrl}`);
  }
  
  if (nodeServerUrl) {
    console.info(`[AUTH CONFIG] Node Server URL: ${nodeServerUrl}`);
    
    // Check if they're on the same domain
    if (nextAuthUrl && nodeServerUrl) {
      try {
        const nextDomain = new URL(nextAuthUrl).hostname;
        const nodeDomain = new URL(nodeServerUrl).hostname;
        
        if (nextDomain === nodeDomain) {
          console.info(`[AUTH CONFIG] Same domain detected - cross-domain auth not needed`);
        } else if (cookieDomain) {
          const parentDomain = cookieDomain.substring(1); // Remove leading dot
          if (nextDomain.endsWith(parentDomain) && nodeDomain.endsWith(parentDomain)) {
            console.info(`[AUTH CONFIG] Subdomain configuration looks correct`);
          } else {
            console.warn(
              `[AUTH CONFIG] Domain mismatch: NextAuth (${nextDomain}) and Node (${nodeDomain}) ` +
              `don't match cookie domain (${cookieDomain})`
            );
          }
        } else {
          console.warn(
            `[AUTH CONFIG] Different domains detected but AUTH_COOKIE_DOMAIN not set. ` +
            `Consider enabling cross-domain auth or using webhook authentication.`
          );
        }
      } catch (error) {
        console.warn(`[AUTH CONFIG] Could not parse domain URLs for validation`);
      }
    }
  }
}