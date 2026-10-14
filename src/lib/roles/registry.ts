// src/lib/roles/registry.ts
// Every capability a role can grant. A feature adds its own here. No
// server-only import: the role editor lists these too.
import { arrManage, arrRequest } from '@src/lib/arr/capabilities'
import type { Capability } from './capability'

export const CAPABILITIES: readonly Capability<any>[] = [arrRequest, arrManage]

export const capabilityByKey = new Map<string, Capability<any>>(CAPABILITIES.map((capability) => [capability.key, capability]))
