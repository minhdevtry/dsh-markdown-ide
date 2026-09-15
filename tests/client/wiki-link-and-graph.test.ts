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
