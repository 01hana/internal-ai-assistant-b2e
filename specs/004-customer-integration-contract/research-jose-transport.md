# jose 5.10.0 Remote JWKS transport research

## Installed version

`jose@5.10.0` (root `package.json` and installed `node_modules/jose/package.json`).

## Capability evidence

| Capability | Status | Evidence / decision |
| --- | --- | --- |
| Remote JWKS timeout | SUPPORTED | `RemoteJWKSetOptions.timeoutDuration`; default 5000 ms. |
| Cache TTL / cooldown | SUPPORTED | `cacheMaxAge` (default 600000 ms) and `cooldownDuration` (default 30000 ms). |
| Unknown-kid refresh | SUPPORTED | `RemoteJWKSet.getKey()` reloads once outside cooldown after `JWKSNoMatchingKey`. |
| Key rotation | SUPPORTED | Reloaded sets are converted to a local JWK set. |
| Custom fetch / transport | NOT SUPPORTED | The Node options expose only `agent` and `headers`; no fetch callback. |
| Redirect control | PARTIALLY_SUPPORTED | Node implementation uses `http(s).get`, which does not follow redirects, but has no hardened destination policy. |
| Response-size bound | NOT SUPPORTED | `runtime/fetch_jwks.js` accumulates every response chunk before JSON parsing. |
| Content-Type validation | NOT SUPPORTED | The implementation checks status 200 then parses JSON. |
| DNS / destination / rebinding policy | NOT SUPPORTED | `agent` cannot provide a complete response-bound and connection-time policy. |

## Selected boundary

Batch 3 does not call `createRemoteJWKSet` for profile sources. `HardenedJwksTransport` validates registered HTTPS sources, all DNS answers, the connection-time lookup, redirects/status, timeout, MIME type, streamed response size, and JWKS shape. It returns a bounded registered document to `jose.createLocalJWKSet`; `jose.jwtVerify` still performs all JWT and RSA verification. Cache max age is 10 minutes and unknown-kid refresh cooldown is 30 seconds, keyed by profile identity plus registered JWKS URI.
