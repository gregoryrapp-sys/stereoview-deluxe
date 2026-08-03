import { useMemo, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type SortDirection = 'asc' | 'desc';

interface SortOption {
  value: string; // e.g. 'title_asc'
  label: string;
}

interface ThumbnailGridProps<T extends { id: string; title: string; created_at: string }> {
  items: T[];
  renderItem: (item: T) => React.ReactNode;
  sortOptions: SortOption[];
  emptyMessage: string;
}

export default function ThumbnailGrid<T extends { id: string; title: string; created_at: string }>({
  items,
  renderItem,
  sortOptions,
  emptyMessage,
}: ThumbnailGridProps<T>) {
  const [sortValue, setSortValue] = useState(
    () => sortOptions.find((option) => option.value === 'title_asc')?.value ?? sortOptions[0]?.value ?? 'title_asc',
  );

  const { sortKey, sortDirection } = useMemo(() => {
    if (!sortValue) return { sortKey: 'created_at', sortDirection: 'desc' as SortDirection };
    const separatorIndex = sortValue.lastIndexOf('_');
    const key = sortValue.slice(0, separatorIndex);
    const direction = sortValue.slice(separatorIndex + 1);
    return {
      sortKey: key as keyof T | 'created_at' | 'title',
      sortDirection: direction as SortDirection,
    };
  }, [sortValue]);

  const sortedItems = useMemo(() => {
    if (!items) return [];
    return [...items].sort((a, b) => {
      const valA = a[sortKey as keyof T];
      const valB = b[sortKey as keyof T];

      let comparison = 0;
      if (typeof valA === 'string' && typeof valB === 'string') {
        comparison = valA.localeCompare(valB, undefined, { numeric: true });
      } else {
        comparison = String(valA).localeCompare(String(valB), undefined, { numeric: true });
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [items, sortKey, sortDirection]);

  if (items.length === 0) {
    return (
      <div className="rounded-md border border-border p-6 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-start gap-2">
        <span className="text-xs font-medium text-muted-foreground">Sort by</span>
        <Select value={sortValue} onValueChange={setSortValue}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Sort by..." />
          </SelectTrigger>
          <SelectContent>
            {sortOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {sortedItems.map((item) => renderItem(item))}
      </div>
    </div>
  );
}