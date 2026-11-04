# DEPS: realtime (RT)

Wave 1 starts with no dependencies: RT-01, 02, 04, 07, 09, 11, 14, 17, 21, 23, 86 (and 03, 05, 06, 08, 10, 12, 15, 16, 18 right behind them within D1). Interface-first order: shared schemas and ports (RT-01..21) unblock server pieces; RT-34/35/41/42 (store contract, memory store, stub payments, harness) unblock every room issue.

## Unblocking graph

- RT-03 needs RT-02
- RT-05 needs RT-04
- RT-06 needs RT-04
- RT-08 needs RT-07
- RT-10 needs RT-09
- RT-12 needs RT-04, RT-07
- RT-13 needs RT-12
- RT-14 needs RT-09
- RT-15 needs RT-14, RT-02, RT-04
- RT-16 needs RT-14, RT-11, RT-02, RT-04
- RT-17 needs RT-14
- RT-18 needs RT-16, RT-17
- RT-19 needs RT-15, RT-16
- RT-20 needs RT-18, RT-19
- RT-21 needs RT-18
- RT-22 needs RT-01, RT-23
- RT-24 needs RT-23, RT-12
- RT-25 needs RT-24
- RT-26 needs RT-23, RT-21
- RT-27 needs RT-26
- RT-28 needs RT-23, RT-03, RT-07
- RT-29 needs RT-28
- RT-30 needs RT-28
- RT-31 needs RT-28
- RT-32 needs RT-23, RT-08
- RT-33 needs RT-32
- RT-34 needs RT-21, RT-08
- RT-35 needs RT-34
- RT-36 needs RT-35, RT-64
- RT-37 needs RT-34
- RT-38 needs RT-34, RT-86
- RT-39 needs RT-35
- RT-40 needs RT-21
- RT-41 needs RT-21
- RT-42 needs RT-35, RT-08, RT-21
- RT-43 needs RT-42, RT-18
- RT-44 needs RT-43
- RT-45 needs RT-44, RT-40, RT-32
- RT-46 needs RT-45
- RT-47 needs RT-45
- RT-48 needs RT-45, RT-31
- RT-49 needs RT-43, RT-40
- RT-50 needs RT-49, RT-46
- RT-51 needs RT-50
- RT-52 needs RT-58
- RT-53 needs RT-45
- RT-54 needs RT-53
- RT-55 needs RT-54
- RT-56 needs RT-47, RT-31
- RT-57 needs RT-56, RT-40
- RT-58 needs RT-56
- RT-59 needs RT-58, RT-41
- RT-60 needs RT-59
- RT-61 needs RT-46, RT-41
- RT-62 needs RT-61
- RT-63 needs RT-62, RT-42
- RT-64 needs RT-47, RT-62
- RT-65 needs RT-64, RT-59
- RT-66 needs RT-64, RT-42
- RT-67 needs RT-64, RT-33
- RT-68 needs RT-42
- RT-69 needs RT-68, RT-28
- RT-70 needs RT-69, RT-67
- RT-71 needs RT-23, RT-10, RT-26
- RT-72 needs RT-71, RT-67, RT-28
- RT-73 needs RT-72, RT-35
- RT-74 needs RT-73
- RT-75 needs RT-72, RT-62
- RT-76 needs RT-72, RT-56
- RT-77 needs RT-71, RT-41
- RT-78 needs RT-77
- RT-79 needs RT-77, RT-60
- RT-80 needs RT-71, RT-35
- RT-81 needs RT-71, RT-43
- RT-82 needs RT-67, RT-71
- RT-83 needs RT-70, RT-43
- RT-84 needs RT-72, RT-41
- RT-85 needs RT-39, RT-08, RT-72
- RT-87 needs RT-86, RT-64, RT-70
- RT-88 needs RT-64, RT-60, RT-63
- RT-89 needs RT-88, RT-79
- RT-90 needs RT-37, RT-70
- RT-91 needs RT-70, RT-33
- RT-92 needs RT-64
- RT-93 needs RT-70, RT-84

## Critical path
RT-07,08 -> RT-34,35,42 -> RT-43 -> RT-44 -> RT-45 -> RT-46/47 -> RT-56 -> RT-58 -> RT-59 -> RT-60 -> RT-64 -> RT-88 -> RT-89.
Host path: RT-68 -> RT-69 -> RT-70 (needs RT-67). HTTP path: RT-71 -> RT-72 -> RT-73/76/77.

## Needs from other areas
- Engine owner: `extendTo(endTs)` on `Auction` (RT-40, RT-57, RT-56 extend). Without it pause/resume and extend are dropped (spec open question 2). Also keep Rejected codes stable (RT-40 maps them).
- Payments owner: confirm PaymentsPort in SPEC 4.3 (`settle`, `handleWebhook`, `onSettlementUpdate`, `onHoldReported`) before RT-59, RT-60, RT-77. Until then StubPayments (RT-41) is the contract.
- Voice owner: BidMsg fields `transcript, confidence, ambiguous, audioTsMs` (RT-15); threshold from gate G5 (open question 7).
- Web owner: imports `packages/shared` schemas and golden fixtures (RT-20); reads error table (RT-09).
- Quality/infra: Postgres service container in Actions (RT-37), scenario runner reuse (RT-88), bench jobs (RT-90, 91, 92), DECISIONS.md (RT-86).

## Gates and unverified items
- PayPal webhook retry behaviour: UNVERIFIED (gate G4); RT-77 maps results without assuming a schedule.
- Durable Object hibernation and free-plan limits: UNVERIFIED (spike RT-86). If Node wins, RT-38 and RT-87 are closed as not needed.

## Coverage table: requirement -> issue
| Requirement | Issues |
|---|---|
| R-RT-001 | RT-02 |
| R-RT-002 | RT-03 |
| R-RT-003 | RT-03 |
| R-RT-004 | RT-04 |
| R-RT-005 | RT-05 |
| R-RT-006 | RT-06 |
| R-RT-007 | RT-07 |
| R-RT-008 | RT-08 |
| R-RT-009 | RT-09 |
| R-RT-010 | RT-10 |
| R-RT-011 | RT-12 |
| R-RT-012 | RT-13 |
| R-RT-013 | RT-11 |
| R-RT-014 | RT-14 |
| R-RT-015 | RT-15 |
| R-RT-016 | RT-16 |
| R-RT-017 | RT-16 |
| R-RT-018 | RT-19 |
| R-RT-019 | RT-17 |
| R-RT-020 | RT-18 |
| R-RT-021 | RT-20 |
| R-RT-022 | RT-21 |
| R-RT-023 | RT-14 |
| R-RT-030 | RT-43 |
| R-RT-031 | RT-43 |
| R-RT-032 | RT-44 |
| R-RT-033 | RT-44 |
| R-RT-034 | RT-45 |
| R-RT-035 | RT-45 |
| R-RT-036 | RT-46 |
| R-RT-037 | RT-46 |
| R-RT-038 | RT-47 |
| R-RT-039 | RT-48 |
| R-RT-040 | RT-48 |
| R-RT-041 | RT-49 |
| R-RT-042 | RT-50 |
| R-RT-043 | RT-51 |
| R-RT-044 | RT-52 |
| R-RT-045 | RT-53 |
| R-RT-046 | RT-54 |
| R-RT-047 | RT-55 |
| R-RT-048 | RT-56 |
| R-RT-049 | RT-57 |
| R-RT-050 | RT-58 |
| R-RT-051 | RT-59 |
| R-RT-052 | RT-60 |
| R-RT-053 | RT-60 |
| R-RT-054 | RT-61 |
| R-RT-055 | RT-61 |
| R-RT-056 | RT-62 |
| R-RT-057 | RT-63 |
| R-RT-058 | RT-63 |
| R-RT-059 | RT-64 |
| R-RT-060 | RT-65 |
| R-RT-061 | RT-66 |
| R-RT-062 | RT-67 |
| R-RT-070 | RT-42 |
| R-RT-071 | RT-68 |
| R-RT-072 | RT-42 |
| R-RT-073 | RT-69 |
| R-RT-074 | RT-70 |
| R-RT-080 | RT-28 |
| R-RT-081 | RT-28 |
| R-RT-082 | RT-29 |
| R-RT-083 | RT-73 |
| R-RT-084 | RT-74 |
| R-RT-085 | RT-31 |
| R-RT-086 | RT-31 |
| R-RT-090 | RT-34 |
| R-RT-091 | RT-34 |
| R-RT-092 | RT-35 |
| R-RT-093 | RT-37 |
| R-RT-094 | RT-38 |
| R-RT-095 | RT-36 |
| R-RT-096 | RT-37 |
| R-RT-097 | RT-39 |
| R-RT-100 | RT-71 |
| R-RT-101 | RT-72 |
| R-RT-102 | RT-72 |
| R-RT-103 | RT-73 |
| R-RT-104 | RT-75 |
| R-RT-105 | RT-71 |
| R-RT-106 | RT-76 |
| R-RT-107 | RT-84 |
| R-RT-108 | RT-85 |
| R-RT-110 | RT-77 |
| R-RT-111 | RT-77 |
| R-RT-112 | RT-78 |
| R-RT-113 | RT-79 |
| R-RT-114 | RT-78 |
| R-RT-120 | RT-32 |
| R-RT-121 | RT-33 |
| R-RT-122 | RT-33 |
| R-RT-130 | RT-24 |
| R-RT-131 | RT-25 |
| R-RT-132 | RT-26 |
| R-RT-133 | RT-27 |
| R-RT-134 | RT-80 |
| R-RT-135 | RT-81 |
| R-RT-136 | RT-83 |
| R-RT-137 | RT-82 |
| R-RT-140 | RT-22 |
| R-RT-141 | RT-86 |
| R-RT-142 | RT-86 |
| R-RT-143 | RT-87 |
| R-RT-150 | RT-90 |
| R-RT-151 | RT-22 |
| R-RT-152 | RT-91 |
| R-RT-153 | RT-92 |

## Coverage table: test -> issue
| Test | Issues |
|---|---|
| T-RT-001 | RT-02 |
| T-RT-002 | RT-03 |
| T-RT-003 | RT-03 |
| T-RT-004 | RT-04 |
| T-RT-005 | RT-05 |
| T-RT-006 | RT-06 |
| T-RT-007 | RT-08 |
| T-RT-008 | RT-09 |
| T-RT-009 | RT-10 |
| T-RT-010 | RT-12 |
| T-RT-011 | RT-13 |
| T-RT-012 | RT-11 |
| T-RT-013 | RT-14 |
| T-RT-014 | RT-15 |
| T-RT-015 | RT-16 |
| T-RT-016 | RT-16 |
| T-RT-017 | RT-19 |
| T-RT-018 | RT-17 |
| T-RT-019 | RT-18 |
| T-RT-020 | RT-20 |
| T-RT-021 | RT-21 |
| T-RT-022 | RT-43 |
| T-RT-023 | RT-43 |
| T-RT-024 | RT-44 |
| T-RT-025 | RT-44 |
| T-RT-026 | RT-45 |
| T-RT-027 | RT-45 |
| T-RT-028 | RT-46 |
| T-RT-029 | RT-46 |
| T-RT-030 | RT-47 |
| T-RT-031 | RT-48 |
| T-RT-032 | RT-49 |
| T-RT-033 | RT-50 |
| T-RT-034 | RT-51 |
| T-RT-035 | RT-52 |
| T-RT-036 | RT-53 |
| T-RT-037 | RT-54 |
| T-RT-038 | RT-55 |
| T-RT-039 | RT-56 |
| T-RT-040 | RT-57 |
| T-RT-041 | RT-58 |
| T-RT-042 | RT-59 |
| T-RT-043 | RT-60 |
| T-RT-044 | RT-60 |
| T-RT-045 | RT-61 |
| T-RT-046 | RT-61 |
| T-RT-047 | RT-62 |
| T-RT-048 | RT-63 |
| T-RT-049 | RT-63 |
| T-RT-050 | RT-64 |
| T-RT-051 | RT-65 |
| T-RT-052 | RT-66 |
| T-RT-053 | RT-67 |
| T-RT-054 | RT-42 |
| T-RT-055 | RT-68 |
| T-RT-056 | RT-69 |
| T-RT-057 | RT-70 |
| T-RT-058 | RT-28 |
| T-RT-059 | RT-28 |
| T-RT-060 | RT-29 |
| T-RT-061 | RT-73 |
| T-RT-062 | RT-74 |
| T-RT-063 | RT-30 |
| T-RT-064 | RT-31 |
| T-RT-065 | RT-34 |
| T-RT-066 | RT-35 |
| T-RT-067 | RT-37 |
| T-RT-068 | RT-38 |
| T-RT-069 | RT-36 |
| T-RT-070 | RT-37 |
| T-RT-071 | RT-39 |
| T-RT-072 | RT-71 |
| T-RT-073 | RT-72 |
| T-RT-074 | RT-72 |
| T-RT-075 | RT-73 |
| T-RT-076 | RT-75 |
| T-RT-077 | RT-71 |
| T-RT-078 | RT-76 |
| T-RT-079 | RT-84 |
| T-RT-080 | RT-85 |
| T-RT-081 | RT-77 |
| T-RT-082 | RT-77 |
| T-RT-083 | RT-78 |
| T-RT-084 | RT-79 |
| T-RT-085 | RT-78 |
| T-RT-086 | RT-32 |
| T-RT-087 | RT-32 |
| T-RT-088 | RT-33 |
| T-RT-089 | RT-24 |
| T-RT-090 | RT-25 |
| T-RT-091 | RT-26 |
| T-RT-092 | RT-27 |
| T-RT-093 | RT-80 |
| T-RT-094 | RT-81 |
| T-RT-095 | RT-83 |
| T-RT-096 | RT-82 |
| T-RT-097 | RT-22 |
| T-RT-098 | RT-86 |
| T-RT-099 | RT-87 |
| T-RT-100 | RT-90 |
| T-RT-101 | RT-91 |
| T-RT-102 | RT-92 |
| T-RT-103 | RT-88 |
| T-RT-104 | RT-88 |
| T-RT-105 | RT-88 |
| T-RT-106 | RT-89 |
| T-RT-107 | RT-89 |
| T-RT-108 | RT-40 |
| T-RT-109 | RT-41 |
| T-RT-110 | RT-42 |
