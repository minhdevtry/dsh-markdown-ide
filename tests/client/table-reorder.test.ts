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
  tableWithMovedRow,
  tableWithMovedColumn,
} from '../../src/client/tiptap/table/tableReorder.ts'

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
})
