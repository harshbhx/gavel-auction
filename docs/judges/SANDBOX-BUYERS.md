# PayPal sandbox buyer instructions

How a judge approves a hold in the sandbox. The buyer logins themselves are not in this repository (it is public). They are in the Devpost testing instructions field. If you cannot see them there, use the scripted demo, which needs no login.

## Before you start

- Everything here is the PayPal sandbox. No real money moves. Never use your own PayPal account or card.
- Use the sandbox buyer from the Devpost testing instructions. Each judge may use any listed buyer; two judges can use the same buyer at the same time, because a hold only reserves sandbox funds.
- Sandbox buyers are US accounts and the auction is in USD.

## Steps

1. Open https://gavel.dualmindlab.tech and press "Start a demo auction" (or open `/try`). You land in the auctioneer console of a room that lasts about thirty minutes.
2. Open the big screen link in a second window, or scan its QR code with a phone.
3. Join as a bidder: enter your name and pick a ceiling, the most you may bid.
4. Press and hold the approve button for 3 seconds (a two-tap alternative sits below it). A PayPal sandbox window opens.
5. Log in with the sandbox buyer email and password from the Devpost field, then approve.
6. The ladder shows your hold as held. Place a bid, then press hammer in the console.
7. After the hammer the winner is captured for the winning price only, the other holds are released, and the receipt shows the result. The audit trail link shows the hash chain.

## If the PayPal window gives trouble

| Symptom                                                      | What to try                                                                                                                                                                        |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The login is refused                                         | Check the email and password for typos. Use a private window so an old PayPal session does not interfere. Make sure it is the sandbox login page (the address contains `sandbox`). |
| The popup is blocked                                         | Allow popups for the GAVEL site and press approve again.                                                                                                                           |
| The page says the room is full, expired or the code is wrong | Start a new demo auction and use the fresh code.                                                                                                                                   |
| "Judge rooms are off" or the host is busy                    | Use `/demo/scripted`, a recorded room with no login.                                                                                                                               |
| The hold shows as released or the bidder dropped             | The hold is old. Register, bid and hammer within one sitting.                                                                                                                      |

## Rules for the credentials

- Credentials are kept out of the repository, issues, pull requests and docs. Only the Devpost field holds them.
- They are sandbox test accounts. If one is locked or a password is reset, tell the team through the Devpost contact or an issue on https://github.com/harshbhx/gavel-auction/issues, without pasting any password.
