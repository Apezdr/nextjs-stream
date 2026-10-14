// src/lib/roles/capability.ts
// A capability is one thing a role can let a user do. The feature that owns
// it declares it here, with its settings: what a fresh grant holds, what an
// admin holds (everything), how two grants combine (a user with several
// roles), and how settings from a form or the database are checked. Roles
// (store.ts) are named sets of grants; permissionsFor (resolve.ts) merges a
// user's roles. No server-only import: the role editor reads the same
// definitions.

export class RoleInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RoleInputError'
  }
}

export interface CapabilityDefinition<S> {
  /** Stable id, stored in role documents: "<feature>.<action>". */
  key: string
  label: string
  description: string
  /** The settings a new grant starts with in the role editor. */
  empty: S
  /** What an admin holds: the most this capability can allow. */
  full: S
  /** Two grants as one, for a user holding several roles. Never narrower than either. */
  merge(a: S, b: S): S
  /** Settings from an admin's form or the database, checked. Throws RoleInputError. */
  parse(input: unknown): S
}

export type Capability<S = unknown> = Readonly<CapabilityDefinition<S>>

export function defineCapability<S>(definition: CapabilityDefinition<S>): Capability<S> {
  if (!/^[a-z][a-z0-9]*\.[a-z][a-zA-Z0-9]*$/.test(definition.key)) {
    throw new Error(`Capability key "${definition.key}" must look like "feature.action"`)
  }
  return Object.freeze({ ...definition })
}

/** The settings a capability's form is described by, for the browser. */
export interface CapabilitySummary {
  key: string
  label: string
  description: string
  empty: unknown
}

export const summarize = ({ key, label, description, empty }: Capability): CapabilitySummary => ({
  key,
  label,
  description,
  empty,
})
