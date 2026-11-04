# DEPS: web area

Derived from issues-web.json. Wave 1 issues need no keys and no other area. Cross-area inputs are listed first.

## Cross-area inputs
- packages/shared (REALTIME): wire message types, error codes, `seq`, `clientBidId` (WEB-10 mirrors them until shared lands; drift test then enforces equality). Requests: OQ-WEB-1.
- packages/server (REALTIME): demo room endpoint (WEB-27), control endpoint (WEB-45, OQ-WEB-2), WebSocket (WEB-21, WEB-76).
- packages/payments: orders and holds endpoints (WEB-28/29), PayPal gate G2 result (WEB-29).
- packages/voice: `AudioFrameSink` type (WEB-42), stt_partial/stt_final/parse events (WEB-41).
- packages/e2e (QUALITY): consumes `src/testing/testids.ts` (WEB-72) and scenario fixtures; recording bundle for replay (OQ-WEB-5).
- infra: workflow for web-visual (WEB-74), CSP headers (WEB-75).

## Wave overview

- Wave 1: WEB-01, WEB-02, WEB-03, WEB-04, WEB-05, WEB-06, WEB-07, WEB-08, WEB-09, WEB-10, WEB-11, WEB-12, WEB-13, WEB-14, WEB-15, WEB-16, WEB-17, WEB-18, WEB-28, WEB-55
- Wave 2: WEB-19, WEB-20, WEB-21, WEB-22, WEB-23, WEB-24, WEB-25, WEB-26, WEB-27, WEB-30, WEB-31, WEB-32, WEB-33, WEB-34, WEB-35, WEB-36, WEB-37, WEB-38, WEB-39, WEB-40, WEB-41, WEB-42, WEB-43, WEB-44, WEB-45, WEB-46, WEB-47, WEB-48, WEB-49, WEB-50, WEB-51, WEB-52, WEB-53, WEB-54, WEB-56, WEB-57, WEB-58, WEB-59, WEB-60, WEB-61, WEB-62, WEB-66, WEB-72, WEB-73
- Wave 3: WEB-29, WEB-63, WEB-64, WEB-65, WEB-67, WEB-68, WEB-69, WEB-70, WEB-71, WEB-74, WEB-75, WEB-76
- Wave 4: WEB-77, WEB-78

## Unblocks (issue -> issues that depend on it)

- WEB-01 -> WEB-02, WEB-03, WEB-05, WEB-06, WEB-07, WEB-10, WEB-17, WEB-23, WEB-28, WEB-33
- WEB-03 -> WEB-04, WEB-15, WEB-50
- WEB-05 -> WEB-15, WEB-56
- WEB-06 -> WEB-22, WEB-30
- WEB-07 -> WEB-08, WEB-09, WEB-26, WEB-30
- WEB-09 -> WEB-36
- WEB-10 -> WEB-09, WEB-11, WEB-12, WEB-13, WEB-18, WEB-55, WEB-62
- WEB-11 -> WEB-14, WEB-21, WEB-27, WEB-62
- WEB-12 -> WEB-14, WEB-68, WEB-73
- WEB-13 -> WEB-68
- WEB-15 -> WEB-16, WEB-24, WEB-30, WEB-34, WEB-39, WEB-56, WEB-66, WEB-72
- WEB-16 -> WEB-25, WEB-36, WEB-38, WEB-43, WEB-46, WEB-47, WEB-72
- WEB-17 -> WEB-37, WEB-47, WEB-51
- WEB-18 -> WEB-19, WEB-20, WEB-21, WEB-22
- WEB-19 -> WEB-35
- WEB-20 -> WEB-24, WEB-34, WEB-39, WEB-50, WEB-52, WEB-73
- WEB-21 -> WEB-76
- WEB-23 -> WEB-25, WEB-32
- WEB-24 -> WEB-25, WEB-26, WEB-30, WEB-32, WEB-34, WEB-39, WEB-52, WEB-60
- WEB-25 -> WEB-67
- WEB-26 -> WEB-27
- WEB-27 -> WEB-78
- WEB-28 -> WEB-29, WEB-31
- WEB-29 -> WEB-75
- WEB-30 -> WEB-31
- WEB-31 -> WEB-69, WEB-76
- WEB-33 -> WEB-50
- WEB-34 -> WEB-35, WEB-36, WEB-37, WEB-38, WEB-67
- WEB-35 -> WEB-69, WEB-71
- WEB-39 -> WEB-40, WEB-41, WEB-43, WEB-44, WEB-45, WEB-49, WEB-67, WEB-71
- WEB-41 -> WEB-42
- WEB-43 -> WEB-48
- WEB-45 -> WEB-46, WEB-47, WEB-76
- WEB-47 -> WEB-69
- WEB-50 -> WEB-51, WEB-71
- WEB-51 -> WEB-70, WEB-77
- WEB-52 -> WEB-53, WEB-54, WEB-67
- WEB-55 -> WEB-56, WEB-58, WEB-60
- WEB-56 -> WEB-57, WEB-59, WEB-77
- WEB-57 -> WEB-70, WEB-77
- WEB-60 -> WEB-61
- WEB-62 -> WEB-63, WEB-64, WEB-75
- WEB-63 -> WEB-65
- WEB-67 -> WEB-68
- WEB-72 -> WEB-74, WEB-78
- WEB-73 -> WEB-74

## Critical path
WEB-01 -> WEB-10 -> WEB-18 -> WEB-20 -> WEB-39 -> (WEB-40..49) ; WEB-10 -> WEB-55 -> WEB-56 -> WEB-57/59 ; WEB-28 -> WEB-29 (gate G2) ; WEB-62 -> WEB-63/64 -> WEB-65.

## Coverage: requirement -> issue

| Requirement | Issues |
|---|---|
| R-WEB-001 | WEB-01 |
| R-WEB-002 | WEB-08 |
| R-WEB-003 | WEB-75 |
| R-WEB-004 | WEB-75 |
| R-WEB-005 | WEB-06 |
| R-WEB-006 | WEB-06 |
| R-WEB-007 | WEB-10 |
| R-WEB-008 | WEB-11, WEB-14 |
| R-WEB-009 | WEB-75 |
| R-WEB-010 | WEB-02 |
| R-WEB-011 | WEB-03 |
| R-WEB-012 | WEB-03 |
| R-WEB-013 | WEB-04 |
| R-WEB-014 | WEB-03 |
| R-WEB-015 | WEB-15 |
| R-WEB-016 | WEB-15 |
| R-WEB-017 | WEB-03, WEB-70 |
| R-WEB-018 | WEB-05 |
| R-WEB-020 | WEB-18 |
| R-WEB-021 | WEB-18 |
| R-WEB-022 | WEB-18 |
| R-WEB-023 | WEB-21 |
| R-WEB-024 | WEB-21 |
| R-WEB-025 | WEB-19 |
| R-WEB-026 | WEB-22 |
| R-WEB-027 | WEB-09 |
| R-WEB-028 | WEB-20 |
| R-WEB-029 | WEB-23 |
| R-WEB-030 | WEB-24 |
| R-WEB-031 | WEB-25 |
| R-WEB-032 | WEB-25 |
| R-WEB-033 | WEB-24 |
| R-WEB-034 | WEB-25 |
| R-WEB-035 | WEB-26 |
| R-WEB-036 | WEB-27 |
| R-WEB-037 | WEB-27 |
| R-WEB-038 | WEB-27 |
| R-WEB-040 | WEB-30 |
| R-WEB-041 | WEB-30 |
| R-WEB-042 | WEB-30 |
| R-WEB-043 | WEB-29 |
| R-WEB-044 | WEB-28 |
| R-WEB-045 | WEB-31 |
| R-WEB-046 | WEB-31 |
| R-WEB-047 | WEB-28 |
| R-WEB-048 | WEB-28 |
| R-WEB-049 | WEB-31 |
| R-WEB-050 | WEB-32 |
| R-WEB-051 | WEB-33 |
| R-WEB-052 | WEB-32 |
| R-WEB-053 | WEB-34 |
| R-WEB-054 | WEB-34 |
| R-WEB-055 | WEB-35 |
| R-WEB-056 | WEB-35 |
| R-WEB-057 | WEB-35 |
| R-WEB-058 | WEB-34 |
| R-WEB-059 | WEB-36 |
| R-WEB-060 | WEB-37 |
| R-WEB-061 | WEB-38 |
| R-WEB-062 | WEB-36 |
| R-WEB-063 | WEB-39 |
| R-WEB-064 | WEB-39 |
| R-WEB-065 | WEB-40 |
| R-WEB-066 | WEB-41, WEB-42 |
| R-WEB-067 | WEB-43 |
| R-WEB-068 | WEB-44 |
| R-WEB-069 | WEB-45 |
| R-WEB-070 | WEB-46 |
| R-WEB-071 | WEB-47 |
| R-WEB-072 | WEB-48 |
| R-WEB-073 | WEB-49 |
| R-WEB-074 | WEB-66 |
| R-WEB-075 | WEB-50 |
| R-WEB-076 | WEB-51 |
| R-WEB-077 | WEB-50 |
| R-WEB-078 | WEB-51 |
| R-WEB-079 | WEB-51 |
| R-WEB-080 | WEB-52 |
| R-WEB-081 | WEB-53 |
| R-WEB-082 | WEB-52 |
| R-WEB-083 | WEB-54 |
| R-WEB-084 | WEB-54 |
| R-WEB-085 | WEB-52 |
| R-WEB-086 | WEB-55, WEB-56 |
| R-WEB-087 | WEB-56 |
| R-WEB-088 | WEB-56 |
| R-WEB-089 | WEB-57 |
| R-WEB-090 | WEB-55 |
| R-WEB-091 | WEB-55, WEB-59 |
| R-WEB-092 | WEB-59 |
| R-WEB-093 | WEB-58 |
| R-WEB-094 | WEB-55 |
| R-WEB-095 | WEB-60 |
| R-WEB-096 | WEB-60 |
| R-WEB-097 | WEB-61 |
| R-WEB-098 | WEB-61 |
| R-WEB-099 | WEB-61 |
| R-WEB-100 | WEB-62 |
| R-WEB-101 | WEB-63 |
| R-WEB-102 | WEB-64 |
| R-WEB-103 | WEB-64 |
| R-WEB-104 | WEB-65 |
| R-WEB-105 | WEB-63 |
| R-WEB-106 | WEB-67 |
| R-WEB-107 | WEB-67 |
| R-WEB-108 | WEB-67 |
| R-WEB-109 | WEB-68 |
| R-WEB-110 | WEB-17 |
| R-WEB-111 | WEB-16, WEB-69 |
| R-WEB-112 | WEB-15, WEB-69 |
| R-WEB-113 | WEB-47, WEB-69 |
| R-WEB-114 | WEB-70 |
| R-WEB-115 | WEB-71 |
| R-WEB-116 | WEB-30 |
| R-WEB-117 | WEB-71 |
| R-WEB-118 | WEB-71 |
| R-WEB-119 | WEB-50 |
| R-WEB-120 | WEB-07 |
| R-WEB-121 | WEB-07 |
| R-WEB-122 | WEB-08 |
| R-WEB-123 | WEB-12, WEB-13, WEB-73 |
| R-WEB-124 | WEB-74 |
| R-WEB-125 | WEB-72 |

## Coverage: test -> issue

| Test | Issues |
|---|---|
| T-WEB-001 | WEB-06 |
| T-WEB-002 | WEB-10 |
| T-WEB-003 | WEB-06 |
| T-WEB-004 | WEB-06 |
| T-WEB-005 | WEB-54 |
| T-WEB-006 | WEB-54 |
| T-WEB-007 | WEB-09 |
| T-WEB-008 | WEB-08 |
| T-WEB-009 | WEB-04 |
| T-WEB-010 | WEB-18 |
| T-WEB-011 | WEB-18 |
| T-WEB-012 | WEB-18 |
| T-WEB-013 | WEB-21 |
| T-WEB-014 | WEB-21 |
| T-WEB-015 | WEB-19 |
| T-WEB-016 | WEB-20 |
| T-WEB-017 | WEB-23 |
| T-WEB-018 | WEB-22 |
| T-WEB-020 | WEB-28 |
| T-WEB-021 | WEB-28 |
| T-WEB-022 | WEB-29 |
| T-WEB-023 | WEB-31 |
| T-WEB-024 | WEB-29 |
| T-WEB-030 | WEB-26, WEB-27 |
| T-WEB-031 | WEB-30 |
| T-WEB-032 | WEB-32, WEB-33 |
| T-WEB-033 | WEB-34, WEB-35 |
| T-WEB-034 | WEB-38 |
| T-WEB-035 | WEB-36 |
| T-WEB-036 | WEB-40, WEB-41 |
| T-WEB-037 | WEB-43 |
| T-WEB-038 | WEB-44 |
| T-WEB-039 | WEB-45, WEB-46 |
| T-WEB-040 | WEB-47 |
| T-WEB-041 | WEB-50, WEB-51 |
| T-WEB-042 | WEB-52, WEB-53 |
| T-WEB-043 | WEB-54 |
| T-WEB-044 | WEB-55, WEB-56, WEB-57 |
| T-WEB-045 | WEB-60, WEB-61 |
| T-WEB-046 | WEB-64, WEB-65 |
| T-WEB-047 | WEB-65 |
| T-WEB-050 | WEB-67 |
| T-WEB-051 | WEB-68 |
| T-WEB-052 | WEB-17 |
| T-WEB-053 | WEB-69 |
| T-WEB-054 | WEB-70 |
| T-WEB-055 | WEB-71 |
| T-WEB-056 | WEB-74 |
| T-WEB-057 | WEB-75 |
| T-WEB-058 | WEB-75 |
| T-WEB-059 | WEB-72 |
| T-WEB-060 | WEB-24, WEB-25 |
| T-WEB-061 | WEB-02 |
| T-WEB-062 | WEB-20 |
| T-WEB-063 | WEB-14 |
| T-WEB-064 | WEB-59 |
