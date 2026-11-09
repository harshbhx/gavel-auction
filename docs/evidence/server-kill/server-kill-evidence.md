# Real server-process kill: PASS

real server process on a CI runner against the real PayPal sandbox (not a deployed host)

Checkpoint: after_capture_request_before_response. Server pid before 3299, after restart 3567.

| check                         | result | detail                                                                   |
| ----------------------------- | ------ | ------------------------------------------------------------------------ |
| server_died_at_checkpoint     | pass   | the server process ended itself at after_capture_request_before_response |
| restarted_as_new_process      | pass   | pid before 3299, pid after 3567                                          |
| journal_settled_after_restart | pass   | journal state SETTLED                                                    |
| one_capture_for_hammer_price  | pass   | winner has 1 capture(s), 12500 captured, hammer price 12500              |
| losers_voided                 | pass   | 2 of 2 other holds are VOIDED with nothing captured                      |
| journal_equals_paypal         | pass   | 0 difference(s)                                                          |
| ledger_chain_verifies         | pass   | 19 entries, head seq 19                                                  |
| ledger_capture_equals_paypal  | pass   | ledger captured 12500, PayPal 12500                                      |
