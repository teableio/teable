/**
 * Softens React's structural DOM calls against third-party DOM rewriting.
 *
 * Browser translators (Chrome's built-in Google Translate and lookalike
 * extensions) rewrite rendered text behind React's back: text nodes get
 * wrapped in <font> elements and reparented. React still holds references to
 * the original nodes, so its next commit calls removeChild/insertBefore with
 * stale children and throws "NotFoundError: ... is not a child of this node",
 * which unmounts the whole tree into the crash page. Error tracking shows this
 * steadily for users browsing in locales we don't ship (the browser offers to
 * translate the page — vi, ko, pt-BR...), most visibly across onboarding's
 * step transitions.
 *
 * React offers no opt-out (facebook/react#11538), and disabling translation
 * with translate="no" would take the product away from exactly the users who
 * need the translator. So the failing call degrades instead of throwing:
 * removing an already-moved node becomes a no-op, inserting before a moved
 * anchor appends to the intended parent. Worst case is a translated fragment
 * rendering out of order until the next commit — where the throw destroyed
 * the page.
 */

/** Stamped on the patched functions so re-imports (HMR) never double-wrap. */
const GUARD_FLAG = '__teableDomGuard';

type Guarded = { [GUARD_FLAG]?: true };

/* Capped: one commit over a fully translated page can hit hundreds of moved
 * nodes, and per-node warnings would drown the console and bloat session
 * replays. A few lines are enough to attribute "why does this page look odd"
 * and to count affected sessions. */
let reported = 0;
const report = (op: string) => {
  if (reported >= 5) {
    return;
  }
  reported += 1;
  console.warn(
    `[dom-guard] ${op} target was reparented by a third party (browser translation?); degraded to keep the page alive`
  );
};

export const installThirdPartyDomGuard = () => {
  // SSR: Node is a DOM global, absent in the server runtime.
  if (typeof Node === 'undefined' || !Node.prototype) {
    return;
  }
  if ((Node.prototype.removeChild as Guarded)[GUARD_FLAG]) {
    return;
  }

  const originalRemoveChild = Node.prototype.removeChild;
  const guardedRemoveChild = function <T extends Node>(this: Node, child: T): T {
    if (child.parentNode !== this) {
      report('removeChild');
      return child;
    }
    return originalRemoveChild.call(this, child) as T;
  };
  (guardedRemoveChild as Guarded)[GUARD_FLAG] = true;
  Node.prototype.removeChild = guardedRemoveChild;

  const originalInsertBefore = Node.prototype.insertBefore;
  const guardedInsertBefore = function <T extends Node>(
    this: Node,
    newNode: T,
    referenceNode: Node | null
  ): T {
    if (referenceNode && referenceNode.parentNode !== this) {
      report('insertBefore');
      // Append instead of dropping the node: the parent is still the one
      // React targeted, only the anchor moved — losing the subtree entirely
      // would leave a visible hole in the page.
      return originalInsertBefore.call(this, newNode, null) as T;
    }
    return originalInsertBefore.call(this, newNode, referenceNode) as T;
  };
  (guardedInsertBefore as Guarded)[GUARD_FLAG] = true;
  Node.prototype.insertBefore = guardedInsertBefore;
};
