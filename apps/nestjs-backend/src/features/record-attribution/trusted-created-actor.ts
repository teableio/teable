// A symbol cannot be supplied by JSON/REST payloads. Only server-owned snapshots may set it.
export const TRUSTED_CREATED_ACTOR = Symbol('trustedCreatedActor');
