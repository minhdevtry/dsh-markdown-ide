import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost' })
globalThis.window = dom.window as any
globalThis.document = dom.window.document as any
globalThis.HTMLElement = dom.window.HTMLElement as any
globalThis.Element = dom.window.Element as any
globalThis.Node = dom.window.Node as any
globalThis.DOMParser = dom.window.DOMParser as any
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window) as any

import { parseWikiLinkText, formatWikiLink, buildGraphFromDocuments } from '../../src/client/tiptap/wiki/wikiLink.ts'

describe('Wiki-Links and Knowledge Graph (Task 9)', () => {
  test('parseWikiLinkText correctly parses target, anchor and alias', () => {
    const parsed1 = parseWikiLinkText('[[my-doc]]')
    assert.deepEqual(parsed1, {
      target: 'my-doc',
      anchor: null,
      alias: null,
    })

    const parsed2 = parseWikiLinkText('[[architecture/overview#database|DB Design]]')
    assert.deepEqual(parsed2, {
      target: 'architecture/overview',
      anchor: 'database',
      alias: 'DB Design',
    })
  })

  test('formatWikiLink formats wiki-link correctly', () => {
    const formatted1 = formatWikiLink({ target: 'guide', anchor: null, alias: null })
    assert.equal(formatted1, '[[guide]]')

    const formatted2 = formatWikiLink({ target: 'guide', anchor: 'step-1', alias: 'Step One' })
    assert.equal(formatted2, '[[guide#step-1|Step One]]')
  })

  test('buildGraphFromDocuments extracts nodes and edges from workspace documents', () => {
    const docs = [
      {
        path: 'index.md',
        content: 'Welcome to [[architecture]] and see [Setup](./setup.md).',
      },
      {
        path: 'architecture.md',
        content: 'Architecture overview. References [[components]] and [[setup]].',
      },
      {
        path: 'setup.md',
        content: 'Setup guide. Back to [[index]].',
      },
      {
        path: 'components.md',
        content: 'Components library.',
      },
    ]

    const graph = buildGraphFromDocuments(docs)
    assert.equal(graph.nodes.length, 4)
    assert.equal(graph.nodes.some(n => n.id === 'index.md'), true)
    assert.equal(graph.nodes.some(n => n.id === 'architecture.md'), true)

    // Check that edges exist between linked documents
    assert.equal(graph.links.length >= 4, true)
    const indexToArch = graph.links.find(l => l.source === 'index.md' && l.target === 'architecture.md')
    assert.ok(indexToArch, 'Expected link from index.md to architecture.md')

    const indexToSetup = graph.links.find(l => l.source === 'index.md' && l.target === 'setup.md')
    assert.ok(indexToSetup, 'Expected link from index.md to setup.md')
  })
})

describe('Wiki-Links edge cases (hardening)', () => {
  test('parseWikiLinkText rejects malformed/empty segments', () => {
    assert.equal(parseWikiLinkText('[[]]'), null)
    assert.equal(parseWikiLinkText('[[#anchor]]'), null)
    assert.equal(parseWikiLinkText('[[doc#]]'), null)
    assert.equal(parseWikiLinkText('[[doc|]]'), null)
    assert.equal(parseWikiLinkText('not-a-wiki-link'), null)
    assert.equal(parseWikiLinkText('[[unterminated'), null)
  })

  test('parseWikiLinkText resolves nested brackets to the innermost well-formed link', () => {
    // The parser is anchored to the start of the string, so a malformed outer
    // shell like `[[a[[b]]]]` never matches as a whole - it is treated as
    // "no link found" rather than misparsing `a[[b` as a target.
    assert.equal(parseWikiLinkText('[[a[[b]]]]'), null)

    // `matchAll` (used by buildGraphFromDocuments) scans the whole string and
    // will find the innermost valid `[[b]]` occurrence instead.
    const inner = [...'[[a[[b]]]]'.matchAll(/\[\[([^[\]|#]+?)(?:#[^\]|]+?)?(?:\|[^\]]+?)?\]\]/g)]
    assert.equal(inner.length, 1)
    assert.equal(inner[0]?.[1], 'b')
  })

  test('parseWikiLinkText trims plain whitespace and NBSP around target/anchor/alias', () => {
    const parsed = parseWikiLinkText('[[  doc name  #  anchor-1  |  Alias Text  ]]')
    assert.deepEqual(parsed, {
      target: 'doc name',
      anchor: 'anchor-1',
      alias: 'Alias Text',
    })

    // U+00A0 (NBSP) is recognized as whitespace by String.prototype.trim().
    const withNbsp = parseWikiLinkText('[[ doc | Alias ]]')
    assert.deepEqual(withNbsp, {
      target: 'doc',
      anchor: null,
      alias: 'Alias',
    })
  })

  test('parseWikiLinkText preserves non-trimmable Unicode characters (zero-width space)', () => {
    // U+200B (zero-width space) is NOT whitespace per the trim() spec, so it
    // is preserved verbatim rather than silently stripped.
    const parsed = parseWikiLinkText('[[a​]]')
    assert.deepEqual(parsed, { target: 'a​', anchor: null, alias: null })
  })

  test('parseWikiLinkText allows literal "#" and "|" inside the anchor/alias tail', () => {
    // Anchor greedily consumes up to the closing `]]`, so a second `#` stays
    // part of the anchor rather than starting a new segment.
    const withHashInAnchor = parseWikiLinkText('[[a#b#c]]')
    assert.deepEqual(withHashInAnchor, { target: 'a', anchor: 'b#c', alias: null })

    // Same for a second `|` inside the alias.
    const withPipeInAlias = parseWikiLinkText('[[a|b|c]]')
    assert.deepEqual(withPipeInAlias, { target: 'a', anchor: null, alias: 'b|c' })
  })

  test('parseWikiLinkText supports non-ASCII target/anchor/alias text', () => {
    const parsed = parseWikiLinkText('[[日本語/文書#見出し|表示名]]')
    assert.deepEqual(parsed, {
      target: '日本語/文書',
      anchor: '見出し',
      alias: '表示名',
    })
  })

  test('parseWikiLinkText only consumes a leading well-formed link and ignores trailing text', () => {
    const parsed = parseWikiLinkText('[[doc]] followed by prose')
    assert.deepEqual(parsed, { target: 'doc', anchor: null, alias: null })
  })

  test('formatWikiLink/parseWikiLinkText round-trip for anchors and Unicode aliases', () => {
    const attrs = { target: 'architecture/overview', anchor: 'section-1', alias: '日本語 Alias' }
    const formatted = formatWikiLink(attrs)
    assert.equal(formatted, '[[architecture/overview#section-1|日本語 Alias]]')
    assert.deepEqual(parseWikiLinkText(formatted), attrs)
  })

  test('buildGraphFromDocuments extracts the innermost link from malformed nested brackets', () => {
    const docs = [
      { path: 'index.md', content: 'See [[a[[components]]]] for details.' },
      { path: 'components.md', content: 'Components library.' },
    ]
    const graph = buildGraphFromDocuments(docs)
    const link = graph.links.find(l => l.source === 'index.md' && l.target === 'components.md')
    assert.ok(link, 'Expected the innermost [[components]] occurrence to resolve to components.md')
  })

  test('buildGraphFromDocuments resolves targets with spaces and Unicode characters', () => {
    const docs = [
      { path: 'index.md', content: 'Refer to [[Café Notes]] for setup.' },
      { path: 'Café Notes.md', content: 'Notes content.' },
    ]
    const graph = buildGraphFromDocuments(docs)
    const link = graph.links.find(l => l.source === 'index.md' && l.target === 'Café Notes.md')
    assert.ok(link, 'Expected wiki-link with spaces/Unicode to resolve to the matching document')
  })

  test('buildGraphFromDocuments ignores self-referencing wiki-links', () => {
    const docs = [
      { path: 'index.md', content: 'This document links to itself: [[index]].' },
    ]
    const graph = buildGraphFromDocuments(docs)
    assert.equal(graph.links.length, 0)
    assert.equal(graph.nodes.length, 1)
  })

  test('buildGraphFromDocuments deduplicates repeated wiki-links between the same pair of documents', () => {
    const docs = [
      { path: 'index.md', content: '[[setup]] and again [[setup]] and once more [[setup]].' },
      { path: 'setup.md', content: 'Setup guide.' },
    ]
    const graph = buildGraphFromDocuments(docs)
    const matches = graph.links.filter(l => l.source === 'index.md' && l.target === 'setup.md')
    assert.equal(matches.length, 1)
  })

  test('buildGraphFromDocuments ignores unresolved wiki-links to unknown documents', () => {
    const docs = [
      { path: 'index.md', content: 'A dangling reference: [[does-not-exist]].' },
    ]
    const graph = buildGraphFromDocuments(docs)
    assert.equal(graph.links.length, 0)
  })

  test('buildGraphFromDocuments resolves nested paths regardless of path separators or .md casing', () => {
    const docs = [
      { path: 'guides\\setup.MD', content: 'Guide content.' },
      { path: 'index.md', content: 'See [[guides/setup]] for the guide.' },
    ]
    const graph = buildGraphFromDocuments(docs)
    const link = graph.links.find(l => l.source === 'index.md' && l.target === 'guides\\setup.MD')
    assert.ok(link, 'Expected normalized path resolution across separators and extension casing')
  })
})

describe('Wiki-Links and Knowledge Graph (additional hardening)', () => {
  test('parseWikiLinkText accepts URL-reserved and shell-safe characters in target', () => {
    // The target character class `[^[\]|#]+?` only excludes `[`, `]`, `|`, `#`,
    // so file names containing dots, hyphens, underscores, tildes and URL-
    // reserved characters are preserved verbatim.
    assert.deepEqual(
      parseWikiLinkText('[[v1.0.0]]'),
      { target: 'v1.0.0', anchor: null, alias: null },
    )
    assert.deepEqual(
      parseWikiLinkText('[[a-b-c]]'),
      { target: 'a-b-c', anchor: null, alias: null },
    )
    assert.deepEqual(
      parseWikiLinkText('[[a_b_c]]'),
      { target: 'a_b_c', anchor: null, alias: null },
    )
    assert.deepEqual(
      parseWikiLinkText('[[a~b]]'),
      { target: 'a~b', anchor: null, alias: null },
    )
    assert.deepEqual(
      parseWikiLinkText('[[a&b?c=d]]'),
      { target: 'a&b?c=d', anchor: null, alias: null },
    )
  })

  test('parseWikiLinkText does not interpret markdown formatting characters inside the target', () => {
    // `*`, `**`, `_`, backticks and similar markdown markers are NOT in the
    // excluded target char class, so they remain literal text.
    assert.deepEqual(
      parseWikiLinkText('[[a*b]]'),
      { target: 'a*b', anchor: null, alias: null },
    )
    assert.deepEqual(
      parseWikiLinkText('[[a**b]]'),
      { target: 'a**b', anchor: null, alias: null },
    )
    assert.deepEqual(
      parseWikiLinkText('[[a`b]]'),
      { target: 'a`b', anchor: null, alias: null },
    )
  })

  test('parseWikiLinkText keeps embedded newlines inside the target verbatim', () => {
    // `\n` is not in the excluded char set and not stripped by `.trim()`, so
    // an unterminated-on-first-line wiki-link is preserved as-is rather than
    // being truncated or rejected outright.
    const parsed = parseWikiLinkText('[[a\nb]]')
    assert.deepEqual(parsed, { target: 'a\nb', anchor: null, alias: null })
  })

  test('parseWikiLinkText allows a literal "[" inside the alias tail but stops at the first "]"', () => {
    // The alias character class `[^\]]+?` only excludes `]`, so `[` is a
    // legal alias character. The match ends at the first `]]`.
    const parsed = parseWikiLinkText('[[a|b[c]]')
    assert.deepEqual(parsed, { target: 'a', anchor: null, alias: 'b[c' })
  })

  test('parseWikiLinkText allows leading and trailing pipe characters in the alias', () => {
    // Alias may begin or end with `|` because the regex engine matches the
    // shortest non-`]` run that still leaves `]]` for the closer.
    const leading = parseWikiLinkText('[[a||b]]')
    assert.deepEqual(leading, { target: 'a', anchor: null, alias: '|b' })

    const trailing = parseWikiLinkText('[[a|b|]]')
    assert.deepEqual(trailing, { target: 'a', anchor: null, alias: 'b|' })
  })

  test('parseWikiLinkText allows a literal "#" at the start of the anchor segment', () => {
    const parsed = parseWikiLinkText('[[a##b]]')
    assert.deepEqual(parsed, { target: 'a', anchor: '#b', alias: null })
  })

  test('parseWikiLinkText allows a literal ".md" suffix inside the target segment', () => {
    // The bracket regex does NOT strip `.md`. Extension stripping is the
    // caller's job (see `normalizeDocKey` in buildGraphFromDocuments).
    assert.deepEqual(
      parseWikiLinkText('[[doc.md]]'),
      { target: 'doc.md', anchor: null, alias: null },
    )
  })

  test('formatWikiLink omits the anchor and alias segments when both are null', () => {
    assert.equal(
      formatWikiLink({ target: 'doc', anchor: null, alias: null }),
      '[[doc]]',
    )
  })

  test('formatWikiLink omits only the anchor when alias is provided', () => {
    assert.equal(
      formatWikiLink({ target: 'doc', anchor: null, alias: 'Display' }),
      '[[doc|Display]]',
    )
  })

  test('formatWikiLink omits only the alias when anchor is provided', () => {
    assert.equal(
      formatWikiLink({ target: 'doc', anchor: 'section', alias: null }),
      '[[doc#section]]',
    )
  })

  test('formatWikiLink/parseWikiLinkText round-trip preserves special-character targets', () => {
    const attrs = { target: 'release-notes/v1.0.0-rc_1', anchor: null, alias: null }
    const formatted = formatWikiLink(attrs)
    assert.equal(formatted, '[[release-notes/v1.0.0-rc_1]]')
    assert.deepEqual(parseWikiLinkText(formatted), attrs)
  })

  test('formatWikiLink/parseWikiLinkText round-trip preserves both anchor and alias', () => {
    const attrs = { target: 'guide', anchor: 'step-1', alias: 'Step One' }
    const formatted = formatWikiLink(attrs)
    assert.equal(formatted, '[[guide#step-1|Step One]]')
    assert.deepEqual(parseWikiLinkText(formatted), attrs)
  })

  test('formatWikiLink/parseWikiLinkText round-trip preserves a "." in the anchor', () => {
    const attrs = { target: 'guide', anchor: 'step.1.2', alias: null }
    const formatted = formatWikiLink(attrs)
    assert.equal(formatted, '[[guide#step.1.2]]')
    assert.deepEqual(parseWikiLinkText(formatted), attrs)
  })

  test('buildGraphFromDocuments returns an empty graph for an empty docs array', () => {
    const graph = buildGraphFromDocuments([])
    assert.deepEqual(graph, { nodes: [], links: [] })
  })

  test('buildGraphFromDocuments handles a single document with no links', () => {
    const docs = [{
      path: 'lonely.md',
      content: 'A document with no wiki-links or markdown links.',
    }]
    const graph = buildGraphFromDocuments(docs)
    assert.equal(graph.nodes.length, 1)
    assert.equal(graph.nodes[0]?.id, 'lonely.md')
    assert.equal(graph.links.length, 0)
  })

  test('buildGraphFromDocuments handles a document whose content is empty', () => {
    const docs = [{ path: 'empty.md', content: '' }]
    const graph = buildGraphFromDocuments(docs)
    assert.equal(graph.nodes.length, 1)
    assert.equal(graph.links.length, 0)
  })

  test('buildGraphFromDocuments handles a document with whitespace-only content', () => {
    const docs = [{ path: 'blank.md', content: '   \n\n  \t\n' }]
    const graph = buildGraphFromDocuments(docs)
    assert.equal(graph.nodes.length, 1)
    assert.equal(graph.links.length, 0)
  })

  test('buildGraphFromDocuments resolves multiple distinct wiki-links in the same paragraph', () => {
    const docs = [
      {
        path: 'index.md',
        content: 'See [[architecture]], [[setup]], and [[components]].',
      },
      { path: 'architecture.md', content: 'arch' },
      { path: 'setup.md', content: 'setup' },
      { path: 'components.md', content: 'comp' },
    ]
    const graph = buildGraphFromDocuments(docs)
    assert.equal(graph.links.length, 3)
    assert.ok(
      graph.links.find(l => l.source === 'index.md' && l.target === 'architecture.md'),
      'Expected link to architecture.md',
    )
    assert.ok(
      graph.links.find(l => l.source === 'index.md' && l.target === 'setup.md'),
      'Expected link to setup.md',
    )
    assert.ok(
      graph.links.find(l => l.source === 'index.md' && l.target === 'components.md'),
      'Expected link to components.md',
    )
  })

  test('buildGraphFromDocuments resolves wiki-links that are spread across multiple paragraphs', () => {
    const docs = [
      {
        path: 'index.md',
        content: [
          '# Title',
          '',
          'First paragraph mentions [[doc-a]].',
          '',
          'Second paragraph links to [[doc-b]].',
          '',
          'A final line still references [[doc-a]] again.',
        ].join('\n'),
      },
      { path: 'doc-a.md', content: 'a' },
      { path: 'doc-b.md', content: 'b' },
    ]
    const graph = buildGraphFromDocuments(docs)
    // Two unique edges after dedup: index -> doc-a and index -> doc-b.
    assert.equal(graph.links.length, 2)
    assert.equal(
      graph.links.filter(l => l.source === 'index.md' && l.target === 'doc-a.md').length,
      1,
    )
    assert.equal(
      graph.links.filter(l => l.source === 'index.md' && l.target === 'doc-b.md').length,
      1,
    )
  })

  test('buildGraphFromDocuments deduplicates wiki-link and markdown link to the same target', () => {
    const docs = [
      {
        path: 'index.md',
        content: 'See [[setup]] or [the guide](./setup.md) for setup.',
      },
      { path: 'setup.md', content: 'Setup' },
    ]
    const graph = buildGraphFromDocuments(docs)
    const matches = graph.links.filter(l => l.source === 'index.md' && l.target === 'setup.md')
    assert.equal(
      matches.length,
      1,
      'Mixed wiki-link and markdown link to the same target must be deduplicated',
    )
  })

  test('buildGraphFromDocuments deduplicates repeated markdown links between the same pair', () => {
    const docs = [
      {
        path: 'index.md',
        content: 'See [a](./setup.md), [b](./setup.md), [c](./setup.md).',
      },
      { path: 'setup.md', content: 'Setup' },
    ]
    const graph = buildGraphFromDocuments(docs)
    const matches = graph.links.filter(l => l.source === 'index.md' && l.target === 'setup.md')
    assert.equal(matches.length, 1)
  })

  test('buildGraphFromDocuments strips query strings from markdown link hrefs before resolution', () => {
    const docs = [
      { path: 'index.md', content: 'See [setup](./setup.md?ref=hot&v=2).' },
      { path: 'setup.md', content: 'Setup' },
    ]
    const graph = buildGraphFromDocuments(docs)
    const link = graph.links.find(l => l.source === 'index.md' && l.target === 'setup.md')
    assert.ok(link, 'Query string in markdown href should be stripped before path resolution')
  })

  test('buildGraphFromDocuments strips in-page anchors from markdown link hrefs before resolution', () => {
    const docs = [
      { path: 'index.md', content: 'See [setup](./setup.md#install).' },
      { path: 'setup.md', content: 'Setup' },
    ]
    const graph = buildGraphFromDocuments(docs)
    const link = graph.links.find(l => l.source === 'index.md' && l.target === 'setup.md')
    assert.ok(link, 'In-page anchor in markdown href should be stripped before path resolution')
  })

  test('buildGraphFromDocuments ignores markdown links to non-existent documents', () => {
    const docs = [
      { path: 'index.md', content: 'See [missing](./does-not-exist.md).' },
    ]
    const graph = buildGraphFromDocuments(docs)
    assert.equal(graph.links.length, 0)
  })

  test('buildGraphFromDocuments ignores self-referencing markdown links', () => {
    const docs = [
      { path: 'index.md', content: 'Back to [self](./index.md).' },
    ]
    const graph = buildGraphFromDocuments(docs)
    assert.equal(graph.links.length, 0)
    assert.equal(graph.nodes.length, 1)
  })

  test('buildGraphFromDocuments ignores external URLs in markdown links', () => {
    const docs = [
      {
        path: 'index.md',
        content: 'See [Google](https://google.com), [HTTP](http://example.com), and [Email](mailto:test@example.com).',
      },
    ]
    const graph = buildGraphFromDocuments(docs)
    assert.equal(graph.links.length, 0)
    assert.equal(graph.nodes.length, 1)
  })

  test('buildGraphFromDocuments ignores anchor-only markdown links', () => {
    const docs = [
      { path: 'index.md', content: 'See [TOC](#table-of-contents).' },
    ]
    const graph = buildGraphFromDocuments(docs)
    assert.equal(graph.links.length, 0)
  })

  test('buildGraphFromDocuments resolves a wiki-link whose target already ends with .md', () => {
    // [[setup.md]] should still resolve to setup.md because the lookup
    // normalizes by stripping the `.md` suffix.
    const docs = [
      { path: 'index.md', content: 'See [[setup.md]] for setup.' },
      { path: 'setup.md', content: 'Setup' },
    ]
    const graph = buildGraphFromDocuments(docs)
    const link = graph.links.find(l => l.source === 'index.md' && l.target === 'setup.md')
    assert.ok(link, 'Wiki-link with explicit .md suffix should resolve to the matching document')
  })

  test('buildGraphFromDocuments uses case-sensitive path resolution against the on-disk filename', () => {
    // The lookup map preserves the on-disk casing verbatim and never folds
    // case, so a wiki-link whose target differs only in case from a real
    // document does NOT resolve to it.
    const docs = [
      { path: 'Doc.md', content: 'I mention myself: [[doc]] (lowercase link).' },
    ]
    const graph = buildGraphFromDocuments(docs)
    // The map has `Doc -> Doc.md` but the wiki-link looks up `doc` and finds
    // no match - no edge is added (and a self-link to `Doc.md` would be
    // filtered out anyway).
    assert.equal(graph.links.length, 0)
    assert.equal(graph.nodes.length, 1)
  })

  test('buildGraphFromDocuments linksCount increases for both source and target nodes on each edge', () => {
    const docs = [
      { path: 'index.md', content: 'Links: [[a]], [[b]], [[a]].' },
      { path: 'a.md', content: 'Body.' },
      { path: 'b.md', content: 'Body.' },
    ]
    const graph = buildGraphFromDocuments(docs)
    const a = graph.nodes.find(n => n.id === 'a.md')
    const b = graph.nodes.find(n => n.id === 'b.md')
    const index = graph.nodes.find(n => n.id === 'index.md')
    assert.ok(a && b && index, 'Expected three nodes')
    // `val` is the participation count: each node is initialised to 1 and
    // incremented once per incident unique edge.
    assert.equal(index?.val, 3, 'index.md has two outgoing edges -> val = 3')
    assert.equal(a?.val, 2, 'a.md has one incoming edge -> val = 2')
    assert.equal(b?.val, 2, 'b.md has one incoming edge -> val = 2')
  })

  test('buildGraphFromDocuments resolves a 3-node chain without spuriously adding cross-edges', () => {
    const docs = [
      { path: 'a.md', content: 'I link to [[b]].' },
      { path: 'b.md', content: 'I link to [[c]].' },
      { path: 'c.md', content: 'I am a leaf.' },
    ]
    const graph = buildGraphFromDocuments(docs)
    assert.equal(graph.nodes.length, 3)
    assert.equal(graph.links.length, 2)
    assert.ok(graph.links.find(l => l.source === 'a.md' && l.target === 'b.md'))
    assert.ok(graph.links.find(l => l.source === 'b.md' && l.target === 'c.md'))
    // No transitive edge from a -> c.
    assert.equal(
      graph.links.filter(l => l.source === 'a.md' && l.target === 'c.md').length,
      0,
    )
  })

  test('buildGraphFromDocuments accepts wiki-links that contain backslashes in the target', () => {
    // The target normalizer replaces `\` with `/`, so a Windows-style link
    // (from a cross-platform context) still resolves against a POSIX-stored
    // sibling document.
    const docs = [
      { path: 'guides/overview.md', content: 'See [[guides\\setup]] for installation.' },
      { path: 'guides/setup.md', content: 'Setup guide body.' },
    ]
    const graph = buildGraphFromDocuments(docs)
    const link = graph.links.find(
      l => l.source === 'guides/overview.md' && l.target === 'guides/setup.md',
    )
    assert.ok(link, 'Backslash target should normalise to forward-slash path key')
  })

  test('buildGraphFromDocuments resolves a wiki-link with special characters (dots and dashes) in target', () => {
    const docs = [
      { path: 'index.md', content: 'See [[release-notes/v1.0.0]].' },
      { path: 'release-notes/v1.0.0.md', content: 'Release notes.' },
    ]
    const graph = buildGraphFromDocuments(docs)
    const link = graph.links.find(
      l => l.source === 'index.md' && l.target === 'release-notes/v1.0.0.md',
    )
    assert.ok(link, 'Wiki-link with dots and dashes should resolve to the matching nested document')
  })

  test('parseWikiLinkText returns null when the only brackets are unbalanced or empty', () => {
    assert.equal(parseWikiLinkText('['), null)
    assert.equal(parseWikiLinkText(']'), null)
    assert.equal(parseWikiLinkText('[['), null)
    assert.equal(parseWikiLinkText(']]'), null)
    assert.equal(parseWikiLinkText('[[ '), null)
    assert.equal(parseWikiLinkText(' ]]'), null)
  })

  test('parseWikiLinkText trims whitespace from captured alias before exposing it', () => {
    // Whitespace-only alias: the capture group is non-empty (regex `+?`
    // requires at least 1 character) but trims to '' which collapses to null.
    const wsOnly = parseWikiLinkText('[[a|  ]]')
    assert.deepEqual(wsOnly, { target: 'a', anchor: null, alias: null })

    // An alias that contains whitespace AND non-whitespace keeps only the
    // non-whitespace portion after trim().
    const display = parseWikiLinkText('[[a|  Display Text  ]]')
    assert.deepEqual(display, { target: 'a', anchor: null, alias: 'Display Text' })
  })

  test('parseWikiLinkText treats an alias of a single "#" as part of the anchor', () => {
    // `[[a#b#]]`: anchor class `[^\]|]+?` matches `b#` (shortest run that
    // still allows `]]` to follow), and the trailing empty alias is rejected.
    const parsed = parseWikiLinkText('[[a#b#]]')
    assert.deepEqual(parsed, { target: 'a', anchor: 'b#', alias: null })
  })
})
