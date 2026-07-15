import { describe, expect, it } from 'vitest';

import { parseDesignMarkdown, parseLabeledValues, parseList } from './parser.js';

const designMarkdown = `# Test Design

## Color
- **Primary:** \`#112233\`

## Typography
- **Chinese Font:** PingFang SC

## Spacing
- **Unit:** 8

## Layout
- **Grid Columns:** 12

## Components
- **Title Card:** compact

## Motion
- **Fast Frames:** 6

## Voice
- **Chinese Tone:** concise

## Brand
- **Name Zh:** 测试

## Anti-patterns
- remote assets
- unsafe subtitles
`;

describe('Open Design Markdown parser', () => {
  it('normalizes all nine OneCrew sections', () => {
    const parsed = parseDesignMarkdown(designMarkdown);

    expect(parsed.title).toBe('Test Design');
    expect(Object.keys(parsed.sections).sort()).toEqual(
      [
        'antiPatterns',
        'brand',
        'color',
        'components',
        'layout',
        'motion',
        'spacing',
        'typography',
        'voice',
      ].sort(),
    );
    expect(parseLabeledValues(parsed.sections.color)).toEqual({ primary: '#112233' });
    expect(parseList(parsed.sections.antiPatterns)).toEqual(['remote assets', 'unsafe subtitles']);
  });

  it('rejects documents without a level-one title', () => {
    expect(() => parseDesignMarkdown('## Color\n')).toThrow('level-one title');
  });
});
