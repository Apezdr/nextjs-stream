import ArrRequestEditor, { describeArrRequest } from '@components/Arr/ArrRequestEditor'

/**
 * Each capability's settings editor and one-line description, by key. The
 * feature that owns a capability owns its editor; a capability without
 * settings (arr.manage) needs neither.
 */
export const CAPABILITY_EDITORS = {
  'arr.request': { Editor: ArrRequestEditor, describe: describeArrRequest },
}
