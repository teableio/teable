import { useIsAnonymous } from '@teable/sdk/hooks';
import { useRouter } from 'next/router';
import type { PropsWithChildren } from 'react';
import { createContext, useCallback, useContext, useMemo, useRef } from 'react';
import { useShareAllowEdit, useShareAllowSave, useShareContext } from '../../context/ShareContext';
import { useIsInIframe } from '../../hooks/useIsInIframe';
import type { IShareSelectSpaceDialogRef } from '../ShareSelectSpaceDialog';
import { ShareSelectSpaceDialog } from '../ShareSelectSpaceDialog';
import { MobileShareOperationBar } from './MobileShareOperationBar';

interface IShareBaseOperations {
  loginToEdit: () => void;
  saveCopy: () => void;
}

const ShareBaseOperationContext = createContext<IShareBaseOperations | null>(null);

export const useShareBaseOperations = () => {
  const operations = useContext(ShareBaseOperationContext);
  if (!operations) {
    throw new Error('ShareBaseOperationProvider is required in base share pages');
  }
  return operations;
};

export const ShareBaseOperationProvider = ({ children }: PropsWithChildren) => {
  const router = useRouter();
  const isAnonymous = useIsAnonymous();
  const isInIframe = useIsInIframe();
  const { shareId } = useShareContext();
  const allowEdit = useShareAllowEdit();
  const allowSave = useShareAllowSave();
  const dialogRef = useRef<IShareSelectSpaceDialogRef>(null);

  const loginToEdit = useCallback(() => {
    router.push(`/auth/login?redirect=${encodeURIComponent(window.location.href)}`);
  }, [router]);

  const saveCopy = useCallback(() => {
    if (isAnonymous) {
      const url = new URL(window.location.href);
      url.searchParams.set('isCopyToSpace', '1');
      router.push(`/auth/login?redirect=${encodeURIComponent(url.toString())}`);
      return;
    }
    dialogRef.current?.setOpen(true);
  }, [isAnonymous, router]);

  const value = useMemo(() => ({ loginToEdit, saveCopy }), [loginToEdit, saveCopy]);
  const mobileOperation = allowEdit && isAnonymous ? 'edit' : allowSave ? 'save' : null;

  return (
    <ShareBaseOperationContext.Provider value={value}>
      {children}
      {mobileOperation && (
        <MobileShareOperationBar
          key={`${shareId}-${mobileOperation}`}
          operation={mobileOperation}
          onAction={mobileOperation === 'edit' ? loginToEdit : saveCopy}
        />
      )}
      {allowSave && !isAnonymous && !isInIframe && <ShareSelectSpaceDialog ref={dialogRef} />}
    </ShareBaseOperationContext.Provider>
  );
};
