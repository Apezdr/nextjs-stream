import { auth } from '../../lib/auth'
import { getServerStatus } from '@src/utils/serverStatus'
import SignOutButton from '@components/SignOutButton'
import SignInButtonsWrapper from '@components/SignInButtonsWrapper'
import ServerStatus from '@components/Login/Status'
import ViewCatalogButton from '@components/Login/ViewCatalogButton'
import { connection } from 'next/server'

// Component that performs dynamic server status check
export default async function ServerStatusCheck() {
  await connection()
  
  const _serverStatus = await getServerStatus()

  let session = null
  if (_serverStatus?.ok) {
    session = await auth()
  }

  return (
    <>
      {session ? (
        <>
          <span className="mb-2">View our catalog of media.</span>
          <ViewCatalogButton />
          <hr className="h-px my-8 bg-gray-200 border-0 dark:bg-gray-700 w-2/4" />
          <span className="mb-2 text-gray-400">
            Take a break, we'll be here when you get back.
          </span>
          <SignOutButton />
        </>
      ) : (
        <>
          <span className="mb-2">To view our catalog of media, please sign in.</span>
          <SignInButtonsWrapper />
        </>
      )}
      {_serverStatus?.ok ? null : <ServerStatus _serverStatus={_serverStatus} />}
    </>
  )
}
