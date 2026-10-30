/**
 * The admin view of a title's credits sync (CREDITS_SIDECAR.md, section 5):
 * what is stored and where it came from, and while the last attempt failed,
 * why, stated so the kept credits are never read as a newly verified file.
 */

import { render, screen } from '@testing-library/react'

const CreditsStatus = require('@components/Admin/Media/CreditsStatus').default
const fixtures = require('../helpers/creditsFixtures')

const HASH = 'a'.repeat(64)

it('says what is stored and where it came from', () => {
  render(<CreditsStatus record={{ credits: fixtures.mixedGrants(), creditsSource: 'default', creditsHash: HASH }} />)
  expect(screen.getByText(/2 entries from server/)).toBeInTheDocument()
  expect(screen.getByText('default')).toBeInTheDocument()
  expect(screen.queryByRole('status')).toBeNull()
})

it('says when nothing is synced', () => {
  render(<CreditsStatus record={{}} scope="episode" />)
  expect(screen.getByText(/No credits synced\. Add its <NN>_credits\.json/)).toBeInTheDocument()
})

it('states a failure, and that the credits shown are the last valid ones', () => {
  render(
    <CreditsStatus
      record={{
        credits: fixtures.mixedGrants(),
        creditsSource: 'default',
        creditsHash: HASH,
        creditsStatus: {
          state: 'error',
          reason: 'schema',
          detail: 'entries[0].licenceUrl: is not a known field',
          serverId: 'default',
          since: new Date('2026-10-29T06:00:00.000Z'),
        },
      }}
    />
  )
  const status = screen.getByRole('status')
  expect(status).toHaveTextContent('The last credits sync failed: the file does not follow the credits schema')
  expect(status).toHaveTextContent('entries[0].licenceUrl: is not a known field')
  expect(status).toHaveTextContent('since 2026-10-29 06:00 UTC')
  expect(status).toHaveTextContent(`The credits shown are the last valid ones (file ${HASH.slice(0, 12)}), not the failed file.`)
})

it('says no credits are shown when a first file fails', () => {
  render(<CreditsStatus record={{ creditsStatus: { state: 'error', reason: 'server:unreadable', serverId: 'default' } }} />)
  expect(screen.getByRole('status')).toHaveTextContent('the processor could not read the file')
  expect(screen.getByRole('status')).toHaveTextContent('No credits are shown until a file is valid.')
})
