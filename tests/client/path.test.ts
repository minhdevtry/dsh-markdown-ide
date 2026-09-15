import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  basename,
  resolveWorkspacePath,
  extensionOf,
  removeDiacritics,
  getAcronym,
  slugifyHeading,
  resolveRelativePath,
  getDocLinkInfo,
} from '../../src/client/utils/path.ts'

describe('basename', () => {
  test('returns the final component of a POSIX path', () => {
    assert.equal(basename('/a/b/c.ts'), 'c.ts')
  })

  test('returns the final component of a Windows path', () => {
    assert.equal(basename('C:\\a\\b\\c.ts'), 'c.ts')
  })

  test('strips trailing slashes', () => {
    assert.equal(basename('/a/b/c/'), 'c')
    assert.equal(basename('/a/b/c///'), 'c')
  })

  test('returns the whole string when there is no separator', () => {
    assert.equal(basename('file.ts'), 'file.ts')
  })

  test('returns empty string for empty input', () => {
    assert.equal(basename(''), '')
  })
})

describe('resolveWorkspacePath', () => {
  test('returns collapsed target as-is when already absolute (POSIX)', () => {
    assert.equal(resolveWorkspacePath('/home/user/project', '/etc/passwd'), '/etc/passwd')
  })

  test('resolves a Windows drive-letter absolute path', () => {
    assert.equal(resolveWorkspacePath('/home/user', 'C:/foo/bar.ts'), 'C:/foo/bar.ts')
  })

  test('joins a relative path against cwd', () => {
    assert.equal(resolveWorkspacePath('/home/user/project', 'src/a.ts'), '/home/user/project/src/a.ts')
  })

  test('joins a ./-relative path against cwd', () => {
    assert.equal(resolveWorkspacePath('/home/user/project', './src/a.ts'), '/home/user/project/src/a.ts')
  })

  test('collapses ../ segments against cwd', () => {
    assert.equal(resolveWorkspacePath('/home/user/project/sub', '../a.ts'), '/home/user/project/a.ts')
  })

  test('normalizes backslashes in both cwd and target', () => {
    assert.equal(resolveWorkspacePath('C:\\Users\\me\\project', 'src\\a.ts'), 'C:/Users/me/project/src/a.ts')
  })

  test('strips trailing slash from cwd before joining', () => {
    assert.equal(resolveWorkspacePath('/home/user/project/', 'a.ts'), '/home/user/project/a.ts')
  })

  test('returns normalized target unchanged when cwd is undefined', () => {
    assert.equal(resolveWorkspacePath(undefined, 'src\\a.ts'), 'src/a.ts')
  })

  test('produces the same canonical string for equivalent spellings of one file', () => {
    const a = resolveWorkspacePath('/home/user/project', './src/a.ts')
    const b = resolveWorkspacePath('/home/user/project', 'src/a.ts')
    const c = resolveWorkspacePath('/home/user/project', '/home/user/project/src/a.ts')
    assert.equal(a, b)
    assert.equal(b, c)
  })
})

describe('extensionOf', () => {
  test('returns lowercased extension', () => {
    assert.equal(extensionOf('/a/b/Component.TSX'), 'tsx')
  })

  test('returns empty string when there is no extension', () => {
    assert.equal(extensionOf('/a/b/README'), '')
  })

  test('treats a leading dot as part of the filename, not an extension marker', () => {
    assert.equal(extensionOf('.gitignore'), '')
  })

  test('handles a dotfile with a real extension', () => {
    assert.equal(extensionOf('.eslintrc.json'), 'json')
  })
})

describe('removeDiacritics', () => {
  test('strips Vietnamese diacritics and lowercases', () => {
    assert.equal(removeDiacritics('Tổng hợp lỗi hệ thống'), 'tong hop loi he thong')
  })

  test('handles the đ/Đ special case not covered by NFD normalization', () => {
    assert.equal(removeDiacritics('Đường dẫn'), 'duong dan')
  })

  test('returns empty string for empty input', () => {
    assert.equal(removeDiacritics(''), '')
  })

  test('leaves plain ASCII lowercase text unchanged', () => {
    assert.equal(removeDiacritics('hello world'), 'hello world')
  })
})

describe('getAcronym', () => {
  test('derives acronym from snake_case parts', () => {
    assert.equal(getAcronym('speechsuper_word_eval.py'), 'swe')
  })

  test('derives acronym from camelCase', () => {
    assert.equal(getAcronym('FileIcon.tsx'), 'fi')
  })

  test('derives acronym from an all-caps basename', () => {
    assert.equal(getAcronym('HDSD.md'), 'hdsd')
  })

  test('returns empty string for empty input', () => {
    assert.equal(getAcronym(''), '')
  })
})

describe('slugifyHeading', () => {
  test('slugifies a heading with diacritics and punctuation', () => {
    assert.equal(slugifyHeading('1. Điểm khởi động (Entrypoint)'), '1-diem-khoi-dong-entrypoint')
  })

  test('collapses internal whitespace runs into a single dash', () => {
    assert.equal(slugifyHeading('foo   bar'), 'foo-bar')
  })

  test('trims leading and trailing whitespace before dashing', () => {
    assert.equal(slugifyHeading('  hello world  '), 'hello-world')
  })
})

describe('resolveRelativePath', () => {
  test('returns empty string when relativePath is empty', () => {
    assert.equal(resolveRelativePath('/a/b/c.md', ''), '')
  })

  test('resolves a same-directory relative link', () => {
    assert.equal(resolveRelativePath('/a/b/c.md', './d.md'), '/a/b/d.md')
  })

  test('resolves a parent-directory relative link', () => {
    assert.equal(resolveRelativePath('/a/b/c.md', '../d.md'), '/a/d.md')
  })

  test('preserves an absolute POSIX target as-is', () => {
    assert.equal(resolveRelativePath('/a/b/c.md', '/x/y.md'), '/x/y.md')
  })

  test('preserves a Windows drive-letter absolute target, normalizing separators', () => {
    assert.equal(resolveRelativePath('/a/b/c.md', 'C:\\x\\y.md'), 'C:/x/y.md')
  })

  test('carries a hash fragment through to the resolved path', () => {
    assert.equal(resolveRelativePath('/a/b/c.md', './d.md#section'), '/a/b/d.md#section')
  })

  test('resolves a bare hash fragment against the current file', () => {
    assert.equal(resolveRelativePath('/a/b/c.md', '#section'), '/a/b/c.md#section')
  })
})

describe('getDocLinkInfo', () => {
  test('returns empty result when targetFilePath is missing', () => {
    assert.deepEqual(getDocLinkInfo('/a/b/c.md', undefined), { title: '', href: '' })
  })

  test('builds a heading link result for a local heading target', () => {
    const result = getDocLinkInfo('/a/b/c.md', '#Điểm khởi động')
    assert.equal(result.title, '# Điểm khởi động')
    assert.equal(result.href, '#diem-khoi-dong')
    assert.equal(result.folderBadge, 'heading')
    assert.equal(result.isHeading, true)
  })

  test('handles a missing currentFilePath by producing a bare relative href', () => {
    const result = getDocLinkInfo(undefined, '/a/b/Button.tsx')
    assert.equal(result.title, 'Button')
    assert.equal(result.href, './Button.tsx')
  })

  test('links to a file in the same directory', () => {
    const result = getDocLinkInfo('/root/components/Button.tsx', '/root/components/Modal.tsx')
    assert.equal(result.title, 'Modal')
    assert.equal(result.href, './Modal.tsx')
    assert.equal(result.folderBadge, '.')
  })

  test('links to a file in a subdirectory', () => {
    const result = getDocLinkInfo('/root/components/Button.tsx', '/root/components/tiptap/BubbleMenu.tsx')
    assert.equal(result.title, 'tiptap/BubbleMenu')
    assert.equal(result.href, './tiptap/BubbleMenu.tsx')
    assert.equal(result.folderBadge, 'tiptap')
  })

  test('links to a sibling directory using a relative href with no leading ../ in the title', () => {
    const result = getDocLinkInfo(
      '/root/components/Button.tsx',
      '/root/explorer/FileTree.tsx',
      '/root',
    )
    assert.equal(result.title, 'explorer/FileTree')
    assert.equal(result.href, '../explorer/FileTree.tsx')
    assert.ok(!result.title.startsWith('..'))
  })

  test('falls back to a well-known folder anchor when target is outside the workspace root', () => {
    const result = getDocLinkInfo(
      '/home/user/other/Button.tsx',
      '/home/user/Downloads/Code/notes.md',
    )
    assert.ok(result.title.startsWith('Downloads/Code'))
  })

  test('appends heading hash suffix to title and href when target has a fragment', () => {
    const result = getDocLinkInfo('/root/components/Button.tsx', '/root/components/Modal.tsx#usage')
    assert.equal(result.title, 'Modal > usage')
    assert.equal(result.href, './Modal.tsx#usage')
  })
})

// --- Optimization invariants: the new fast paths must stay byte-identical
// to the legacy behaviour. Each case below is a regression guard against an
// optimisation reordering an allocation or short-circuit that would change a
// return value.

describe('resolveWorkspacePath — optimization invariants', () => {
  test('strips multiple leading ./ segments before joining', () => {
    assert.equal(resolveWorkspacePath('/home/user/project', '././src/a.ts'), '/home/user/project/src/a.ts')
    assert.equal(resolveWorkspacePath('/home/user/project', './../src/a.ts'), '/home/user/src/a.ts')
  })

  test('handles a single dot as the entire relative target', () => {
    assert.equal(resolveWorkspacePath('/home/user/project', '.'), '/home/user/project')
  })

  test('collapses a path with mixed . and .. segments', () => {
    assert.equal(resolveWorkspacePath('/a/b/c', './d/../e/./f'), '/a/b/c/e/f')
  })

  test('preserves the trailing component when cwd itself ends with a slash', () => {
    assert.equal(resolveWorkspacePath('/home/user/project///', 'a.ts'), '/home/user/project/a.ts')
  })

  test('returns the drive-letter prefix when the relative target collapses to a drive root', () => {
    assert.equal(resolveWorkspacePath(undefined, 'C:\\..\\..'), 'C:/')
  })

  test('handles consecutive slashes between cwd and target', () => {
    // The manual scanner in collapseDotSegments must still treat `//` as a
    // single separator boundary.
    assert.equal(resolveWorkspacePath('/home/user/project', 'src//a.ts'), '/home/user/project/src/a.ts')
  })
})

describe('resolveRelativePath — optimization invariants', () => {
  test('treats a Windows drive-letter target with backslash separator as absolute', () => {
    // The previous regex `/^[a-zA-Z]:[\\/]/` was replaced with a charCode-based
    // check; this test guards that the new check accepts both `C:\` and `C:/`.
    assert.equal(resolveRelativePath('/a/b/c.md', 'C:\\x\\y.md'), 'C:/x/y.md')
    assert.equal(resolveRelativePath('/a/b/c.md', 'D:/x/y.md'), 'D:/x/y.md')
  })

  test('handles a backslash relative path against a forward-slash cwd', () => {
    assert.equal(resolveRelativePath('/a/b/c.md', '..\\utils\\path.ts'), '/a/utils/path.ts')
  })

  test('preserves a leading POSIX slash on a relative target', () => {
    assert.equal(resolveRelativePath('/a/b/c.md', '/elsewhere.md#frag'), '/elsewhere.md#frag')
  })

  test('keeps the prefix `/` for absolute POSIX current paths', () => {
    assert.equal(resolveRelativePath('/a/b/c.md', './d.md'), '/a/b/d.md')
  })

  test('handles a bare relative target without ./ prefix', () => {
    assert.equal(resolveRelativePath('/a/b/c.md', 'd.md'), '/a/b/d.md')
  })
})

describe('getDocLinkInfo — optimization invariants', () => {
  test('strips trailing slashes from workspaceRoot before matching', () => {
    const result = getDocLinkInfo(
      '/root/components/Button.tsx',
      '/root/explorer/FileTree.tsx',
      '/root///',
    )
    assert.equal(result.title, 'explorer/FileTree')
    assert.equal(result.href, '../explorer/FileTree.tsx')
  })

  test('strips trailing backslashes from workspaceRoot', () => {
    const result = getDocLinkInfo(
      '/root/components/Button.tsx',
      '/root/explorer/FileTree.tsx',
      '\\root\\\\',
    )
    assert.equal(result.title, 'explorer/FileTree')
    assert.equal(result.href, '../explorer/FileTree.tsx')
  })

  test('does not strip the lone root prefix', () => {
    // The helper must keep `/` alone and not drop via `len > 1`.
    const result = getDocLinkInfo(
      '/root/components/Button.tsx',
      '/root/explorer/FileTree.tsx',
      '/',
    )
    // With workspaceRoot = `/`, every absolute path is inside, so the title
    // is built relative to root.
    assert.equal(result.title, 'root/explorer/FileTree')
  })
})
