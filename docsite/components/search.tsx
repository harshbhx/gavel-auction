'use client';
import { useEffect, useState } from 'react';
import {
  SearchDialog,
  SearchDialogClose,
  SearchDialogContent,
  SearchDialogFooter,
  SearchDialogHeader,
  SearchDialogIcon,
  SearchDialogInput,
  SearchDialogList,
  SearchDialogOverlay,
  TagsList,
  TagsListItem,
  type SharedProps,
} from 'fumadocs-ui/components/dialog/search';
import { useStaticSearch } from 'fumadocs-core/search/client';
import { useI18n } from 'fumadocs-ui/contexts/i18n';
import { sections } from '@/lib/sections';

const ALL = '__all__';

export default function DefaultSearchDialog(props: SharedProps) {
  const { locale } = useI18n();
  const [tag, setTag] = useState<string | undefined>();
  const search = useStaticSearch({ locale, tag });

  // Search covers every section by default: each time the dialog opens, drop any section filter.
  useEffect(() => {
    if (props.open) setTag(undefined);
  }, [props.open]);

  return (
    <SearchDialog {...search} {...props}>
      <SearchDialogOverlay />
      <SearchDialogContent>
        <SearchDialogHeader>
          <SearchDialogIcon />
          <SearchDialogInput />
          <SearchDialogClose />
        </SearchDialogHeader>
        <SearchDialogList />
        <SearchDialogFooter>
          <span className="mr-2 font-mono text-[0.68rem] uppercase tracking-wide text-fd-muted-foreground">
            Filter by section:
          </span>
          <TagsList tag={tag ?? ALL} onTagChange={(v) => setTag(v === ALL ? undefined : v)}>
            <TagsListItem value={ALL}>All sections</TagsListItem>
            {sections.map((s) => (
              <TagsListItem key={s.id} value={s.id}>
                {s.title}
              </TagsListItem>
            ))}
          </TagsList>
        </SearchDialogFooter>
      </SearchDialogContent>
    </SearchDialog>
  );
}
