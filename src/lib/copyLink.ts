import { toast } from '@/hooks/use-toast';

/** Copies a link and says so; on refusal the toast shows the address to copy by hand. */
export async function copyLink(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    toast({ title: 'Link copied' });
  } catch {
    toast({ title: 'Could not copy', description: url, variant: 'destructive' });
  }
}
