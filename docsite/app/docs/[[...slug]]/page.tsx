import { source } from '@/lib/source';
import { socialMeta } from '@/lib/meta';
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  EditOnGitHub,
  MarkdownCopyButton,
  PageLastUpdate,
  ViewOptionsPopover,
} from 'fumadocs-ui/layouts/docs/page';
import { notFound } from 'next/navigation';
import { getMDXComponents } from '@/components/mdx';
import { PageMeta } from '@/components/holdline/page-meta';
import { TourBar, TourPager } from '@/components/guide/tour-nav';
import { PageFooter } from '@/components/guide/page-footer';
import type { Metadata } from 'next';
import { createRelativeLink } from 'fumadocs-ui/mdx';
import { getPageEditUrl, getPageImageUrl, getPageMarkdownUrl } from '@/lib/shared';

export default async function Page(props: PageProps<'/docs/[[...slug]]'>) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;
  const markdownUrl = getPageMarkdownUrl(page).url;
  const editUrl = getPageEditUrl(page.path);
  const lastModified = page.data.lastModified;

  return (
    <DocsPage
      toc={page.data.toc}
      full={page.data.full}
      breadcrumb={{ includeRoot: true }}
      tableOfContent={{ style: 'clerk' }}
      tableOfContentPopover={{ style: 'clerk' }}
    >
      <TourBar url={page.url} />
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription className="mb-0">{page.data.description}</DocsDescription>
      <PageMeta
        slugs={page.slugs}
        status={page.data.status}
        evidence={page.data.evidence}
        changed={lastModified ? new Date(lastModified) : null}
      />
      <div className="flex flex-row flex-wrap gap-2 items-center border-b pb-6 pt-4">
        <MarkdownCopyButton markdownUrl={markdownUrl} />
        <ViewOptionsPopover markdownUrl={markdownUrl} githubUrl={editUrl} />
      </div>
      <DocsBody>
        <MDX
          components={getMDXComponents({
            // this allows you to link to other pages with relative file paths
            a: createRelativeLink(source, page),
          })}
        />
        <TourPager url={page.url} />
        <PageFooter url={page.url} />
      </DocsBody>
      <div className="flex flex-row flex-wrap items-center justify-between gap-4 border-t pt-6">
        <EditOnGitHub href={editUrl} />
        {lastModified && <PageLastUpdate date={new Date(lastModified)} />}
      </div>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: PageProps<'/docs/[[...slug]]'>): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const image = getPageImageUrl(page).url;
  return {
    title: page.data.title,
    description: page.data.description,
    ...socialMeta({
      title: page.data.title,
      description: page.data.description ??
        'Every bid is a PayPal hold; only the winner pays. GAVEL documentation, PayPal sandbox only.',
      path: page.url,
      image,
      alt: `${page.data.title}: GAVEL documentation. Every bid is a hold, the hammer is the payment. PayPal sandbox only.`,
      type: 'article',
    }),
  };
}
