/**
 * Pure tree model for the file explorer: path arithmetic, git badge
 * derivation, and flattening the expanded directory set into the flat row list
 * the renderer walks.
 *
 * No React, no fetch, no DOM — the explorer's rendering decisions are all
 * decided here so they can be tested directly. `FileTree.tsx` holds the loaded
 * listings and the expansion set; this module turns them into rows.
 */
import type { DirEntry, FileEntry, GitStatuses, Listing } from '../api/files.ts'

/** What a row draws. */
export type RowKind = 'dir' | 'file'

/** One rendered tree row, already ordered and indented. */
export interface TreeRow {
  /** Absolute host path — the row's identity. */
  path: string
  name: string
  kind: RowKind
  /** Nesting level below the root (root children are 0). */
  depth: number
  /** Directories only: whether their children are showing. */
  expanded: boolean
  /** Dotfile or conventionally-collapsed directory. */
  hidden: boolean
  /**
   * Git porcelain letter for this row, if any. Directories carry a rolled-up
   * badge when anything beneath them changed.
   */
  badge?: string
}

/** Loaded listings, keyed by absolute directory path. */
export type Listings = ReadonlyMap<string, Listing>

/** How to project the loaded state into rows. */
export interface FlattenOptions {
  /** Include dotfiles and collapsed directories. */
  showHidden: boolean
  /** Repository-relative porcelain statuses, or undefined outside a repository. */
  statuses?: GitStatuses
}

/**
 * Normalise a path to forward slashes and drop any trailing separator, so the
 * same directory compares equal however it arrived (host joins use the
 * platform separator; git reports forward slashes).
 */
export function normalize(path: string): string {
  // Hot path: this runs once per entry per tree render. The common input is
  // already a clean POSIX path, so the fast path returns the input untouched
  // with only one indexOf scan + one charCodeAt.
  const len = path.length
  if (len === 0) return ''
  const last = path.charCodeAt(len - 1)
  const hasTrailingSep = last === 47 /* '/' */ || last === 92 /* '\\' */
  const bsIdx = path.indexOf('\\')
  if (bsIdx === -1 && !hasTrailingSep) return path

  // Either has a trailing separator, a backslash, or both. Skip the regex
  // allocation when no backslash is present, then drop any trailing slash
  // without dropping the bare root (`/` alone must survive).
  const forward = bsIdx === -1 ? path : path.replace(/\\/g, '/')
  const flen = forward.length
  return flen > 1 && forward.charCodeAt(flen - 1) === 47 ? forward.slice(0, -1) : forward
}

/**
 * Express `path` relative to `root`, forward-slashed — the key space git
 * porcelain uses.
 * @returns the relative path, or undefined when `path` is not under `root`.
 */
export function relativeTo(root: string, path: string, normalizedRoot?: string): string | undefined {
  // Hot path on a 1000-row tree render. `flatten` already normalises the
  // root once and threads it through, so when it's pre-supplied we skip the
  // per-row `normalize(root)` scan entirely.
  const from = normalizedRoot ?? normalize(root)
  const to = normalize(path)
  if (to === from) return ''
  // Cheap length/char checks first so a non-matching sibling (e.g. `/work/app2`)
  // never pays for the full `startsWith` scan, and no `${from}/` string is allocated.
  if (to.length <= from.length || to.charCodeAt(from.length) !== 47 /* '/' */ || !to.startsWith(from)) {
    return undefined
  }
  return to.slice(from.length + 1)
}

/**
 * The git badge for one entry.
 *
 * Files take their own status. Directories roll up: VS Code marks a folder
 * whose subtree contains changes, which is what makes a collapsed tree
 * scannable. A rollup prefers a real letter over the untracked marker so a
 * folder holding one edited and several new files still reads as modified.
 *
 * `statusKeys` and `normalizedRoot` are hoisted-work hooks for `flatten`'s
 * hot path; external callers can omit both and pay the standard cost.
 * @returns the porcelain letter, or undefined when nothing applies.
 */
export function badgeFor(
  root: string,
  path: string,
  kind: RowKind,
  statuses: GitStatuses | undefined,
  statusKeys?: readonly string[],
  normalizedRoot?: string,
): string | undefined {
  if (statuses === undefined) return undefined
  const rel = relativeTo(root, path, normalizedRoot)
  if (rel === undefined || rel === '') return undefined
  if (kind === 'file') return statuses[rel]

  const prefix = `${rel}/`
  // Reusing the caller's pre-computed `Object.keys(statuses)` saves one
  // tuple-array allocation per row — the dominant cost in a big render —
  // by skipping `Object.entries` and looking up the code directly.
  const keys = statusKeys ?? Object.keys(statuses)
  let untracked: string | undefined
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!
    if (key.length <= rel.length || key.charCodeAt(rel.length) !== 47 || !key.startsWith(prefix)) continue
    const code = statuses[key]
    if (code === '??') { untracked = code; continue }
    return code
  }
  return untracked
}

/** Directories before files, then case-insensitive by name — the VS Code order. */
function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
}

/**
 * Flatten the loaded listings into ordered, indented rows.
 *
 * Only expanded directories recurse, and only listings already loaded
 * contribute children — an expanded directory whose fetch has not landed
 * simply renders without children rather than blocking the whole tree.
 * @param root - the tree's root directory (absolute).
 * @param listings - loaded directory listings.
 * @param expanded - absolute paths of expanded directories.
 * @param options - hidden-file and git-badge projection.
 * @returns rows in render order.
 */
export function flatten(
  root: string,
  listings: Listings,
  expanded: ReadonlySet<string>,
  options: FlattenOptions,
): TreeRow[] {
  const rows: TreeRow[] = []
  const visited = new Set<string>()

  // Hot path hoisting: every row crossing this call resolves against the same
  // root and queries the same status map, so we normalise the root and
  // capture `Object.keys(statuses)` once and thread them through. Without
  // hoisting, a 1000-row render pays for 1000 redundant `normalize(root)`
  // scans and 1000 redundant `[key,value][]` allocations from
  // `Object.entries`.
  const normRoot = normalize(root)
  const statuses = options.statuses
  const statusKeys = statuses === undefined ? undefined : Object.keys(statuses)
  const addBadge = (path: string, kind: RowKind): { badge?: string } =>
    badgeOf(normRoot, path, kind, statuses, statusKeys)

  // Every path crossing this function is normalised. The host joins with the
  // platform separator, git reports forward slashes, and the caller keys its
  // caches and its expansion set by normalised path — mixing the two forms
  // silently breaks lookup on Windows while looking correct on Linux.
  const walk = (dir: string, depth: number): void => {
    // A symlink loop would otherwise recurse until the stack dies.
    if (visited.has(dir)) return
    visited.add(dir)

    const listing = listings.get(dir)
    if (listing === undefined) return

    const visible = <T extends DirEntry>(entries: readonly T[]): T[] =>
      options.showHidden ? [...entries] : entries.filter(entry => !entry.hidden)

    for (const entry of visible(listing.dirs).sort(byName)) {
      const path = normalize(entry.path)
      const isExpanded = expanded.has(path)
      rows.push({
        path,
        name: entry.name,
        kind: 'dir',
        depth,
        expanded: isExpanded,
        hidden: entry.hidden,
        ...addBadge(path, 'dir'),
      })
      if (isExpanded) walk(path, depth + 1)
    }

    for (const entry of visible<FileEntry>(listing.files).sort(byName)) {
      const path = normalize(entry.path)
      rows.push({
        path,
        name: entry.name,
        kind: 'file',
        depth,
        expanded: false,
        hidden: entry.hidden,
        ...addBadge(path, 'file'),
      })
    }
  }

  walk(normRoot, 0)
  return rows
}

/**
 * `exactOptionalPropertyTypes` forbids assigning an explicit `undefined` to an
 * optional member, so an absent badge must be an absent key.
 *
 * Threading `normRoot` / `statusKeys` through skips per-row work that
 * `flatten` has already done for the whole render.
 */
function badgeOf(
  normRoot: string,
  path: string,
  kind: RowKind,
  statuses: GitStatuses | undefined,
  statusKeys: readonly string[] | undefined,
): { badge?: string } {
  const badge = badgeFor(normRoot, path, kind, statuses, statusKeys, normRoot)
  return badge === undefined ? {} : { badge }
}

/**
 * Every ancestor directory of `path` up to and including `root`, nearest last.
 * Revealing a file means loading and expanding exactly this chain.
 * @returns the ancestor paths, or an empty list when `path` is outside `root`.
 */
export function ancestorsOf(root: string, path: string): string[] {
  const rel = relativeTo(root, path)
  if (rel === undefined || rel === '') return []
  const segments = rel.split('/')
  segments.pop() // the entry itself is not its own ancestor
  const out: string[] = []
  let current = normalize(root)
  out.push(current)
  for (const segment of segments) {
    current = `${current}/${segment}`
    out.push(current)
  }
  return out
}

/**
 * The directory a new sibling of `path` belongs in: the directory itself for a
 * directory row, otherwise its parent. Right-clicking a folder targets that
 * folder; right-clicking a file targets the folder holding it.
 */
export function creationParent(row: Pick<TreeRow, 'path' | 'kind'>): string {
  if (row.kind === 'dir') return row.path
  const path = normalize(row.path)
  const cut = path.lastIndexOf('/')
  return cut <= 0 ? path : path.slice(0, cut)
}
