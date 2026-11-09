import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { baseOptions } from '@/lib/layout.shared';
import { Footer } from '@/components/home/footer';
import { MotionProvider } from '@/components/home/motion-provider';

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <HomeLayout {...baseOptions({ inList: true })}>
      <MotionProvider>{children}</MotionProvider>
      <Footer />
    </HomeLayout>
  );
}
