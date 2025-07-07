import SignInButtonsWrapper from '@components/SignInButtonsWrapper'

export default function UnauthenticatedPage({ children, callbackUrl }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-between xl:p-24">
      <div className="h-auto flex flex-col gap-y-6 items-center justify-center py-32 lg:py-0 px-4 xl:px-0 sm:mt-20 w-full">
        {children ? (
          <>
            {children}
            <SignInButtonsWrapper callbackUrl={callbackUrl} />
          </>
        ) : (
          <>
            <h2 className="mx-auto max-w-2xl text-3xl font-bold tracking-tight text-white sm:text-4xl pb-8 xl:pb-0 px-4 xl:px-0">
              Please Sign in first
            </h2>
            <SignInButtonsWrapper callbackUrl={callbackUrl} />
          </>
        )}
      </div>
    </div>
  )
}
