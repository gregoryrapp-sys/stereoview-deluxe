import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type SortDirection = 'asc' | 'desc';

interface SortOption<T> {
  value: keyof T | 'created_at' | 'title';
  label: string;
}

interface ThumbnailGridProps<T extends { id: string; title: string; created_at: string }> {
  items: T[];
  renderItem: (item: T) => React.ReactNode;
  sortOptions: SortOption<T>[];
  initialSortKey?: keyof T | 'created_at' | 'title';
  initialSortDirection?: SortDirection;
  emptyMessage: string;
}

export default function ThumbnailGrid<T extends { id: string; title: string; created_at: string }>({
  items,
  renderItem,
  sortOptions,
  initialSortKey = 'created_at',
  initialSortDirection = 'desc',
  emptyMessage,
}: ThumbnailGridProps<T>) {
  const [sortKey, setSortKey] = useState(initialSortKey);
  const [sortDirection, setSortDirection] = useState<SortDirection>(initialSortDirection);

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

  const toggleSortDirection = () => {
    setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
  };

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
        <Select value={sortKey as string} onValueChange={(value) => setSortKey(value as keyof T)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Sort by..." />
          </SelectTrigger>
          <SelectContent>
            {sortOptions.map((option) => (
              <SelectItem key={option.value as string} value={option.value as string}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="icon" onClick={toggleSortDirection}>
          {sortDirection === 'asc' ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {sortedItems.map((item) => renderItem(item))}
      </div>
    </div>
  );
}