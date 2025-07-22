import Image from 'next/image'
import Link from 'next/link'
import Clock from '../../../../../public/Clock.png'
import isAuthenticated from '@src/utils/routeAuth'
import { headers } from 'next/headers'
import { classNames } from '@src/utils'
import RetryImage from '@components/RetryImage'

const AuthError = async props => {
  const searchParams = await props.searchParams;
  const headersList = await headers()
  let authResult
  if (headersList.get('cookie')) {
    authResult = await isAuthenticated({
      headers: headersList,
      searchParams,
    })
    if (authResult instanceof Response) {
      return authResult
    }
  }
  const paramError = searchParams.error
  var error = ''
  var pendingApproval = false

  if (paramError === 'APPROVAL_PENDING') {
    pendingApproval = true
    //error = 'Your account is pending approval. Please try again later.'
  } else {
    error = paramError
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-between xl:p-24">
      <div className="flex flex-col max-w-screen-sm">
        <div className="text-center">
          {error ? (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-6 h-6 mx-auto"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m0-10.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.75c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.57-.598-3.75h-.152c-3.196 0-6.1-1.25-8.25-3.286Zm0 13.036h.008v.008H12v-.008Z"
              />
            </svg>
          ) : null}
          {error ? <h1 className="mt-4">Authentication Error</h1> : null}
          {error ? <p className="mt-4">An error occurred during authentication:</p> : null}
          {error ? <pre>{error}</pre> : null}
          {pendingApproval && !error ? (
            <div className="relative">
              <RetryImage
                className="rounded-3xl border border-gray-800"
                src={Clock}
                alt="Clock"
                placeholder="blur"
              />
              <div className="absolute top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2 flex flex-col">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="w-14 h-14 mx-auto mb-2"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v3.75m0-10.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.75c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.57-.598-3.75h-.152c-3.196 0-6.1-1.25-8.25-3.286Zm0 13.036h.008v.008H12v-.008Z"
                  />
                </svg>
                <div className="bg-gray-500 rounded-xl bg-opacity-60">
                  <h3
                    className={classNames(
                      authResult?.approved ? 'text-green-500' : '',
                      'font-bold text-2xl drop-shadow-lg'
                    )}
                  >
                    Your account is {authResult?.approved ? 'approved!' : 'awaiting approval!'}
                  </h3>
                  {!authResult?.approved ? (
                    <h3 className="text-white drop-shadow-md">Check back in later</h3>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
          <div className="flex flex-row gap-4 justify-center">
            <Link href="/list">
              <button
                type="button"
                className="mt-2 mx-auto flex flex-row gap-x-2 rounded bg-indigo-600 px-2 py-1 text-base font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
              >
                Try to go to media list
              </button>
            </Link>
            <Link href="/">
              <button
                type="button"
                className="mt-2 mx-auto flex flex-row gap-x-2 rounded bg-indigo-600 px-2 py-1 text-base font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
              >
                Go to Home
              </button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

export default AuthError
