export const v2VcsClientTokens = {
  remoteGateway: Symbol.for('v2.vcs.remoteGateway'),
  localEngine: Symbol.for('v2.vcs.localEngine'),
  stateRepository: Symbol.for('v2.vcs.stateRepository'),
} as const;

export const v2VcsServerTokens = {
  logRepository: Symbol.for('v2.vcs.server.logRepository'),
  accessPolicy: Symbol.for('v2.vcs.server.accessPolicy'),
  enableBaseVcsService: Symbol.for('v2.vcs.server.enableBaseVcsService'),
  getVcsHeadService: Symbol.for('v2.vcs.server.getVcsHeadService'),
  cloneVcsSnapshotService: Symbol.for('v2.vcs.server.cloneVcsSnapshotService'),
  listVcsTableRecordsChunkService: Symbol.for('v2.vcs.server.listVcsTableRecordsChunkService'),
  listVcsChangesService: Symbol.for('v2.vcs.server.listVcsChangesService'),
  pushVcsPatchService: Symbol.for('v2.vcs.server.pushVcsPatchService'),
  historyService: Symbol.for('v2.vcs.server.historyService'),
} as const;
