import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { extractSettledDiffs, narrowDiffs } from '../../src/client/utils/extractSettledDiffs.ts'

describe('extractSettledDiffs', () => {
  test('reads meta.diffs off a real settled "edit" tool-result node', () => {
    // Shaped exactly like a real ToolResultNode captured from a live dsh
    // session (a genuine agent `edit` call on main.py) — this is the actual
    // bug: the capture pipeline used to read `node.resultView?.card`, a
    // field that does not exist on this type at all (see
    // dsh-client-ui-conversation's contract/records.ts — the real field is
    // `meta: unknown`). Every real agent edit silently matched nothing.
    const node = {
      kind: 'tool-result' as const,
      callId: 'call_01a07ad755a87e1094f430f40b8a86f7',
      isError: false,
      call: {
        name: 'edit',
        argsRaw: JSON.stringify({
          file_path: '/home/minhdn3/Documents/Code/Minh/VHCode/bottelerag/main.py',
          old_string: 'import sys\nimport asyncio\nimport logging',
          new_string: 'import os\nimport sys\nimport asyncio\nimport logging',
        }),
      },
      meta: {
        diffs: [
          {
            path: '/home/minhdn3/Documents/Code/Minh/VHCode/bottelerag/main.py',
            oldText: 'import sys\nimport asyncio\nimport logging',
            newText: 'import os\nimport sys\nimport asyncio\nimport logging',
          },
          {
            path: '/home/minhdn3/Documents/Code/Minh/VHCode/bottelerag/main.py',
            oldText: 'from bot.collector import OnyxIngestionWorker\n\nlogging.basicConfig(',
            newText: 'from bot.collector import OnyxIngestionWorker\n\n\nclass _ColorFormatter(logging.Formatter):',
          },
        ],
      },
    }

    const diffs = extractSettledDiffs(node)
    assert.notEqual(diffs, null, 'a real edit\'s meta.diffs must be recognized')
    assert.equal(diffs!.length, 2)
    assert.equal(diffs![0]!.path, '/home/minhdn3/Documents/Code/Minh/VHCode/bottelerag/main.py')
    assert.equal(diffs![0]!.oldText, 'import sys\nimport asyncio\nimport logging')
  })

  test('an errored call is the caller\'s responsibility, not this function\'s — but a node with no usable meta and a non-write call is null', () => {
    const node = { kind: 'tool-result' as const, callId: 'c1', isError: false, call: { name: 'read', argsRaw: '{}' }, meta: undefined }
    assert.equal(extractSettledDiffs(node), null)
  })

  test('falls back to a write call\'s own arguments when meta.diffs is absent or empty', () => {
    const node = {
      kind: 'tool-result' as const,
      callId: 'c2',
      isError: false,
      call: {
        name: 'write',
        argsRaw: JSON.stringify({ file_path: '/work/new-file.ts', content: 'export const x = 1\n' }),
      },
      meta: undefined,
    }
    const diffs = extractSettledDiffs(node)
    assert.notEqual(diffs, null, 'a write with no reconciliation metadata must still fall back to its own arguments')
    assert.deepEqual(diffs, [{ path: '/work/new-file.ts', oldText: null, newText: 'export const x = 1\n' }])
  })

  test('does NOT fall back to arguments for a non-write call (edit) with no usable meta', () => {
    // An edit's actual applied hunks can differ from what was asked for
    // (fuzzy old-text matching) — no metadata means no confident diff, not
    // a guess reconstructed from the request.
    const node = {
      kind: 'tool-result' as const,
      callId: 'c3',
      isError: false,
      call: {
        name: 'edit',
        argsRaw: JSON.stringify({ file_path: '/work/f.ts', old_string: 'a', new_string: 'b' }),
      },
      meta: undefined,
    }
    assert.equal(extractSettledDiffs(node), null)
  })

  test('treats an empty meta.diffs array as "no diffs", not a crash', () => {
    const node = { kind: 'tool-result' as const, callId: 'c4', isError: false, call: { name: 'edit', argsRaw: '{}' }, meta: { diffs: [] } }
    assert.equal(extractSettledDiffs(node), null)
  })

  test('narrowDiffs rejects a malformed hunk instead of silently dropping it', () => {
    assert.equal(narrowDiffs([{ path: '/f', newText: 'x' }, { path: 123, oldText: null, newText: 'y' }]), null)
    assert.equal(narrowDiffs('not an array'), null)
    assert.equal(narrowDiffs([]), null)
  })

  test('narrowDiffs accepts a genuine create (oldText: null)', () => {
    const out = narrowDiffs([{ path: '/f', oldText: null, newText: 'whole file' }])
    assert.deepEqual(out, [{ path: '/f', oldText: null, newText: 'whole file' }])
  })

  test('narrowDiffs reuses an already-well-shaped hunk instead of allocating a copy', () => {
    const hunk = { path: '/f', oldText: 'a', newText: 'b' }
    const out = narrowDiffs([hunk])
    assert.equal(out![0], hunk, 'a hunk with exactly {path, oldText, newText} should be returned by reference')
  })

  test('narrowDiffs still normalizes a hunk carrying extra properties', () => {
    const hunk = { path: '/f', oldText: 'a', newText: 'b', extra: 'ignored' }
    const out = narrowDiffs([hunk])
    assert.notEqual(out![0], hunk, 'a hunk with extra keys must be rebuilt into the narrow shape')
    assert.deepEqual(out, [{ path: '/f', oldText: 'a', newText: 'b' }])
  })
})
