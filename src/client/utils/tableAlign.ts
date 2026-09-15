/**
 * Table column alignment detection utility.
 *
 * Inspects a markdown table delimiter row (e.g. `| :--- | :---: | ---: | --- |`)
 * and detects the column alignments based on GitHub Flavored Markdown (GFM) conventions.
 */

export type TableColumnAlignment = 'left' | 'center' | 'right' | 'default'

/**
 * Checks whether a single line qualifies as a markdown table delimiter row.
 */
function isDelimiterRow(line: string): boolean {
  if (!line.includes('-')) return false
  let stripped = line.trim()
  if (stripped.startsWith('|')) stripped = stripped.slice(1)
  if (stripped.endsWith('|')) stripped = stripped.slice(0, -1)
  const cells = stripped.split('|').map((c) => c.replace(/\s+/g, ''))
  return (
    cells.length > 0 &&
    cells.every((c) => /^:?-+:?$/.test(c) || c === '') &&
    cells.some((c) => /^:?-+:?$/.test(c))
  )
}

/**
 * Detects the alignment for each column from a markdown table delimiter row.
 *
 * @param headerDelimiterRow The markdown header delimiter line or table snippet
 * @returns An array of alignments: 'left', 'center', 'right', or 'default'
 */
export function detectTableAlignments(
  headerDelimiterRow: string,
): Array<'left' | 'center' | 'right' | 'default'> {
  if (!headerDelimiterRow || typeof headerDelimiterRow !== 'string') {
    return []
  }

  const lines = headerDelimiterRow
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  if (lines.length === 0) {
    return []
  }

  // If multiple lines are provided, locate the table delimiter row
  const targetLine = lines.find(isDelimiterRow) ?? (lines.length === 1 ? lines[0] : null)
  if (!targetLine) {
    return []
  }

  let line = targetLine.trim()
  if (!line.includes('-')) {
    return []
  }

  if (line.startsWith('|')) {
    line = line.slice(1)
  }
  if (line.endsWith('|')) {
    line = line.slice(0, -1)
  }

  if (line.trim() === '') {
    return []
  }

  const rawCells = line.split('|')
  const alignments: TableColumnAlignment[] = []

  for (const rawCell of rawCells) {
    const cleaned = rawCell.replace(/\s+/g, '')
    if (!cleaned.includes('-')) {
      alignments.push('default')
      continue
    }

    const startsWithColon = cleaned.startsWith(':')
    const endsWithColon = cleaned.endsWith(':')

    if (startsWithColon && endsWithColon) {
      alignments.push('center')
    } else if (startsWithColon) {
      alignments.push('left')
    } else if (endsWithColon) {
      alignments.push('right')
    } else {
      alignments.push('default')
    }
  }

  return alignments
}
