# Payments gate failure escalation runbook

Status: runbook for PAY-71. It states what happens when gate G1 or G2 fails, who decides, and what is switched. It adds no requirement; it applies R-PAY-148 and the decision matrices in SPEC-payments 7.3.

Gate results live in `docs/GATES.md` (status blocks and run entries) and in `docs/evidence/<gate>/<runId>.jsonl`. A gate is closed only with a recorded Decision.

## Who does what

| Role                    | Who                 | Does                                                                                |
| ----------------------- | ------------------- | ----------------------------------------------------------------------------------- |
| Gate runner             | payments area (PAY) | runs the gate, writes the run entry, sets the issue label, links the evidence       |
| Decision owner (G1, G2) | Project owner       | picks PASS, PASS-WITH-FALLBACK or FAIL when the matrix does not give a clean answer |
| Server owner            | realtime area (RT)  | applies the wallet-only switch on the server side when asked                        |
| Web owner               | web area (WEB)      | removes the card option and changes the copy when asked                             |
| Spec owner              | payments area (PAY) | flips the UNVERIFIED tags in SPEC-payments after the decision (PAY-70)              |

## Decision path

1. The gate runner finishes the run and checks the run entry: observed rows, evidence path with its sha256, verdict.
2. Look the observation up in SPEC-payments 7.3.
   - A matrix row with PASS, or PASS-WITH-FALLBACK and a named fallback: record the Decision, apply the fallback listed in the row, close the gate. No escalation.
   - No matrix row fits, or the row says FAIL or "escalate" (G1 decision C): go to step 3.
3. Label the gate issue `blocked:needs-owner` (SPEC R-PAY-148) and remove `status:doing`.
4. Comment on the issue with: the gate and run id, the observed value in one line, the link to the evidence file, the named fallback from the table below, and what the fallback costs.
5. Post the same four items in the team channel. Do not start the fallback work until The owner answers.
6. The owner answers on the issue with one of: use the fallback, change the plan (state how), or accept the risk and ship with the tag UNVERIFIED kept.
7. The gate runner records the Decision in `docs/GATES.md`, removes the blocking label, and opens the follow-up issues (one per area touched).
8. The spec owner flips or keeps the tags in SPEC-payments and links the run entry (PAY-70).

If nobody answers within one working day before a demo date, the fallback in the table is used and the issue says so.

## Named fallbacks

| Gate | Failure                                                     | Fallback                                                                                     | Cost                                                        |
| ---- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| G1   | remainder is not released after final capture, void fails   | capture the winning price, void the authorization explicitly, copy says "released on expiry" | one extra call; the winner's remainder stays blocked longer |
| G1   | partial capture with final_capture rejected for card buyers | wallet buyers only (R-PAY-037)                                                               | card buyers cannot register                                 |
| G2   | card or guest AUTHORIZE not offered or fails                | wallet buyers only                                                                           | card registration removed; copy changes                     |

## Wallet-only switch checklist

Use it when G1 (card) or G2 fails, or when the owner decides to cut card checkout. Each step has an owner; tick them in the follow-up issue.

- [ ] Gate runner: keep `g2_card_authorize` false in `packages/payments/src/gates-result.json` (and set `g1_remainder_mode` to the letter the matrix gives), with the run id in the commit message.
- [ ] Gate runner: record the Decision and the fallback adopted in `docs/GATES.md`.
- [ ] Web owner: hide the card option and the guest checkout button; the flag is read at build time (R-PAY-037).
- [ ] Web owner: change the registration copy to say "PayPal account required".
- [ ] Server owner: refuse hold orders created for a card funding source with a clear error code, if the server still accepts them.
- [ ] Spec owner: keep the UNVERIFIED (G2) tags that now carry the fallback text, and mark R-PAY-036 and R-PAY-037 as decided.
- [ ] Gate runner: rerun the fake-mode crash and settlement checks (`npm run demo:settle -w @gavel/payments`) to show the saga is unchanged; the money path does not depend on the buyer funding source.
- [ ] Anyone: tell the owner the switch is done and link the merged pull request.

## What does not change

The settlement saga, the journal, the reconciler and the kill switch do not depend on the funding source. A wallet-only switch changes registration and copy, not the money path.
