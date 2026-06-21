# Security

This document records the OWASP-oriented security review of **Reclaim**, the fixes applied,
the residual/accepted risks, and the checklist for a hardened production deployment. It
assumes a strong attacker model: **the attacker has the full source code** and can reach any
exposed port.

> TL;DR — the headline issues were a shipped default JWT secret, hardcoded admin credentials,
> and stored XSS in the admin panel that chained to full account takeover. All three are
> fixed, along with a broad set of hardening changes. Before deploying, work through the
> [Production hardening checklist](#production-hardening-checklist).

---

## 1. Scope & architecture recap

Four services (see [ARCHITECTURE.md](ARCHITECTURE.md)):

| Service | Tech | Exposure | Trust |
| :--- | :--- | :--- | :--- |
| `backend-api` | Java 25 / Spring Boot 4 | `:8080` REST | owns auth, RBAC, the DB |
| `ml-service` | Python / FastAPI | `:8000` REST | stateless model server, **no auth** |
| `frontend` | static HTML + vanilla JS | `:5500` / `:7001` | runs in the user's browser |
| `data-engine` | Python ETL + AOP scraper | offline / scheduled | writes Postgres |

Auth is intentionally dependency-free: PBKDF2 password hashing, a hand-rolled HS256 JWT, and
a servlet filter that loads the caller into a per-request `CurrentUser`. The whole entitlement
policy lives in `security/Features`.

---

## 2. What an attacker can and cannot do

- Auth is a **stateless bearer JWT** sent in the `Authorization` header (never a cookie), so
  classic CSRF does not apply — a cross-site page cannot make the browser attach the token.
- There is **no SQL injection surface**: the Java layer uses Spring Data derived queries and a
  single parameterized `JdbcTemplate` query; the Python layer uses psycopg2 parameter binding
  (`execute_values`). No string-built SQL anywhere.
- There is **no command injection**: the only `ProcessBuilder` (the Radar force-scrape) runs a
  fixed argument vector with no user input.
- The JWT verifier ignores the token's `alg` header and always recomputes HMAC-SHA256, so the
  `alg:none` / algorithm-confusion class does not apply.

---

## 3. Findings and fixes

Severity uses the usual scale. Every **Critical/High/Medium** item below is **fixed**; Low/Info
items are either fixed or documented as accepted with rationale.

### 3.1 Critical

| # | Finding | OWASP / CWE | Fix |
| :-- | :--- | :--- | :--- |
| C1 | **Shipped default JWT secret.** `JwtUtil` fell back to a constant key baked into the source; `application.yml` never overrode it. With the source, an attacker forges a token for any `sub` (e.g. the seeded admin, id 1) → full auth bypass. | A02 Cryptographic Failures / A07 / CWE-321 | Secret now comes only from `APP_AUTH_JWT_SECRET`. **No default.** Blank ⇒ a random per-process key (safe failure: tokens reset on restart, never forgeable); a key `< 32` bytes **fails startup**. |
| C2 | **Hardcoded admin credentials** (`admin@gmail.com` / `P4$$w0rd!`) in source + README → known login on every deployment. | A07 Identification & Auth / CWE-798 | `AdminSeeder` reads `APP_ADMIN_EMAIL` / `APP_ADMIN_PASSWORD`. Blank password ⇒ a strong random one generated and logged once. Dev value lives only in the gitignored `.env`. |
| C3 | **Stored XSS → admin account takeover.** The admin user panel rendered user-chosen `displayName` / `email` via `innerHTML`. A signup with `displayName="<img src=x onerror=…>"` runs script in the **admin's** session when they open the panel; the payload can read the admin's token from `localStorage` and call the admin API. The backend also accepted `role=ADMIN`, so the attacker could self-promote. | A03 Injection (XSS) / CWE-79, CWE-269 | (a) Output-escape every untrusted value rendered to HTML (`esc()` in `auth.js` + `app.js`); (b) backend now **rejects `role=ADMIN`** and refuses to edit the admin row (`UserAdminService`); (c) a strict CSP blocks inline-script execution as a backstop. |

### 3.2 High

| # | Finding | OWASP / CWE | Fix |
| :-- | :--- | :--- | :--- |
| H1 | **Pervasive XSS** across the map UI: OSM facility names, AOP-scraped `projectName` / `buyerName`, and GeoNames town/settlement names were interpolated into `innerHTML` and Leaflet popups unescaped. All come from external/untrusted sources. | A03 / CWE-79 | All such sinks now route through `esc()`; values passed as i18n `{params}` into HTML templates are escaped before substitution. |
| H2 | **"Exactly one admin" not enforced.** The invariant was only hidden in the UI; the admin API happily set `role=ADMIN`. | A01 Broken Access Control / CWE-269 | Enforced server-side: promotion to `ADMIN` and edits to the admin account are rejected (`403`). |
| H3 | **Unauthenticated ML service + unbounded `grid`** → DoS: `GET /api/ml/recommend` has no auth and built a `grid × grid` candidate mesh from a caller-supplied `grid`; a large value allocates an enormous `linspace` and exhausts CPU/memory. | A05 Misconfiguration / A04 Insecure Design / CWE-770 | `grid`, `top`, `radius_km`, `min_separation_km` are clamped to sane ranges. The auth gap is documented as an accepted risk (§4) with the recommended fix. |

### 3.3 Medium

| # | Finding | OWASP / CWE | Fix |
| :-- | :--- | :--- | :--- |
| M1 | **Unbounded matrix cache.** `@Cacheable("matrix")` with the default in-memory cache manager keyed on an unvalidated `district` → unlimited distinct keys grow memory. | A04 / CWE-770 | District is canonicalized against a 28-province whitelist (`Districts.canonical`) **before** the cache lookup; unknown values get a `400`. Key space is bounded to ~29. |
| M2 | **Weak PBKDF2 cost** (120k iterations). | A02 / CWE-916 | Raised to **600,000** (OWASP 2023 guidance for PBKDF2-HMAC-SHA256). Backward-compatible: `matches()` reads each hash's own iteration count. |
| M3 | **No CSP, no SRI on CDN scripts.** | A05 / CWE-1021, CWE-353 | Added a strict CSP (`script-src` without `'unsafe-inline'`) and Subresource Integrity + `crossorigin` on the pinned Leaflet/GSAP CDN assets. |
| M4 | **Permissive CORS, no security headers, no auth rate-limiting.** | A05 / A07 / CWE-307 | CORS narrowed to explicit headers/methods with `allowCredentials(false)`; a `SecurityHeadersFilter` adds `nosniff` / `X-Frame-Options: DENY` / `Referrer-Policy` / `Permissions-Policy` / `Cache-Control: no-store`; `RateLimiter` throttles login (per-IP **and** per-account) and register. |
| M5 | **Weak input validation.** Registration accepted any string containing `@` as an "email", so XSS payloads were storable; no length caps. | A03 / CWE-20 | Real email shape check, control-character stripping + length caps on display name, and a password length cap that also bounds PBKDF2 work. |

### 3.4 Low / informational (accepted or hardened)

| # | Finding | Disposition |
| :-- | :--- | :--- |
| L1 | **Stack-trace / message leakage.** | `server.error.include-stacktrace/-message/-binding-errors: never` set explicitly (it was already the framework default). |
| L2 | **Gemini prompt injection** via `townName` / needs flowing into the LLM prompt. | Low: the prompt JSON is escaped, the model has no tools, and output is shown only to the requester. Accepted; do not feed model output into any privileged sink. |
| L3 | **JWT in `localStorage`** (readable by any script). | Accepted: the bearer model needs client-side storage; with XSS closed + CSP this is the standard trade. An httpOnly-cookie design would require CSRF defenses. |
| L4 | **Scraper SSRF** — a detail URL is `urljoin`-ed from AOP's own HTML. | Low: only exploitable if aop.bg itself is malicious; responses are regex-parsed, not returned. Recommend restricting fetches to the `aop.bg` host. |
| L5 | **Pickle model loading** (`joblib.load` of `*.pkl`). | Accepted: models are local, trusted build artifacts. RCE requires filesystem write access. Don't load untrusted pickles. |
| L6 | **Self-serve `activate()`** upgrades the caller's own account to a paid tier with no real payment. | **By design** (a checkout stand-in). It is authenticated and can never reach `ADMIN`. Wire to a real payment provider before charging. |
| L7 | **OpenKBS playground** (`functions/`, `site/`) returns env presence + project id with `Access-Control-Allow-Origin: *`. | Non-deployed dev playground (see README). Not part of the live stack. |

---

## 4. Residual / accepted risks

1. **ML service is unauthenticated.** `ml-service` (`:8000`) exposes recommendations without a
   token, and the frontend calls it directly. The data is non-sensitive aggregate model output,
   but it does expose a feature that is "paid" in the main app. **Recommended fix:** proxy ML
   calls through the authenticated backend (or require a shared secret the backend forwards) and
   stop binding `:8000` publicly. Until then, the DoS vectors are clamped (H3) and the service
   should be firewalled to the backend host.
2. **Rate limiting is in-process and per-instance.** Behind the shared OpenKBS proxy many clients
   share one source IP, so per-IP limits are coarse (per-account login limits are not affected).
   For internet exposure, add limiting at the proxy/WAF.
3. **`0.0.0.0` binding.** The deploy binds all three services to all interfaces. They should sit
   behind the proxy/firewall with only the frontend port publicly reachable.

---

## 5. Secret configuration

All secrets are environment variables (see `.env.example`). They are sourced from a gitignored
`.env`; the deploy (`scripts/lib.sh` `load_env`) exports them to the backend.

| Variable | Required in prod | Notes |
| :--- | :--- | :--- |
| `APP_AUTH_JWT_SECRET` | **Yes** | ≥ 32 chars, high entropy. `openssl rand -base64 48`. Unset ⇒ random per boot (users log out each restart). |
| `APP_ADMIN_EMAIL` | recommended | defaults to `admin@gmail.com`. |
| `APP_ADMIN_PASSWORD` | **Yes** | unset ⇒ a random password is generated and logged once at first seed. |
| `PG*` | yes | database connection. |
| `GEMINI_API_KEY` | optional | enables real AI explanations; blank ⇒ deterministic fallback. |

> In `.env`, **single-quote** values with shell metacharacters (e.g. `'P4$$w0rd!'`) so
> `set -a; source .env` keeps them literal.

---

## 6. Production hardening checklist

- [ ] Set a strong, unique `APP_AUTH_JWT_SECRET` (≥ 32 chars).
- [ ] Set `APP_ADMIN_PASSWORD` (don't rely on the logged random one), and change the admin email.
- [ ] Rotate the local-dev `.env` values — they are public in this repo's history of `.env.example` placeholders; never reuse them.
- [ ] Put every service behind TLS and a reverse proxy; expose only the frontend publicly.
- [ ] Firewall `:8000` (ML) and `:8080` (backend) to the proxy host; don't expose `0.0.0.0` to the internet.
- [ ] Add proxy/WAF rate limiting in front of `/api/v1/auth/*`.
- [ ] Either authenticate `ml-service` or proxy it through the backend (residual risk #1).
- [ ] Keep `GEMINI_API_KEY` (and all secrets) out of source and logs.
- [ ] Run dependency audits (A06): `mvn versions:display-dependency-updates` / OWASP dependency-check for Java, `pip-audit` for the Python services; the CDN libs are version-pinned with SRI.
- [ ] Add security logging/alerting (A09) for repeated `401`/`429` and admin actions before going to production.
- [ ] Re-run `mvn test` — the `SecurityHardeningTest` suite guards the JWT/secret/PBKDF2/cache fixes.

---

## 7. Test coverage

`backend-api/src/test/java/.../SecurityHardeningTest.java` covers the crypto/authorization core:
valid-token round-trip, tampered-payload rejection, cross-secret forgery rejection, the
old-default-secret-grants-nothing property, weak-secret boot failure, blank-secret random-key
behavior, token expiry, PBKDF2 cost/round-trip/malformed-input handling, and the district
cache-key bounding (including rejection of injection-shaped input).

## 8. Reporting

This is a hackathon project with no production tenants. For a real deployment, route security
reports to the maintainers privately and rotate `APP_AUTH_JWT_SECRET` + `APP_ADMIN_PASSWORD`
on any suspected exposure.
