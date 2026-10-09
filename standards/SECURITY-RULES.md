# Security Rules

1. Never print or commit secrets.
2. Never reveal environment-variable values unless the user explicitly asks for a non-secret value and it is safe.
3. Confirm secret presence by name/status rather than printing the secret.
4. Keep `.env`, keys, certificates, credentials, and tokens out of Git.
5. Do not weaken authentication or authorization to make a test pass.
6. Treat client-side authorization as insufficient for protected operations.
7. Do not place privileged credentials in browser-delivered code.
8. Use least privilege for service accounts and database roles.
9. Prefer non-production test data.
10. Do not run destructive database or filesystem operations unless explicitly authorized.
11. Before an irreversible operation, identify recovery/rollback.
12. Production deploy, DNS, billing, payment, and authoritative accounting changes require a human approval gate.
