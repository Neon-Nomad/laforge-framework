# Identity & Access (SSO/SCIM/RBAC) Execution Plan

This document operationalizes roadmap item **1) Identity & Access**: ship SSO for Studio and generated services, map IdP groups to DSL roles/claims, add SCIM inbound provisioning, and harden session handling.

## Goals
- Single-sign-on for Studio UI and generated services with OIDC first, SAML second.
- Deterministic mapping from IdP groups/claims to DSL-defined roles and tenant scopes.
- SCIM 2.0 inbound provisioning for users and groups with idempotent sync hooks.
- Short-lived access tokens with refresh, tenant binding, and audit-friendly session metadata.
- Minimal friction for local development with a mock IdP and feature flags.

## Scope and Surfaces
- **Studio and compiler API**: add login/logout endpoints, callbacks, and middleware that injects the authenticated user into requests and enforces tenant/role context.
- **Generated services/runtime**: shared auth middleware that verifies bearer tokens (OIDC/SAML-derived JWT), populates `user` context (id, tenantId, role(s), claims), and fails closed.
- **DSL and compiler**: expose roles/claims/scopes in the DSL so generated RLS and services can use them safely.
- **SCIM ingress**: optional Fastify routes for `/scim/v2/Users` and `/scim/v2/Groups` that fan into pluggable provisioning hooks.
- **Ops**: configuration via env/flags, JWKS caching, key rotation support, and audit logging of auth events.

Out of scope for this phase: IdP-specific UI customizations, fine-grained consent screens, and device-based MFA (we rely on the IdP for MFA).

## Milestones
1) **OIDC foundation (Studio + runtime)**  
   - OIDC login for Studio using authorization code + PKCE.  
   - Fastify `preHandler` middleware for generated services that verifies JWTs via JWKS and binds tenant/role/claims into `user`.  
   - Local dev mock IdP (static JWKS + sign/verify helpers) behind a flag.  
   - Config surface: issuer, client id, client secret, redirect URI, audience, allowed tenants.

2) **Roles, claims, and DSL support**  
   - DSL additions: `roles {}` block and `claim`/`scope` exposure for policies; compiler validation for allowed `user` properties.  
   - Role/group mapping: configurable map from IdP group claims (e.g., `groups`, `roles`) to DSL roles; default/fallback role.  
   - Tenant scoping: claim name mapping (e.g., `tenant`, `org_id`) and enforcement that tenant presence is required in multi-tenant mode.  
   - Update runtime user context shape and generated code to use roles/claims lists (not just a single `role` string).

3) **SCIM inbound provisioning**  
   - Implement `/scim/v2/Users` and `/scim/v2/Groups` endpoints with filtering, patch, and deprovisioning minimal set.  
   - Pluggable hooks: `onUserProvisioned`, `onUserUpdated`, `onUserDeprovisioned`, `onGroupProvisioned`, `onGroupMembershipChanged`.  
   - Idempotent storage adapter for user/group mirrors (SQLite/Postgres) with optimistic concurrency.  
   - Map SCIM groups to DSL roles; emit audit events for all SCIM mutations.

4) **SAML parity + session hardening**  
   - SAML 2.0 support via metadata URL (sign-in, ACS, logout) with assertion validation and audience/tenant checks.  
   - Session model: 15m access tokens, rotating refresh tokens, reuse detection, and per-tenant session binding.  
   - Cookie settings for Studio UI: HttpOnly, Secure, SameSite=Lax; CSRF token for state-changing calls.  
   - Key rotation: cache JWKS with `kid` awareness; reject unknown algorithms; require `exp`, `iat`, `iss`, `aud`, `sub`.

## Design Notes (per workstream)

### SSO (OIDC first, SAML second)
- Use `openid-client` for OIDC flows; wrap it in `auth/oidcClient.ts` shared by Studio and the auth middleware.
- Studio flow: `/auth/login` -> IdP, `/auth/callback` exchanges code, sets refresh token cookie, returns access token to UI; `/auth/logout` clears session and calls IdP logout if supported.
- Generated services: Fastify plugin `authPlugin.ts` that verifies bearer token (or session cookie for Studio-only calls), loads JWKS, and sets `request.user`. Reject if missing tenant/role/exp or if issuer/audience mismatch.

### Role/claim mapping and DSL
- Extend DSL spec to allow `roles` declarations and to expose `user.roles`, `user.claims.<key>`, `user.scopes` in policies with static validation to block arbitrary properties.
- Add compiler validation that referenced roles exist and that claims are typed (`string | string[]`).
- Introduce config `roleMappings` that maps IdP groups/roles to DSL roles; support default role and explicit deny list.
- Update runtime and generated code to treat roles as string arrays and to propagate claims into policy evaluation.

### Tenant binding
- Configurable claim keys for tenant (`tenant`, `org`, `org_id`, etc.). Require tenant claim when multi-tenant is enabled; otherwise reject token.
- Populate `current_setting('laforge.tenant_id', true)` (or helper) from verified claim; refuse cross-tenant overrides.

### SCIM ingress
- Implement SCIM routes in a dedicated module with schema validation, pagination (`startIndex`, `count`), and RFC7644 filter support for `userName`, `id`, and `emails.value`.
- Storage adapter interface so we can back SCIM mirrors with SQLite/Postgres; include ETag/version to make PATCH idempotent.
- Hook bridge: emit normalized events the domain can consume to provision users/groups into the generated data model.

### Session hardening
- Access tokens: 15m lifetime; refresh tokens: rotating, one-time use, 30d max age; detect reuse and revoke the chain.
- Token contents: `sub`, `iss`, `aud`, `iat`, `exp`, `jti`, `tenant`, `roles`, optional `groups`, `scopes`, `email`.
- Cookies: HttpOnly + Secure + SameSite=Lax for refresh; XSRF token for POST/PUT/PATCH/DELETE in Studio.
- JWKS cache with per-`kid` TTL and background refresh; fail closed on algorithm mismatch.

## Deliverables and Acceptance
- End-to-end login to Studio via OIDC with protected routes and logout.
- Generated services reject unsigned/expired tokens and expose user/tenant/roles/claims to policy evaluation.
- DSL additions documented with examples and validation errors for unsupported `user` properties.
- SCIM inbound provisioning endpoints with conformance tests (create/update/deprovision user and group membership).
- Session hardening demonstrated by automated tests (exp/iat checks, refresh rotation, reuse detection).

## Test and Validation Plan
- **Unit**: JWT verifier, JWKS cache, role/claim mapper, DSL validator changes, SCIM payload validators.
- **Integration**: OIDC flow using mock IdP; token verification inside generated service requests; tenant guard enforcement with mismatched tokens.
- **SCIM**: replay sequences from Okta/Azure AD samples; PATCH vs PUT idempotency; group membership churn.
- **Security**: algorithm confusion tests, missing exp/iss/aud, wrong tenant, replayed refresh token, CSRF token mismatch.
- **Docs**: example env files, `forge` auth config examples, Studio login walkthrough.

## Rollout and Flags
- `AUTH_PROVIDER` = `oidc | saml | mock`.
- `AUTH_REQUIRE_TENANT=true|false`.
- `AUTH_ROLE_MAPPINGS` (JSON map) and `AUTH_TENANT_CLAIM`.
- `ENABLE_SCIM=true|false`.
- Feature flags wrap new middleware and routes; defaults keep current permissive behavior for existing users until configured.

### Quickstart (Mock IdP for local testing)
1. Export env: `AUTH_PROVIDER=mock`, `AUTH_ISSUER=http://localhost:3001/auth/mock`, `AUTH_AUDIENCE=laforge-dev` (defaults are provided).  
2. Start the runtime server (`npm run dev` or your usual entry).  
3. POST to `/auth/mock/token` to obtain a bearer token (optionally pass `sub`, `tenantId`, `roles`, `claims`).  
4. Call `/api/execute` with `Authorization: Bearer <token>`; the user context on the request includes `id`, `tenantId`, `role`, `roles`, and `claims`.  
5. Switch to a real IdP by setting `AUTH_PROVIDER=oidc` and `AUTH_JWKS_URI=https://your-idp/.well-known/jwks.json` plus issuer/audience.
