/**
 * Naming contract for audit `action` codes — the value of the `audit_log.action` column.
 *
 *   <domain>[.<sub-resource>…].<verb>
 *
 * - Lowercase, dot-separated segments; kebab-case inside a segment
 *   (`access-token.create`, `base.authority-matrix-role.name.update`).
 * - Prefer these verbs: create · update · delete · permanent-delete · restore · move · rename ·
 *   change · duplicate · import · export · publish · unpublish · enable · disable · activate ·
 *   deactivate · grant · revoke · refresh · rotate · signin · signout · signup · send · accept ·
 *   click. Use a domain verb (pause, resume, rollback, execute, repair, renew…) only when none
 *   of them fits. A failed or denied attempt gets its own verb (`user.signin-failed`), never a
 *   `.failed` suffix segment.
 * - No code may be a dot-prefix of another (`user.signin` and `user.signin.failed` cannot
 *   coexist): the admin UI resolves labels from nested i18n keys, where `user.signin` would have
 *   to be both a label and a parent object.
 * - Payloads carry ids, counts, field names and before/after values of permission changes —
 *   never the value of a secret, token, password or key.
 *
 * Every code written to the `action` column must also be registered in `AUDIT_LOG_ACTIONS`
 * (`@teable/openapi-ee`), grouped in the admin ActionFilter and labelled in every locale; the
 * EE audit-action registry spec enforces all of it.
 */
export const AUDIT_ACTION_PATTERN = /^[a-z][\da-z-]*(?:\.[a-z][\da-z-]*)+$/;
