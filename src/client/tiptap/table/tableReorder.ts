/**
 * Table Drag Reorder & Axis Selection Engine.
 *
 * Implements AST row/column swapping, axis selection, and drag boundary tracking
 * for TipTap & ProseMirror tables.
 */
import type { Node as PmNode } from '@tiptap/pm/model'
import type { Selection } from '@tiptap/pm/state'
import { CellSelection, cellAround, TableMap } from '@tiptap/pm/tables'
import type { Editor } from '@tiptap/core'

export type TableAxis = 'column' | 'row'

export const FIRST_MOVABLE_ROW_INDEX = 1

export interface DragTarget {
  index: number
  rect: { left: number; top: number; width: number; height: number }
}

export function buildAxisSelection(
  doc: PmNode,
  posInCell: number,
  axis: TableAxis,
): CellSelection | null {
  if (posInCell < 0 || posInCell > doc.content.size) return null
  const $cell = cellAround(doc.resolve(posInCell))
  if (!$cell) return null
  return axis === 'row' ? CellSelection.rowSelection($cell) : CellSelection.colSelection($cell)
}

export function handleAnchorCellPos(selection: Selection): number | null {
  if (!(selection instanceof CellSelection)) return null
  const table = selection.$anchorCell.node(-1)
  if (!table) return null
  const tableStart = selection.$anchorCell.start(-1)
  const map = TableMap.get(table)
  const rect = map.rectBetween(
    selection.$anchorCell.pos - tableStart,
    selection.$headCell.pos - tableStart,
  )
  const offset = map.map[rect.top * map.width + rect.left]
  return offset === undefined ? null : tableStart + offset
}

export function selectTableAxis(editor: Editor, anchor: HTMLElement, axis: TableAxis): void {
  const { view, state } = editor
  let posInCell: number
  try {
    posInCell = view.posAtDOM(anchor, 0)
  } catch (err) {
    console.warn('[table-axis-selection] posAtDOM failed on handle anchor', err)
    return
  }
  const selection = buildAxisSelection(state.doc, posInCell, axis)
  if (!selection) return
  view.dispatch(state.tr.setSelection(selection))
}

export function tableWithMovedRow(table: PmNode, from: number, to: number): PmNode {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return table
  const rows: PmNode[] = []
  table.forEach((row) => {
    rows.push(row)
  })
  if (from < 0 || from >= rows.length) return table
  const [moved] = rows.splice(from, 1)
  if (!moved) return table
  const dest = to > from ? to - 1 : to
  const clampedDest = Math.max(0, Math.min(dest, rows.length))
  rows.splice(clampedDest, 0, moved)
  return table.type.create(table.attrs, rows, table.marks)
}

export function tableWithMovedColumn(table: PmNode, from: number, to: number): PmNode {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return table
  const dest = to > from ? to - 1 : to
  const newRows: PmNode[] = []
  table.forEach((row) => {
    const cells: PmNode[] = []
    row.forEach((cell) => {
      cells.push(cell)
    })
    if (from < 0 || from >= cells.length) {
      newRows.push(row)
      return
    }
    const [moved] = cells.splice(from, 1)
    if (!moved) {
      newRows.push(row)
      return
    }
    const clampedDest = Math.max(0, Math.min(dest, cells.length))
    cells.splice(clampedDest, 0, moved)
    newRows.push(row.type.create(row.attrs, cells, row.marks))
  })
  return table.type.create(table.attrs, newRows, table.marks)
}

export function findTablePos($from: { depth: number; node: (d: number) => PmNode; before: (d: number) => number }): number {
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.spec.tableRole === 'table') {
      return $from.before(depth)
    }
  }
  return -1
}

function horizontalLine(tableRect: DOMRect, y: number): DragTarget['rect'] {
  return { left: tableRect.left, top: y - 1, width: tableRect.width, height: 2 }
}

function verticalLine(tableRect: DOMRect, x: number): DragTarget['rect'] {
  return { left: x - 1, top: tableRect.top, width: 2, height: tableRect.height }
}

function rowBottomOr(rows: HTMLTableRowElement[], index: number, fallbackY: number): number {
  const row = rows[index]
  return row ? row.getBoundingClientRect().bottom : fallbackY
}

export function computeDragTarget(
  anchor: HTMLTableCellElement,
  axis: TableAxis,
  clientX: number,
  clientY: number,
): DragTarget | null {
  const table = anchor.closest('table')
  if (!table) return null
  const tableRect = table.getBoundingClientRect()

  if (axis === 'row') {
    const rows = Array.from(table.rows)
    if (rows.length === 0) return null
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      if (!row) continue
      const rect = row.getBoundingClientRect()
      if (clientY < rect.top) {
        return {
          index: FIRST_MOVABLE_ROW_INDEX,
          rect: horizontalLine(tableRect, rowBottomOr(rows, 0, rect.top)),
        }
      }
      if (clientY <= rect.bottom) {
        const midY = rect.top + rect.height / 2
        const insertAfter = clientY >= midY
        const rawIndex = insertAfter ? i + 1 : i
        const index = Math.max(FIRST_MOVABLE_ROW_INDEX, rawIndex)
        const clamped = index !== rawIndex
        const y = clamped ? rowBottomOr(rows, 0, rect.top) : insertAfter ? rect.bottom : rect.top
        return { index, rect: horizontalLine(tableRect, y) }
      }
    }
    const lastRow = rows[rows.length - 1]
    if (!lastRow) return null
    const last = lastRow.getBoundingClientRect()
    return { index: rows.length, rect: horizontalLine(tableRect, last.bottom) }
  }

  const referenceRow = table.rows[0]
  if (!referenceRow) return null
  const cells = Array.from(referenceRow.cells)
  if (cells.length === 0) return null
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i]
    if (!cell) continue
    const rect = cell.getBoundingClientRect()
    if (clientX < rect.left) {
      return { index: 0, rect: verticalLine(tableRect, rect.left) }
    }
    if (clientX <= rect.right) {
      const midX = rect.left + rect.width / 2
      const insertAfter = clientX >= midX
      const x = insertAfter ? rect.right : rect.left
      return { index: insertAfter ? i + 1 : i, rect: verticalLine(tableRect, x) }
    }
  }
  const lastCell = cells[cells.length - 1]
  if (!lastCell) return null
  const last = lastCell.getBoundingClientRect()
  return { index: cells.length, rect: verticalLine(tableRect, last.right) }
}
