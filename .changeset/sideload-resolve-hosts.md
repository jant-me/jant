---
"@jant/core": patch
"create-jant": patch
---

Rehosting a pasted image refuses more private addresses. On Node, each host is resolved first and refused when any address it resolves to is private, so a name like `127.0.0.1.nip.io` no longer reaches the server's own network. Addresses written as `localhost.` or in an IPv6 form that carries an IPv4 address (IPv4-compatible, NAT64, 6to4) are refused too.

**Upgrade notes**

- No database migrations.
