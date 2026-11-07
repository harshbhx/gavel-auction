import defaultMdxComponents from 'fumadocs-ui/mdx';
import { Accordion, Accordions as BaseAccordions } from 'fumadocs-ui/components/accordion';
import { File, Files, Folder } from 'fumadocs-ui/components/files';
import { ImageZoom } from 'fumadocs-ui/components/image-zoom';
import { InlineTOC } from 'fumadocs-ui/components/inline-toc';
import { Step, Steps } from 'fumadocs-ui/components/steps';
import { Tab, Tabs } from 'fumadocs-ui/components/tabs';
import { TypeTable } from 'fumadocs-ui/components/type-table';
import { Mermaid } from '@/components/mermaid';
import { Charged, Held, NotVerified, Released } from '@/components/holdline/callout';
import { Chip, GateBadge } from '@/components/holdline/chip';
import { CodePaths } from '@/components/holdline/code-paths';
import { GatesTable, LatencyTable, SimScenarioTable, SpeechTable } from '@/components/holdline/data-tables';
import { SagaDiagram } from '@/components/diagrams/saga';
import { MoneyFlowDiagram } from '@/components/diagrams/money-flow';
import { VoiceDiagram } from '@/components/diagrams/voice';
import { TimelineDiagram } from '@/components/diagrams/timeline';
import { CrashDiagram } from '@/components/diagrams/crash';
import type { MDXComponents } from 'mdx/types';
import type { ComponentProps } from 'react';

// fumadocs-ui here is the Base UI build: several open items need `multiple`.
// Also accept the Radix-style `type="multiple"` so either spelling works.
function Accordions({
  type,
  ...props
}: ComponentProps<typeof BaseAccordions> & { type?: 'single' | 'multiple' }) {
  return <BaseAccordions multiple={type === 'multiple' || props.multiple} {...props} />;
}

// Everything here is usable in any .mdx page without an import.
export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    img: (props) => <ImageZoom {...(props as React.ComponentProps<typeof ImageZoom>)} />,
    Accordion,
    Accordions,
    File,
    Files,
    Folder,
    InlineTOC,
    Step,
    Steps,
    Tab,
    Tabs,
    TypeTable,
    Mermaid,
    // Holdline vocabulary
    Held,
    Charged,
    Released,
    NotVerified,
    Chip,
    GateBadge,
    CodePaths,
    // data read from the repo evidence at build time
    GatesTable,
    SpeechTable,
    LatencyTable,
    SimScenarioTable,
    // the five diagrams
    SagaDiagram,
    MoneyFlowDiagram,
    VoiceDiagram,
    TimelineDiagram,
    CrashDiagram,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
