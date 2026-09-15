import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  stripMarkdown,
  countWords,
  estimateReadingTime,
  type MarkdownStatsOptions,
  type ReadingTimeResult,
} from '../../src/client/utils/markdownStats.ts'

describe('stripMarkdown', () => {
  test('returns empty string for empty input', () => {
    assert.equal(stripMarkdown(''), '')
  })

  test('returns empty string for whitespace-only input', () => {
    assert.equal(stripMarkdown('   \n\n   \t  '), '')
  })

  test('returns empty string when input is not a string', () => {
    assert.equal(stripMarkdown(undefined as unknown as string), '')
    assert.equal(stripMarkdown(null as unknown as string), '')
    assert.equal(stripMarkdown(123 as unknown as string), '')
  })

  test('preserves plain prose text', () => {
    assert.equal(
      stripMarkdown('Hello world, this is a simple sentence.'),
      'Hello world, this is a simple sentence.',
    )
  })

  test('strips a YAML frontmatter block at the document start by default', () => {
    const text = [
      '---',
      'title: Example',
      'author: Jane',
      '---',
      '',
      'Real body content here.',
    ].join('\n')
    const result = stripMarkdown(text)
    assert.ok(!result.includes('title'))
    assert.ok(!result.includes('author'))
    assert.ok(result.includes('Real body content here.'))
  })

  test('keeps the frontmatter when excludeFrontmatter is false', () => {
    const text = [
      '---',
      'title: Example',
      '---',
      'Body',
    ].join('\n')
    const result = stripMarkdown(text, { excludeFrontmatter: false })
    assert.ok(result.includes('title'))
    assert.ok(result.includes('Example'))
  })

  test('does not strip frontmatter when --- marker is not on the first line', () => {
    const text = ['Leading line', '---', 'title: x', '---', 'Body'].join('\n')
    const result = stripMarkdown(text)
    assert.ok(result.includes('title'))
  })

  test('strips fenced code blocks using triple backticks by default', () => {
    const text = [
      'Prose before.',
      '```js',
      'const ignored = "code";',
      '```',
      'Prose after.',
    ].join('\n')
    const result = stripMarkdown(text)
    assert.ok(!result.includes('ignored'))
    assert.ok(result.includes('Prose before'))
    assert.ok(result.includes('Prose after'))
  })

  test('strips fenced code blocks using tilde fences by default', () => {
    const text = ['Intro.', '~~~', 'echo hidden', '~~~', 'Outro.'].join('\n')
    const result = stripMarkdown(text)
    assert.ok(!result.includes('hidden'))
    assert.ok(result.includes('Intro'))
    assert.ok(result.includes('Outro'))
  })

  test('keeps code-block content when excludeCodeBlocks is false', () => {
    const text = ['A.', '```', 'inside', '```', 'B.'].join('\n')
    const result = stripMarkdown(text, { excludeCodeBlocks: false })
    assert.ok(result.includes('inside'))
  })

  test('handles an unclosed code block by treating the rest of the file as code', () => {
    const text = ['Open prose.', '```', 'still inside', 'no closing fence'].join('\n')
    const result = stripMarkdown(text)
    assert.ok(result.includes('Open prose'))
    assert.ok(!result.includes('still inside'))
    assert.ok(!result.includes('no closing fence'))
  })

  test('handles fenced code blocks with more than three backticks', () => {
    const text = ['Head.', '````py', 'print("hidden")', '````', 'Tail.'].join('\n')
    const result = stripMarkdown(text)
    assert.ok(!result.includes('hidden'))
    assert.ok(result.includes('Head'))
    assert.ok(result.includes('Tail'))
  })

  test('does not require language info on a closing fence', () => {
    const text = ['A.', '```js', 'hidden', '```', 'B.'].join('\n')
    const result = stripMarkdown(text)
    assert.ok(!result.includes('hidden'))
  })

  test('strips HTML comments', () => {
    const result = stripMarkdown('Visible <!-- hidden comment --> text')
    assert.ok(!result.includes('hidden comment'))
    assert.ok(result.includes('Visible'))
    assert.ok(result.includes('text'))
  })

  test('strips HTML tags but keeps surrounding text', () => {
    const result = stripMarkdown('<div>Hello <br/>world</div>')
    assert.ok(!result.includes('<div>'))
    assert.ok(!result.includes('<br/>'))
    assert.ok(result.includes('Hello'))
    assert.ok(result.includes('world'))
  })

  test('strips image syntax completely', () => {
    const result = stripMarkdown('Look ![alt text](https://example.com/x.png) here')
    assert.ok(!result.includes('alt text'))
    assert.ok(!result.includes('https://example.com'))
    assert.ok(result.includes('Look'))
    assert.ok(result.includes('here'))
  })

  test('keeps the text of inline links', () => {
    const result = stripMarkdown('Read [the docs](https://example.com) please')
    assert.equal(result.includes('https://example.com'), false)
    assert.ok(result.includes('the docs'))
    assert.ok(result.includes('Read'))
    assert.ok(result.includes('please'))
  })

  test('strips reference link definitions', () => {
    const text = [
      '[doc]: https://example.com/docs',
      '',
      'Read [the doc][doc] for more.',
    ].join('\n')
    const result = stripMarkdown(text)
    assert.ok(!result.includes('https://example.com'))
    assert.ok(result.includes('the doc'))
  })

  test('keeps the text of reference-style links', () => {
    const text = [
      '[doc]: https://example.com/docs',
      '',
      'See [the doc][doc].',
    ].join('\n')
    const result = stripMarkdown(text)
    assert.ok(result.includes('the doc'))
    assert.ok(!result.includes('https://example.com'))
  })

  test('strips $$ math blocks', () => {
    const text = ['Intro.', '', '$$', 'a^2 + b^2 = c^2', '$$', '', 'Outro.'].join('\n')
    const result = stripMarkdown(text)
    assert.ok(!result.includes('a^2'))
    assert.ok(result.includes('Intro'))
    assert.ok(result.includes('Outro'))
  })

  test('strips leading heading markers but keeps heading text', () => {
    const result = stripMarkdown('### Section Title\n\nBody paragraph.')
    assert.ok(!result.includes('###'))
    assert.ok(result.includes('Section Title'))
    assert.ok(result.includes('Body paragraph'))
  })

  test('strips blockquote markers but keeps quote text', () => {
    const result = stripMarkdown('> Quoted remark\n> continued')
    assert.ok(!/^>/m.test(result))
    assert.ok(result.includes('Quoted remark'))
    assert.ok(result.includes('continued'))
  })

  test('strips unordered list markers', () => {
    const result = stripMarkdown('- apple\n- banana\n* cherry')
    assert.ok(result.includes('apple'))
    assert.ok(result.includes('banana'))
    assert.ok(result.includes('cherry'))
    assert.ok(!result.match(/^[ \t]*[-*+]/m))
  })

  test('strips ordered list markers', () => {
    const result = stripMarkdown('1. first\n2. second\n3. third')
    assert.ok(result.includes('first'))
    assert.ok(result.includes('second'))
    assert.ok(result.includes('third'))
    assert.ok(!result.match(/^[ \t]*\d+\./m))
  })

  test('strips task list checkboxes', () => {
    const result = stripMarkdown('- [ ] todo\n- [x] done\n- [X] also done')
    assert.ok(result.includes('todo'))
    assert.ok(result.includes('done'))
    assert.ok(result.includes('also done'))
    assert.ok(!result.match(/\[[ xX]\]/))
  })

  test('strips table separator rows', () => {
    const text = [
      '| Name | Age |',
      '| --- | --- |',
      '| Alice | 30 |',
    ].join('\n')
    const result = stripMarkdown(text)
    assert.ok(!result.match(/^[ \t]*\|?\s*:?-+:?\s*\|/m))
    assert.ok(result.includes('Name'))
    assert.ok(result.includes('Age'))
    assert.ok(result.includes('Alice'))
    assert.ok(result.includes('30'))
  })

  test('replaces table column pipes with spaces', () => {
    const text = '| alpha | beta | gamma |'
    const result = stripMarkdown(text)
    assert.ok(!result.includes('|'))
    assert.ok(result.includes('alpha'))
    assert.ok(result.includes('beta'))
    assert.ok(result.includes('gamma'))
  })

  test('strips inline backticks but keeps the code content as text', () => {
    const result = stripMarkdown('Use `npm install` to install')
    assert.ok(!result.includes('`'))
    assert.ok(result.includes('npm install'))
  })

  test('strips bold and italic markup', () => {
    const result = stripMarkdown('**bold** and __also bold__ and *em* and _also em_')
    assert.ok(result.includes('bold'))
    assert.ok(result.includes('also bold'))
    assert.ok(result.includes('em'))
    assert.ok(result.includes('also em'))
    assert.ok(!result.match(/\*\w/))
  })

  test('strips strikethrough and highlight markup', () => {
    const result = stripMarkdown('~~gone~~ and ==highlighted== text')
    assert.ok(result.includes('gone'))
    assert.ok(result.includes('highlighted'))
    assert.ok(!result.includes('~~'))
    assert.ok(!result.includes('=='))
  })

  test('strips thematic breaks (---, ***, ___)', () => {
    const result = stripMarkdown('Before\n\n---\n\nAfter')
    assert.ok(result.includes('Before'))
    assert.ok(result.includes('After'))
    assert.ok(!result.match(/^[ \t]*-{3,}\s*$/m))
  })

  test('normalizes runs of more than two blank lines down to two', () => {
    const text = 'Line one\n\n\n\n\nLine two'
    const result = stripMarkdown(text)
    assert.ok(!result.includes('\n\n\n'))
    assert.ok(result.includes('Line one'))
    assert.ok(result.includes('Line two'))
  })
})

describe('countWords', () => {
  test('returns 0 for empty input', () => {
    assert.equal(countWords(''), 0)
  })

  test('returns 0 for whitespace-only input', () => {
    assert.equal(countWords('   \n\n\t  '), 0)
  })

  test('returns 0 for non-string input', () => {
    assert.equal(countWords(undefined as unknown as string), 0)
    assert.equal(countWords(null as unknown as string), 0)
  })

  test('counts simple English words', () => {
    assert.equal(countWords('Hello world'), 2)
    assert.equal(countWords('The quick brown fox jumps'), 5)
  })

  test('treats contractions as a single word', () => {
    assert.equal(countWords("don't worry it's fine"), 4)
    assert.equal(countWords("don't"), 1)
    assert.equal(countWords("it's a test"), 3)
  })

  test('treats hyphenated phrases as a single word', () => {
    assert.equal(countWords('state-of-the-art technology'), 2)
  })

  test('counts each CJK Han character as one word', () => {
    assert.equal(countWords('你好世界'), 4)
    assert.equal(countWords('中文'), 2)
  })

  test('counts Hiragana characters as individual words', () => {
    assert.equal(countWords('こんにちは'), 5)
  })

  test('counts Katakana characters as individual words', () => {
    assert.equal(countWords('カタカナ'), 4)
  })

  test('mixes CJK and Latin word counts additively', () => {
    assert.equal(countWords('Hello 世界'), 3)
    assert.equal(countWords('Hi 你好'), 3)
  })

  test('excludes fenced code-block words by default', () => {
    const text = ['Visible word.', '```', 'hidden secret word', '```', 'Tail.'].join('\n')
    const result = countWords(text)
    assert.ok(result >= 3)
    assert.equal(countWords('Visible word. Tail.'), result)
  })

  test('includes code-block words when excludeCodeBlocks is false', () => {
    const text = ['A.', '```', 'inside words', '```', 'B.'].join('\n')
    const withCode = countWords(text, { excludeCodeBlocks: false })
    const withoutCode = countWords(text)
    assert.ok(withCode > withoutCode)
    assert.ok(withCode >= 4)
  })

  test('excludes YAML frontmatter words by default', () => {
    const text = [
      '---',
      'title: Example Document',
      'author: Jane Doe',
      '---',
      '',
      'Body paragraph with words.',
    ].join('\n')
    const result = countWords(text)
    assert.ok(result >= 4)
    assert.equal(countWords('Body paragraph with words.'), result)
  })

  test('includes frontmatter words when excludeFrontmatter is false', () => {
    const text = [
      '---',
      'title: Example',
      '---',
      'Body',
    ].join('\n')
    const withFront = countWords(text, { excludeFrontmatter: false })
    const withoutFront = countWords(text)
    assert.ok(withFront > withoutFront)
  })

  test('strips markdown markup before counting so headings and lists contribute only their prose', () => {
    const text = [
      '# Heading One',
      '',
      '- bullet item',
      '- second bullet',
      '',
      'Paragraph word.',
    ].join('\n')
    const result = countWords(text)
    assert.equal(result, countWords('Heading One bullet item second bullet Paragraph word.'))
  })

  test('returns 0 for documents whose content is entirely markup', () => {
    assert.equal(countWords('**__~~===='), 0)
    assert.equal(countWords('---'), 0)
  })

  test('handles a realistic mix of markdown syntax', () => {
    const text = [
      '---',
      'title: Sample',
      '---',
      '',
      '# Introduction',
      '',
      'This is **bold** and *italic* text with a [link](https://x.test).',
      '',
      '- [ ] task one',
      '- [x] task two',
      '',
      '```js',
      'const x = 1;',
      '```',
      '',
      'Final sentence.',
    ].join('\n')
    const result = countWords(text)
    const prose = 'Introduction This is bold and italic text with a link. task one task two Final sentence.'
    assert.equal(result, countWords(prose))
  })
})

describe('estimateReadingTime', () => {
  test('returns zero metrics for empty input', () => {
    const result: ReadingTimeResult = estimateReadingTime('')
    assert.deepEqual(result, { words: 0, minutes: 0, characters: 0 })
  })

  test('returns zero metrics for whitespace-only input', () => {
    assert.deepEqual(estimateReadingTime('   \n\t  '), {
      words: 0,
      minutes: 0,
      characters: 0,
    })
  })

  test('returns zero words and minutes when content produces no readable words', () => {
    const result = estimateReadingTime('**__~~====\n---\n')
    assert.equal(result.words, 0)
    assert.equal(result.minutes, 0)
    assert.equal(result.characters, stripMarkdown('**__~~====\n---\n').length)
  })

  test('defaults reading speed to 200 words per minute', () => {
    const words = 250
    const text = Array.from({ length: words }, (_, i) => `word${i}`).join(' ')
    const result = estimateReadingTime(text)
    assert.equal(result.words, words)
    assert.equal(result.minutes, Math.ceil(words / 200))
  })

  test('accepts a numeric wpm as the second argument', () => {
    const text = Array.from({ length: 100 }, (_, i) => `w${i}`).join(' ')
    const result = estimateReadingTime(text, 50)
    assert.equal(result.minutes, 2)
  })

  test('accepts a MarkdownStatsOptions object as the second argument', () => {
    const text = Array.from({ length: 100 }, (_, i) => `w${i}`).join(' ')
    const result = estimateReadingTime(text, { wpm: 25 })
    assert.equal(result.minutes, 4)
  })

  test('rounds minutes up to the next integer', () => {
    const text = Array.from({ length: 201 }, (_, i) => `w${i}`).join(' ')
    const result = estimateReadingTime(text, 200)
    assert.equal(result.minutes, Math.ceil(201 / 200))
  })

  test('falls back to 200 wpm when wpm is zero', () => {
    const text = Array.from({ length: 400 }, (_, i) => `w${i}`).join(' ')
    const result = estimateReadingTime(text, { wpm: 0 })
    assert.equal(result.minutes, Math.ceil(400 / 200))
  })

  test('falls back to 200 wpm when wpm is negative', () => {
    const text = Array.from({ length: 400 }, (_, i) => `w${i}`).join(' ')
    const result = estimateReadingTime(text, { wpm: -10 })
    assert.equal(result.minutes, Math.ceil(400 / 200))
  })

  test('reports the cleaned character count after stripping markup', () => {
    const text = '# Hello **world**'
    const result = estimateReadingTime(text)
    assert.equal(result.characters, stripMarkdown(text).length)
    assert.ok(result.characters < text.length)
  })

  test('character count matches stripMarkdown output exactly', () => {
    const samples = [
      '',
      'plain text only',
      '# Heading\n\nSome **bold** words.',
      '- [ ] task one\n- [x] task two',
      '| a | b |\n| --- | --- |\n| 1 | 2 |',
      '```js\nconst x = 1;\n```\n\nafter code.',
    ]
    for (const text of samples) {
      const result = estimateReadingTime(text)
      assert.equal(result.characters, stripMarkdown(text).length)
    }
  })

  test('omits code-block content from word and character counts by default', () => {
    const withCode = estimateReadingTime(
      'Visible.\n```\nconst hidden = "code contents";\n```\nTail.',
    )
    assert.ok(!withCode.characters.toString().includes('hidden'))
    assert.equal(
      withCode.characters,
      estimateReadingTime('Visible. Tail.').characters,
    )
    assert.equal(
      withCode.words,
      estimateReadingTime('Visible. Tail.').words,
    )
  })

  test('includes code-block content when excludeCodeBlocks is false', () => {
    const text = 'Visible.\n```\nconst hidden = "code contents";\n```\nTail.'
    const withCode = estimateReadingTime(text, { excludeCodeBlocks: false })
    const withoutCode = estimateReadingTime(text)
    assert.ok(withCode.characters > withoutCode.characters)
    assert.ok(withCode.words > withoutCode.words)
  })

  test('omits frontmatter words by default', () => {
    const text = [
      '---',
      'title: A very long frontmatter title with several words',
      '---',
      'Body text with words.',
    ].join('\n')
    const withoutFrontmatter = estimateReadingTime(text, { excludeFrontmatter: true })
    const withFrontmatter = estimateReadingTime(text, { excludeFrontmatter: false })
    assert.ok(withFrontmatter.words > withoutFrontmatter.words)
    assert.ok(withFrontmatter.characters > withoutFrontmatter.characters)
  })

  test('counts CJK characters as words for reading time', () => {
    const cjk = '你好世界你好世界你好世界'
    const result = estimateReadingTime(cjk)
    assert.equal(result.words, cjk.length)
    assert.ok(result.minutes >= 1)
  })

  test('treats a markdown doc with exactly wpm words as a single minute', () => {
    const text = Array.from({ length: 200 }, (_, i) => `w${i}`).join(' ')
    const result = estimateReadingTime(text, 200)
    assert.equal(result.words, 200)
    assert.equal(result.minutes, 1)
  })

  test('preserves options object references without mutating the caller-provided object', () => {
    const options: MarkdownStatsOptions = { wpm: 150 }
    const before = JSON.stringify(options)
    estimateReadingTime('Some words here.', options)
    assert.equal(JSON.stringify(options), before)
  })

  test('handles a missing options argument by falling back to defaults', () => {
    const result = estimateReadingTime('Just a few words.', undefined as unknown as number)
    assert.equal(result.minutes, 1)
  })

  test('returns 0 minutes for zero words even when wpm is large', () => {
    const result = estimateReadingTime('', 1000)
    assert.equal(result.minutes, 0)
    assert.equal(result.words, 0)
    assert.equal(result.characters, 0)
  })
})
