/**
 * A movie's credits step: its credits sidecar, kept, fetched or removed by
 * the credits rule (core/credits), apart from the metadata and its lock.
 *
 * The fifth of the movie's steps (MovieSyncService). Its plan sets
 * `credits`, `creditsSource` and `creditsHash` when the owner's file is new
 * and valid, records `creditsStatus` (and holds the gate open) when it could
 * not be read or is not valid, and removes all four when every server that
 * has the movie confirms it has no credits file.
 *
 * Reads the credits file from `resources`: a call made before it is fetched
 * names it in its plan's `needs` and does nothing else (./step).
 */

import { SyncOperation, SyncStatus, type MovieEntity } from '../../core'
import { Resources } from '../../core/resources'
import { creditsReporters, creditsRequest, planCredits, type CreditsRuleInput } from '../../core/credits'
import { emptyWritePlan } from '../../core/writePlan'
import { movieStepResult, pendingStep, type MovieCreditsInput, type MovieStepOutcome } from './step'

export function syncMovieCredits(
  { originalTitle, movie, payload, run, availability }: MovieCreditsInput,
  resources: Resources = new Resources()
): MovieStepOutcome {
  const rule: CreditsRuleInput = {
    stored: movie as any,
    reported: payload?.credits,
    reporters: creditsReporters(availability.fieldAvailability, 'movies', originalTitle),
    scope: 'title',
    run,
    now: new Date(),
  }

  // The file the step reads, if any: a call made before it is fetched stops here.
  const request = creditsRequest(rule)
  if (request && !resources.read(request)) {
    return pendingStep(originalTitle, SyncOperation.Credits, run, resources.needs)
  }

  const outcome = planCredits(rule, (asked) => resources.read(asked))
  const plan = emptyWritePlan<MovieEntity>()
  plan.set = outcome.set as Partial<MovieEntity>
  plan.unset = outcome.unset
  if (outcome.holdBack) {
    plan.incomplete = true
    plan.deferrals.push(outcome.holdBack)
  }

  const status =
    outcome.action === 'failed'
      ? SyncStatus.Failed
      : outcome.action === 'stored' || outcome.action === 'removed'
        ? SyncStatus.Completed
        : SyncStatus.Skipped
  return {
    plan,
    result: movieStepResult(originalTitle, SyncOperation.Credits, run, status, outcome.changes, outcome.errors),
  }
}
