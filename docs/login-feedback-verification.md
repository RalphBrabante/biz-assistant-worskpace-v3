# Login feedback verification (issue #3)

## Behavior
- Valid submissions show Signing in… plus a decorative spinner immediately. A persistent polite status region announces pending work; the form exposes aria-busy.
- A synchronous component guard prevents repeated form/keyboard submissions, not only button clicks. The Angular form's validity is checked on submission; required inputs and existing autocomplete are preserved.
- Credentials become read-only while pending. Pending feedback stays active through the login response, session validation and router navigation, rather than disappearing when HTTP completes.
- Credential/network/missing-token/null-body and rejected/cancelled navigation failures unlock retry and show an alert. Organization-selection continuation retains its own visible pending/error feedback and submission guard.

## Automated evidence
Run with the repository's supported Node 22:

```sh
npm test
npm --prefix api run build
npm --prefix client run build
git diff --check
```

504 tests passed (494 existing + 10 executable login component regression tests). API TypeScript and Angular production builds passed. Login tests transpile and execute the actual component using controlled RxJS Subjects and router promises, following existing repository test conventions. They cover invalid submission, immediate pending/duplicate guard, slow HTTP and navigation, success, failure/retry, malformed responses, navigation rejection/cancellation/redirect, and organization continuation. Four additional null/absent-body cases first failed against the reviewed head with pending stuck and RxJS unhandled errors, then passed after null-safe top-level response access. HttpClient represents an empty successful body (including 204) and JSON null as null; undefined also covers an absent adapter body. Both ordinary login and organization continuation now show the appropriate error, unlock retry, avoid session writes on the invalid response, and preserve pending/duplicate guards through successful retry navigation. Targeted login/session tests passed 16/16.

## Browser reproduction and current limitation
A no-dependency fixture is provided at scripts/login-feedback-preview.cjs. It serves the production client on 127.0.0.1:4313 with synthetic API responses; it does not connect to the real API, database, production, or any external service. Run it after building the client:

```sh
node scripts/login-feedback-preview.cjs
```

Open http://127.0.0.1:4313/login. Use synthetic@example.test and any nonempty password: "success" returns a synthetic token, other passwords fail. Login and session-validation responses each take three seconds. While pending, try repeated clicks and Enter; GET /__fixture/stats reports the number of login requests. Confirm pending status persists for both three-second phases on success, an error appears and retry works on failure, and empty fields do not submit. Inspect role=status, role=alert, aria-busy and read-only input state.

Browser availability was verified (managed Chrome CDP/page ready), but navigation to the localhost fixture was explicitly blocked by browser policy. No policy changes or bypass were attempted. Browser UI flows, visual screenshots, and actual screen-reader announcements remain unverified; automated component tests are not a substitute for these checks. The initial preview launch encountered an unavailable companion response; a subsequent listener check found no process on 4313. On the requested retry the fixture started, but localhost browser navigation was again explicitly blocked by policy, despite the managed browser being ready and the parent confirming external navigation works. The fixture was stopped after verification. No service was left running. No Docker services were started and no dependencies were added.
