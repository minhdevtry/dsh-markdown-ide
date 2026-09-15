/**
 * Extract a settled tool-result's file diff hunks — the capture pipeline's
 * "did this call actually change a file" signal (`index.ts`).
 *
 * A local port of `dsh-client-ui-tool`'s `diffCardModel`/`narrowDiffs`, the
 * host's own source of truth for what a settled write/edit's diff looks
 * like. Not imported: `dsh-client-ui-tool` is a leaf UI package, not one of
 * this bundle's platform modules, so a value import from it fails the
 * client-bundle purity gate.
 *
 * This exists because of a measured, real bug: `ToolResultNode` (see
 * `dsh-client-ui-conversation`'s `contract/records.ts`) carries a settled
 * call's diff hunks on `meta: unknown` — there is no `resultView` field on
 * it at all. The capture pipeline used to read `node.resultView?.card`,
 * a field that has never existed at runtime, so it silently never fired for
 * a real agent turn — only for `window.__dsh_start_ai_review` called
 * directly, which is how every test this session ran before this file
 * existed passed anyway.
 */

export interface DiffHunk {
  path: string
  oldText: string | null
  newText: string
}

/** A settled tool-result node's fields this module actually reads. */
export interface SettledDiffSourceNode {
  isError: boolean
  meta?: unknown
  call: { name: string; argsRaw: string } | null
}

/**
 * Narrow an unknown `meta.diffs` payload to well-formed hunks.
 *
 * Filters out no-op hunks (`oldText === newText`, both non-null strings):
 * the settled reconciliation found zero change for that block, and a
 * downstream block-diff pass over it would only churn the GC and pop a
 * useless "review this" in the UI. A `write` fallback carries
 * `oldText: null`, which is a creation, not a no-op, and never matches.
 * @param diffs - the metadata field to validate.
 * @returns the validated hunks, or null when the payload is not usable.
 */
export function narrowDiffs(diffs: unknown): DiffHunk[] | null {
  if (!Array.isArray(diffs) || diffs.length === 0) return null
  const out: DiffHunk[] = []
  for (const hunk of diffs) {
    if (typeof hunk !== 'object' || hunk === null) return null
    const { path, oldText, newText } = hunk as Record<string, unknown>
    if (typeof path !== 'string') return null
    if (oldText !== null && typeof oldText !== 'string') return null
    if (typeof newText !== 'string') return null
    if (oldText !== null && oldText === newText) continue
    // If the hunk already has exactly this shape (the common case — the
    // host's own reconciliation payload), reuse it instead of allocating a
    // fresh object per hunk: a settled call reconciling hundreds of hunks
    // against a large file would otherwise churn one throwaway object each.
    if (!Array.isArray(hunk) && Object.keys(hunk).length === 3) {
      out.push(hunk as unknown as DiffHunk)
    } else {
      out.push({ path, oldText: oldText as string | null, newText })
    }
  }
  // If filtering emptied the array, treat it as "no usable diff" rather
  // than returning [] — callers already distinguish null (no review) from
  // a non-empty hunks array (review this), and `[]` would land in the
  // second bucket and waste one downstream iteration per settled call.
  if (out.length === 0) return null
  return out
}

/**
 * A settled node's usable diff hunks, or null.
 *
 * `meta.diffs` (populated by the tool's own reconciliation against disk) is
 * authoritative when present. A `write` with no such metadata — or an empty
 * one — still falls back to its own call arguments (matching
 * `diffCardModel`'s write fallback): a write's intended content IS what
 * landed, unlike an edit, whose actual applied hunks can differ from what
 * was asked for (fuzzy old-text matching) — no metadata there means no
 * confident diff, not a guess from the request.
 * @param node - the settled tool-result node (already confirmed `!isError`
 *   by the caller — this function does not re-check it).
 * @returns the diff hunks, or null when this call has none this plugin can use.
 */
export function extractSettledDiffs(node: SettledDiffSourceNode): DiffHunk[] | null {
  const meta = node.meta
  if (typeof meta === 'object' && meta !== null && !Array.isArray(meta)) {
    const diffs = (meta as Record<string, unknown>).diffs
    if (Array.isArray(diffs) && diffs.length > 0) {
      const narrowed = narrowDiffs(diffs)
      if (narrowed !== null) return narrowed
    }
  }
  const call = node.call
  if (call === null || typeof call !== 'object' || call.name !== 'write') return null
  try {
    const args = JSON.parse(call.argsRaw)
    const path = args.file_path
    const content = args.content
    if (typeof path !== 'string' || path.trim() === '' || typeof content !== 'string') return null
    return [{ path, oldText: null, newText: content }]
  } catch {
    return null
  }
}
