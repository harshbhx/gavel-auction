// The six sidebar tabs. Each docs URL belongs to exactly one section; the section is also the
// search tag, so the search box can filter by it. Keep in sync with the (group) folders in
// content/docs and their meta.json files.
export const sections = [
  { id: 'learn', title: 'Learn', roots: ['start', 'how-it-works', 'roadmap'] },
  { id: 'prove', title: 'Prove', roots: ['proof'] },
  { id: 'judges', title: 'For judges', roots: ['judges'] },
  { id: 'builders', title: 'Builders', roots: ['builders'] },
  { id: 'operators', title: 'Operators', roots: ['run', 'safety'] },
  { id: 'reference', title: 'Reference', roots: ['reference'] },
] as const;

export type SectionId = (typeof sections)[number]['id'];

export function sectionOf(slugs: string[]): SectionId {
  const first = slugs[0] ?? '';
  return sections.find((s) => (s.roots as readonly string[]).includes(first))?.id ?? 'learn';
}
