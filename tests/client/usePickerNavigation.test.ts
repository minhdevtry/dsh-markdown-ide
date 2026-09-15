/**
 * Comprehensive Unit Tests for usePickerNavigation hook.
 *
 * Covers:
 * - Default options and state initialization
 * - Auto-focus timer scheduling, execution, negative delay bypass, and unmount cleanup
 * - Manual state updates via setSelectedIndex (value & functional updater)
 * - IME composition guard (isComposing and keyCode 229) for all keys
 * - Empty list boundaries (itemCount === 0), including Escape exemption
 * - ArrowDown cycling and wraparound
 * - ArrowUp cycling and wraparound
 * - Single item list boundary (itemCount === 1)
 * - Enter execution (with/without onSelect, index accuracy after navigation)
 * - Escape dismissal (with/without onClose, itemCount === 0 & itemCount > 0)
 * - Ignored/unhandled keys (preventDefault / stopPropagation not called)
 * - Events without stopPropagation method
 * - Real DOM KeyboardEvent integration via JSDOM
 * - Dynamic option updates across re-renders (itemCount, callbacks, open toggle)
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import React from 'react'
import { JSDOM } from 'jsdom'
import { usePickerNavigation } from '../../src/client/utils/usePickerNavigation.ts'

// ============================================================================
// Test Harness: Minimal React Hook Runner
// ============================================================================

interface RenderHookResult<P, R> {
  result: { current: R }
  rerender: (newProps?: P) => void
  unmount: () => void
}

interface EffectRecord {
  create: () => void | (() => void)
  deps?: unknown[] | undefined
  destroy?: void | (() => void) | undefined
}

/**
 * Lightweight hook runner utilizing React's current dispatcher.
 * Accurately simulates useState, useRef, and useEffect lifecycle without external dependencies.
 */
function renderHook<P, R>(
  hookFn: (props: P) => R,
  initialProps: P,
): RenderHookResult<P, R> {
  const stateStorage: unknown[] = []
  const refStorage: Array<{ current: unknown }> = []
  const effectStorage: EffectRecord[] = []

  let stateIdx = 0
  let refIdx = 0
  let effectIdx = 0
  let scheduledEffects: EffectRecord[] = []
  let currentProps = initialProps
  const resultRef: { current: R } = { current: undefined as unknown as R }
  let isRendering = false
  let needsRerender = false

  const dispatcher = {
    useState<T>(initialState: T | (() => T)): [T, (action: T | ((prev: T) => T)) => void] {
      const idx = stateIdx++
      if (stateStorage[idx] === undefined) {
        stateStorage[idx] = typeof initialState === 'function'
          ? (initialState as () => T)()
          : initialState
      }
      const setState = (action: T | ((prev: T) => T)) => {
        const prevVal = stateStorage[idx] as T
        const nextVal = typeof action === 'function'
          ? (action as (prev: T) => T)(prevVal)
          : action
        if (!Object.is(prevVal, nextVal)) {
          stateStorage[idx] = nextVal
          if (isRendering) {
            needsRerender = true
          } else {
            render()
          }
        }
      }
      return [stateStorage[idx] as T, setState]
    },

    useRef<T>(initialValue: T): { current: T } {
      const idx = refIdx++
      if (refStorage[idx] === undefined) {
        refStorage[idx] = { current: initialValue }
      }
      return refStorage[idx] as { current: T }
    },

    useEffect(create: () => void | (() => void), deps?: unknown[] | undefined): void {
      const idx = effectIdx++
      const prev = effectStorage[idx]
      let hasChanged = true
      if (prev && deps && prev.deps) {
        hasChanged =
          deps.length !== prev.deps.length ||
          deps.some((dep, i) => !Object.is(dep, prev.deps![i]))
      }
      const record: EffectRecord = { create, deps, destroy: prev?.destroy }
      effectStorage[idx] = record
      if (hasChanged) {
        scheduledEffects.push(record)
      }
    },
  }

  function render() {
    let loopCount = 0
    do {
      if (loopCount++ > 50) {
        throw new Error('Maximum update depth exceeded in renderHook')
      }
      needsRerender = false
      stateIdx = 0
      refIdx = 0
      effectIdx = 0
      scheduledEffects = []
      isRendering = true

      const internals = (React as unknown as {
        __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: {
          ReactCurrentDispatcher: { current: unknown }
        }
      }).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED

      const prevDispatcher = internals.ReactCurrentDispatcher.current
      internals.ReactCurrentDispatcher.current = dispatcher
      try {
        resultRef.current = hookFn(currentProps)
      } finally {
        internals.ReactCurrentDispatcher.current = prevDispatcher
        isRendering = false
      }

      // Execute newly scheduled effects
      const toRun = scheduledEffects
      for (const eff of toRun) {
        if (typeof eff.destroy === 'function') {
          eff.destroy()
        }
        eff.destroy = eff.create()
      }
    } while (needsRerender)
  }

  function rerender(newProps?: P) {
    if (newProps !== undefined) {
      currentProps = newProps
    }
    render()
  }

  function unmount() {
    for (const eff of effectStorage) {
      if (eff && typeof eff.destroy === 'function') {
        eff.destroy()
        eff.destroy = undefined
      }
    }
  }

  render()

  return {
    result: resultRef,
    rerender,
    unmount,
  }
}

// ============================================================================
// Event Mock Helpers
// ============================================================================

interface MockKeyboardEventOptions {
  key: string
  isComposing?: boolean | undefined
  keyCode?: number | undefined
  hasStopPropagation?: boolean | undefined
}

function createMockKeyEvent({
  key,
  isComposing = false,
  keyCode,
  hasStopPropagation = true,
}: MockKeyboardEventOptions) {
  let defaultPrevented = false
  let propagationStopped = false

  const event: {
    key: string
    isComposing?: boolean | undefined
    keyCode?: number | undefined
    preventDefault: () => void
    stopPropagation?: (() => void) | undefined
    readonly defaultPrevented: boolean
    readonly propagationStopped: boolean
  } = {
    key,
    ...(isComposing ? { isComposing } : {}),
    ...(keyCode !== undefined ? { keyCode } : {}),
    preventDefault: () => {
      defaultPrevented = true
    },
    get defaultPrevented() {
      return defaultPrevented
    },
    get propagationStopped() {
      return propagationStopped
    },
  }

  if (hasStopPropagation) {
    event.stopPropagation = () => {
      propagationStopped = true
    }
  }

  return event
}

function attachInputRef(
  inputRef: React.RefObject<HTMLInputElement>,
  element: Partial<HTMLInputElement> | null,
) {
  Object.defineProperty(inputRef, 'current', {
    value: element,
    writable: true,
    configurable: true,
  })
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// ============================================================================
// Test Suites
// ============================================================================

describe('usePickerNavigation', () => {
  describe('initialization and default options', () => {
    it('initializes selectedIndex to 0 and inputRef to null current', () => {
      const { result } = renderHook(usePickerNavigation, { itemCount: 5 })

      assert.equal(result.current.selectedIndex, 0)
      assert.ok(result.current.inputRef)
      assert.equal(result.current.inputRef.current, null)
      assert.equal(typeof result.current.setSelectedIndex, 'function')
      assert.equal(typeof result.current.handleKeyDown, 'function')
    })

    it('allows manual update of selectedIndex via setSelectedIndex with value', () => {
      const { result } = renderHook(usePickerNavigation, { itemCount: 5 })

      result.current.setSelectedIndex(3)
      assert.equal(result.current.selectedIndex, 3)
    })

    it('allows manual update of selectedIndex via setSelectedIndex with updater function', () => {
      const { result } = renderHook(usePickerNavigation, { itemCount: 5 })

      result.current.setSelectedIndex(prev => prev + 2)
      assert.equal(result.current.selectedIndex, 2)
    })
  })

  describe('auto-focus and open state transitions', () => {
    it('focuses inputRef element after autoFocusDelay when open is true', async () => {
      let focusCount = 0
      const { result } = renderHook(usePickerNavigation, {
        itemCount: 3,
        autoFocusDelay: 15,
      })

      attachInputRef(result.current.inputRef, {
        focus: () => {
          focusCount++
        },
      })

      assert.equal(focusCount, 0, 'Focus should not be called synchronously')
      await sleep(35)
      assert.equal(focusCount, 1, 'Focus should be called after autoFocusDelay')
    })

    it('handles null inputRef gracefully when auto-focus timer triggers', async () => {
      // Should not throw even if inputRef.current was never attached
      renderHook(usePickerNavigation, { itemCount: 3, autoFocusDelay: 10 })
      await sleep(25)
    })

    it('does not schedule focus when autoFocusDelay is negative', async () => {
      let focusCount = 0
      const { result } = renderHook(usePickerNavigation, {
        itemCount: 3,
        autoFocusDelay: -1,
      })

      attachInputRef(result.current.inputRef, {
        focus: () => {
          focusCount++
        },
      })

      await sleep(25)
      assert.equal(focusCount, 0, 'Focus should not be scheduled when autoFocusDelay < 0')
    })

    it('supports autoFocusDelay === 0', async () => {
      let focusCount = 0
      const { result } = renderHook(usePickerNavigation, {
        itemCount: 3,
        autoFocusDelay: 0,
      })

      attachInputRef(result.current.inputRef, {
        focus: () => {
          focusCount++
        },
      })

      await sleep(15)
      assert.equal(focusCount, 1, 'Focus should be called when autoFocusDelay === 0')
    })

    it('does not trigger auto-focus or reset selectedIndex when open is false', async () => {
      let focusCount = 0
      const { result } = renderHook(usePickerNavigation, {
        open: false,
        itemCount: 5,
        autoFocusDelay: 10,
      })

      result.current.setSelectedIndex(3)
      attachInputRef(result.current.inputRef, {
        focus: () => {
          focusCount++
        },
      })

      await sleep(25)
      assert.equal(focusCount, 0, 'Focus should not be called when open is false')
      assert.equal(result.current.selectedIndex, 3, 'selectedIndex should not reset when open is false')
    })

    it('resets selectedIndex to 0 and re-triggers auto-focus when transitioning open from false to true', async () => {
      let focusCount = 0
      const { result, rerender } = renderHook(usePickerNavigation, {
        open: false,
        itemCount: 5,
        autoFocusDelay: 15,
      })

      result.current.setSelectedIndex(4)
      assert.equal(result.current.selectedIndex, 4)

      attachInputRef(result.current.inputRef, {
        focus: () => {
          focusCount++
        },
      })

      // Open picker
      rerender({ open: true, itemCount: 5, autoFocusDelay: 15 })

      assert.equal(result.current.selectedIndex, 0, 'selectedIndex should reset to 0 on open')
      await sleep(35)
      assert.equal(focusCount, 1, 'Focus should be called after opening')
    })

    it('clears auto-focus timer on unmount before delay elapses', async () => {
      let focusCount = 0
      const { result, unmount } = renderHook(usePickerNavigation, {
        itemCount: 3,
        autoFocusDelay: 40,
      })

      attachInputRef(result.current.inputRef, {
        focus: () => {
          focusCount++
        },
      })

      // Unmount immediately before timer fires
      unmount()
      await sleep(60)

      assert.equal(focusCount, 0, 'Focus should not be called after unmount')
    })

    it('clears previous timer when autoFocusDelay or open prop changes before expiry', async () => {
      let focusCount = 0
      const { result, rerender } = renderHook(usePickerNavigation, {
        open: true,
        itemCount: 3,
        autoFocusDelay: 50,
      })

      attachInputRef(result.current.inputRef, {
        focus: () => {
          focusCount++
        },
      })

      // Wait 15ms, then update to a shorter delay (20ms)
      await sleep(15)
      rerender({ open: true, itemCount: 3, autoFocusDelay: 20 })

      await sleep(35)
      // The second timer should fire, but the first timer must have been cleared
      assert.equal(focusCount, 1)
    })
  })

  describe('IME composition guard (Vietnamese Telex/VNI, CJK, etc.)', () => {
    it('ignores ArrowDown when isComposing is true', () => {
      const { result } = renderHook(usePickerNavigation, { itemCount: 4 })
      const event = createMockKeyEvent({ key: 'ArrowDown', isComposing: true })

      result.current.handleKeyDown(event as unknown as KeyboardEvent)

      assert.equal(result.current.selectedIndex, 0, 'selectedIndex must not change')
      assert.equal(event.defaultPrevented, false, 'preventDefault must not be called')
      assert.equal(event.propagationStopped, false, 'stopPropagation must not be called')
    })

    it('ignores ArrowUp when isComposing is true', () => {
      const { result } = renderHook(usePickerNavigation, { itemCount: 4 })
      const event = createMockKeyEvent({ key: 'ArrowUp', isComposing: true })

      result.current.handleKeyDown(event as unknown as KeyboardEvent)

      assert.equal(result.current.selectedIndex, 0)
      assert.equal(event.defaultPrevented, false)
      assert.equal(event.propagationStopped, false)
    })

    it('ignores Enter when isComposing is true', () => {
      let selected = false
      const { result } = renderHook(usePickerNavigation, {
        itemCount: 4,
        onSelect: () => {
          selected = true
        },
      })
      const event = createMockKeyEvent({ key: 'Enter', isComposing: true })

      result.current.handleKeyDown(event as unknown as KeyboardEvent)

      assert.equal(selected, false, 'onSelect must not be called during IME composition')
      assert.equal(event.defaultPrevented, false)
    })

    it('ignores Escape when isComposing is true', () => {
      let closed = false
      const { result } = renderHook(usePickerNavigation, {
        itemCount: 4,
        onClose: () => {
          closed = true
        },
      })
      const event = createMockKeyEvent({ key: 'Escape', isComposing: true })

      result.current.handleKeyDown(event as unknown as KeyboardEvent)

      assert.equal(closed, false, 'onClose must not be called during IME composition')
      assert.equal(event.defaultPrevented, false)
    })

    it('ignores ArrowDown when keyCode is 229 (IME composition in legacy browsers)', () => {
      const { result } = renderHook(usePickerNavigation, { itemCount: 4 })
      const event = createMockKeyEvent({ key: 'ArrowDown', keyCode: 229 })

      result.current.handleKeyDown(event as unknown as KeyboardEvent)

      assert.equal(result.current.selectedIndex, 0)
      assert.equal(event.defaultPrevented, false)
      assert.equal(event.propagationStopped, false)
    })

    it('ignores Enter when keyCode is 229', () => {
      let selected = false
      const { result } = renderHook(usePickerNavigation, {
        itemCount: 4,
        onSelect: () => {
          selected = true
        },
      })
      const event = createMockKeyEvent({ key: 'Enter', keyCode: 229 })

      result.current.handleKeyDown(event as unknown as KeyboardEvent)

      assert.equal(selected, false)
      assert.equal(event.defaultPrevented, false)
    })
  })

  describe('empty list behavior (itemCount === 0)', () => {
    it('ignores ArrowDown when itemCount is 0 without preventing default', () => {
      const { result } = renderHook(usePickerNavigation, { itemCount: 0 })
      const event = createMockKeyEvent({ key: 'ArrowDown' })

      result.current.handleKeyDown(event as unknown as KeyboardEvent)

      assert.equal(result.current.selectedIndex, 0)
      assert.equal(event.defaultPrevented, false)
      assert.equal(event.propagationStopped, false)
    })

    it('ignores ArrowUp when itemCount is 0 without preventing default', () => {
      const { result } = renderHook(usePickerNavigation, { itemCount: 0 })
      const event = createMockKeyEvent({ key: 'ArrowUp' })

      result.current.handleKeyDown(event as unknown as KeyboardEvent)

      assert.equal(result.current.selectedIndex, 0)
      assert.equal(event.defaultPrevented, false)
      assert.equal(event.propagationStopped, false)
    })

    it('ignores Enter when itemCount is 0 without calling onSelect or preventing default', () => {
      let selected = false
      const { result } = renderHook(usePickerNavigation, {
        itemCount: 0,
        onSelect: () => {
          selected = true
        },
      })
      const event = createMockKeyEvent({ key: 'Enter' })

      result.current.handleKeyDown(event as unknown as KeyboardEvent)

      assert.equal(selected, false)
      assert.equal(event.defaultPrevented, false)
      assert.equal(event.propagationStopped, false)
    })

    it('handles Escape even when itemCount is 0', () => {
      let closed = false
      const { result } = renderHook(usePickerNavigation, {
        itemCount: 0,
        onClose: () => {
          closed = true
        },
      })
      const event = createMockKeyEvent({ key: 'Escape' })

      result.current.handleKeyDown(event as unknown as KeyboardEvent)

      assert.equal(closed, true, 'Escape must invoke onClose even when list is empty')
      assert.equal(event.defaultPrevented, true)
      assert.equal(event.propagationStopped, true)
    })
  })

  describe('single item list (itemCount === 1)', () => {
    it('ArrowDown stays at index 0', () => {
      const { result } = renderHook(usePickerNavigation, { itemCount: 1 })
      const event = createMockKeyEvent({ key: 'ArrowDown' })

      result.current.handleKeyDown(event as unknown as KeyboardEvent)

      assert.equal(result.current.selectedIndex, 0)
      assert.equal(event.defaultPrevented, true)
    })

    it('ArrowUp stays at index 0', () => {
      const { result } = renderHook(usePickerNavigation, { itemCount: 1 })
      const event = createMockKeyEvent({ key: 'ArrowUp' })

      result.current.handleKeyDown(event as unknown as KeyboardEvent)

      assert.equal(result.current.selectedIndex, 0)
      assert.equal(event.defaultPrevented, true)
    })

    it('Enter selects index 0', () => {
      let selectedIndex = -1
      const { result } = renderHook(usePickerNavigation, {
        itemCount: 1,
        onSelect: idx => {
          selectedIndex = idx
        },
      })
      const event = createMockKeyEvent({ key: 'Enter' })

      result.current.handleKeyDown(event as unknown as KeyboardEvent)

      assert.equal(selectedIndex, 0)
      assert.equal(event.defaultPrevented, true)
    })
  })

  describe('ArrowDown navigation', () => {
    it('increments selectedIndex by 1 and prevents default', () => {
      const { result } = renderHook(usePickerNavigation, { itemCount: 4 })
      const event = createMockKeyEvent({ key: 'ArrowDown' })

      result.current.handleKeyDown(event as unknown as KeyboardEvent)

      assert.equal(result.current.selectedIndex, 1)
      assert.equal(event.defaultPrevented, true)
      assert.equal(event.propagationStopped, true)
    })

    it('wraps around to 0 when pressing ArrowDown at the last item', () => {
      const { result } = renderHook(usePickerNavigation, { itemCount: 3 })

      // 0 -> 1 -> 2 -> 0
      result.current.handleKeyDown(createMockKeyEvent({ key: 'ArrowDown' }) as unknown as KeyboardEvent)
      assert.equal(result.current.selectedIndex, 1)

      result.current.handleKeyDown(createMockKeyEvent({ key: 'ArrowDown' }) as unknown as KeyboardEvent)
      assert.equal(result.current.selectedIndex, 2)

      result.current.handleKeyDown(createMockKeyEvent({ key: 'ArrowDown' }) as unknown as KeyboardEvent)
      assert.equal(result.current.selectedIndex, 0, 'Should wrap around to 0')
    })
  })

  describe('ArrowUp navigation', () => {
    it('wraps around to the last item (itemCount - 1) when pressing ArrowUp from index 0', () => {
      const { result } = renderHook(usePickerNavigation, { itemCount: 4 })
      const event = createMockKeyEvent({ key: 'ArrowUp' })

      result.current.handleKeyDown(event as unknown as KeyboardEvent)

      assert.equal(result.current.selectedIndex, 3, 'Should wrap from 0 to 3')
      assert.equal(event.defaultPrevented, true)
      assert.equal(event.propagationStopped, true)
    })

    it('decrements selectedIndex when navigating backward', () => {
      const { result } = renderHook(usePickerNavigation, { itemCount: 4 })

      result.current.setSelectedIndex(3)
      assert.equal(result.current.selectedIndex, 3)

      result.current.handleKeyDown(createMockKeyEvent({ key: 'ArrowUp' }) as unknown as KeyboardEvent)
      assert.equal(result.current.selectedIndex, 2)

      result.current.handleKeyDown(createMockKeyEvent({ key: 'ArrowUp' }) as unknown as KeyboardEvent)
      assert.equal(result.current.selectedIndex, 1)

      result.current.handleKeyDown(createMockKeyEvent({ key: 'ArrowUp' }) as unknown as KeyboardEvent)
      assert.equal(result.current.selectedIndex, 0)
    })
  })

  describe('combined ArrowUp and ArrowDown cycling', () => {
    it('navigates forward and backward seamlessly across list bounds', () => {
      const { result } = renderHook(usePickerNavigation, { itemCount: 3 })

      // 0 -> Down (1) -> Down (2) -> Up (1) -> Up (0) -> Up (2) -> Down (0)
      result.current.handleKeyDown(createMockKeyEvent({ key: 'ArrowDown' }) as unknown as KeyboardEvent)
      assert.equal(result.current.selectedIndex, 1)

      result.current.handleKeyDown(createMockKeyEvent({ key: 'ArrowDown' }) as unknown as KeyboardEvent)
      assert.equal(result.current.selectedIndex, 2)

      result.current.handleKeyDown(createMockKeyEvent({ key: 'ArrowUp' }) as unknown as KeyboardEvent)
      assert.equal(result.current.selectedIndex, 1)

      result.current.handleKeyDown(createMockKeyEvent({ key: 'ArrowUp' }) as unknown as KeyboardEvent)
      assert.equal(result.current.selectedIndex, 0)

      result.current.handleKeyDown(createMockKeyEvent({ key: 'ArrowUp' }) as unknown as KeyboardEvent)
      assert.equal(result.current.selectedIndex, 2)

      result.current.handleKeyDown(createMockKeyEvent({ key: 'ArrowDown' }) as unknown as KeyboardEvent)
      assert.equal(result.current.selectedIndex, 0)
    })
  })

  describe('Enter key selection', () => {
    it('executes onSelect with current selectedIndex, prevents default and stops propagation', () => {
      let selectedItem = -1
      const { result } = renderHook(usePickerNavigation, {
        itemCount: 5,
        onSelect: idx => {
          selectedItem = idx
        },
      })

      // Navigate to index 2
      result.current.handleKeyDown(createMockKeyEvent({ key: 'ArrowDown' }) as unknown as KeyboardEvent)
      result.current.handleKeyDown(createMockKeyEvent({ key: 'ArrowDown' }) as unknown as KeyboardEvent)
      assert.equal(result.current.selectedIndex, 2)

      const enterEvent = createMockKeyEvent({ key: 'Enter' })
      result.current.handleKeyDown(enterEvent as unknown as KeyboardEvent)

      assert.equal(selectedItem, 2, 'onSelect should receive active selectedIndex')
      assert.equal(enterEvent.defaultPrevented, true)
      assert.equal(enterEvent.propagationStopped, true)
    })

    it('handles Enter safely when onSelect is not provided', () => {
      const { result } = renderHook(usePickerNavigation, { itemCount: 3 })
      const enterEvent = createMockKeyEvent({ key: 'Enter' })

      // Should not throw
      result.current.handleKeyDown(enterEvent as unknown as KeyboardEvent)

      assert.equal(enterEvent.defaultPrevented, true)
      assert.equal(enterEvent.propagationStopped, true)
    })
  })

  describe('Escape key dismissal', () => {
    it('executes onClose, prevents default and stops propagation', () => {
      let closeCalled = false
      const { result } = renderHook(usePickerNavigation, {
        itemCount: 3,
        onClose: () => {
          closeCalled = true
        },
      })
      const escapeEvent = createMockKeyEvent({ key: 'Escape' })

      result.current.handleKeyDown(escapeEvent as unknown as KeyboardEvent)

      assert.equal(closeCalled, true)
      assert.equal(escapeEvent.defaultPrevented, true)
      assert.equal(escapeEvent.propagationStopped, true)
    })

    it('handles Escape safely when onClose is not provided', () => {
      const { result } = renderHook(usePickerNavigation, { itemCount: 3 })
      const escapeEvent = createMockKeyEvent({ key: 'Escape' })

      // Should not throw
      result.current.handleKeyDown(escapeEvent as unknown as KeyboardEvent)

      assert.equal(escapeEvent.defaultPrevented, true)
      assert.equal(escapeEvent.propagationStopped, true)
    })
  })

  describe('unhandled / unmapped keys', () => {
    it('does not prevent default, stop propagation, or alter index for standard keystrokes', () => {
      const unhandledKeys = ['Tab', 'a', 'Backspace', 'Shift', ' ', 'ArrowLeft', 'ArrowRight']
      const { result } = renderHook(usePickerNavigation, { itemCount: 4 })

      result.current.setSelectedIndex(2)

      for (const key of unhandledKeys) {
        const event = createMockKeyEvent({ key })
        result.current.handleKeyDown(event as unknown as KeyboardEvent)

        assert.equal(result.current.selectedIndex, 2, `Key '${key}' should not change selectedIndex`)
        assert.equal(event.defaultPrevented, false, `Key '${key}' should not prevent default`)
        assert.equal(event.propagationStopped, false, `Key '${key}' should not stop propagation`)
      }
    })
  })

  describe('event variations and DOM compatibility', () => {
    it('handles events without stopPropagation method without throwing', () => {
      const { result } = renderHook(usePickerNavigation, { itemCount: 3 })
      const eventWithoutStopPropagation = createMockKeyEvent({
        key: 'ArrowDown',
        hasStopPropagation: false,
      })

      assert.equal(eventWithoutStopPropagation.stopPropagation, undefined)
      // Should not throw TypeError: e.stopPropagation is not a function
      result.current.handleKeyDown(eventWithoutStopPropagation as unknown as KeyboardEvent)
      assert.equal(result.current.selectedIndex, 1)
      assert.equal(eventWithoutStopPropagation.defaultPrevented, true)
    })

    it('works with native DOM KeyboardEvent from JSDOM', () => {
      const dom = new JSDOM('<!doctype html><html><body></body></html>')
      const { result } = renderHook(usePickerNavigation, { itemCount: 3 })

      const nativeEvent = new dom.window.KeyboardEvent('keydown', {
        key: 'ArrowDown',
        bubbles: true,
        cancelable: true,
      })

      result.current.handleKeyDown(nativeEvent)
      assert.equal(result.current.selectedIndex, 1)
      assert.equal(nativeEvent.defaultPrevented, true)
    })
  })

  describe('dynamic options updates across re-renders', () => {
    it('adapts wraparound behavior when itemCount changes dynamically', () => {
      const { result, rerender } = renderHook(usePickerNavigation, { itemCount: 3 })

      // Navigate to index 2
      result.current.setSelectedIndex(2)
      assert.equal(result.current.selectedIndex, 2)

      // itemCount increases to 5
      rerender({ itemCount: 5 })

      // Next ArrowDown should move to 3 instead of wrapping to 0
      result.current.handleKeyDown(createMockKeyEvent({ key: 'ArrowDown' }) as unknown as KeyboardEvent)
      assert.equal(result.current.selectedIndex, 3)

      // itemCount decreases to 2
      rerender({ itemCount: 2 })

      // Next ArrowDown with itemCount = 2 wraps (3 + 1) % 2 = 0
      result.current.handleKeyDown(createMockKeyEvent({ key: 'ArrowDown' }) as unknown as KeyboardEvent)
      assert.equal(result.current.selectedIndex, 0)
    })

    it('uses updated onSelect callback when options are re-rendered', () => {
      let callId = ''
      const { result, rerender } = renderHook(usePickerNavigation, {
        itemCount: 3,
        onSelect: () => {
          callId = 'first'
        },
      })

      rerender({
        itemCount: 3,
        onSelect: () => {
          callId = 'second'
        },
      })

      result.current.handleKeyDown(createMockKeyEvent({ key: 'Enter' }) as unknown as KeyboardEvent)
      assert.equal(callId, 'second', 'Should call updated onSelect callback')
    })

    it('uses updated onClose callback when options are re-rendered', () => {
      let callId = ''
      const { result, rerender } = renderHook(usePickerNavigation, {
        itemCount: 3,
        onClose: () => {
          callId = 'first'
        },
      })

      rerender({
        itemCount: 3,
        onClose: () => {
          callId = 'second'
        },
      })

      result.current.handleKeyDown(createMockKeyEvent({ key: 'Escape' }) as unknown as KeyboardEvent)
      assert.equal(callId, 'second', 'Should call updated onClose callback')
    })
  })
})
