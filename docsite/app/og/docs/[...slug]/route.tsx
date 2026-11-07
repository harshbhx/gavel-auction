import { source } from '@/lib/source';
import { notFound } from 'next/navigation';
import { ogImage } from '@/lib/og';
import { getPageImageUrl } from '@/lib/shared';
import { sections, sectionOf } from '@/lib/sections';

export const revalidate = false;

export async function GET(_req: Request, { params }: RouteContext<'/og/docs/[...slug]'>) {
  const { slug } = await params;
  const page = source.getPage(slug.slice(0, -1));
  if (!page) notFound();

  const status = (page.data as { status?: string }).status;
  const section = sections.find((x) => x.id === sectionOf(page.slugs))?.title ?? 'Docs';
  return ogImage({
    title: page.data.title,
    description: page.data.description,
    kicker: status ? `${section} | ${status}` : section,
  });
}

export function generateStaticParams() {
  return source.getPages().map((page) => ({
    lang: page.locale,
    slug: getPageImageUrl(page).segments,
  }));
}
