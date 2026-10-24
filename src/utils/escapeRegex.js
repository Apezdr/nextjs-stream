/** Escape user input before embedding it in a RegExp or a MongoDB $regex. */
export function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
