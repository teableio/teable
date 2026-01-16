import { useCallback, useEffect, useRef, useState } from 'react';

export const CROSS_WINDOW_DRAG_TYPE = 'application/x-teable-node';
const TEXT_PLAIN_TYPE = 'text/plain';

// Use a unique ID per window to track internal drags
const WINDOW_ID = `window-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export interface ICrossWindowDragData {
  type: 'table' | 'dashboard' | 'workflow' | 'app' | 'folder';
  baseId: string;
  resourceId: string;
  name: string;
  windowId?: string;
}

interface UseCrossWindowDragOptions {
  currentBaseId: string;
  onExternalDrop?: (data: ICrossWindowDragData) => void;
  enabled?: boolean;
}

interface UseCrossWindowDragReturn {
  isDraggingOver: boolean;
  containerCallbackRef: (node: HTMLElement | null) => void;
}

/**
 * Hook to handle cross-window drag and drop using native HTML5 drag events
 * Uses callback ref to ensure listeners are set up when element is ready
 */
export const useCrossWindowDrag = (
  options: UseCrossWindowDragOptions
): UseCrossWindowDragReturn => {
  const { currentBaseId, onExternalDrop, enabled = true } = options;
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const dragCounterRef = useRef(0);
  const isExternalDragRef = useRef(false);
  const containerRef = useRef<HTMLElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const parseExternalData = useCallback(
    (dataTransfer: DataTransfer): ICrossWindowDragData | null => {
      try {
        let jsonData = dataTransfer.getData(CROSS_WINDOW_DRAG_TYPE);
        if (!jsonData) {
          jsonData = dataTransfer.getData(TEXT_PLAIN_TYPE);
        }
        if (!jsonData) return null;

        const parsed = JSON.parse(jsonData);
        if (parsed.type && parsed.baseId && parsed.resourceId) {
          return parsed as ICrossWindowDragData;
        }
        return null;
      } catch {
        return null;
      }
    },
    []
  );

  const isFromDifferentBase = useCallback(
    (data: ICrossWindowDragData | null): boolean => {
      if (!data) return false;
      return data.baseId !== currentBaseId;
    },
    [currentBaseId]
  );

  const isExternalDragCheck = useCallback((data: ICrossWindowDragData | null): boolean => {
    if (!data) return false;
    return data.windowId !== WINDOW_ID;
  }, []);

  // Setup listeners on a container
  const setupListeners = useCallback(
    (container: HTMLElement) => {
      // eslint-disable-next-line no-console
      console.log('[CrossWindowDrag] Setting up listeners on:', container.tagName);

      const handleDragEnter = (e: DragEvent) => {
        dragCounterRef.current++;
        const types = e.dataTransfer?.types || [];
        const hasTeableData = types.includes(CROSS_WINDOW_DRAG_TYPE);

        // eslint-disable-next-line no-console
        console.log('[CrossWindowDrag] dragenter, hasTeableData:', hasTeableData);

        if (hasTeableData && dragCounterRef.current === 1) {
          isExternalDragRef.current = true;
          setIsDraggingOver(true);
          e.preventDefault();
        }
      };

      const handleDragOver = (e: DragEvent) => {
        if (isExternalDragRef.current) {
          e.preventDefault();
          if (e.dataTransfer) {
            e.dataTransfer.dropEffect = 'move';
          }
        }
      };

      const handleDragLeave = () => {
        dragCounterRef.current--;
        if (dragCounterRef.current === 0) {
          setIsDraggingOver(false);
          isExternalDragRef.current = false;
        }
      };

      const handleDrop = (e: DragEvent) => {
        // eslint-disable-next-line no-console
        console.log('[CrossWindowDrag] drop event');
        const wasExternal = isExternalDragRef.current;
        dragCounterRef.current = 0;
        setIsDraggingOver(false);
        isExternalDragRef.current = false;

        if (!wasExternal || !e.dataTransfer) return;

        const data = parseExternalData(e.dataTransfer);
        // eslint-disable-next-line no-console
        console.log('[CrossWindowDrag] Parsed data:', data);

        if (!data) return;

        const isExternal = isExternalDragCheck(data);
        const isDifferentBase = isFromDifferentBase(data);
        // eslint-disable-next-line no-console
        console.log(
          '[CrossWindowDrag] isExternal:',
          isExternal,
          'isDifferentBase:',
          isDifferentBase
        );

        if (isExternal && isDifferentBase) {
          e.preventDefault();
          e.stopPropagation();
          onExternalDrop?.(data);
        }
      };

      container.addEventListener('dragenter', handleDragEnter, true);
      container.addEventListener('dragover', handleDragOver, true);
      container.addEventListener('dragleave', handleDragLeave, true);
      container.addEventListener('drop', handleDrop, true);

      return () => {
        container.removeEventListener('dragenter', handleDragEnter, true);
        container.removeEventListener('dragover', handleDragOver, true);
        container.removeEventListener('dragleave', handleDragLeave, true);
        container.removeEventListener('drop', handleDrop, true);
      };
    },
    [parseExternalData, isFromDifferentBase, isExternalDragCheck, onExternalDrop]
  );

  // Callback ref - called when element is mounted/unmounted
  const containerCallbackRef = useCallback(
    (node: HTMLElement | null) => {
      // eslint-disable-next-line no-console
      console.log('[CrossWindowDrag] Callback ref called, node:', !!node, 'enabled:', enabled);

      // Cleanup previous listeners
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }

      containerRef.current = node;

      // Setup new listeners if enabled and node exists
      if (node && enabled) {
        cleanupRef.current = setupListeners(node);
      }
    },
    [enabled, setupListeners]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
      }
    };
  }, []);

  return {
    isDraggingOver,
    containerCallbackRef,
  };
};

/**
 * Helper function to set cross-window drag data on native drag events
 */
export const setCrossWindowDragData = (event: DragEvent, data: ICrossWindowDragData): void => {
  if (!event.dataTransfer) return;

  const dataWithWindowId: ICrossWindowDragData = {
    ...data,
    windowId: WINDOW_ID,
  };

  // eslint-disable-next-line no-console
  console.log('[CrossWindowDrag] Setting drag data with windowId:', WINDOW_ID);

  const jsonData = JSON.stringify(dataWithWindowId);
  event.dataTransfer.setData(CROSS_WINDOW_DRAG_TYPE, jsonData);
  event.dataTransfer.setData(TEXT_PLAIN_TYPE, jsonData);
  event.dataTransfer.effectAllowed = 'move';
};

// Export for backwards compatibility
// eslint-disable-next-line @typescript-eslint/no-empty-function
export const useGlobalDragEndListener = (): void => {};
