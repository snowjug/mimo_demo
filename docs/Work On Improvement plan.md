# MIMO Project Status and Improvement Plan

Date: April 23, 2026
Project: MIMO Print Platform

---

## Section A: What Has Been Completed (Implemented and Verified)

This section captures what is already done in the current codebase and documented project status.

### 1) Core End-to-End Platform Delivered
- Web frontend for upload and payment flow is implemented and deployed.
- Kiosk frontend for PIN-based print retrieval is implemented and deployed.
- Backend API for authentication, upload, conversion, payment, and print dispatch is implemented.
- Firebase Firestore and Storage integration is implemented.
- Raspberry Pi printer service integration is implemented.

### 2) File Upload and Conversion Flow Implemented
- Upload endpoint accepts supported file types: PDF, DOC, DOCX, TXT, JPG, JPEG, PNG.
- Uploads are stored in Firebase Storage and jobs are created in Firestore.
- Jobs start in pending_conversion status.
- Backend converts non-PDF files into PDF.
- Converted PDF is saved back to storage and job moves to pending payment flow.

### 3) Job Lifecycle and Queue-State Flow Implemented
- Application state flow is implemented using status transitions:
  pending_conversion -> pending -> paid -> printing -> completed.
- PIN-based retrieval is implemented for kiosk flow.
- Print dispatch to Pi printer service is implemented.
- Test print mode is implemented for non-hardware testing.

### 4) Five Critical Reliability and Security Fixes Implemented
- Cache size limits implemented with max cache cap and eviction behavior.
- Conversion lock implemented to prevent duplicate conversion race conditions.
- Payment timeout handling implemented to avoid hangs and duplicate retries.
- Rate limiting implemented on kiosk print endpoint.
- Authentication protection implemented on sensitive print status endpoint.

### 5) Performance and Stability Optimizations Implemented
- In-memory PDF cache implemented with TTL.
- Cache prefetch behavior after payment success implemented.
- Timeout wrappers implemented around slow external operations.
- Queue/backlog operational checks are implemented.
- Basic ops alert persistence and webhook alerting support are implemented.

### 6) Test and Deployment Readiness Work Completed
- Load test scenarios were run and documented.
- Test report, deployment guide, and smoke checklist were prepared.
- Project marked production ready in status documentation, with remaining manual operational steps listed.

### 7) Printer Queue Integration Implemented
- Pi print service accepts PDF and PIN and dispatches using CUPS lp command.
- Multiple printer queue candidates can be configured.
- If primary queue fails, service attempts fallback queue candidates.
- Dispatch failures return retry-safe responses to backend.

---

## Section B: Current Behavior Notes (Compression, Optimization, Queue)

### Compression Behavior (Current)
- Files are converted to PDF where needed.
- No explicit dedicated PDF compression stage is currently configured.
- No explicit compression mode selection exists today (for example, strict lossless vs aggressive lossy profile).
- Therefore, output size and quality depend on conversion path and source file type.

### Optimization Behavior (Current)
- Major optimization exists around cache, timeout protection, and race-condition prevention.
- Rate limiting and state guards reduce abuse and inconsistent transitions.
- Current optimization is good for stability, but deeper media and queue optimization can still be added.

### Printing Queue Behavior (Current)
- App-level queue logic is status-driven in Firestore.
- Actual print queue is managed by CUPS on Raspberry Pi.
- There is no dedicated persistent retry queue in backend yet; retries are request-driven.

---

## Section C: Recommended Improvisations (Complete List)

This section includes the complete improvement list requested.

### C1) Upload, Conversion, and Compression
1. Add explicit PDF compression pipeline after conversion with modes: none, lossless, balanced, aggressive.
2. Add image downscaling before embedding into PDF for very large images.
3. Add DPI normalization policy for print-friendly output quality.
4. Add strict max file size checks per file and per request.
5. Add strict max page count checks per job.
6. Add MIME type sniffing in addition to extension checks.
7. Add malware scan step for uploaded files.
8. Add storage checksum tracking for integrity verification.
9. Add source-to-output size analytics per conversion.
10. Add conversion profile by file type (document, image, text).

### C2) Queue, Printing, and Reliability
11. Add persistent backend print retry queue with exponential backoff.
12. Add dead-letter handling for repeatedly failing print jobs.
13. Add printer acknowledgment lifecycle events: queued, started, completed, failed.
14. Store and expose printer system job IDs.
15. Add idempotency lock for print dispatch to prevent duplicate prints.
16. Add cancellation endpoint and safe rollback behavior for jobs.
17. Add priority queue support for urgent jobs.
18. Add multi-printer routing policy (availability, health, load).
19. Add automatic failover between printer queues.
20. Add circuit breaker behavior when printer service becomes unstable.

### C3) Data Model and State Integrity
21. Enforce strict state machine transition validation in backend.
22. Make all critical transitions atomic and auditable.
23. Add immutable state transition event log collection.
24. Add operator actions log for manual retries and interventions.
25. Add consistent status taxonomy across all services.
26. Add schema versioning for print jobs and orders.
27. Add job TTL and expiration policy for stale paid jobs.
28. Add orphan-file cleanup linkage in metadata.
29. Add stronger foreign-key style consistency checks in app logic.
30. Add automated data repair script for inconsistent records.

### C4) Security Hardening
31. Add machine-to-machine auth for kiosk and printer services.
32. Add scoped service tokens and periodic key rotation.
33. Add webhook signature verification for payment callbacks.
34. Add replay protection and nonce/timestamp validation.
35. Add IP allowlist options for internal endpoints.
36. Add request body size limits and strict validation everywhere.
37. Add secrets scanning in CI for accidental key commits.
38. Add encrypted sensitive metadata fields at rest where applicable.
39. Add full audit trail on auth-sensitive endpoints.
40. Add security-focused negative test suite.

### C5) Performance and Scale
41. Move in-memory rate limiter to centralized Redis for multi-instance scaling.
42. Move conversion execution from request path to async worker queue.
43. Add worker autoscaling trigger based on pending queue depth.
44. Improve cache eviction to true LRU with multi-item eviction.
45. Add cache hit/miss metrics and adaptive cache policies.
46. Add duplicate upload deduplication using content hash.
47. Add streaming upload path for very large files.
48. Add controlled concurrency for conversions and dispatch operations.
49. Add graceful backpressure responses under extreme load.
50. Add performance budgets and P95/P99 latency tracking.

### C6) Observability and Operations
51. Add structured logging with correlation IDs across services.
52. Add trace propagation from frontend to backend to printer service.
53. Add dashboards for conversion time, queue wait, print success, and error classes.
54. Add alerting thresholds for backlog, printer down, payment mismatch.
55. Add on-call runbooks for top incident scenarios.
56. Add scheduled synthetic flow checks every few minutes.
57. Add business KPI dashboard: conversion success, payment success, print completion.
58. Add monthly reliability review reports.
59. Add SLO targets and error budget policy.
60. Add post-incident review template and tracking.

### C7) Testing and Quality Gates
61. Add end-to-end tests for full flow: upload to payment to print completion.
62. Add conversion regression test corpus with varied file samples.
63. Add printer integration tests for queue failover and retries.
64. Add load tests for spike, soak, and stress.
65. Add chaos tests for converter timeout and printer outage.
66. Add contract tests for all public API responses.
67. Add schema migration tests and backward compatibility checks.
68. Add pre-deploy smoke automation.
69. Add rollout guardrails to block deploy on critical failures.
70. Add release verification checklist tied to CI status.

### C8) Deployment, Infra, and Cost Control
71. Add blue-green or canary deployment strategy for backend.
72. Add automatic rollback on health check failure.
73. Add environment config validator at startup.
74. Add infrastructure-as-code for service and secret setup.
75. Add Firestore index verification in CI before release.
76. Add backup and restore drill schedule.
77. Add data retention policy for old PDFs and logs.
78. Add storage lifecycle rules to reduce long-term cost.
79. Add budget alerts for storage, egress, and compute.
80. Add capacity planning model by campus load profile.

### C9) Product and UX Improvements
81. Add real-time user-facing job progress timeline.
82. Add clearer retry guidance and error messaging.
83. Add kiosk-friendly fallback workflows when printer is offline.
84. Add proactive warning if job is too large or too many pages.
85. Add queue position indicator for user confidence.
86. Add multilingual kiosk messaging support.
87. Add accessibility checks for kiosk interface.
88. Add admin override flow with approval logging.
89. Add notification flow for delayed or failed prints.
90. Add user receipt with print metadata and timestamp.

### C10) Governance and Team Process
91. Add architecture decision records for major changes.
92. Add code ownership map for services and critical modules.
93. Add security and reliability review gate for high-risk PRs.
94. Add dependency update policy and vulnerability SLA.
95. Add quarterly threat modeling exercise.
96. Add coding standards for status transitions and error handling.
97. Add production change calendar for coordinated releases.
98. Add incident severity matrix and communication templates.
99. Add regular game-day drills for printer and payment outages.
100. Add prioritized roadmap tracking with P0, P1, P2 buckets and measurable outcomes.

---

## Section D: Suggested Prioritization

### P0 (Immediate)
- Compression modes and file guardrails.
- Persistent retry queue and dispatch idempotency lock.
- Machine auth for kiosk and printer.
- Structured logs plus critical alert dashboard.
- End-to-end test automation gate.

### P1 (Near-Term)
- Async conversion workers.
- Multi-printer routing and failover.
- State transition audit log.
- Redis-backed rate limiting.
- Canary deploy and automatic rollback.

### P2 (Mid-Term)
- Advanced dedup, predictive scaling, KPI analytics, and governance maturity additions.

---

## Section E: Summary

The platform already has strong foundations: complete upload-to-print flow, major critical fixes, and production-focused reliability measures. The highest-value next step is to formalize compression behavior and harden queue reliability with persistent retries, stronger state controls, and deeper observability.
