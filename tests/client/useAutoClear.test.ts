import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { useAutoClear } from '../../src/client/utils/useAutoClear.ts'

type EffectCreate = () => void | (() => void)

interface MinimalDispatcher {
  useEffect(create: EffectCreate, deps?: ReadonlyArray<unknown>): void
}

interface ReactInternals {
  ReactCurrentDispatcher: { current: MinimalDispatcher | null }
}

const internals = (
  React as unknown as {
    __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: ReactInternals
  }
).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED

/**
 * Runs `render` with a fake hook dispatcher installed so that the real
 * `useEffect` call inside `useAutoClear` resolves against it instead of
 * requiring an actual React render tree. Immediately invokes the captured
 * effect (mirroring React running it after mount) and returns its cleanup.
 */
function runEffect(render: () => void): { deps: ReadonlyArray<unknown> | undefined; cleanup: (() => void) | void } {
  let capturedCreate: EffectCreate | undefined
  let capturedDeps: ReadonlyArray<unknown> | undefined
  const dispatcher: MinimalDispatcher = {
    useEffect(create, deps) {
      capturedCreate = create
      capturedDeps = deps
    },
  }
  const previous = internals.ReactCurrentDispatcher.current
  internals.ReactCurrentDispatcher.current = dispatcher
  try {
    render()
  } finally {
    internals.ReactCurrentDispatcher.current = previous
  }
  assert.ok(capturedCreate, 'expected useAutoClear to register an effect')
  const cleanup = capturedCreate()
  return { deps: capturedDeps, cleanup }
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

describe('useAutoClear', () => {
  test('does not schedule a clear when trigger is falsy', async () => {
    let calls = 0
    const { cleanup } = runEffect(() => {
      useAutoClear(false, () => { calls++ }, 10)
    })
    assert.equal(cleanup, undefined)
    await wait(20)
    assert.equal(calls, 0)
  })

  test('calls onClear after delayMs when trigger is truthy', async () => {
    let calls = 0
    runEffect(() => {
      useAutoClear(true, () => { calls++ }, 10)
    })
    assert.equal(calls, 0)
    await wait(30)
    assert.equal(calls, 1)
  })

  test('treats any truthy trigger value (string, number, object) as active', async () => {
    for (const trigger of ['error', 1, { some: 'state' }]) {
      let calls = 0
      runEffect(() => {
        useAutoClear(trigger, () => { calls++ }, 5)
      })
      await wait(20)
      assert.equal(calls, 1, `expected onClear to fire for trigger ${JSON.stringify(trigger)}`)
    }
  })

  test('cleanup cancels the pending timer so onClear never fires', async () => {
    let calls = 0
    const { cleanup } = runEffect(() => {
      useAutoClear('active', () => { calls++ }, 10)
    })
    assert.equal(typeof cleanup, 'function')
    cleanup?.()
    await wait(30)
    assert.equal(calls, 0)
  })

  test('exposes trigger, onClear, and delayMs via the effect dependency array', () => {
    const onClear = () => {}
    const { deps, cleanup } = runEffect(() => {
      useAutoClear('some-trigger', onClear, 42)
    })
    assert.deepEqual(deps, ['some-trigger', onClear, 42])
    cleanup?.()
  })
})
