import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { hasPermission } from '@teable/core';
import type { IMoveBaseNodeCheckVo } from '@teable/openapi';
import {
  BaseNodeResourceType,
  CollaboratorType,
  getBaseList,
  getSharedBase,
  moveBaseNode,
  moveBaseNodeCheck,
} from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useBase } from '@teable/sdk/hooks';
import { ConfirmDialog, Selector, Spin } from '@teable/ui-lib/base';
import {
  Button,
  Checkbox,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { cn } from '@teable/ui-lib/shadcn/utils';
import { AlertTriangle, ChevronRight, HelpCircle } from 'lucide-react';
import { useRouter } from 'next/router';
import { Trans, useTranslation } from 'next-i18next';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Emoji } from '@/features/app/components/emoji/Emoji';
import { useBaseResource } from '@/features/app/hooks/useBaseResource';
import { tableConfig } from '@/features/i18n/table.config';
import {
  markTableDeletedLocally,
  unmarkTableDeletedLocally,
} from '../../table/hooks/stale-table-fallback';
import { useTableHref } from '../../table-list/useTableHref';
import type { TreeItemData } from '../base-node/hooks';
import { BaseNodeResourceIconMap, getNodeIcon, getNodeUrl } from '../base-node/hooks';
import { useBaseNodeContext } from '../base-node/hooks/useBaseNodeContext';

interface IMoveNodeToBaseDialogProps {
  node: TreeItemData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Names shown as chips before the rest fold behind a +N, as elsewhere in settings. */
const NAME_PREVIEW_COUNT = 3;

/** A plain statement at the foot of the dialog; `detail` is a help tooltip. */
interface INote {
  key: string;
  text: string;
  detail?: string;
}

const NAME_CHIP =
  'inline-flex h-5 min-w-0 max-w-40 items-center truncate rounded-md bg-muted px-1.5 text-xs text-foreground';

const useTargetBases = (spaceId: string, currentBaseId: string, enabled: boolean) => {
  const base = useBase();
  const isSpaceCollaborator = base.collaboratorType !== CollaboratorType.Base;
  const { data: spaceBases, isLoading: spaceLoading } = useQuery({
    queryKey: ReactQueryKeys.baseList(spaceId),
    queryFn: ({ queryKey }) => getBaseList({ spaceId: queryKey[1] }).then((res) => res.data),
    enabled: enabled && isSpaceCollaborator,
  });
  const { data: sharedBases, isLoading: sharedLoading } = useQuery({
    queryKey: ReactQueryKeys.getSharedBase(),
    queryFn: () => getSharedBase().then((res) => res.data),
    enabled: enabled && !isSpaceCollaborator,
  });
  const bases = useMemo(() => {
    const list = spaceBases ?? sharedBases ?? [];
    return list
      .filter(
        (b) =>
          b.id !== currentBaseId && b.spaceId === spaceId && hasPermission(b.role, 'table|create')
      )
      .map((b) => ({ id: b.id, name: b.name }));
  }, [spaceBases, sharedBases, currentBaseId, spaceId]);
  return { bases, isLoading: spaceLoading || sharedLoading };
};

/** First non-folder node in sidebar order that is not part of `excluded`. */
const findRemainingNode = (
  treeItems: Record<string, TreeItemData>,
  excluded: Set<string>
): TreeItemData | undefined => {
  const byOrder = (a: TreeItemData, b: TreeItemData) => a.order - b.order;
  const walk = (parentId: string | null): TreeItemData | undefined => {
    const siblings = Object.values(treeItems)
      .filter((item) => item.parentId === parentId && !excluded.has(item.id))
      .sort(byOrder);
    for (const item of siblings) {
      if (item.resourceType !== BaseNodeResourceType.Folder) return item;
      const inside = walk(item.id);
      if (inside) return inside;
    }
    return undefined;
  };
  return walk(null);
};

/** Every node id in the subtree rooted at `rootId` (root included). */

export const MoveNodeToBaseDialog = (props: IMoveNodeToBaseDialogProps) => {
  const { node, open, onOpenChange } = props;
  const { t, i18n } = useTranslation(tableConfig.i18nNamespaces);
  const base = useBase();
  const router = useRouter();
  const queryClient = useQueryClient();
  const baseResource = useBaseResource();
  const { treeItems, invalidateMenu } = useBaseNodeContext();
  const { hrefMap: tableHrefMap, viewIdMap: tableViewIdMap } = useTableHref();
  const [targetBaseId, setTargetBaseId] = useState('');
  const [check, setCheck] = useState<IMoveBaseNodeCheckVo | null>(null);
  /** keys of the sections the reader has opened; all start closed */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  /**
   * Take the whole dependency closure, or nothing.
   *
   * Never a per-node pick: an automation usually names several tables, so
   * bringing one along while its others stay behind breaks more of it than
   * leaving it alone did. All-or-nothing is the only form with an invariant —
   * afterwards no reference that was inside one project spans two.
   */
  const [moveClosure, setMoveClosure] = useState(true);
  /**
   * The answer to "move only what was asked". Kept alongside the active one
   * because the choice shows both futures at once: what leaving the references
   * behind costs, and how much travels if they come. Only this reply knows the
   * closure — asked about the enlarged set, there is nothing left to add.
   */
  const [plainCheck, setPlainCheck] = useState<IMoveBaseNodeCheckVo | null>(null);
  /** What has been accepted so far, grown until the answer asks for nothing more. */
  const [closureIds, setClosureIds] = useState<string[]>([]);
  const nodeName = node.resourceMeta?.name ?? '';
  /**
   * Which check is the current one.
   *
   * A superseded request is never cancelled, and its handler is frozen on the
   * render that issued it — so without this a stale answer lands later, applies
   * its own idea of whether the box was ticked, and leaves the preview showing
   * one move while the button performs another.
   */
  const checkSeq = useRef(0);

  const { bases, isLoading: basesLoading } = useTargetBases(base.spaceId, base.id, open);

  useEffect(() => {
    if (!open) {
      setTargetBaseId('');
      setCheck(null);
      setExpanded(new Set());
      setMoveClosure(true);
      setPlainCheck(null);
      setClosureIds([]);
    }
  }, [open]);

  /**
   * Asked once per destination. The answer is the whole reachable set, so the
   * choice below only decides which of it travels and nothing has to be
   * re-asked while the user makes up their mind.
   */
  const { mutate: runCheck, isPending: checking } = useMutation({
    // Asked again with the closure attached rather than reasoned about here:
    // the answer then describes the real moving set, so its blockers, its lost
    // permission rules and whatever still breaks are all the true ones.
    mutationFn: (vars: { target: string; ids: string[]; wantClosure: boolean; seq: number }) =>
      moveBaseNodeCheck(base.id, node.id, {
        targetBaseId: vars.target,
        ...(vars.ids.length > 0 ? { additionalNodeIds: vars.ids } : {}),
      }).then((res) => res.data),
    onSuccess: (data, vars) => {
      // anything but the newest request is answering a question already replaced
      if (vars.seq !== checkSeq.current) return;
      if (vars.ids.length === 0) setPlainCheck(data);
      /**
       * Asked again while the answer still names something that has to come.
       *
       * One round is not always enough: an enlarged set is a different
       * question, and what it reaches can differ from what the first set did.
       * Growing until the reply asks for nothing more is what makes "nothing
       * will break" true rather than nearly true — and it terminates, because
       * the set only ever grows and the project is finite.
       */
      const next = [...new Set([...vars.ids, ...data.dependencyClosure.map((i) => i.nodeId)])];
      // the intent travels with the request: read from state it would be the
      // intent at reply time, which a tick in between has already changed
      if (vars.wantClosure && next.length > vars.ids.length) {
        setClosureIds(next);
        startCheck(vars.target, next, true);
        return;
      }
      setCheck(data);
    },
    onError: (_error, vars) => {
      if (vars.seq !== checkSeq.current) return;
      setCheck(null);
    },
  });

  /** Issues a check and makes it the only one whose answer counts. */
  const startCheck = (target: string, ids: string[], wantClosure: boolean) => {
    checkSeq.current += 1;
    runCheck({ target, ids, wantClosure, seq: checkSeq.current });
  };

  const candidates = useMemo(() => check?.candidates ?? [], [check]);
  /** Whether there is anything to offer at all, known from the first answer. */
  const hasClosureOffer = (plainCheck?.dependencyClosure.length ?? 0) > 0;

  const currentResourceId = useMemo(() => {
    switch (baseResource.resourceType) {
      case BaseNodeResourceType.Table:
        return baseResource.tableId;
      case BaseNodeResourceType.Dashboard:
        return baseResource.dashboardId;
      case BaseNodeResourceType.Workflow:
        return baseResource.workflowId;
      case BaseNodeResourceType.Routine:
        return baseResource.routineId;
      case BaseNodeResourceType.App:
        return baseResource.appId;
      default:
        return undefined;
    }
  }, [baseResource]);

  /** Every node leaving this project: the one asked for, and its subtree. */
  /**
   * What is actually leaving, read off the answer rather than re-derived.
   *
   * The server already resolved it — the node asked for, its subtree, and each
   * additional node's subtree — so deriving it again from the sidebar tree only
   * introduces ways to be wrong: that tree hides folders from restricted users
   * and can simply lag. Captured when the move is fired, because the dialog may
   * be closed and its state reset before the answer comes back.
   */
  const leavingRef = useRef<{ ids: Set<string>; tableIds: string[] }>({
    ids: new Set(),
    tableIds: [],
  });

  const { mutateAsync: runMove, isPending: moving } = useMutation({
    mutationFn: (target: string) => {
      // this window is the actor: keep the "your table was deleted" recovery quiet
      // the server's answer is the moving set; freeze it before anything resets
      const leaving = check?.nodes ?? [];
      leavingRef.current = {
        ids: new Set(leaving.map((item) => item.nodeId)),
        tableIds: leaving
          .filter((item) => item.resourceType === BaseNodeResourceType.Table)
          .map((item) => item.resourceId),
      };
      leavingRef.current.tableIds.forEach(markTableDeletedLocally);
      // only what was asked for: nothing here offers to take anything else,
      // so there is no set to send and no cascade to get wrong
      return moveBaseNode(base.id, node.id, {
        targetBaseId: target,
        ...(moveClosure && closureIds.length > 0 ? { additionalNodeIds: closureIds } : {}),
      }).then((res) => res.data);
    },
    onError: () => {
      leavingRef.current.tableIds.forEach(unmarkTableDeletedLocally);
    },
    onSuccess: (moved, target) => {
      invalidateMenu();
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.baseNodeTree(target) });
      const targetName = bases.find((b) => b.id === target)?.name ?? target;
      const url = getNodeUrl({
        baseId: target,
        resourceType: moved.resourceType,
        resourceId: moved.resourceId,
        viewId:
          moved.resourceType === BaseNodeResourceType.Table
            ? moved.resourceMeta?.defaultViewId
            : undefined,
      });
      const goToMoved = () => {
        router.push(url ?? `/base/${target}`);
      };
      toast.success(t('table:baseNode.moveToBase.successTitle'), {
        description: (
          // the names carry themselves; quoting them as well is belt and braces
          <Trans
            ns={tableConfig.i18nNamespaces}
            i18nKey="table:baseNode.moveToBase.successDescription"
            values={{ count: leavingRef.current.ids.size, baseName: targetName }}
            components={{ b: <span className="font-medium text-foreground" /> }}
          />
        ),
        action: { label: t('table:baseNode.moveToBase.open'), onClick: goToMoved },
      });

      // the page we are on just left this project: stay here, on whatever
      // remains (same as after a delete); the toast offers the way over
      const currentNode = Object.values(treeItems).find(
        (item) => item.resourceId === currentResourceId
      );
      if (currentNode && leavingRef.current.ids.has(currentNode.id)) {
        const remaining = findRemainingNode(treeItems, leavingRef.current.ids);
        if (!remaining) {
          router.replace(`/base/${base.id}`, undefined, { shallow: true });
        } else if (
          remaining.resourceType === BaseNodeResourceType.Table &&
          tableHrefMap[remaining.resourceId]
        ) {
          router.replace({ pathname: tableHrefMap[remaining.resourceId] }, undefined, {
            shallow: Boolean(tableViewIdMap[remaining.resourceId]),
          });
        } else {
          const next = getNodeUrl({
            baseId: base.id,
            resourceType: remaining.resourceType,
            resourceId: remaining.resourceId,
          });
          router.replace(next ?? `/base/${base.id}`, undefined, {
            shallow: remaining.resourceType !== BaseNodeResourceType.Table,
          });
        }
      }
      onOpenChange(false);
    },
  });

  /**
   * Said only where the row departs from what its heading already promised.
   * Left at its default the panel stays silent, so the words that do appear
   * are always about a choice the reader has just made.
   */
  /**
   * What will stop working, one entry per thing.
   *
   * A reference by id does not survive the two ends landing in different
   * projects, and it is always the side that does the naming that fails. That
   * side can be either end of the move: an automation left behind naming a
   * table that goes, or an automation that goes naming a table that stays. So
   * both are reported the same way — the namer, and what it named — and the
   * reader never has to work out which direction a row is about.
   *
   * Grouped by the namer, because one automation missing three tables is one
   * thing that is broken, not three.
   */
  /**
   * Joins names the way the reader's language does.
   *
   * A hardcoded separator is wrong everywhere but one language: Chinese and
   * Japanese want 、 and a comma looks foreign, while German wants a comma and
   * 、 is not a character it uses at all. `conjunction` is the type that gets
   * both right — `unit` drops the separator entirely in CJK.
   */
  const joinNames = useCallback(
    (names: string[]): string => {
      try {
        return new Intl.ListFormat(i18n.language, {
          style: 'narrow',
          type: 'conjunction',
        }).format(names);
      } catch {
        // an unknown language tag rather than a missing Intl: still readable
        return names.join(', ');
      }
    },
    [i18n.language]
  );

  /**
   * What stops working under a given answer. Written against whichever reply is
   * passed in, because the choice above has to price both: the active one, and
   * the one that moves nothing extra.
   */
  const casualtiesOf = useCallback((source: IMoveBaseNodeCheckVo | null) => {
    if (!source) return [];

    // either end of the move can be the casualty, so both sides feed the index
    const known = new Map<string, { name: string; resourceType: BaseNodeResourceType }>();
    const remember = (item: { nodeId: string; name: string; resourceType: BaseNodeResourceType }) =>
      known.set(item.nodeId, { name: item.name, resourceType: item.resourceType });
    source.nodes.forEach(remember);
    source.candidates.forEach(remember);

    type ICasualty = {
      nodeId: string;
      name: string;
      resourceType: BaseNodeResourceType;
      needs: string[];
      uncertain: boolean;
    };
    const byId = new Map<string, ICasualty>();
    const add = (nodeId: string, needs: string[], uncertain: boolean) => {
      const who = known.get(nodeId);
      if (!who) return;
      const entry = byId.get(nodeId) ?? { nodeId, ...who, needs: [], uncertain: true };
      needs.forEach((need) => !entry.needs.includes(need) && entry.needs.push(need));
      // one certain reference is enough to stop hedging about this node
      entry.uncertain = entry.uncertain && uncertain;
      byId.set(nodeId, entry);
    };
    for (const candidate of source.candidates) {
      if (candidate.reason !== 'reference') continue;
      const uncertain = Boolean(candidate.uncertain);
      if (candidate.role === 'dependent') {
        // it names something on the move, so it is the one that fails
        add(candidate.nodeId, candidate.relatedNames, uncertain);
        continue;
      }
      // something on the move names it, so those movers are what fail
      candidate.relatedNodeIds.forEach((mover) => add(mover, [candidate.name], uncertain));
    }
    return [...byId.values()].sort(
      (a, b) => Number(a.uncertain) - Number(b.uncertain) || a.name.localeCompare(b.name)
    );
  }, []);

  const casualties = useMemo(() => casualtiesOf(check), [casualtiesOf, check]);

  const linked = useMemo(
    () => candidates.filter((candidate) => candidate.reason === 'link'),
    [candidates]
  );

  const blockerLabel = (code: string): string =>
    String(
      t(`table:baseNode.moveToBase.blockers.${code}` as never, {
        defaultValue: t('table:baseNode.moveToBase.blockers.unknown'),
      })
    );

  const renderIcon = (nodeId: string, resourceType: BaseNodeResourceType) => {
    const item = treeItems[nodeId];
    const emoji = item ? getNodeIcon(item) : undefined;
    if (resourceType === BaseNodeResourceType.Table && emoji) {
      return <Emoji emoji={emoji} size={14} className="size-3.5 shrink-0" />;
    }
    const Icon = BaseNodeResourceIconMap[resourceType];
    return <Icon className="size-3.5 shrink-0 text-muted-foreground" />;
  };

  /**
   * Everything that simply happens, in one place and one voice. These ask
   * nothing of the reader, so each is a single line; whatever else is worth
   * knowing hangs off it as a detail rather than growing the line.
   */
  const notes = useMemo<INote[]>(() => {
    const all: (INote | undefined)[] = [
      check?.embeddedIdApps.length
        ? {
            key: 'appIds',
            text: t('table:baseNode.moveToBase.appEmbeddedId', {
              count: check.embeddedIdApps.length,
            }),
            // which apps and how many places, kept off the line but never lost
            detail: t('table:baseNode.moveToBase.appEmbeddedIdDetail', {
              apps: joinNames(
                check.embeddedIdApps.map(
                  (app) =>
                    `${app.name} · ${t('table:baseNode.moveToBase.occurrences', {
                      count: app.occurrences,
                    })}`
                )
              ),
            }),
          }
        : undefined,
      check?.uninspectableApps.length
        ? {
            key: 'uninspectable',
            text: t('table:baseNode.moveToBase.uninspectableTitle', {
              count: check.uninspectableApps.length,
            }),
            detail: joinNames(check.uninspectableApps.map((app) => app.name)),
          }
        : undefined,
      check?.droppedPermissionRuleCount
        ? {
            key: 'rules',
            text: t('table:baseNode.moveToBase.droppedRules', {
              count: check.droppedPermissionRuleCount,
            }),
            detail: t('table:baseNode.moveToBase.droppedRulesDetail'),
          }
        : undefined,
    ];
    return all.filter((note): note is INote => Boolean(note));
  }, [check, joinNames, t]);

  const toggleSection = (key: string) => {
    const next = new Set(expanded);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    setExpanded(next);
  };

  const content = (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">
          {t('table:baseNode.moveToBase.targetLabel')}
        </span>
        {basesLoading ? (
          <Spin className="size-4" />
        ) : bases.length === 0 ? (
          <span className="text-xs text-muted-foreground">
            {t('table:baseNode.moveToBase.noTarget')}
          </span>
        ) : (
          <Selector
            className="w-full"
            candidates={bases}
            selectedId={targetBaseId}
            placeholder={t('table:baseNode.moveToBase.targetPlaceholder')}
            onChange={(id) => {
              setTargetBaseId(id);
              setCheck(null);
              setExpanded(new Set());
              setMoveClosure(true);
              setPlainCheck(null);
              setClosureIds([]);
              startCheck(id, [], true);
            }}
          />
        )}
      </div>

      {checking && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Spin className="size-3" />
          {t('table:baseNode.moveToBase.checking')}
        </div>
      )}

      {check && check.blockers.length > 0 && (
        <div className="flex flex-col gap-1 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {check.blockers.map((blocker, index) => (
            <div key={`${blocker.code}-${index}`} className="flex items-start gap-1.5">
              <AlertTriangle className="mt-px size-3 shrink-0" />
              <span>
                {blocker.node ? `${blocker.node.name}: ` : ''}
                {blockerLabel(blocker.code)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Outside the `allowed` gate on purpose. The box is ticked by default,
          so the first answer the reader sees describes the enlarged set — and
          if it is the closure that is blocked (a node they cannot move, a name
          that clashes), gating this would hide the one control that undoes it
          while the blocker stays on screen, with no way back. */}
      {check && hasClosureOffer && (
        <div className="flex items-center gap-2">
          <Checkbox
            id="move-node-closure"
            checked={moveClosure}
            disabled={checking}
            onCheckedChange={(value) => {
              const next = value === true;
              setMoveClosure(next);
              if (!targetBaseId) return;
              // unticking goes back to the bare question; ticking restarts
              // the walk from what the first answer offered
              const ids = next ? (plainCheck?.dependencyClosure.map((i) => i.nodeId) ?? []) : [];
              setClosureIds(ids);
              startCheck(targetBaseId, ids, next);
            }}
          />
          <Label
            htmlFor="move-node-closure"
            className="cursor-pointer text-xs font-normal leading-relaxed"
          >
            {t('table:baseNode.moveToBase.moveClosure')}
          </Label>
          {/* what it does not cover: a link is the other kind of connection
                  and never travels, which is the one thing worth asking about */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex shrink-0 cursor-help text-muted-foreground/60 transition-colors hover:text-foreground">
                  <HelpCircle className="size-3.5" />
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-72 whitespace-normal break-words">
                <p className="leading-relaxed">{t('table:baseNode.moveToBase.moveClosureHint')}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      )}

      {/* Every section this can hold, or the block hides its own contents: the
          offer to take the references along empties the casualty list by
          design, so a guard written around casualties alone disappears exactly
          when the reader accepts it. */}
      {check?.allowed &&
        (hasClosureOffer || casualties.length > 0 || linked.length > 0 || notes.length > 0) && (
          <div className="flex max-h-[46vh] flex-col gap-3 overflow-y-auto pe-1">
            {casualties.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {/* the line is the finding; the list is only who and what */}
                <button
                  type="button"
                  className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => toggleSection('breaking')}
                >
                  <ChevronRight
                    className={cn(
                      'size-3 shrink-0 transition-transform',
                      expanded.has('breaking') && 'rotate-90'
                    )}
                  />
                  {/* a statement, not an alarm: it says "may", and red would
                    contradict that while making every move look like a fault */}
                  <span>
                    {t('table:baseNode.moveToBase.breakingCount', { count: casualties.length })}
                  </span>
                </button>
                {expanded.has('breaking') && (
                  <div className="overflow-hidden rounded-md border">
                    {casualties.map((entry) => {
                      const preview = entry.needs.slice(0, NAME_PREVIEW_COUNT);
                      const rest = entry.needs.slice(preview.length);
                      return (
                        <div
                          key={entry.nodeId}
                          className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 px-3 py-2 text-xs"
                        >
                          {renderIcon(entry.nodeId, entry.resourceType)}
                          <span className="min-w-0 max-w-40 shrink-0 truncate">{entry.name}</span>
                          <span className="shrink-0 text-muted-foreground">
                            {t('table:baseNode.moveToBase.referencesLabel')}
                          </span>
                          {preview.map((name) => (
                            <span key={name} className={NAME_CHIP} title={name}>
                              {name}
                            </span>
                          ))}
                          {rest.length > 0 && (
                            // The move screen is a modal dialog; a non-modal popover
                            // inside one never gets the wheel, so its list cannot scroll.
                            <Popover modal>
                              <PopoverTrigger asChild>
                                <Button variant="link" size="sm" className="h-auto p-0 text-xs">
                                  +{rest.length}
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent align="start" className="w-72 p-2">
                                <div className="px-2 pb-1 text-xs font-medium text-muted-foreground">
                                  {t('table:baseNode.moveToBase.referencesLabel')}
                                </div>
                                <div className="max-h-72 space-y-0.5 overflow-auto">
                                  {rest.map((name) => (
                                    <div
                                      key={name}
                                      className="truncate rounded px-2 py-1 text-xs"
                                      title={name}
                                    >
                                      {name}
                                    </div>
                                  ))}
                                </div>
                              </PopoverContent>
                            </Popover>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {moveClosure && hasClosureOffer && (check?.nodes.length ?? 0) > 0 && (
              <div className="flex flex-col gap-1.5">
                {/* the count moved off the checkbox and onto its own line, where
                  opening it answers the question the number only raises */}
                <button
                  type="button"
                  className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => toggleSection('moving')}
                >
                  <ChevronRight
                    className={cn(
                      'size-3 shrink-0 transition-transform',
                      expanded.has('moving') && 'rotate-90'
                    )}
                  />
                  <span>
                    {t('table:baseNode.moveToBase.movingCount', {
                      count: check?.nodes.length ?? 0,
                    })}
                  </span>
                </button>
                {expanded.has('moving') && (
                  <div className="overflow-hidden rounded-md border">
                    {check?.nodes.map((item) => (
                      <div
                        key={item.nodeId}
                        className="flex items-center gap-2 px-3 py-1.5 text-xs"
                      >
                        {renderIcon(item.nodeId, item.resourceType)}
                        <span className="truncate">{item.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {linked.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <button
                  type="button"
                  className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => toggleSection('linked')}
                >
                  <ChevronRight
                    className={cn(
                      'size-3 shrink-0 transition-transform',
                      expanded.has('linked') && 'rotate-90'
                    )}
                  />
                  <span>
                    {t('table:baseNode.moveToBase.linkedAcrossProjects', { count: linked.length })}
                  </span>
                </button>
                {expanded.has('linked') && (
                  <div className="overflow-hidden rounded-md border">
                    {linked.map((candidate) => (
                      <div
                        key={candidate.nodeId}
                        className="flex items-center gap-2 px-3 py-1.5 text-xs"
                      >
                        {renderIcon(candidate.nodeId, candidate.resourceType)}
                        <span className="truncate">{candidate.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ps-4 clears the chevron above, so every line starts on one edge;
              kept together at gap-1 because they are one set of statements */}
            {notes.length > 0 && (
              <div className="flex flex-col gap-1 ps-4">
                {notes.map((note) => (
                  <p
                    key={note.key}
                    className="flex items-center gap-1 text-xs leading-relaxed text-muted-foreground"
                  >
                    {note.text}
                    {/* the mark carries the offer, so the sentence stays a sentence */}
                    {note.detail && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex shrink-0 cursor-help text-muted-foreground/60 transition-colors hover:text-foreground">
                              <HelpCircle className="size-3.5" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent
                            side="top"
                            className="max-w-72 whitespace-normal break-words"
                          >
                            <p className="leading-relaxed">{note.detail}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
    </div>
  );

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        // the name is set apart by weight, not by quote marks around it
        <Trans
          ns={tableConfig.i18nNamespaces}
          i18nKey="table:baseNode.moveToBase.title"
          values={{ name: nodeName }}
          components={{ b: <span className="font-semibold" /> }}
        />
      }
      content={content}
      cancelText={t('common:actions.cancel')}
      confirmText={t('table:baseNode.moveToBase.confirm')}
      confirmLoading={moving}
      confirmDisabled={!targetBaseId || !check?.allowed || checking}
      onCancel={() => onOpenChange(false)}
      onConfirm={async () => {
        if (!targetBaseId) return;
        await runMove(targetBaseId);
      }}
    />
  );
};
