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
 *    for; a removal is dropped when the merged set writes the same field;
 *  - needs and deferrals: every plan's, in order;
 *  - incomplete: any plan held something back.
 *
 * The gate decision reads the merged plan alone: an incomplete pass leaves
 * the gate open (core/syncGate decideGate).
 *
 * Pure: the caller writes what the merged plan says.
 */

import type { WritePlan } from './types'
import { decideGate, type GateDecision } from './syncGate'

/** The steps' plans as one, with the gate decision they lead to. */
export interface MergedWritePlan<E = Record<string, any>> extends WritePlan<E> {
  gate: GateDecision
}

/** A plan that writes nothing and holds nothing back. */
export function emptyWritePlan<E = Record<string, any>>(): WritePlan<E> {
  return { set: {}, unset: [], needs: [], incomplete: false, deferrals: [] }
}

/**
 * Merge the steps' plans, in the order the steps ran, and decide the gate.
 *
 * @param plans - One plan per step, in step order
 */
export function mergeWritePlans<E = Record<string, any>>(
  plans: readonly WritePlan<E>[]
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

  const merged: WritePlan<E> = {
    set: set as Partial<E>,
    unset: unset.filter((field) => !Object.prototype.hasOwnProperty.call(set, field)),
    needs,
    incomplete,
    deferrals,
  }
  return { ...merged, gate: decideGate(merged) }
}
