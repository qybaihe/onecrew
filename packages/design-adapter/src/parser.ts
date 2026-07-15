export type DesignSection =
  | 'color'
  | 'typography'
  | 'spacing'
  | 'layout'
  | 'components'
  | 'motion'
  | 'voice'
  | 'brand'
  | 'antiPatterns';

const aliases: Array<[DesignSection, RegExp]> = [
  ['color', /color|palette|颜色|色彩/i],
  ['typography', /typography|type rules|字体|排版/i],
  ['spacing', /spacing|间距|safe area|安全区/i],
  ['layout', /layout|responsive|grid|布局|响应式/i],
  ['components', /component|组件/i],
  ['motion', /motion|animation|动效|动画/i],
  ['voice', /voice|tone|文案|语气/i],
  ['brand', /brand|logo|品牌/i],
  ['antiPatterns', /anti.?pattern|do.?s and don.?ts|禁用|禁止/i],
];

export interface ParsedDesignMarkdown {
  title: string;
  sections: Partial<Record<DesignSection, string>>;
}

export function parseDesignMarkdown(markdown: string): ParsedDesignMarkdown {
  if (Buffer.byteLength(markdown, 'utf8') > 1_048_576) {
    throw new Error('DESIGN.md exceeds the 1 MiB safety limit');
  }
  const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (!title) throw new Error('DESIGN.md must contain a level-one title');

  const headings = [...markdown.matchAll(/^##\s+(?:\d+[.)]\s*)?(.+)$/gm)];
  const sections: Partial<Record<DesignSection, string>> = {};
  for (const [index, heading] of headings.entries()) {
    const name = heading[1]?.trim() ?? '';
    const start = (heading.index ?? 0) + heading[0].length;
    const end = headings[index + 1]?.index ?? markdown.length;
    const canonical = aliases.find(([, pattern]) => pattern.test(name))?.[0];
    if (canonical && !sections[canonical]) sections[canonical] = markdown.slice(start, end).trim();
  }
  return { title, sections };
}

export function parseLabeledValues(section: string | undefined): Record<string, string> {
  if (!section) return {};
  return Object.fromEntries(
    [...section.matchAll(/^\s*-\s+\*\*([^*]+?):\*\*\s*(.+)$/gm)].map((match) => [
      (match[1] ?? '').trim().toLowerCase(),
      (match[2] ?? '').trim().replace(/^`|`$/g, ''),
    ]),
  );
}

export function parseList(section: string | undefined): string[] {
  if (!section) return [];
  return [...section.matchAll(/^\s*-\s+(?:❌\s*)?(.+)$/gm)]
    .map((match) => (match[1] ?? '').trim())
    .filter((item) => !item.startsWith('**'));
}
