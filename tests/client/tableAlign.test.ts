import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  detectTableAlignments,
  type TableColumnAlignment,
} from '../../src/client/utils/tableAlign.ts'

describe('detectTableAlignments', () => {
  test('detects all four alignments with outer pipes', () => {
    const row = '| :--- | :---: | ---: | --- |'
    const alignments: TableColumnAlignment[] = detectTableAlignments(row)
    assert.deepStrictEqual(alignments, ['left', 'center', 'right', 'default'])
  })

  test('detects all four alignments without outer pipes', () => {
    const row = ':--- | :---: | ---: | ---'
    const alignments = detectTableAlignments(row)
    assert.deepStrictEqual(alignments, ['left', 'center', 'right', 'default'])
  })

  test('detects alignments with leading pipe only', () => {
    const row = '| :--- | :---: | ---: | ---'
    const alignments = detectTableAlignments(row)
    assert.deepStrictEqual(alignments, ['left', 'center', 'right', 'default'])
  })

  test('detects alignments with trailing pipe only', () => {
    const row = ':--- | :---: | ---: | --- |'
    const alignments = detectTableAlignments(row)
    assert.deepStrictEqual(alignments, ['left', 'center', 'right', 'default'])
  })

  test('handles compact delimiter row with no spaces', () => {
    const rowWithPipes = '|:---|:---:|---:|---|'
    assert.deepStrictEqual(detectTableAlignments(rowWithPipes), [
      'left',
      'center',
      'right',
      'default',
    ])

    const rowWithoutPipes = ':---|:---:|---:|---'
    assert.deepStrictEqual(detectTableAlignments(rowWithoutPipes), [
      'left',
      'center',
      'right',
      'default',
    ])
  })

  test('handles varying dash counts', () => {
    // Single dash
    assert.deepStrictEqual(detectTableAlignments('| :- | :-: | -: | - |'), [
      'left',
      'center',
      'right',
      'default',
    ])

    // Two dashes
    assert.deepStrictEqual(detectTableAlignments('| :-- | :--: | --: | -- |'), [
      'left',
      'center',
      'right',
      'default',
    ])

    // Many dashes
    assert.deepStrictEqual(
      detectTableAlignments('| :-------- | :--------: | --------: | -------- |'),
      ['left', 'center', 'right', 'default'],
    )
  })

  test('handles single column delimiter rows', () => {
    assert.deepStrictEqual(detectTableAlignments('| :--- |'), ['left'])
    assert.deepStrictEqual(detectTableAlignments('| :---: |'), ['center'])
    assert.deepStrictEqual(detectTableAlignments('| ---: |'), ['right'])
    assert.deepStrictEqual(detectTableAlignments('| --- |'), ['default'])

    assert.deepStrictEqual(detectTableAlignments(':---'), ['left'])
    assert.deepStrictEqual(detectTableAlignments(':---:'), ['center'])
    assert.deepStrictEqual(detectTableAlignments('---:'), ['right'])
    assert.deepStrictEqual(detectTableAlignments('---'), ['default'])
  })

  test('handles irregular spaces and tabs inside and around cells', () => {
    const row = '  \t |   :---    |  :---:   |   ---: |  ---   | \t \n'
    assert.deepStrictEqual(detectTableAlignments(row), [
      'left',
      'center',
      'right',
      'default',
    ])

    // Spaces between colons and hyphens
    assert.deepStrictEqual(detectTableAlignments('| : --- | : --- : | --- : | --- |'), [
      'left',
      'center',
      'right',
      'default',
    ])
    assert.deepStrictEqual(detectTableAlignments('| : - : |'), ['center'])
  })

  test('handles empty and whitespace-only inputs gracefully', () => {
    assert.deepStrictEqual(detectTableAlignments(''), [])
    assert.deepStrictEqual(detectTableAlignments('   '), [])
    assert.deepStrictEqual(detectTableAlignments('\n\t  \r\n'), [])
  })

  test('handles rows with no delimiter hyphens or only pipes', () => {
    assert.deepStrictEqual(detectTableAlignments('|'), [])
    assert.deepStrictEqual(detectTableAlignments('||'), [])
    assert.deepStrictEqual(detectTableAlignments('| | |'), [])
    assert.deepStrictEqual(detectTableAlignments('| Header 1 | Header 2 |'), [])
  })

  test('handles empty or malformed cells within a valid delimiter row', () => {
    const row = '| :--- | | ---: |'
    assert.deepStrictEqual(detectTableAlignments(row), ['left', 'default', 'right'])
  })

  test('extracts alignments when passed full markdown table snippet', () => {
    const tableSnippet = [
      '| Name | Status | Score |',
      '| :--- | :---: | ---: |',
      '| Alice | Active | 100 |',
    ].join('\n')

    assert.deepStrictEqual(detectTableAlignments(tableSnippet), [
      'left',
      'center',
      'right',
    ])
  })
})
