import { Spin } from '@teable/ui-lib/base';
import { Input } from '@teable/ui-lib/shadcn';
import { debounce } from 'lodash';
import { useEffect, useMemo, useState } from 'react';

interface ICollaboratorListProps {
  children?: React.ReactNode | React.ReactNode[];
  inputRight?: React.ReactNode;
  searchPlaceholder?: string;
  isSearching?: boolean;
  onSearch: (search: string) => void;
}

export const CollaboratorList = (props: ICollaboratorListProps) => {
  const { searchPlaceholder, onSearch, children, inputRight, isSearching } = props;
  const [search, setSearch] = useState<string>('');
  const [isComposing, setIsComposing] = useState(false);

  const setApplySearchDebounced = useMemo(() => {
    return debounce(onSearch, 200);
  }, [onSearch]);

  useEffect(() => {
    if (!isComposing) {
      setApplySearchDebounced(search);
    }
  }, [search, isComposing, onSearch, setApplySearchDebounced]);

  return (
    <div className="flex grow flex-col overflow-hidden">
      <div className="mb-6 flex items-center gap-x-4">
        <Input
          className="h-8"
          type="search"
          placeholder={searchPlaceholder}
          value={search}
          onChange={(e) => {
            const value = e.target.value;
            setSearch(value);
          }}
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={() => setIsComposing(false)}
        />
        {inputRight}
      </div>
      <div className="mb-0.5 flex grow flex-col space-y-5 overflow-y-auto">
        {isSearching ? (
          <div className="flex justify-center">
            <Spin />
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
};
