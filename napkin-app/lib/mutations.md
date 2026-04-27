# Mutation Pattern — Napkin Canonical Guide

**Source of truth for all `useMutation` hooks in Napkin.**
Introduced in TICKET-036 (pattern enforcement), extended in TICKET-042 (cursor-cache helpers + docs).

---

## TL;DR

Every mutation hook follows 4 phases: **snapshot → patch → rollback → narrow refetch**. Never blast-invalidate. Never skip the snapshot.

```ts
useMutation({
    mutationFn: async (input) => callEdgeFn('my-function', { action: 'do_thing', body: input }),

    onMutate: async (input) => {
        // 1. Cancel in-flight queries we're about to mutate
        await queryClient.cancelQueries({ queryKey });
        // 2. Snapshot current state
        const previous = queryClient.getQueryData(queryKey);
        // 3. Optimistically patch
        queryClient.setQueryData(queryKey, (old) => patch(old, input));
        // 4. Return snapshot for rollback
        return { previous };
    },

    onError: (_err, _input, ctx) => {
        // 5. Restore from snapshot
        if (ctx?.previous !== undefined) queryClient.setQueryData(queryKey, ctx.previous);
    },

    onSuccess: (result) => {
        // 6. Reconcile cache with server shape (swap optimistic id for real id, merge fields)
        queryClient.setQueryData(queryKey, (old) => reconcile(old, result));
        // 7. Narrow invalidate ONLY when server shape has data the patch couldn't synthesise
    },
});
```

---

## 1. The Template (annotated)

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';

export function useMyMutation() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (input: MyInput): Promise<MyResult> =>
            callEdgeFn<MyResult>('my-function', { action: 'do_thing', body: input }),

        onMutate: async (input) => {
            // ALWAYS cancel + snapshot BEFORE patching.
            // cancelQueries prevents a racing background refetch from overwriting
            // the optimistic state immediately after we set it.
            const key = queryKeys.myFeature.detail(input.id);
            await queryClient.cancelQueries({ queryKey: key });

            // Snapshot MUST be returned — it's the only rollback source.
            // Rule: if `previous` is not in the returned context, onError
            //       cannot restore. This caused TICKET-036 P0-8.
            const previous = queryClient.getQueryData<MyData>(key);
            queryClient.setQueryData<MyData>(key, (old) =>
                old ? { ...old, status: 'optimistic' } : old,
            );
            return { previous, key };
        },

        onError: (_err, _input, ctx) => {
            // Restore. Guard: if previous is undefined, the cache was empty —
            // setQueryData(key, undefined) is equivalent to deleting the entry,
            // which is correct (we added nothing).
            if (ctx?.key && ctx.previous !== undefined) {
                queryClient.setQueryData(ctx.key, ctx.previous);
            }
        },

        onSuccess: (result, input, _ctx) => {
            // Reconcile: swap the optimistic state for the server-authoritative shape.
            // Do NOT reach for invalidateQueries unless there's a specific reason
            // (see section 6 — When invalidation IS appropriate).
            const key = queryKeys.myFeature.detail(input.id);
            queryClient.setQueryData<MyData>(key, (old) => {
                if (!old) return old;
                return { ...old, id: result.id, status: result.status };
            });
        },
    });
}
```

---

## 2. Why `invalidateQueries` is Wrong By Default

### Cursor pages reset to page 1
`InfiniteData` caches page 0..N. `invalidateQueries` on a paginated key removes all cached pages. The next read fetches only page 0 — scroll position jumps to the top of a truncated list. The user loses context. This is a visible UX regression, not a background concern.

### Thundering herd on grouped keys
`invalidateQueries({ queryKey: ['tables'] })` matches every table key in the cache — all detail pages, all activity feeds, all member lists — in a single flush. One mutation causes N concurrent network requests. On a slow connection this saturates the link.

### Optimistic flash window
`invalidateQueries` triggers a refetch. Between the refetch landing and the cache updating, there is a window where the query is `isLoading: true` and the component shows a spinner or empty state. This is the flash the optimistic patch was designed to prevent. Blast-invalidating after an optimistic patch wastes the patch entirely.

### Example: `useCreateEntry` pre-TICKET-042
```ts
// BAD: the pre-TICKET-042 pattern
onSuccess: () => {
    qc.invalidateQueries({ queryKey: queryKeys.feed.all(userId) });       // page 0 reset
    qc.invalidateQueries({ queryKey: queryKeys.entries.forDayAll(userId) }); // all buckets
};

// GOOD: the TICKET-042 pattern
onSuccess: (result) => {
    qc.setQueryData(feedKey, (old) => swapByNonce(old, nonce, result));
    qc.setQueryData(forDayKey, (old) => swapInArray(old, isNonce, () => result));
    // atlas is a server-derived aggregate — invalidate is appropriate here
    qc.invalidateQueries({ queryKey: queryKeys.atlas.index(tableId) });
};
```

---

## 3. The `client_nonce` Round-Trip Pattern

Use `client_nonce` when a mutation **creates** an entity and the entity has no natural client-side key before the server assigns one (e.g. a new entry, a new reaction).

**How it works:**
1. `onMutate`: generate `nonce = crypto.randomUUID()`, stash on input, build optimistic row with `id: 'optimistic-<nonce>'`, prepend to cache.
2. Server: stores `client_nonce` for idempotency deduplication. Returns the real row with `id: <uuid>`.
3. `onSuccess`: call `swapByNonce(data, nonce, serverRow)` — finds `optimistic-<nonce>`, replaces with the full server row. No refetch needed.
4. `onError`: rollback from snapshot.

**Reference implementations (post-TICKET-042):**
- `hooks/tables/useCreateEntry.ts` — nonce on entry creates, extended to 4 caches
- `hooks/posts/usePostInteractions.ts::useToggleReaction` — nonce on reaction add

**Nonce generation:**
```ts
const nonce = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
input.client_nonce = nonce;
```

---

## 4. Reconciling Without a Nonce

When the entity already has a natural composite key, match on that instead of a nonce.

**`(entry_id, user_id)` for takes:**
```ts
// useAddTake — reconcile by composite key
patchActivityParticipant(prev, entryId, viewerId, (p) => ({
    ...p,
    ...serverTake,
    __optimistic: undefined,
}));
```

**`user_id` for table members:**
```ts
// useAddMember — reconcile by user_id
prev.map((m) =>
    m.member_id.startsWith('optimistic-') && m.user_id === targetUserId
        ? { ...m, member_id: result.member_id }
        : m,
);
```

**`(user_id, emoji)` for reactions:**
See `useToggleReaction.onSuccess` for the swap-by-(user_id, emoji) pattern.

---

## 5. The `lib/optimistic.ts` Helpers

For paginated `InfiniteData<Page<T>>` caches, use the shared helpers from `lib/optimistic.ts` instead of reimplementing the page-walk logic.

```ts
import {
    prependToInfinitePages,  // prepend row to page 0
    swapByMatch,             // walk all pages, replace first match
    swapByNonce,             // convenience: match by id === 'optimistic-<nonce>'
    removeByMatch,           // walk all pages, remove all matches
    snapshotInfinite,        // snapshot + restore factory for InfiniteData
    snapshot,                // snapshot + restore factory for non-paginated data
    prependArray,            // prepend to flat T[]
    removeFromArray,         // remove from flat T[]
    swapInArray,             // replace first match in flat T[]
} from '@/lib/optimistic';
```

Key behaviors:
- All helpers are no-ops when `data === undefined` (returns `undefined`) — safe to call on unpopulated caches.
- `prependToInfinitePages` preserves extra page-0 fields (`trending`, `window_days` on `FeedPage`).
- Unit tests live in `lib/optimistic.test.ts` — read them as worked examples.

**Snapshot usage:**
```ts
onMutate: async (input) => {
    await qc.cancelQueries({ queryKey: feedKey });
    const { restore } = snapshotInfinite<FeedEntry>(qc, feedKey);
    qc.setQueryData(feedKey, (old) => prependToInfinitePages(old, optimisticRow));
    return { restore };
},
onError: (_err, _input, ctx) => {
    ctx?.restore();
},
```

For multi-cache mutations (e.g. `useCreateEntry` patches 4 caches), collect restores in an array:
```ts
const restores: Array<() => void> = [];
// ... for each cache:
const { restore } = snapshotInfinite(qc, key);
restores.push(restore);
// ...
onError: (_err, _input, ctx) => {
    for (const restore of ctx.restores) restore();
},
```

---

## 6. When Invalidation IS Appropriate

Invalidation is correct in exactly these cases. Scope the key as narrowly as possible.

| Case | Correct scope | Hook example |
|------|--------------|--------------|
| **Server-derived aggregates** the client can't synthesise | Narrow key for the specific aggregate | `atlas.index(tableId)` after `useCreateEntry` — city stats are computed server-side |
| **Cursor-order changes the client can't predict** | Just the paginated key (not the prefix) | Rare; typically only for score-ordered feeds |
| **First-page joins** with display data not in the mutation response | Narrow detail key | `entries.participants(entryId)` after `useAddTake` — avatar/display_name joins aren't in the take response |
| **Follow-list ordering** the server controls | `users.followingAll()` + `users.followListAll()` | `useFollow.onSuccess` — follow-list sort order is server-side |
| **Personal wishlist list** (after add) | `wishlist.personal(userId)` | `useWishlistAdd.onSuccess` |

**Anti-pattern:**
```ts
// BAD — blasts every table-related cache:
onSuccess: () => qc.invalidateQueries({ queryKey: ['tables'] });

// GOOD — only the single table that changed:
onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.tables.detail(tableId) });
```

When you must invalidate in `onSuccess`, always add an explanatory comment:
```ts
// invalidate: atlas city stats are server-derived aggregates the client can't synthesise
qc.invalidateQueries({ queryKey: queryKeys.atlas.index(tableId) });
```

---

## 7. Anti-Patterns Checklist

- **`onSuccess: invalidate(rootAll())`** — guaranteed thundering herd. Use the narrowest possible key.
- **Missing `cancelQueries` in `onMutate`** — a background refetch can land between `onMutate` and `setQueryData`, overwriting the optimistic state immediately.
- **`onMutate` doesn't return `previous`** — `onError` can't restore. Cache stays stuck on the optimistic value forever if the mutation fails. (This was the exact bug in TICKET-036 P0-8.)
- **`onSettled` invalidate that races with `onMutate` patch** — `onSettled` fires after both success and error. If `onMutate` already patched and `onSettled` invalidates the same key, the invalidation triggers a refetch that overwrites the reconciled state with the loading state.
- **Widening the queryKey prefix unnecessarily** — `['users', 'profile']` invalidates all profiles; `queryKeys.users.profile(targetId)` invalidates one.

---

## 8. Lint Rule — Punted

A CI grep that flags `invalidateQueries` inside `onSuccess` blocks was evaluated and **punted** (TICKET-042 architect decision). Reasons:
1. Grep is brittle against multi-line bodies, helper calls, and conditional invalidates.
2. The doc + dual-review protocol covers the regression class adequately.
3. A real solution is an AST-based ESLint rule (`no-blast-invalidate-in-onSuccess`), worth its own ticket if regressions appear.

If you see a blast invalidate slip through review, file a ticket for the ESLint rule rather than fighting the grep.
