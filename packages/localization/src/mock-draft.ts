import {
  localizedTextPackSchema,
  type LocalePack,
  type LocalizedTextPack,
} from '@onecrew/contracts';

const lineDictionary: Readonly<Record<string, string>> = {
  '星图没有消失，它在等我们。': 'The star map is not gone. It is waiting for us.',
  '那就把最后一角找回来。': "Then let's bring back its final piece.",
};

function translateDemoLine(text: string, index: number): string {
  const direct = lineDictionary[text];
  if (direct) return direct;
  const gate = text.match(/^越过第\s*(\d+)\s*道星门。$/);
  if (gate) return `Beyond stargate ${gate[1]}.`;
  return `Mock-localized story line ${index + 1}.`;
}

export function createMockEnglishDraft(source: LocalePack): LocalizedTextPack {
  return localizedTextPackSchema.parse({
    title: source.title === '山海星辰' ? 'Stars Beyond the Mountains and Seas' : 'OneCrew English Edition',
    cta: source.cta === '立即启程' ? 'Begin the journey' : 'Watch now',
    marketingCopy: source.marketingCopy.map((copy, index) =>
      copy === '最后一角星图，藏在山海尽头。'
        ? 'The final star-map shard lies beyond the known world.'
        : `A cinematic mystery begins — variant ${index + 1}.`,
    ),
    lines: source.lines.map((line, index) => ({
      sourceLineId: line.lineId,
      speaker: line.speaker === '林遥' ? 'Lin Yao' : line.speaker === '岳岚' ? 'Yue Lan' : line.speaker,
      text: translateDemoLine(line.text, index),
      translationNotes: 'Preserves story function and emotion while shortening for spoken English.',
    })),
  });
}
