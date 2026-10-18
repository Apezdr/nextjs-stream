/**
 * Merging the steps' write plans into one write, and deciding the skip gate.
 *
 * A pass over a title runs its steps in a fixed order. Each step takes its
 * inputs and returns a WritePlan (core/types): the fields to set, the fields
 * to remove, and whether it held a decision back. The service merges the
 * plans, in step order, with mergeWritePlans:
 *
 *  - set: a later plan's value for a field wins over an earlier one's;
 *  - unset: every plan's removals, once each, in the order they were asked
 *    for; a removal is dropped when the merged set writes the same field
 *    (which no pass should ask for, so it is logged as an error);
 *  - needs and deferrals: every plan's, in order;
 *  - incomplete: any plan held something back.
 *
 * The gate decision reads the merged plan alone: an incomplete pass leaves
 * the gate open (core/syncGate decideGate).
 *
 * A builder that works on a copy of the stored document (the TV builders,
 * and the movie's normalization) states its plan with draftWritePlan, and
 * applyWritePlan gives back the document a plan leaves. Field-absence
 * cleanup's outcome is a plan too (cleanupWritePlan), for movies and TV.
 * These are the one implementation of each for both.
 *
 * Writes nothing: the caller writes what the merged plan says.
 */

import type { WritePlan } from './types'
import type { CleanupPlan } from './FieldAbsenceCleaner'
import { decideGate, type GateDecision } from './syncGate'
import { createLogger } from '@src/lib/logger'

const log = createLogger('Sync.WritePlan')

/** The steps' plans as one, with the gate decision they lead to. */
export interface MergedWritePlan<E = Record<string, any>> extends WritePlan<E> {
  gate: GateDecision
}

/**
 * Whether a plan writes its document: a step or builder that writes stamps
 * `lastSynced` in its plan. MovieSyncService writes the movie's
 * normalization only with a step whose plan does.
 */
export function writesDocument(plan: Pick<WritePlan<any>, 'set'>): boolean {
  return Object.prototype.hasOwnProperty.call(plan.set, 'lastSynced')
}

/** A plan that writes nothing and holds nothing back. */
export function emptyWritePlan<E = Record<string, any>>(): WritePlan<E> {
  return { set: {}, unset: [], needs: [], incomplete: false, deferrals: [] }
}

/**
 * Merge the steps' plans, in the order the steps ran, and decide the gate.
 *
 * No plan sets a field that a plan removes: the steps are built so that the
 * one with the field's data decides it. Should that ever break, the set
 * still wins, and each such field is logged as an error with the entity's
 * key, so that a regression is loud without failing the pass.
 *
 * @param plans - One plan per step, in step order
 * @param entityKey - The entity the plans are for (its results' entity id), for the log
 */
export function mergeWritePlans<E = Record<string, any>>(
  plans: readonly WritePlan<E>[],
  entityKey: string
): MergedWritePlan<E> {
  const set: Record<string, any> = {}
  const unset: string[] = []
  const needs: WritePlan['needs'] = []
  const deferrals: string[] = []
  let incomplete = false

  for (const plan of plans) {
    // A field an earlier plan set keeps its place; its value is the later one.
    Object.assign(set, plan.set)
    for (const field of plan.unset) if (!unset.includes(field)) unset.push(field)
    needs.push(...plan.needs)
    deferrals.push(...plan.deferrals)
    incomplete = incomplete || plan.incomplete
  }

  for (const field of unset) {
    if (Object.prototype.hasOwnProperty.call(set, field)) {
      log.error(
        { field, entity: entityKey },
        'A write plan sets a field another plan removes; the set wins'
      )
    }
  }

  const merged: WritePlan<E> = {
    set: set as Partial<E>,
    unset: unset.filter((field) => !Object.prototype.hasOwnProperty.call(set, field)),
    needs,
    incomplete,
    deferrals,
  }
  return { ...merged, gate: decideGate(merged) }
}

/**
 * The plan of a builder that works on a copy of the stored document (a
 * draft): it sets every field the draft holds and the stored document does
 * not, or holds with another value, in the draft's order, and it removes
 * the fields the builder says it removed.
 *
 * The builder's removals are its own list, taken as they are. Each field it
 * took out of the draft that the stored document holds must be on it, and
 * no field on it may still be in the draft.
 *
 * @param existing - The stored document, or null for a new one
 * @param draft - The document the builder wants stored
 * @param unset - The fields the builder removed
 */
export function draftWritePlan<E extends Record<string, any>>(
  existing: E | null,
  draft: E,
  unset: readonly string[]
): Pick<WritePlan<E>, 'set' | 'unset'> {
  const set: Record<string, any> = {}
  for (const [field, value] of Object.entries(draft)) {
    if (!existing || !Object.prototype.hasOwnProperty.call(existing, field) || !Object.is(existing[field], value)) {
      set[field] = value
    }
  }
  return { set: set as Partial<E>, unset: [...unset] }
}

/**
 * The document a plan leaves: the stored document with the plan's fields
 * written over it, in place, and new ones added in the plan's order, then
 * its removals made. A removal of a field the plan also sets is not made,
 * as in mergeWritePlans.
 *
 * @param existing - The stored document, or null for a new one
 */
export function applyWritePlan<E>(existing: E | null, plan: Pick<WritePlan<E>, 'set' | 'unset'>): E {
  const doc: Record<string, any> = { ...(existing ?? {}), ...plan.set }
  for (const field of plan.unset) {
    if (!Object.prototype.hasOwnProperty.call(plan.set, field)) delete doc[field]
  }
  return doc as E
}

/**
 * Field-absence cleanup's outcome as a plan: the fields it removes (enforce
 * mode only), and a removal it held back because not every enabled server
 * answered, which leaves the gate open.
 */
export function cleanupWritePlan<E = Record<string, any>>(cleanup: Pick<CleanupPlan, 'unset' | 'withheld'>): WritePlan<E> {
  const withheld = cleanup.withheld === true
  return {
    ...emptyWritePlan<E>(),
    unset: [...(cleanup.unset ?? [])],
    incomplete: withheld,
    deferrals: withheld ? ['field-absence cleanup'] : [],
  }
}
