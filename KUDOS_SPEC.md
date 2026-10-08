# Kudos Feature — Product and Technical Specification

**Status:** Draft — awaiting explicit stakeholder approval  
**Version:** 1.0  
**Scope:** First release of peer-to-peer kudos in the internal web application  
**Implementation status:** Not started. No feature code, migrations, API, or UI may be implemented until this specification is reviewed and explicitly approved.

## 1. Purpose

Enable an authenticated employee to select a colleague, write a short message of appreciation, and submit it. Display recent kudos in a dashboard feed visible to authorized employees.

“Public” in this specification means visible to authorized users inside the applicable organization or tenant. It does not mean internet-public.

## 2. Goals, non-goals, and scope

### Goals

- Make it easy to recognize one eligible colleague with a short written message.
- Show recent, successfully submitted kudos to authorized dashboard users.
- Integrate with the application's existing identity, authorization, UI, API, and data conventions.
- Protect employee data, prevent abuse, and support reliable operation.

### In scope

- Search and explicitly select one active, eligible colleague from the existing employee directory.
- Submit one plain-text appreciation message.
- Show the sender, recipient, message, and submission time in a newest-first dashboard feed.
- Paginate the feed and provide usable loading, empty, success, validation, and failure states.
- Enforce authentication, authorization, tenant boundaries, validation, and rate limits.
- Provide an authorized, auditable way to remove inappropriate or erroneous content.

### Out of scope for the first release

- Anonymous recognition, reactions, comments, editing, or sender-initiated deletion.
- Attachments, badges, points, leaderboards, rewards, or monetary value.
- Email, chat, or push notifications.
- External or cross-tenant visibility.
- A new employee directory or identity provider.
- A complex moderation workflow beyond the application's established administrative/support process.

## 3. Requirements, defaults, and decisions

This specification is not authorization to build. The categories below distinguish requirements already stated in the feature brief and review request from choices proposed to make implementation concrete and choices that still require stakeholder resolution.

### 3.1 Confirmed requirements

- An app user can select another user from a list, write a short appreciation message, and submit it.
- The main dashboard has a public-to-app-users feed showing recently submitted kudos. “Public” means visible inside the internal app, not on the internet.
- An administrator can hide or delete inappropriate kudos. Moderation actions must be restricted to authorized administrators.
- The user-facing feature must handle empty/whitespace-only messages, messages beyond the allowed length, attempts to give kudos to oneself, spam submissions, inappropriate/abusive content, and duplicate submissions.
- No feature implementation code or database migration is authorized by this specification task. Implementation remains blocked pending explicit approval.

### 3.2 Proposed defaults (not yet approved)

| Area | Proposed default |
|---|---|
| Feed audience | Authenticated employees authorized for the dashboard, scoped to their tenant |
| Recipient eligibility | Active employees in the existing directory; exclude the sender |
| Message limit | 500 Unicode code points after trimming leading/trailing whitespace |
| Duplicate policy | Permit repeated kudos as distinct recognition; prevent accidental retries with a shared idempotency mechanism if available |
| Spam controls | Apply server-side per-actor rate limits; thresholds follow existing platform policy |
| Moderation | Admin may hide or delete; hide is reversible/soft and preserves moderation metadata; delete is permanent only when explicitly permitted by retention/audit policy |
| Feed order and page size | Newest first by `(created_at, id)`; 20 per page, maximum 100 |
| Historical identity display | Follow existing identity strategy; choose live lookup versus approved snapshots before schema design |
| Retention/account deletion | Follow approved employee-data retention, legal-hold, export, and deletion policies |
| Performance objectives | Proposed p95: feed/create under 500 ms; recipient search under 300 ms, excluding external identity-provider latency |

### 3.3 Unresolved stakeholder decisions

- Approve or change the proposed feed audience, tenant/department scope, recipient eligibility, and self-kudos prohibition.
- Approve the message-length limit and the exact Unicode counting rule.
- Decide whether semantically repeated kudos are allowed, or whether any sender/recipient/time-window duplicate restriction is needed. Idempotent transport retries are separate from this policy.
- Set numeric spam/rate-limit thresholds and determine whether additional abuse detection or automated content filtering is appropriate.
- Define administrator roles, whether hide and permanent delete are both available at launch, deletion/retention rules, required moderation reason handling, and audit retention.
- Choose live identity lookup or display-name snapshots and decide behavior for renamed/deactivated/deleted users.
- Confirm retention, privacy, legal-hold, and account-deletion behavior.
- Confirm numeric performance objectives against the app's baselines and operating environment.

If the app is single-tenant, tenant fields and filters may follow its established model. Otherwise, every lookup, write, read, moderation action, cache key, and cursor must be tenant-scoped. Do not treat an unresolved decision as permission to make an irreversible choice.

### Approval required before implementation

Implementation is blocked until the product owner explicitly approves the confirmed scope and proposed defaults or records replacements, and the relevant security/privacy and engineering reviewers accept the unresolved decisions. Record approvals and final decisions in this document. Approval does not waive normal code review, security review, or release controls.

## 4. User stories

- **US-01 — Find a colleague:** As an authenticated employee, I want to search for and select a colleague so I can address recognition to the correct person.
- **US-02 — Give kudos:** As an authenticated employee, I want to write a short appreciation message and submit it so that my recognition is recorded.
- **US-03 — Confirm submission:** As a sender, I want clear confirmation after a successful submission so I know it was saved.
- **US-04 — Read the feed:** As an authorized dashboard user, I want to see recent kudos with sender, recipient, message, and time so I can share in colleagues' recognition.
- **US-05 — Browse history:** As a feed reader, I want to load older entries without fetching the entire history so the dashboard remains responsive.
- **US-06 — Moderate content:** As an authorized administrator, I want to hide or delete inappropriate kudos, with the action restricted to authorized admins and recorded for audit, so the feed remains appropriate.
- **US-07 — Recover from failures:** As a sender or feed reader, I want understandable, recoverable error states so temporary failures do not cause data loss or duplicate submissions.
- **US-08 — Prevent and handle abuse:** As an administrator and feed user, I want spam and abusive submissions to be constrained and removable so the feed remains useful and safe.

## 5. Functional requirements

### 5.1 Recipient search and selection

- **FR-01:** Reuse the existing employee directory/search capability and its authorization contract. Do not create a competing identity source.
- **FR-02:** Search only active, eligible employees in the caller's permitted tenant/scope. Exclude the caller if self-kudos is prohibited.
- **FR-03:** Return only the minimum approved fields needed to identify a result, such as stable user ID and display name. Do not expose email or other personal data unless approved and required to disambiguate.
- **FR-04:** Require explicit selection of one returned result. Free-form text is not a recipient selection.
- **FR-05:** Apply the directory's minimum query length and debounce conventions; bound query length and result count on the server.
- **FR-06:** Revalidate recipient existence, active status, eligibility, and scope on submission. A result shown earlier is not authorization to submit later.

### 5.2 Submission

- **FR-07:** Accept exactly one recipient ID and one message. Derive sender and tenant from the trusted server-side authentication context; ignore/reject client-supplied sender or tenant identity.
- **FR-08:** Trim leading/trailing whitespace, reject a whitespace-only message, and enforce the approved maximum length. Proposed maximum: 500 Unicode code points after trimming. Enforce compatible request-body limits.
- **FR-09:** Preserve valid Unicode and punctuation. Treat the message as plain text; do not interpret HTML or Markdown.
- **FR-10:** Persist the record transactionally and return success only after commit. Return the canonical record, including server-generated ID, sender/recipient identities, and UTC creation time.
- **FR-11:** Prevent duplicate creation from repeated clicks and retries of the same operation. Disable submission while a request is in flight and use the existing idempotency mechanism if available. If idempotency is adopted, the same actor/key/payload returns the original result; reuse of the key with a different payload conflicts. This protects transport retries and does not decide whether two intentionally repeated kudos are allowed; apply the separately approved semantic duplicate policy.
- **FR-12:** Do not provide sender edit/delete operations in the first release.
- **FR-13:** Apply configured per-actor rate limits to submission. Return retry guidance where supported.

### 5.3 Dashboard feed

- **FR-14:** Show the newest visible kudos first with sender, recipient, message, and a localized or relative timestamp.
- **FR-15:** Restrict feed data to authenticated, authorized users and the applicable tenant/scope. Never accept a client-selected tenant as authority.
- **FR-16:** Paginate using an opaque cursor and stable `(created_at, id)` ordering. Bound page size; proposed default is 20 and maximum is 100.
- **FR-17:** Return an explicit empty state when there are no visible entries. Provide an incremental “load more” or the established equivalent; do not fetch unbounded history.
- **FR-18:** Make a newly submitted item visible in the feed after successful creation without a full page reload, using the established client data-refresh pattern without duplicate insertion.
- **FR-19:** Do not include hidden or deleted messages in normal feed responses. The feed omits hidden/deleted items rather than exposing their message or moderation reason.

### 5.4 Moderation

- **FR-20:** Authorized administrators must be able to hide or delete inappropriate kudos. Moderation actions are denied unless the authenticated principal has the explicit administrative permission.
- **FR-21:** Hiding sets `is_visible` to false and retains the kudos and moderation metadata. The feed must omit hidden content.
- **FR-22:** Deletion is a distinct administrative action. Apply the approved retention/audit policy; where physical deletion is allowed, preserve the required audit record outside the deleted kudos row. Do not use a soft hide as a success-shaped response for a requested delete.
- **FR-23:** Require and validate a moderation reason unless policy explicitly waives it. Record the moderator, action time, and reason in the approved audit record; never display the reason in the public feed.
- **FR-24:** Do not expose moderation actions to ordinary users or a sender-initiated delete endpoint.
- **FR-25:** Apply server-side spam controls. The initial proposal is rate limiting; any automated content classification/filtering requires separate approval and must have safe handling for false positives.

## 6. Acceptance criteria

- **AC-01:** An authenticated employee can search eligible colleagues, explicitly select one, enter a valid message, submit, and receive a success confirmation.
- **AC-02:** The persisted sender and tenant are taken from the authenticated server context, even if a request attempts to forge either value.
- **AC-03:** A nonexistent, inactive, out-of-scope, or otherwise ineligible recipient is rejected without creating a kudos record. The response does not leak whether an unauthorized user exists.
- **AC-04:** Self-kudos is rejected at the API when the approved policy prohibits it, even if the UI is bypassed.
- **AC-05:** Empty/whitespace-only and over-limit messages are rejected with stable field-level validation feedback; valid Unicode round-trips intact.
- **AC-06:** A successful submission is persisted once, and the response/feed show the canonical sender, recipient, text, and server timestamp.
- **AC-07:** The dashboard feed is newest-first, tenant/scope-correct, bounded, and cursor-paginated. Equal timestamps do not cause duplicates or omissions across pages.
- **AC-08:** New entries arriving while a reader paginates do not corrupt the stable cursor sequence.
- **AC-09:** Unauthenticated or unauthorized callers cannot search, create, read, or moderate beyond their grants.
- **AC-10:** Rate limits are enforced and communicated. If idempotency is enabled, retrying the same key and payload cannot create a second record; a changed payload with the same key conflicts.
- **AC-11:** Loading, empty, success, validation, network, server, and rate-limit states are accessible and distinguishable. Recoverable failures preserve the draft.
- **AC-12:** Hidden and deleted content is not returned in the public feed; moderation is restricted and auditable.
- **AC-13:** Logs, traces, analytics, and error responses do not expose message bodies, secrets, or unnecessary personal data.
- **AC-14:** Migration, constraints, indexes, rollback/disable behavior, and staged deployment are verified without requiring destructive data loss.
- **AC-15:** A user without the explicit admin permission cannot hide or delete kudos, including by directly calling the API.
- **AC-16:** An authorized admin can hide a kudos item; the feed then omits it and moderation metadata is recorded. When permanent deletion is approved and enabled, an authorized admin can delete it and the required audit event is recorded before the row is removed.
- **AC-17:** Moderation reason, actor, timestamp, and action are recorded as required by policy, remain private, and are available only through authorized audit/admin workflows.
- **AC-18:** Spam attempts are bounded by server-side controls and do not bypass limits by changing client state or directly invoking the API.
- **AC-19:** Exact duplicate-policy behavior is tested once approved; accidental transport retries do not create duplicate records when idempotency is enabled.

## 7. Edge cases and expected behavior

| Case | Expected behavior |
|---|---|
| Search query is empty, too short, too long, or contains unusual Unicode | Apply directory conventions and server bounds; return validation or no results without an unbounded search |
| Two employees have similar names | Require selection from results and use only an approved disambiguator |
| Recipient is deactivated, deleted, or moved out of scope after search | Revalidate at submission; reject safely without persistence |
| User attempts to give kudos to themselves | Reject server-side if the approved policy disallows self-kudos; never rely only on excluding the user in the UI |
| Message is empty or whitespace-only | Reject with a field-level validation error; do not persist |
| Message contains leading/trailing whitespace | Trim before length validation and storage |
| Message exceeds the allowed length | Reject with a field-level error and the approved limit; do not silently truncate |
| Message is at the length boundary or includes supplementary Unicode characters | Count consistently using the approved rule on server and client; test boundary values |
| Message resembles HTML, script, or Markdown | Store as text and render with contextual output encoding; never execute or interpret it |
| Client double-clicks or request times out after server commit | Disable while pending; if idempotency is enabled, retry using the same key and receive the original result |
| Same idempotency key is reused with a changed payload | Return conflict; do not create a second record |
| User submits spam or exceeds the submission rate | Apply server-side rate limits/approved abuse controls; return retry guidance and record privacy-safe operational signals |
| Submitted content is inappropriate or abusive | Content is treated as untrusted text; authorized admins can hide or delete it under the approved process; moderation reason is not public |
| User intentionally submits the same kudos more than once | Apply the stakeholder-approved semantic duplicate policy; do not confuse valid repeated kudos with duplicate network retries |
| Feed is empty or an item is removed during pagination | Return an empty page/next cursor safely; removed text is not disclosed |
| Multiple records have identical timestamps | Use unique ID as deterministic tie-breaker |
| Cursor is malformed, tampered with, expired, or incompatible with filters | Reject with a safe client error; client restarts pagination rather than looping |
| User loses authentication or authorization while composing/reading | Follow the app's reauthentication/access-denied behavior; do not silently discard a draft |
| Directory, database, or network dependency is unavailable | Fail closed for writes and recipient validation; do not claim success or fabricate identities; offer retry for reads |
| Rate limit is exceeded | Return 429 (or app-standard equivalent) and a safe retry interval where available |
| User leaves organization or requests deletion/export | Follow approved retention and privacy policy; do not cascade-delete records unintentionally |
| Hide/delete is attempted by an ordinary user or without a required reason | Deny unauthorized action; validate reason; audit accepted and denied attempts according to policy |

## 8. Technical design

### 8.1 Architecture

Use the host application's established layers:

`Dashboard UI → authenticated API → authorization/validation/service → relational persistence`

Recipient lookup delegates to the existing employee-directory abstraction. The service derives actor and tenant from the server-side principal, validates the recipient within the same permitted scope, enforces policy/rate limits, and persists the record. The feed query applies authorization and tenant/scope filters before cursor pagination. Use existing frameworks, data-access patterns, migration tools, error envelopes, and observability.

### 8.2 Create flow

1. Client searches the existing directory and commits an explicit recipient selection.
2. Client submits recipient ID and message over the existing authenticated transport. Include an idempotency key only if supported and approved.
3. API authenticates the caller, applies CSRF protection where relevant, applies authorization and rate limits, validates payload and recipient, and derives sender/tenant from trusted context.
4. Service transactionally inserts the kudos and any idempotency record. On failure, roll back and return a safe error.
5. After commit, return the canonical resource. Client shows success, clears the form, and inserts that resource or refreshes the first feed page using the established data layer.

### 8.3 Read flow

1. Client requests a bounded feed page.
2. API authenticates and authorizes the caller, applies tenant/scope and `is_visible = TRUE` filters, validates the opaque cursor, and queries by `(created_at DESC, id DESC)`.
3. Resolve sender/recipient names using the approved identity strategy without N+1 requests.
4. Return items and a next cursor when more visible results exist. Client can retry a failed read or restart from page one for an invalid cursor.

### 8.4 Identity and consistency

- Persist stable user IDs. Resolve display names live if that is the application's normal approach; otherwise snapshot only approved minimum fields. The choice and renamed/deactivated-user behavior must be approved before migration.
- Use deliberate foreign-key deletion behavior. Do not cascade-delete recognition history accidentally; align employee deletion/anonymization with privacy policy.
- Generate `created_at` using the server/database in UTC; format for the viewer's locale.
- Any feed cache must be authorization-safe and partitioned by tenant/scope and relevant access context; default to the application's existing private/no-cache behavior.

## 9. Database schema

The following is a logical schema, not a migration script. Adapt names and native types to the host application's ORM, database, tenant model, and identity strategy.

### `kudos`

| Column | Logical type | Required constraints and purpose |
|---|---|---|
| `id` | Existing standard ID type (UUID if conventional) | Primary key |
| `tenant_id` | Existing tenant ID type | Not null when multi-tenant; derived from principal |
| `sender_user_id` | Existing user ID type | Not null; FK to user identity; derived from principal |
| `recipient_user_id` | Existing user ID type | Not null; FK to user identity; eligible at creation |
| `message` | Bounded text/varchar | Not null; trimmed; approved maximum |
| `created_at` | Timestamp with time zone | Not null; server-generated UTC |
| `is_visible` | `BOOLEAN` | `NOT NULL DEFAULT TRUE`; false when hidden by an authorized moderator |
| `moderated_by` | Nullable existing user ID type | Admin identity for the latest hide action; FK per local convention |
| `moderated_at` | Nullable timestamp with time zone | Server-generated UTC time for the latest hide action |
| `reason_for_moderation` | Nullable text | Private reason recorded for the latest moderation action; never included in feed responses |

Constraints and indexes:

- Enforce non-empty trimmed message and the approved length in application validation and in the database where supported.
- Enforce consistent moderation metadata: when `is_visible = FALSE`, `moderated_by`, `moderated_at`, and `reason_for_moderation` must be populated according to the approved reason policy. For visible records, clear moderation metadata only if an approved restore/unhide operation is introduced.
- Normal feed queries must filter to `is_visible = TRUE`.
- The fields above represent retained hide state. A physical delete removes the kudos row, so record the authorized delete action, actor, timestamp, and reason in the established audit store before deleting; do not imply that deleted-row metadata remains in `kudos`.
- Apply foreign keys and tenant relationship constraints appropriate to the existing identity model. Choose `RESTRICT` or a reviewed anonymization/deletion policy; avoid accidental cascades.
- Feed index: `(tenant_id, created_at DESC, id DESC)` for multi-tenant deployments; omit `tenant_id` only in a confirmed single-tenant schema.
- Add `(tenant_id, recipient_user_id, created_at DESC)` only if an approved recipient view or moderation query needs it.
- Do not add sender/recipient uniqueness unless a specific duplicate window is approved and can be enforced transactionally with a defined time basis.

### Idempotency (conditional)

Prefer the shared application mechanism. If none exists and idempotency is approved, store a unique `(tenant_id, actor_user_id, idempotency_key)` with a request hash, resource ID/response reference, and creation/expiry times. Scope keys to the actor and tenant; same key with a different request hash returns conflict. Define finite retention (24 hours is a proposal, not a decision) and safe cleanup. Do not log/store a second copy of message text unnecessarily.

### Migration and rollback

Use an additive migration for the table, constraints, and indexes. No backfill is expected. Deploy the schema before application code that uses it. On rollback, disable the feature or roll back application code and leave submitted data intact. Dropping the table is a separate, explicitly approved destructive operation after privacy/retention review.

## 10. API endpoints

Routes below are proposals; reuse existing endpoint paths, API versioning, authentication, naming, and error conventions where available.

### Recipient search

`GET /api/v1/users/search?q={query}&limit={limit}`

- Prefer the existing directory endpoint; add no duplicate endpoint if it already meets the requirements.
- Requires authentication and directory-read authorization.
- Enforces query length, result maximum, active/eligible status, and tenant scope.
- Returns only approved selection fields, for example:

```json
{
  "items": [
    { "id": "user-id", "displayName": "Display Name" }
  ]
}
```

### Create kudos

`POST /api/v1/kudos`

- Requires authentication, submit permission, applicable CSRF protection, and rate-limit checks.
- Request body contains only:

```json
{
  "recipientUserId": "user-id",
  "message": "Thank you for your help."
}
```

- Sender and tenant fields are not accepted as authoritative input. Reject unknown fields if that is the application's standard.
- Optional `Idempotency-Key` header if the mechanism is adopted.
- Success: `201 Created`, with canonical item and server-generated timestamp.
- Errors follow the standard envelope. Expected semantics: `400` malformed request, `401` unauthenticated, `403` unauthorized, `404` recipient unavailable where non-disclosure permits, `409` idempotency conflict, `413` oversized body, `422` field/policy validation (or app-standard equivalent), `429` rate limited, `500` unexpected failure.

### Read feed

`GET /api/v1/kudos?limit={limit}&cursor={opaqueCursor}`

- Requires authentication and feed-read permission.
- Enforces server-derived tenant/scope; no client-selected tenant filter.
- Returns newest-first records where `is_visible = TRUE`; hidden or deleted content is never exposed.
- Proposed response:

```json
{
  "items": [
    {
      "id": "kudos-id",
      "sender": { "id": "sender-id", "displayName": "Sender" },
      "recipient": { "id": "recipient-id", "displayName": "Recipient" },
      "message": "Thank you for your help.",
      "createdAt": "2026-10-08T09:00:00Z"
    }
  ],
  "nextCursor": "opaque-or-null"
}
```

- Cursor is opaque, validated, and bound to stable ordering and relevant scope/filter contract. Expected errors: `400` invalid cursor/limit, `401`, `403`, `429`, `500`.

### Administrative removal

Prefer the established moderation API and audit system. If new routes are necessary, propose:

- `POST /api/v1/admin/kudos/{id}/moderation` with `{ "action": "hide", "reason": "..." }` to set `is_visible = FALSE` and populate `moderated_by`, `moderated_at`, and `reason_for_moderation`.
- `DELETE /api/v1/admin/kudos/{id}` with a policy-approved reason payload to permanently delete only when permitted. Record the delete action, actor, timestamp, and reason in the established audit store before removing the row.

Both operations require explicit administrative permission, tenant/scope checks, a valid reason when required, and audit logging. They must not be available to ordinary employees. Do not expose moderation reasons in feed responses. If permanent deletion is not approved, disable that operation and use hide.

### Error response contract

Use the established error envelope. Validation responses include stable machine-readable codes and safe field-level messages. Never return stack traces, SQL details, secrets, or existence information that leaks unauthorized directory identities. Include a correlation/request ID when the application supports it.

## 11. Frontend components and behavior

- **Dashboard Kudos Feed:** bounded newest-first list with loading skeleton/state, empty state, retryable error, and load-more control or established pagination pattern.
- **Kudos Feed Item:** sender, recipient, plain-text message, and localized timestamp; profile links only if already permitted and accessible.
- **Give Kudos Form:** labeled recipient combobox, message textarea, visible character count, validation, and submit control. A selected recipient is a committed canonical result, not matching free text.
- **Recipient Search Results:** keyboard-operable listbox with loading, no-match, and retryable error states; expose only approved identity fields.
- **Submission Feedback:** accessible success announcement and actionable validation/network/rate-limit errors. Preserve a draft after recoverable failure; clear it only after confirmed success.
- **Admin Moderation Controls:** visible only to authorized administrators, with separate hide and delete actions, a required reason field when policy requires it, an explicit confirmation for permanent deletion, and accessible success/error feedback. UI visibility is convenience only; the API must authorize every action.
- **Feed refresh integration:** add the canonical response or invalidate/refetch the first page; do not optimistically and subsequently render duplicate copies.

Accessibility and responsive behavior: follow the existing design system and localization conventions; use semantic labels, keyboard-only operation, visible focus, sufficient contrast, and screen-reader status announcements. Do not rely on color alone. On validation failure, focus or announce the first relevant error predictably.

## 12. Authentication and authorization

- Require the application's established authentication for directory search, create, feed read, and moderation.
- Enforce permission at every endpoint and in the service/data-access path; hiding controls in the UI is not authorization.
- Require an explicit administrative permission for hide and delete; ordinary users, including the kudos sender, cannot moderate unless separately granted that admin permission.
- Derive actor and tenant from trusted server-side claims/session. Never trust body, query, or cursor fields to select the caller or expand scope.
- Validate both sender and recipient against permitted tenant/scope. Prevent cross-tenant reads, writes, and moderation.
- Use a narrowly scoped admin permission for content moderation. Deny by default when role or tenant resolution is unavailable; apply object-level scope checks to the kudos being moderated.
- Apply the application's CSRF protection for cookie-authenticated writes and its standard session/token protections.

## 13. Security and privacy considerations

- Treat message content as untrusted input. Validate size and shape server-side; use parameterized queries/ORM; store and render as plain text with contextual output encoding.
- Do not enable raw HTML or unsafe Markdown rendering. Test stored-XSS payloads in every feed rendering surface.
- Enforce authentication, object-level authorization, tenant isolation, and recipient eligibility on the server to prevent IDOR and enumeration.
- Bound search input, result count, body size, cursor size, page size, and request time. Use opaque cursors with integrity validation where appropriate.
- Apply actor-based rate limiting and, where appropriate, secondary abuse controls. Do not rely on client throttling.
- Treat spam and abusive content as user-generated content: enforce server-side submission limits, provide the approved admin hide/delete path, and do not add automated content classification without stakeholder approval and false-positive handling.
- Protect moderation reason and audit details as private administrative data. A user with feed-read access must not gain access to moderation metadata.
- Require confirmation and explicit authorization for permanent deletion; audit the action before destroying the row.
- Protect cookie-based writes from CSRF; require secure transport and use existing secure session/token handling.
- Exclude messages, tokens, and unnecessary personal data from logs, traces, analytics, URLs, and error reports. Avoid including message content in idempotency hashes' logs or metric labels.
- Scope caches to authorization context; never use a shared cache that can cross tenant or permission boundaries.
- Establish acceptable-use guidance and an authorized removal process before enabling public feed visibility.
- Apply approved rules for retention, legal holds, employee departure, account deletion/anonymization, and data export. Limit moderator access and audit privileged actions.

## 14. Performance and reliability

- Use indexed keyset pagination, bounded projections/results, and stable ordering. Avoid loading the full history.
- Resolve sender and recipient identities in a batch/join or approved bounded cache; avoid N+1 directory calls. Define cache freshness/invalidation if names are cached.
- Debounce client search and enforce server query/result limits. Reuse directory search infrastructure.
- Set request and database timeouts using host-app standards. Keep the write transaction short.
- Proposed initial objectives, subject to baseline confirmation: feed first page and create p95 below 500 ms; recipient search p95 below 300 ms, excluding external identity-provider latency.
- Load-test at agreed expected peak and verify query plans/index use. Do not add partitioning absent measured scale need.
- Monitor latency, error rates, throttling, and database load without collecting message bodies.
- Do not claim success until the write commits. On dependency failure, fail closed for writes and recipient verification.

## 15. Error handling, logging, and observability

| Condition | API behavior | UI/operations behavior |
|---|---|---|
| Invalid recipient/message | Stable field-level validation response; no write | Preserve draft, show actionable inline feedback, focus/announce error |
| Unauthenticated/expired session | App-standard 401/reauth behavior | Preserve draft when possible; follow standard reauthentication flow |
| Unauthorized/out-of-scope | Safe 403/404 behavior without identity leakage | Show access message; do not retry indefinitely |
| Non-admin attempts moderation | Deny with the standard safe authorization error; record security-relevant audit/telemetry without message content | Do not display moderation actions; if a request is denied, show a safe error |
| Invalid/missing moderation reason | Return field-level validation error; perform no action | Preserve reason draft and explain the requirement |
| Hide succeeds | Persist `is_visible = FALSE` and moderation metadata | Remove the item from feed immediately/refetch; announce completion |
| Delete is unavailable or denied by policy | Return the standard authorization/policy error; do not silently hide instead | Explain that permanent deletion is unavailable |
| Delete succeeds | Audit actor, time, target, and reason before deleting the kudos row | Remove item from feed and confirm permanent removal |
| Rate limited | 429 or standard equivalent; `Retry-After` when supported | Explain wait and honor retry interval |
| Network timeout/unknown create result | Do not create a success-shaped response | Retry with same idempotency key if enabled; otherwise explain uncertainty and check feed before resubmission |
| Invalid/stale cursor | Safe 400 or standard client error | Restart from first page; prevent retry loops |
| Directory/database outage | Fail closed for create; safe server error | Retryable feed/search state; no fabricated identities or false success |
| Unexpected server error | Generic response plus correlation ID where supported | Preserve draft; log structured diagnostic without message body |

Use structured operational events for request ID, endpoint, outcome/error code, duration, tenant-safe aggregate dimensions, and actor/rate-limit identifiers only as permitted by policy. Never log message bodies or credentials. Audit admin hide/delete actions with moderator, item reference, action, time, and approved reason handling; audit denied moderation attempts where policy requires. Keep reasons out of ordinary application logs and public responses. Define alert thresholds with operations before rollout.

## 16. Testing strategy

### Unit tests

- Trimming, empty/length validation, Unicode boundary counting, payload validation, and plain-text serialization.
- Recipient active/eligible/same-tenant checks and approved self-kudos policy.
- Spam/rate-limit behavior and the approved semantic duplicate policy separately from idempotent request retries.
- Cursor encode/decode/validation, deterministic ordering, scope binding, and pagination edge cases.
- Rate-limit and idempotency decisions; safe handling of key reuse.
- Hide/delete state transitions, required reason validation, moderation metadata invariants, visibility filtering, and identity resolution for renamed/deactivated/unavailable users.

### API and integration tests

- Successful creation derives actor/tenant from auth context and persists exactly one record.
- Forged sender/tenant values cannot alter identity or scope.
- Invalid, inactive, self, nonexistent, and cross-tenant recipients are rejected without persistence.
- Message boundary, Unicode, malformed payload, oversized request, and stable error envelope behavior.
- Unauthorized access to every endpoint; tenant isolation for reads, writes, recipient search, and moderation.
- Ordinary users cannot hide/delete; authorized admins can hide and can delete only when policy permits; reason/audit behavior is verified.
- Feed ordering by `(created_at, id)`, equal timestamps, cursor pagination under concurrent inserts, `is_visible` filtering, and bounded limits.
- Idempotent retry and changed-payload conflict if enabled; rate limits; CSRF where applicable.
- Database outage, transaction rollback, and no partial kudos/idempotency record.
- Migration from the previous schema, constraint/index behavior, and rollback/disable procedure.

### Frontend tests

- Combobox search, keyboard navigation/selection, disambiguation, no-result and failure states.
- Required selection, trimming, character count, exact length boundary, validation focus/announcement, disabled pending state, and success reset.
- Draft preservation across recoverable errors and behavior after uncertain create result.
- Feed loading/empty/error states, pagination, new item refresh, removed item behavior, and no duplicate rendering.
- Admin moderation controls are absent for non-admins; hide/delete confirmation, reason validation, success/error feedback, and immediate feed removal are tested for admins.
- Accessibility checks for labels, focus order, keyboard use, status announcements, contrast, and responsive layout.

### End-to-end, security, and non-functional tests

- One authenticated employee submits and sees kudos; another authorized employee in the same scope reads it; unauthorized and cross-tenant users cannot.
- Verify stored-XSS payload rendering, CSRF where applicable, authorization bypass, identifier/tenant tampering, enumeration, oversized inputs, and cursor tampering.
- Verify spam throttling, abusive-content admin handling, unauthorized moderation denial, moderation-reason privacy, and permanent-delete audit ordering.
- Run automated accessibility checks plus targeted keyboard/screen-reader review.
- Load-test feed, search, and write bursts at agreed peak; verify proposed latency targets and database query plans.
- Verify logs/traces/analytics contain no message text or secrets.
- Exercise feature-disabled, staged rollout, application rollback, and data-preservation behavior in staging.

## 17. Deployment and operations

1. Confirm approval, unresolved product/security/privacy decisions, numeric rate limits, retention, and operational ownership before implementation is considered release-ready.
2. Deploy additive, backward-compatible database migration before application code that depends on it.
3. Deploy API and UI with the feature disabled; verify health checks, permissions, directory integration, query plans, and telemetry.
4. Enable for an internal pilot or controlled cohort using the existing feature-flag mechanism if available.
5. Validate tenant boundaries, recipient and duplicate policies, spam controls, admin-only hide/delete behavior, moderation audit/reason handling, accessibility, and support readiness during the pilot.
6. Expand availability only after agreed acceptance criteria and operational gates pass.
7. Monitor feed/create/search latency, error rates, throttling, database saturation, usage, and support reports. Alert without message-body collection.
8. On rollback, disable the feature or roll back application code while retaining the additive schema and submitted records. Destructive cleanup requires separate approval and retention review.

Document feature ownership, support contact, moderation procedure, retention behavior, alert response, and rollout/rollback controls before general availability. Ensure mixed frontend/API versions remain compatible during staged deployment.

## 18. Step-by-step implementation plan (after approval only)

1. **Resolve decisions:** Inspect the actual app and confirm identity/directory, auth and tenant model, API conventions, database/migrations, frontend stack/design system, caching, rate limiting, duplicate policy, spam controls, moderation roles/actions/reasons, retention, and operational ownership. Record approved decisions in this document.
2. **Design validation:** Have product, engineering, security, and privacy reviewers sign off on final behavior, schema identity strategy, admin-only hide/delete flow, reason/audit handling, error contracts, limits, and performance objectives.
3. **Plan additive persistence:** Design the table including `is_visible BOOLEAN NOT NULL DEFAULT TRUE`, `moderated_by`, `moderated_at`, and `reason_for_moderation`, plus foreign keys/deletion behavior, constraints, indexes, and conditional idempotency using local conventions. Review migration and rollback in a disposable environment.
4. **Implement server behavior:** Reuse/extend directory search; implement create service/API, feed API filtering `is_visible = TRUE`, and admin-only hide/delete operations. Enforce authentication, object/tenant authorization, message validation, spam/rate limits, approved duplicate policy, stable cursor pagination, moderation reasons/audits, and idempotency if approved.
5. **Implement UI:** Add the form, recipient selection, dashboard feed, pagination, refresh behavior, accessible admin moderation controls, reason capture/confirmation, and all loading, empty, validation, success, and recoverable error states.
6. **Add operations:** Add privacy-safe structured metrics, alerts, feature gating, moderation audit retention, and documented admin/support procedures.
7. **Verify:** Execute unit, API/integration, frontend, end-to-end, migration, security, accessibility, and performance tests, including spam, duplicate, self-kudos, abusive content, and unauthorized moderation cases. Fix regressions and obtain normal code/security review.
8. **Stage and release:** Deploy schema and app disabled, validate staging, pilot behind a flag or controlled cohort, confirm moderation authority and audit behavior, assess monitoring/support signals, and expand only after release gates pass.
9. **Operate and review:** Monitor service health and abuse indicators, respond through the approved admin process, and revisit retention/performance decisions using production evidence.

**No step above authorizes implementation before the approval gate in Section 3 is satisfied.**

## 19. Definition of done

The feature is ready to enable only when:

- Required stakeholder decisions are resolved and this specification is explicitly approved.
- All applicable acceptance criteria pass.
- Authorization, tenant isolation, content rendering, rate limits, and moderation controls are reviewed.
- Migration, indexes, rollback/disable behavior, and data preservation have been exercised.
- Accessibility, performance, logging/privacy, and operational requirements meet approved standards.
- Support ownership, retention, moderation, alerting, and rollout/rollback procedures are documented.
- The feature can be disabled or rolled back without unintended loss of submitted records.
