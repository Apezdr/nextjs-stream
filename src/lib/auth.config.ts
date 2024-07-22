import Google from 'next-auth/providers/google'
import Discord from 'next-auth/providers/discord'
//import Facebook from 'next-auth/providers/facebook'

import type { NextAuthConfig } from 'next-auth'

const authConfig: NextAuthConfig = {
  providers: [
    Google({
      allowDangerousEmailAccountLinking: true,
    }),
    Discord({
      allowDangerousEmailAccountLinking: true,
    }),
    /* Facebook({
      allowDangerousEmailAccountLinking: true,
    }), */
  ],
}

export default authConfig
