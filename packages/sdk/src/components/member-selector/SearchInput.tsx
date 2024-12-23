import { Search } from '@teable/icons';
import type { InputProps } from '@teable/ui-lib';
import { Input } from '@teable/ui-lib';
import { useEffect, useState } from 'react';

interface SearchInputProps extends InputProps {
  search: string;
  onSearch: (value: string) => void;
}
export const SearchInput = ({ search, onSearch, ...props }: SearchInputProps) => {
  const [searchInner, setSearchInner] = useState('');
  const [isComposing, setIsComposing] = useState(false);

  useEffect(() => {
    if (!isComposing) {
      onSearch(searchInner);
    }
  }, [searchInner, isComposing, onSearch]);

  return (
    <div className="relative">
      <Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" />
      <Input
        {...props}
        className="h-8 pl-8 text-[13px]"
        value={searchInner}
        onChange={(e) => setSearchInner(e.target.value)}
        onCompositionStart={() => setIsComposing(true)}
        onCompositionEnd={() => setIsComposing(false)}
      />
    </div>
  );
};
