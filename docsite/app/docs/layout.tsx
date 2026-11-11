import { source } from '@/lib/source';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { baseOptions } from '@/lib/layout.shared';
import { GitHubButton } from '@/components/holdline/github-button';

export default function Layout({ children }: LayoutProps<'/docs'>) {
  return (
    <DocsLayout
      tree={source.getPageTree()}
      {...baseOptions({ githubIcon: false })}
      tabMode="top"
      sidebar={{
        footer: (
          <>
            <GitHubButton />
            <p className="mt-2 font-mono text-[0.65rem] text-fd-muted-foreground">
              MIT License. PayPal sandbox only. Source of truth: the repository docs and committed
              evidence.
            </p>
          </>
        ),
      }}
    >
      {children}
    </DocsLayout>
  );
}
