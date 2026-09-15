/**
 * Markdown statistics utility for calculating word counts, character counts,
 * and estimated reading time.
 *
 * Designed to handle markdown-specific syntax such as YAML frontmatter,
 * fenced code blocks, inline markup, tables, and task lists without inflating
 * prose metrics.
 */

export interface MarkdownStatsOptions {
  /**
   * Reading speed in words per minute.
   * @default 200
   */
  wpm?: number
  /**
   * Whether to exclude fenced code blocks (``` and ~~~) from word count and reading time.
   * @default true
   */
  excludeCodeBlocks?: boolean
  /**
   * Whether to exclude YAML frontmatter headers from word count and reading time.
   * @default true
   */
  excludeFrontmatter?: boolean
}

export interface ReadingTimeResult {
  /** Total number of prose words in the document. */
  words: number
  /** Estimated reading time in minutes (ceiled, 0 if no words). */
  minutes: number
  /** Character count of the cleaned readable text. */
  characters: number
}

/**
 * Strips code blocks from markdown text.
 * Handles CommonMark fenced code blocks (``` and ~~~) with optional language tags,
 * custom fence lengths (e.g. 4+ backticks), and unclosed fences at the end of input.
 */
function stripCodeBlocks(text: string, exclude: boolean): string {
  const lines = text.split(/\r?\n/)
  const result: string[] = []
  let inCodeBlock = false
  let fenceChar = ''
  let fenceLength = 0

  for (const line of lines) {
    const match = /^[ ]{0,3}(`{3,}|~{3,})/.exec(line)
    if (match && match[1]) {
      const char = match[1][0] ?? ''
      const length = match[1].length

      if (!inCodeBlock) {
        inCodeBlock = true
        fenceChar = char
        fenceLength = length
        continue
      } else if (char === fenceChar && length >= fenceLength) {
        const rest = line.replace(/^[ ]{0,3}(`{3,}|~{3,})/, '').trim()
        if (!rest) {
          inCodeBlock = false
          fenceChar = ''
          fenceLength = 0
          continue
        }
      }
    }

    if (inCodeBlock) {
      if (!exclude) {
        // If code blocks are preserved, retain the code content without the fences
        result.push(line)
      }
    } else {
      result.push(line)
    }
  }

  return result.join('\n')
}

/**
 * Strips YAML frontmatter at the start of a markdown file.
 * Must begin on the very first line with `---` and be closed by a matching `---`.
 */
function stripFrontmatter(text: string): string {
  return text.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/, '')
}

/**
 * Strips markdown markup and syntax formatting to extract readable plain text.
 */
export function stripMarkdown(text: string, options?: MarkdownStatsOptions): string {
  if (typeof text !== 'string' || !text.trim()) {
    return ''
  }

  const excludeFrontmatter = options?.excludeFrontmatter ?? true
  const excludeCodeBlocks = options?.excludeCodeBlocks ?? true

  let cleaned = text

  // 1. Strip YAML frontmatter at document start
  if (excludeFrontmatter) {
    cleaned = stripFrontmatter(cleaned)
  }

  // 2. Strip or clean fenced code blocks
  cleaned = stripCodeBlocks(cleaned, excludeCodeBlocks)

  // 3. Strip HTML comments <!-- ... -->
  cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '')

  // 4. Strip HTML tags (e.g. <div>, <br/>, <span>)
  cleaned = cleaned.replace(/<[^>]+>/g, ' ')

  // 5. Strip images: ![alt](url) -> ""
  cleaned = cleaned.replace(/!\[([^\]]*)\]\([^)]*\)/g, '')

  // 6. Inline links: [link text](url) -> "link text"
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')

  // 7. Reference links & link definitions
  cleaned = cleaned.replace(/^\[[^\]]+\]:\s*\S+.*$/gm, '')
  cleaned = cleaned.replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')

  // 8. Math blocks ($$...$$)
  cleaned = cleaned.replace(/\$\$[\s\S]*?\$\$/g, '')

  // 9. Headings: strip leading #
  cleaned = cleaned.replace(/^[ ]{0,3}#{1,6}\s+/gm, '')

  // 10. Blockquotes: strip leading >
  cleaned = cleaned.replace(/^[ ]{0,3}>\s*/gm, '')

  // 11. Task lists and list markers: strip -, *, +, 1., [ ], [x]
  cleaned = cleaned.replace(/^[ ]{0,3}(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s*)?/gm, '')

  // 12. Table formatting: strip separator lines (|---|) and replace column pipes with spaces
  cleaned = cleaned.replace(/^[ ]{0,3}\|?(\s*:?-+:?\s*\|)+\s*$/gm, '')
  cleaned = cleaned.replace(/\|/g, ' ')

  // 13. Inline code backticks: `code` -> code
  cleaned = cleaned.replace(/(`+)([\s\S]*?)\1/g, '$2')

  // 14. Text styling (bold, italic, strikethrough, highlight)
  cleaned = cleaned.replace(/(\*\*|__)(.*?)\1/g, '$2')
  cleaned = cleaned.replace(/(\*|_)(.*?)\1/g, '$2')
  cleaned = cleaned.replace(/~~(.*?)~~/g, '$1')
  cleaned = cleaned.replace(/==(.*?)==/g, '$1')

  // 15. Thematic breaks / horizontal rules (---, ***, ___)
  cleaned = cleaned.replace(/^[ ]{0,3}([-*_])(?:\s*\1){2,}\s*$/gm, '')

  // 16. Normalize consecutive blank lines and trim
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim()

  return cleaned
}

/**
 * Counts the total number of words in a markdown string.
 *
 * Automatically handles:
 * - Empty and whitespace-only strings (returns 0)
 * - YAML frontmatter metadata (excluded by default)
 * - Fenced code blocks (excluded by default)
 * - Markdown links, images, tables, list markers, and inline styling
 * - Unicode text, contractions (don't, it's), hyphens (state-of-the-art), and CJK characters
 *
 * @param text - The markdown content to count words in.
 * @param options - Optional configuration for exclusion and parsing.
 * @returns Total count of readable words.
 */
export function countWords(text: string, options?: MarkdownStatsOptions): number {
  if (typeof text !== 'string' || !text.trim()) {
    return 0
  }

  const cleaned = stripMarkdown(text, options)
  if (!cleaned) {
    return 0
  }

  // Count CJK logograms as individual words (Han, Hiragana, Katakana)
  const cjkMatches = cleaned.match(/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/gu)
  const cjkCount = cjkMatches ? cjkMatches.length : 0

  // Replace CJK characters with space and match remaining word tokens
  const nonCjkText = cleaned.replace(/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/gu, ' ')
  // Match word tokens: sequences of letters/numbers, allowing internal hyphens or apostrophes
  const wordMatches = nonCjkText.match(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu)
  const wordCount = wordMatches ? wordMatches.length : 0

  return cjkCount + wordCount
}

/**
 * Estimates reading time and document metrics for a markdown string.
 *
 * @param text - The markdown content to evaluate.
 * @param wpmOrOptions - Either reading speed in words per minute (default 200), or options object.
 * @returns Object containing words, minutes (ceiled, 0 for empty), and characters.
 */
export function estimateReadingTime(
  text: string,
  wpmOrOptions: number | MarkdownStatsOptions = 200,
): ReadingTimeResult {
  const options: MarkdownStatsOptions =
    typeof wpmOrOptions === 'number'
      ? { wpm: wpmOrOptions }
      : (wpmOrOptions ?? {})

  const rawWpm = options.wpm ?? 200
  const wpm = typeof rawWpm === 'number' && rawWpm > 0 ? rawWpm : 200

  if (typeof text !== 'string' || !text.trim()) {
    return { words: 0, minutes: 0, characters: 0 }
  }

  const cleaned = stripMarkdown(text, options)
  if (!cleaned) {
    return { words: 0, minutes: 0, characters: 0 }
  }

  const words = countWords(text, options)
  const minutes = words === 0 ? 0 : Math.ceil(words / wpm)
  const characters = cleaned.length

  return { words, minutes, characters }
}
