/**
 * File path utilities for the VS Code workbench layout.
 *
 * Normalises both Windows (`\\`) and POSIX (`/`) separators so path arithmetic
 * behaves consistently across operating systems and remote tunnel hosts.
 */

/**
 * Returns the final name component of a path, handling both `/` and `\\`
 * separators as well as trailing slashes.
 */
export function basename(path: string): string {
  if (!path) return ''
  // Skip the backslash-replace allocation when it can't match, and trim
  // trailing slashes with a char scan instead of a regex — this runs once
  // per row when rendering a large file tree, so the common (already-clean,
  // no-trailing-slash) case should do zero extra allocation.
  const forward = path.indexOf('\\') === -1 ? path : path.replace(/\\/g, '/')
  let end = forward.length
  while (end > 0 && forward.charCodeAt(end - 1) === 47 /* '/' */) end--
  const normalized = end === forward.length ? forward : forward.slice(0, end)
  const idx = normalized.lastIndexOf('/')
  return idx === -1 ? normalized : normalized.slice(idx + 1)
}

/** Whether `str` starts with a Windows drive letter followed by `:/` (e.g. `C:/`). */
function isDriveAbsolute(str: string): boolean {
  if (str.length < 3) return false
  const c0 = str.charCodeAt(0)
  const isLetter = (c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122)
  return isLetter && str.charCodeAt(1) === 58 /* ':' */ && str.charCodeAt(2) === 47 /* '/' */
}

/**
 * Resolve an agent-reported path (bare relative, `./`/`../`-relative, or
 * already absolute — POSIX or a Windows drive letter) against a session's
 * cwd into one canonical absolute string.
 *
 * The single canonical implementation, so it can be the one thing every
 * review/hold/autosave map key goes through — `./src/a.ts`, `src/a.ts`, and
 * the cwd-joined absolute form for the same file must produce the identical
 * string, or two spellings of one file silently become two unrelated map
 * entries (a review registered under one key that a later command, spelling
 * the same path differently, can never find again).
 */
export function resolveWorkspacePath(cwd: string | undefined, target: string): string {
  const normalizedTarget = target.indexOf('\\') === -1 ? target : target.replace(/\\/g, '/')
  const isAbsolute = normalizedTarget.charCodeAt(0) === 47 /* '/' */ || isDriveAbsolute(normalizedTarget)
  if (isAbsolute) return collapseDotSegments(normalizedTarget)
  if (!cwd) return normalizedTarget
  const forwardCwd = cwd.indexOf('\\') === -1 ? cwd : cwd.replace(/\\/g, '/')
  let cwdEnd = forwardCwd.length
  while (cwdEnd > 0 && forwardCwd.charCodeAt(cwdEnd - 1) === 47 /* '/' */) cwdEnd--
  const normalizedCwd = cwdEnd === forwardCwd.length ? forwardCwd : forwardCwd.slice(0, cwdEnd)
  return collapseDotSegments(`${normalizedCwd}/${normalizedTarget}`)
}

/** Resolve `.`/`..` segments in an already-absolute (POSIX or drive-letter) path. */
function collapseDotSegments(path: string): string {
  const isWindowsAbsolute = isDriveAbsolute(path)
  const prefix = isWindowsAbsolute ? path.slice(0, 3) : '/'
  const rest = isWindowsAbsolute ? path.slice(3) : path.slice(1)
  const parts: string[] = []
  for (const part of rest.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') { parts.pop(); continue }
    parts.push(part)
  }
  return prefix + parts.join('/')
}

/**
 * Last file extension of a path, lowercased; empty string when there is none.
 * A leading dot is treated as part of the filename (e.g. `.gitignore`), not an extension marker.
 */
export function extensionOf(path: string): string {
  const name = basename(path)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/**
 * Strips Vietnamese and Latin diacritics / accents for seamless non-accented search.
 * e.g. "Tổng hợp lỗi hệ thống" -> "tong hop loi he thong"
 */
export function removeDiacritics(str: string): string {
  if (!str) return ''
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
}

/**
 * Extracts camelCase and snake_case acronym / initials.
 * e.g. "speechsuper_word_eval.py" -> "swe", "FileIcon.tsx" -> "fi", "HDSD.md" -> "hdsd"
 */
export function getAcronym(str: string): string {
  if (!str) return ''
  const base = basename(str).replace(/\.[^/.]+$/, '')
  const parts = base.split(/[-_.\s]+/).filter(Boolean)
  if (parts.length > 1) {
    return parts.map(p => p[0] || '').join('').toLowerCase()
  }
  const camelInitials = base.replace(/[^A-Z]/g, '').toLowerCase()
  return camelInitials.length > 1 ? camelInitials : base.toLowerCase()
}

/**
 * Converts a heading title into a clean GitHub / TipTap slug.
 * e.g. "1. Điểm khởi động (Entrypoint)" -> "1-diem-khoi-dong-entrypoint"
 */
export function slugifyHeading(heading: string): string {
  return removeDiacritics(heading)
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}

/**
 * Resolves a relative path (e.g. `./sub/doc.md` or `../utils/path.ts`) against the
 * current document's absolute path to produce a fully qualified target path.
 */
export function resolveRelativePath(currentFilePath: string, relativePath: string): string {
  if (!relativePath) return ''
  // Strip hash fragment before resolving path
  const hashIdx = relativePath.indexOf('#')
  const rawPath = hashIdx !== -1 ? relativePath.slice(0, hashIdx) : relativePath
  const hash = hashIdx !== -1 ? relativePath.slice(hashIdx) : ''

  if (!rawPath && hash) {
    return `${currentFilePath}${hash}`
  }

  if (rawPath.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(rawPath)) {
    return `${rawPath.replace(/\\/g, '/')}${hash}`
  }
  const normCurrent = currentFilePath.replace(/\\/g, '/')
  const currentDir = normCurrent.slice(0, Math.max(0, normCurrent.lastIndexOf('/')))
  const parts = currentDir ? currentDir.split('/').filter(Boolean) : []
  const relParts = rawPath.replace(/\\/g, '/').split('/')

  for (const part of relParts) {
    if (!part || part === '.') continue
    if (part === '..') {
      parts.pop()
    } else {
      parts.push(part)
    }
  }

  const prefix = normCurrent.startsWith('/') ? '/' : ''
  return `${prefix}${parts.join('/')}${hash}`
}

/**
 * Computes both the display title and relative href for a target document link
 * relative to the current file and workspace root.
 *
 * Title format rules (clean, human-readable, NO ugly `../../../`):
 * 1. Same directory: Just the bare filename without extension (e.g. "Button").
 * 2. Subdirectory: Subfolder path (e.g. "components/Modal" or "tiptap/BubbleMenu").
 * 3. Outside current directory (sibling, parent, or external):
 *    - If inside workspaceRoot: clean path relative to root (e.g. "explorer/FileTree").
 *    - If outside workspaceRoot: path relative to common anchor (e.g. "Downloads/Code/notes").
 *    - In all cases, NEVER prepend `../` to the title!
 *
 * Href format rules:
 * - Proper relative path that can be resolved via resolveRelativePath (e.g. "./Button.tsx", "../../explorer/FileTree.tsx").
 */
export function getDocLinkInfo(
  currentFilePath?: string,
  targetFilePath?: string,
  workspaceRoot?: string,
): { title: string; href: string; folderBadge?: string; isHeading?: boolean } {
  if (!targetFilePath) return { title: '', href: '' }

  // Handle local heading link (e.g. "#Điểm khởi động")
  if (targetFilePath.startsWith('#')) {
    const headingText = targetFilePath.slice(1)
    const slug = slugifyHeading(headingText)
    return {
      title: `# ${headingText}`,
      href: `#${slug}`,
      folderBadge: 'heading',
      isHeading: true,
    }
  }

  const hashIdx = targetFilePath.indexOf('#')
  const cleanTarget = hashIdx !== -1 ? targetFilePath.slice(0, hashIdx) : targetFilePath
  const hashPart = hashIdx !== -1 ? targetFilePath.slice(hashIdx + 1) : ''
  const hashSuffix = hashPart ? `#${slugifyHeading(hashPart)}` : ''
  const hashTitleSuffix = hashPart ? ` > ${hashPart}` : ''

  if (!currentFilePath) {
    const rawName = basename(cleanTarget)
    return {
      title: `${rawName.replace(/\.[^/.]+$/, '')}${hashTitleSuffix}`,
      href: `./${rawName}${hashSuffix}`,
    }
  }

  const normCurrent = currentFilePath.replace(/\\/g, '/')
  const normTarget = cleanTarget.replace(/\\/g, '/')
  const normRoot = workspaceRoot ? workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '') : undefined
  const currentDir = normCurrent.slice(0, Math.max(0, normCurrent.lastIndexOf('/')))

  // Calculate href (proper relative path for storage & link resolution)
  const fromParts = currentDir.split('/').filter(Boolean)
  const toParts = normTarget.split('/').filter(Boolean)
  let common = 0
  while (common < fromParts.length && common < toParts.length && fromParts[common] === toParts[common]) {
    common++
  }
  const upCount = fromParts.length - common
  const relParts = [...Array(upCount).fill('..'), ...toParts.slice(common)]
  const href = (relParts.length > 0 && !relParts[0]?.startsWith('..') ? './' : '') + relParts.join('/') + hashSuffix

  const targetFileName = basename(normTarget)
  const targetBaseName = targetFileName.replace(/\.[^/.]+$/, '')

  // 1. Same directory
  if (normTarget.startsWith(currentDir + '/') && !normTarget.slice(currentDir.length + 1).includes('/')) {
    return {
      title: `${targetBaseName}${hashTitleSuffix}`,
      href,
      folderBadge: '.',
    }
  }

  // 2. Subdirectory of current directory
  if (normTarget.startsWith(currentDir + '/')) {
    const subPath = normTarget.slice(currentDir.length + 1)
    return {
      title: `${subPath.replace(/\.[^/.]+$/, '')}${hashTitleSuffix}`,
      href,
      folderBadge: subPath.slice(0, Math.max(0, subPath.lastIndexOf('/'))),
    }
  }

  // 3. Outside current directory (no `../` in title!)
  let cleanTitle = ''
  let folderBadge = ''

  if (normRoot && normTarget.startsWith(normRoot + '/')) {
    const fromRoot = normTarget.slice(normRoot.length + 1)
    cleanTitle = fromRoot.replace(/\.[^/.]+$/, '')
    folderBadge = fromRoot.slice(0, Math.max(0, fromRoot.lastIndexOf('/')))
  } else {
    const match = normTarget.match(/(?:Documents|Downloads|Projects|Code|src)\/.*$/i)
    if (match) {
      cleanTitle = match[0].replace(/\.[^/.]+$/, '')
      folderBadge = match[0].slice(0, Math.max(0, match[0].lastIndexOf('/')))
    } else {
      const segments = toParts.slice(-3)
      cleanTitle = segments.join('/').replace(/\.[^/.]+$/, '')
      folderBadge = segments.slice(0, -1).join('/')
    }
  }

  return {
    title: `${cleanTitle}${hashTitleSuffix}`,
    href,
    folderBadge,
  }
}
