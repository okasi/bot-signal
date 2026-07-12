# Security

Please report security issues privately instead of opening a public issue.

Use GitHub private vulnerability reporting if it is available:

https://github.com/okasi/bot-signal/security/advisories/new

Include:

- A description of the issue and impact.
- Steps to reproduce or a minimal proof of concept.
- Affected package entry point, browser check, server signal, script, or demo route.
- Relevant environment details such as browser, Node version, edge/runtime, headers, or proxy setup.
- Any suggested mitigation.

This package evaluates untrusted browser signals, request metadata, TLS fingerprints, IP addresses, and downloaded blocklists. Treat crashes, bypasses that materially reduce detection, unsafe parsing, path traversal, data exfiltration, dependency compromise, and accidental exposure of private request data as security-relevant.
