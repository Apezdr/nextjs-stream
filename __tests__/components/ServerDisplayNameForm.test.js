import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import ServerDisplayNameForm from '@src/components/Admin/Settings/ServerDisplayNameForm'

jest.mock('@src/utils/actions/admin_settings', () => ({
  updateServerDisplayName: jest.fn(),
}))

describe('ServerDisplayNameForm', () => {
  let container
  let root
  let previousActEnvironment

  beforeAll(() => {
    previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  afterAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
  })

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  test('shows and locks a Docker Compose-owned name', async () => {
    await act(async () => root.render(
      <ServerDisplayNameForm
        serverId="default"
        displayName="Primary Library"
        displayNameOverride="Old Database Name"
        displayNameEditable={false}
        displayNameEnvironmentVariable="SERVER_DISPLAY_NAME"
      />
    ))

    expect(container.querySelector('input[name="displayName"]')).toBeDisabled()
    expect(container.querySelector('input[name="displayName"]')).toHaveValue('Primary Library')
    expect(container.querySelector('button[type="submit"]')).toBeNull()
    expect(container).toHaveTextContent('Managed by Docker Compose via SERVER_DISPLAY_NAME')
  })

  test('keeps database-backed names editable', async () => {
    await act(async () => root.render(
      <ServerDisplayNameForm
        serverId="server2"
        displayName="Remote Library"
        displayNameOverride="Remote Library"
        displayNameEditable
        displayNameEnvironmentVariable="SERVER_DISPLAY_NAME_2"
      />
    ))

    expect(container.querySelector('input[name="displayName"]')).toBeEnabled()
    expect(container.querySelector('button[type="submit"]')).toBeEnabled()
  })
})