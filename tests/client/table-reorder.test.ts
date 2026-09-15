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

import { Editor } from '@tiptap/core'
import type { Node as PmNode } from '@tiptap/pm/model'
import { documentExtensions } from '../../src/client/tiptap/extensions.ts'
import {
  buildAxisSelection,
  computeDragTarget,
  FIRST_MOVABLE_ROW_INDEX,
  tableWithMovedRow,
  tableWithMovedColumn,
} from '../../src/client/tiptap/table/tableReorder.ts'
import { commitReorder } from '../../src/client/tiptap/table/useTableDragReorder.ts'

describe('Table Drag Reorder', () => {
  function createTestEditor(md: string): Editor {
    return new Editor({
      element: document.createElement('div'),
      extensions: documentExtensions(),
      content: md,
      contentType: 'markdown',
    })
  }

  function extractTableTexts(table: PmNode): string[][] {
    const rows: string[][] = []
    table.forEach((r) => {
      const cells: string[] = []
      r.forEach((c) => {
        cells.push(c.textContent.trim())
      })
      rows.push(cells)
    })
    return rows
  }

  function getFirstTable(editor: Editor): PmNode {
    let table: PmNode | null = null
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'table' && !table) {
        table = node
        return false
      }
      return true
    })
    if (!table) throw new Error('No table node found in document')
    return table
  }

  test('tableWithMovedRow moves row down', () => {
    const md = `
| H1 | H2 |
| --- | --- |
| A1 | A2 |
| B1 | B2 |
| C1 | C2 |
`
    const editor = createTestEditor(md)
    try {
      const table = getFirstTable(editor)
      // Moving row 1 (A) to position 3 (between B and C)
      const moved = tableWithMovedRow(table, 1, 3)
      assert.deepEqual(extractTableTexts(moved), [
        ['H1', 'H2'],
        ['B1', 'B2'],
        ['A1', 'A2'],
        ['C1', 'C2'],
      ])
    } finally {
      editor.destroy()
    }
  })

  test('tableWithMovedRow moves row up', () => {
    const md = `
| H1 | H2 |
| --- | --- |
| A1 | A2 |
| B1 | B2 |
| C1 | C2 |
`
    const editor = createTestEditor(md)
    try {
      const table = getFirstTable(editor)
      // Moving row 3 (C) to position 1 (right after header H)
      const moved = tableWithMovedRow(table, 3, 1)
      assert.deepEqual(extractTableTexts(moved), [
        ['H1', 'H2'],
        ['C1', 'C2'],
        ['A1', 'A2'],
        ['B1', 'B2'],
      ])
    } finally {
      editor.destroy()
    }
  })

  test('tableWithMovedColumn moves column to the right', () => {
    const md = `
| Col1 | Col2 | Col3 |
| --- | --- | --- |
| A1 | A2 | A3 |
| B1 | B2 | B3 |
`
    const editor = createTestEditor(md)
    try {
      const table = getFirstTable(editor)
      // Moving col 0 (Col1) to position 2 (between Col2 and Col3)
      const moved = tableWithMovedColumn(table, 0, 2)
      assert.deepEqual(extractTableTexts(moved), [
        ['Col2', 'Col1', 'Col3'],
        ['A2', 'A1', 'A3'],
        ['B2', 'B1', 'B3'],
      ])
    } finally {
      editor.destroy()
    }
  })

  test('tableWithMovedColumn moves column to the left', () => {
    const md = `
| Col1 | Col2 | Col3 |
| --- | --- | --- |
| A1 | A2 | A3 |
| B1 | B2 | B3 |
`
    const editor = createTestEditor(md)
    try {
      const table = getFirstTable(editor)
      // Moving col 2 (Col3) to position 0 (first column)
      const moved = tableWithMovedColumn(table, 2, 0)
      assert.deepEqual(extractTableTexts(moved), [
        ['Col3', 'Col1', 'Col2'],
        ['A3', 'A1', 'A2'],
        ['B3', 'B1', 'B2'],
      ])
    } finally {
      editor.destroy()
    }
  })

  test('boundary safety: out of bounds indices do not throw or mutate corrupted tree', () => {
    const md = `
| H1 | H2 |
| --- | --- |
| A1 | A2 |
`
    const editor = createTestEditor(md)
    try {
      const table = getFirstTable(editor)
      const invalidRow = tableWithMovedRow(table, 99, 100)
      assert.deepEqual(extractTableTexts(invalidRow), extractTableTexts(table))

      const invalidCol = tableWithMovedColumn(table, -5, 10)
      assert.deepEqual(extractTableTexts(invalidCol), extractTableTexts(table))
    } finally {
      editor.destroy()
    }
  })

  test('boundary safety: negative or overflowing target index clamps instead of throwing', () => {
    const md = `
| H1 | H2 |
| --- | --- |
| A1 | A2 |
| B1 | B2 |
`
    const editor = createTestEditor(md)
    try {
      const table = getFirstTable(editor)

      assert.doesNotThrow(() => tableWithMovedRow(table, 1, -100))
      assert.doesNotThrow(() => tableWithMovedRow(table, 1, 1000))
      assert.doesNotThrow(() => tableWithMovedColumn(table, 0, -100))
      assert.doesNotThrow(() => tableWithMovedColumn(table, 0, 1000))

      const movedToStart = tableWithMovedRow(table, 1, -100)
      assert.deepEqual(extractTableTexts(movedToStart), [
        ['A1', 'A2'],
        ['H1', 'H2'],
        ['B1', 'B2'],
      ])

      const movedToEnd = tableWithMovedRow(table, 1, 1000)
      assert.deepEqual(extractTableTexts(movedToEnd), [
        ['H1', 'H2'],
        ['B1', 'B2'],
        ['A1', 'A2'],
      ])
    } finally {
      editor.destroy()
    }
  })

  test('boundary safety: non-finite indices (NaN/Infinity) leave the table structure unchanged', () => {
    const md = `
| H1 | H2 |
| --- | --- |
| A1 | A2 |
| B1 | B2 |
`
    const editor = createTestEditor(md)
    try {
      const table = getFirstTable(editor)
      const original = extractTableTexts(table)

      assert.doesNotThrow(() => tableWithMovedRow(table, NaN, 1))
      assert.deepEqual(extractTableTexts(tableWithMovedRow(table, NaN, 1)), original)
      assert.deepEqual(extractTableTexts(tableWithMovedRow(table, 1, NaN)), original)
      assert.deepEqual(extractTableTexts(tableWithMovedRow(table, Infinity, 1)), original)
      assert.deepEqual(extractTableTexts(tableWithMovedRow(table, 1, -Infinity)), original)

      assert.deepEqual(extractTableTexts(tableWithMovedColumn(table, NaN, 1)), original)
      assert.deepEqual(extractTableTexts(tableWithMovedColumn(table, 1, NaN)), original)
      assert.deepEqual(extractTableTexts(tableWithMovedColumn(table, Infinity, 0)), original)
      assert.deepEqual(extractTableTexts(tableWithMovedColumn(table, 0, Infinity)), original)
    } finally {
      editor.destroy()
    }
  })

  test('boundary safety: source index === rows.length (one past last row) is treated as out of bounds', () => {
    const md = `
| H1 | H2 |
| --- | --- |
| A1 | A2 |
| B1 | B2 |
`
    const editor = createTestEditor(md)
    try {
      const table = getFirstTable(editor)
      const original = extractTableTexts(table)

      assert.doesNotThrow(() => tableWithMovedRow(table, 3, 0))
      assert.deepEqual(extractTableTexts(tableWithMovedRow(table, 3, 0)), original)
      assert.deepEqual(extractTableTexts(tableWithMovedRow(table, 3, 5)), original)
    } finally {
      editor.destroy()
    }
  })

  test('boundary safety: column source index === cells.length (one past last column) is treated as out of bounds', () => {
    const md = `
| Col1 | Col2 |
| --- | --- |
| A1 | A2 |
`
    const editor = createTestEditor(md)
    try {
      const table = getFirstTable(editor)
      const original = extractTableTexts(table)

      assert.doesNotThrow(() => tableWithMovedColumn(table, 2, 0))
      assert.deepEqual(extractTableTexts(tableWithMovedColumn(table, 2, 0)), original)
      assert.deepEqual(extractTableTexts(tableWithMovedColumn(table, 2, 5)), original)
    } finally {
      editor.destroy()
    }
  })

  test('boundary safety: targetIndex === sourceIndex is a structural no-op (no throw, table intact)', () => {
    const md = `
| H1 | H2 | H3 |
| --- | --- | --- |
| A1 | A2 | A3 |
| B1 | B2 | B3 |
`
    const editor = createTestEditor(md)
    try {
      const table = getFirstTable(editor)
      const original = extractTableTexts(table)

      assert.doesNotThrow(() => tableWithMovedRow(table, 1, 1))
      assert.deepEqual(extractTableTexts(tableWithMovedRow(table, 1, 1)), original)
      assert.doesNotThrow(() => tableWithMovedColumn(table, 1, 1))
      assert.deepEqual(extractTableTexts(tableWithMovedColumn(table, 1, 1)), original)
    } finally {
      editor.destroy()
    }
  })

  test('boundary safety: dragging the last row past itself keeps row pinned at the end', () => {
    const md = `
| H1 | H2 |
| --- | --- |
| A1 | A2 |
| B1 | B2 |
| C1 | C2 |
`
    const editor = createTestEditor(md)
    try {
      const table = getFirstTable(editor)

      const moved = tableWithMovedRow(table, 3, 99)
      assert.deepEqual(extractTableTexts(moved), [
        ['H1', 'H2'],
        ['A1', 'A2'],
        ['B1', 'B2'],
        ['C1', 'C2'],
      ])
    } finally {
      editor.destroy()
    }
  })

  test('boundary safety: dragging the last column past itself keeps column pinned at the end', () => {
    const md = `
| C1 | C2 | C3 |
| --- | --- | --- |
| A1 | A2 | A3 |
`
    const editor = createTestEditor(md)
    try {
      const table = getFirstTable(editor)
      const original = extractTableTexts(table)

      const moved = tableWithMovedColumn(table, 2, 99)
      assert.deepEqual(extractTableTexts(moved), original)
    } finally {
      editor.destroy()
    }
  })

  test('boundary safety: buildAxisSelection rejects negative or overflowing posInCell', () => {
    const md = `
| H1 | H2 |
| --- | --- |
| A1 | A2 |
`
    const editor = createTestEditor(md)
    try {
      const doc = editor.state.doc

      assert.equal(buildAxisSelection(doc, -1, 'row'), null)
      assert.equal(buildAxisSelection(doc, -10, 'column'), null)
      assert.equal(buildAxisSelection(doc, doc.content.size + 5, 'row'), null)
    } finally {
      editor.destroy()
    }
  })

  test('boundary safety: buildAxisSelection returns null for invalid position', () => {
    const md = `
| H1 | H2 |
| --- | --- |
| A1 | A2 |
`
    const editor = createTestEditor(md)
    try {
      const doc = editor.state.doc
      assert.equal(buildAxisSelection(doc, 0, 'row'), null)
    } finally {
      editor.destroy()
    }
  })

  test('boundary safety: computeDragTarget returns null when no table is reachable', () => {
    const detached = dom.window.document.createElement('td') as any
    const result = computeDragTarget(detached, 'row', 10, 10)
    assert.equal(result, null)
  })

  test('boundary safety: computeDragTarget returns null for an empty table', () => {
    const emptyTable = dom.window.document.createElement('table')
    dom.window.document.body.appendChild(emptyTable)
    const anchor = dom.window.document.createElement('td')
    emptyTable.appendChild(anchor)
    try {
      const result = computeDragTarget(anchor as any, 'row', 10, 10)
      assert.equal(result, null)
    } finally {
      dom.window.document.body.removeChild(emptyTable)
    }
  })

  test('boundary safety: commitReorder rejects non-finite targetIndex without dispatching', () => {
    const md = `
| H1 | H2 |
| --- | --- |
| A1 | A2 |
| B1 | B2 |
`
    const editor = createTestEditor(md)
    try {
      const tableDom = editor.view.dom.querySelector('table')
      const rowAnchor = tableDom?.querySelector('tbody tr:nth-child(2) td') as HTMLElement | null
      assert.ok(rowAnchor, 'row anchor must be found')
      assert.equal(rowAnchor.tagName, 'TD')

      const original = editor.state.doc.toJSON()

      assert.doesNotThrow(() => {
        commitReorder(editor, rowAnchor as any, 'row', NaN)
      })
      assert.doesNotThrow(() => {
        commitReorder(editor, rowAnchor as any, 'row', Infinity)
      })
      assert.doesNotThrow(() => {
        commitReorder(editor, rowAnchor as any, 'row', -Infinity)
      })

      assert.deepEqual(editor.state.doc.toJSON(), original)
    } finally {
      editor.destroy()
    }
  })

  test('boundary safety: commitReorder rejects targetIndex < FIRST_MOVABLE_ROW_INDEX for row axis', () => {
    const md = `
| H1 | H2 |
| --- | --- |
| A1 | A2 |
| B1 | B2 |
`
    const editor = createTestEditor(md)
    try {
      const tableDom = editor.view.dom.querySelector('table')
      const rowAnchor = tableDom?.querySelector('tbody tr:nth-child(2) td') as HTMLElement | null
      assert.ok(rowAnchor, 'row anchor must be found')

      const original = editor.state.doc.toJSON()

      assert.doesNotThrow(() => {
        commitReorder(editor, rowAnchor as any, 'row', 0)
      })
      assert.doesNotThrow(() => {
        commitReorder(editor, rowAnchor as any, 'row', -5)
      })

      assert.deepEqual(editor.state.doc.toJSON(), original)
    } finally {
      editor.destroy()
    }
  })

  test('boundary safety: commitReorder rejects source on header row', () => {
    const md = `
| H1 | H2 |
| --- | --- |
| A1 | A2 |
| B1 | B2 |
`
    const editor = createTestEditor(md)
    try {
      const tableDom = editor.view.dom.querySelector('table')
      const headerAnchor = tableDom?.querySelector('thead tr:first-child th') as HTMLElement | null
      const fallbackHeaderAnchor = tableDom?.querySelector('tr:first-child td, tr:first-child th') as HTMLElement | null
      const anchor = (headerAnchor ?? fallbackHeaderAnchor) as any
      assert.ok(anchor, 'header anchor must be found')

      const original = editor.state.doc.toJSON()

      assert.doesNotThrow(() => {
        commitReorder(editor, anchor, 'row', 3)
      })

      assert.deepEqual(editor.state.doc.toJSON(), original)
    } finally {
      editor.destroy()
    }
  })

  test('boundary safety: FIRST_MOVABLE_ROW_INDEX constant value matches expected skip-header invariant', () => {
    assert.equal(FIRST_MOVABLE_ROW_INDEX, 1)
  })
})
