import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  clampBubblePosition,
  clampCaretPosition,
  clampPointPosition,
} from '../../src/client/utils/positioning.ts'

// No `window` global exists under the node:test runner, so all three functions
// fall back to their default viewport of 1024x768.
const VIEWPORT_WIDTH = 1024
const VIEWPORT_HEIGHT = 768

describe('clampPointPosition', () => {
  it('returns the anchor point unchanged when there is no collision', () => {
    const result = clampPointPosition({ x: 100, y: 100, width: 200, height: 100 })
    assert.deepEqual(result, { left: 100, top: 100 })
  })

  it('flips leftward when the popup would overflow the right edge', () => {
    const x = VIEWPORT_WIDTH - 50
    const width = 200
    const result = clampPointPosition({ x, y: 100, width, height: 50 })
    assert.equal(result.left, x - width)
  })

  it('clamps to the margin when flipping left would go negative', () => {
    const width = VIEWPORT_WIDTH + 100
    const result = clampPointPosition({ x: VIEWPORT_WIDTH - 10, y: 100, width, height: 50 })
    assert.equal(result.left, 8)
  })

  it('flips upward when the popup would overflow the bottom edge', () => {
    const y = VIEWPORT_HEIGHT - 20
    const height = 100
    const result = clampPointPosition({ x: 100, y, width: 50, height })
    assert.equal(result.top, y - height)
  })

  it('clamps to the margin when flipping up would go negative', () => {
    const height = VIEWPORT_HEIGHT + 100
    const result = clampPointPosition({ x: 100, y: VIEWPORT_HEIGHT - 10, width: 50, height })
    assert.equal(result.top, 8)
  })

  it('respects a custom margin', () => {
    const margin = 32
    const x = VIEWPORT_WIDTH - 10
    const width = 50
    const result = clampPointPosition({ x, y: 100, width, height: 50, margin })
    assert.equal(result.left, x - width)
  })
})

describe('clampCaretPosition', () => {
  it('positions below the caret by default with the default gap', () => {
    const result = clampCaretPosition({
      top: 100,
      left: 100,
      bottom: 120,
      width: 200,
      height: 100,
    })
    assert.deepEqual(result, { left: 100, top: 120 + 6 })
  })

  it('keeps the caret left offset when it fits within the viewport', () => {
    const result = clampCaretPosition({
      top: 50,
      left: 300,
      bottom: 70,
      width: 200,
      height: 100,
    })
    assert.equal(result.left, 300)
  })

  it('clamps left to fit within the right edge of the viewport', () => {
    const width = 200
    const result = clampCaretPosition({
      top: 50,
      left: VIEWPORT_WIDTH - 50,
      bottom: 70,
      width,
      height: 100,
    })
    assert.equal(result.left, VIEWPORT_WIDTH - width - 16)
  })

  it('clamps left to the margin when the caret is near the left edge', () => {
    const result = clampCaretPosition({
      top: 50,
      left: 2,
      bottom: 70,
      width: 200,
      height: 100,
    })
    assert.equal(result.left, 16)
  })

  it('flips above the caret when placing below would overflow the bottom edge', () => {
    const caretTop = VIEWPORT_HEIGHT - 100
    const caretBottom = VIEWPORT_HEIGHT - 80
    const height = 150
    const result = clampCaretPosition({
      top: caretTop,
      left: 100,
      bottom: caretBottom,
      width: 200,
      height,
    })
    assert.equal(result.top, caretTop - height - 6)
  })

  it('clamps the flipped-above position to the margin', () => {
    const height = VIEWPORT_HEIGHT
    const result = clampCaretPosition({
      top: 10,
      left: 100,
      bottom: VIEWPORT_HEIGHT - 5,
      width: 200,
      height,
    })
    assert.equal(result.top, 16)
  })

  it('respects custom margin and gap', () => {
    const margin = 40
    const gap = 20
    const result = clampCaretPosition({
      top: 100,
      left: 100,
      bottom: 120,
      width: 200,
      height: 100,
      margin,
      gap,
    })
    assert.equal(result.top, 120 + gap)
    assert.equal(result.left, 100)
  })
})

describe('clampBubblePosition', () => {
  it('centers above the selection range by default', () => {
    const result = clampBubblePosition({
      startTop: 200,
      startLeft: 100,
      endLeft: 300,
      width: 120,
      height: 50,
    })
    assert.equal(result.top, 200 - 50 - 8)
    assert.equal(result.left, (100 + 300) / 2)
  })

  it('flips below the selection when placing above would clip and startBottom fits', () => {
    const result = clampBubblePosition({
      startTop: 10,
      startBottom: 30,
      startLeft: 100,
      endLeft: 300,
      width: 120,
      height: 50,
    })
    assert.equal(result.top, 30 + 8)
  })

  it('clamps to the top margin when neither above nor below fits', () => {
    const result = clampBubblePosition({
      startTop: 10,
      startBottom: VIEWPORT_HEIGHT - 5,
      startLeft: 100,
      endLeft: 300,
      width: 120,
      height: 50,
    })
    assert.equal(result.top, 12)
  })

  it('clamps to the top margin when startBottom is not provided and above clips', () => {
    const result = clampBubblePosition({
      startTop: 10,
      startLeft: 100,
      endLeft: 300,
      width: 120,
      height: 50,
    })
    assert.equal(result.top, 12)
  })

  it('clamps left when the centered position overflows the left edge', () => {
    const width = 200
    const result = clampBubblePosition({
      startTop: 300,
      startLeft: 0,
      endLeft: 10,
      width,
      height: 50,
    })
    assert.equal(result.left, 12 + width / 2)
  })

  it('clamps left when the centered position overflows the right edge', () => {
    const width = 200
    const result = clampBubblePosition({
      startTop: 300,
      startLeft: VIEWPORT_WIDTH - 10,
      endLeft: VIEWPORT_WIDTH + 10,
      width,
      height: 50,
    })
    assert.equal(result.left, VIEWPORT_WIDTH - 12 - width / 2)
  })

  it('respects custom margin and gap', () => {
    const margin = 24
    const gap = 16
    const result = clampBubblePosition({
      startTop: 200,
      startLeft: 100,
      endLeft: 300,
      width: 120,
      height: 50,
      margin,
      gap,
    })
    assert.equal(result.top, 200 - 50 - gap)
    assert.equal(result.left, 200)
  })
})
