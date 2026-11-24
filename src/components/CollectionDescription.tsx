import { cn } from '@/lib/utils';

/**
 * An event's or album's Description, as the photographer typed it in
 * management: shown under the title on the pages visitors browse, line breaks
 * kept, and nothing at all when the field is empty.
 */
export default function CollectionDescription({ text, className }: { text: string | null | undefined; className?: string }) {
  const trimmed = text?.trim();
  if (!trimmed) return null;
  return (
    <p className={cn('max-w-prose whitespace-pre-line text-sm leading-relaxed text-foreground/80', className)}>
      {trimmed}
    </p>
  );
}
