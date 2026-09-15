import type { Editor } from '@tiptap/core'
import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react'
import {
  type TableAxis,
  type DragTarget,
  FIRST_MOVABLE_ROW_INDEX,
  computeDragTarget,
  findTablePos,
  tableWithMovedRow,
  tableWithMovedColumn,
} from './tableReorder.ts'

const DRAG_THRESHOLD_PX = 5

export interface UseTableDragReorderOptions {
  editor: Editor
  axis: TableAxis
  anchor: HTMLTableCellElement
  onClickGesture: () => void
}

export interface UseTableDragReorderResult {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
  shouldAllowOpen: (nextOpen: boolean) => boolean
  isDragging: boolean
  indicator: DragTarget | null
}

function rowIndexOf(cell: HTMLTableCellElement): number {
  const tr = cell.parentElement
  const table = tr?.closest('table')
  if (!table) return -1
  return Array.prototype.indexOf.call(table.rows, tr)
}

export function commitReorder(
  editor: Editor,
  anchor: HTMLTableCellElement,
  axis: TableAxis,
  targetIndex: number,
): void {
  if (!Number.isFinite(targetIndex)) return
  const sourceIndex = axis === 'row' ? rowIndexOf(anchor) : anchor.cellIndex
  if (!Number.isFinite(sourceIndex) || sourceIndex < 0) return
  if (axis === 'row') {
    if (sourceIndex < FIRST_MOVABLE_ROW_INDEX) return
    if (targetIndex < FIRST_MOVABLE_ROW_INDEX) return
  }
  if (targetIndex === sourceIndex || targetIndex === sourceIndex + 1) return

  const { state, view } = editor
  const tablePos = findTablePos(state.selection.$from)
  if (tablePos < 0) return
  const table = state.doc.nodeAt(tablePos)
  if (!table) return

  const newTable =
    axis === 'row'
      ? tableWithMovedRow(table, sourceIndex, targetIndex)
      : tableWithMovedColumn(table, sourceIndex, targetIndex)

  const tr = state.tr
  tr.replaceRangeWith(tablePos, tablePos + table.nodeSize, newTable)
  view.dispatch(tr)
}

export function useTableDragReorder({
  editor,
  axis,
  anchor,
  onClickGesture,
}: UseTableDragReorderOptions): UseTableDragReorderResult {
  const pendingDragRef = useRef<{
    startX: number
    startY: number
    isDragging: boolean
    lastTarget: DragTarget | null
  } | null>(null)

  const controllerRef = useRef<AbortController | null>(null)
  const onClickGestureRef = useRef(onClickGesture)

  useEffect(() => {
    onClickGestureRef.current = onClickGesture
  }, [onClickGesture])

  useEffect(() => {
    return () => {
      controllerRef.current?.abort()
      controllerRef.current = null
      pendingDragRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [])

  const [isDragging, setIsDragging] = useState(false)
  const [indicator, setIndicator] = useState<DragTarget | null>(null)

  const shouldAllowOpen = (nextOpen: boolean): boolean => {
    if (nextOpen && pendingDragRef.current !== null) return false
    return true
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return

    controllerRef.current?.abort()

    pendingDragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      isDragging: false,
      lastTarget: null,
    }

    const controller = new AbortController()
    controllerRef.current = controller
    const { signal } = controller

    const onMove = (moveEvent: PointerEvent): void => {
      const drag = pendingDragRef.current
      if (!drag) return

      if (!drag.isDragging) {
        const dx = moveEvent.clientX - drag.startX
        const dy = moveEvent.clientY - drag.startY
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
        drag.isDragging = true
        setIsDragging(true)
        document.body.style.cursor = 'grabbing'
        document.body.style.userSelect = 'none'
      }

      const target = computeDragTarget(anchor, axis, moveEvent.clientX, moveEvent.clientY)
      drag.lastTarget = target
      setIndicator(target)
    }

    const onUp = (): void => {
      controller.abort()
      if (controllerRef.current === controller) controllerRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''

      const drag = pendingDragRef.current
      pendingDragRef.current = null
      setIsDragging(false)
      setIndicator(null)

      if (!drag) return
      if (drag.isDragging && drag.lastTarget) {
        commitReorder(editor, anchor, axis, drag.lastTarget.index)
      } else if (!drag.isDragging) {
        onClickGestureRef.current()
      }
    }

    document.addEventListener('pointermove', onMove, { signal })
    document.addEventListener('pointerup', onUp, { signal })
    document.addEventListener('pointercancel', onUp, { signal })
  }

  return { onPointerDown, shouldAllowOpen, isDragging, indicator }
}
