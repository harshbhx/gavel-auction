# GAVEL launch film

The launch film of GAVEL for the PayPal Hackathon 2026 judges: 2:45, 1920x1080, 60 fps, no voice and no audio track,
every line on screen. The product chapters are a recording of the real web app; the argument, proof and judge beats
are type and graphics in the brand's motion language. Built by Harsh Bhanushali and Dhairya Patel, credited in the
intro, the hook and the outro. Storyboard, research and the motion language: [STORYBOARD.md](STORYBOARD.md).

| File                           | What it is                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------- |
| `gavel-launch-film.mp4`        | H.264, 1920x1080, 60 fps, 2:45, no audio track, 21.07 MB                        |
| `gavel-launch-film-poster.png` | Poster, 1920x1080, the title card                                               |
| `gavel-launch-film.en.srt`     | Every on-screen line with timecodes, for YouTube captions or a voice-over later |
| `timeline.json`                | Scene starts and caption times in seconds, machine readable                     |

No third-party audio is used (the Devpost rules forbid copyrighted music). If a voice-over is added later, follow the SRT
line by line and mux it without re-encoding the picture:
`ffmpeg -i gavel-launch-film.mp4 -i voice.wav -map 0:v -map 1:a -c:v copy -c:a aac -shortest out.mp4`.

## What it shows and what it does not

- The seven product chapters (Open, Join, Hold, Bid, Hammer, Receipt, Verify) are a **recording of the real web app**
  against a local server in CI: judge rooms on, **simulated holds**, fake payments, memory store, no secrets. Every
  recorded frame carries "Recorded run. Simulated holds. No PayPal call." and the sandbox footer. No PayPal call is
  made and no money moves.
- The voice beat is an illustration and says so in frame; the only voice numbers are the 24 synthetic clips of
  `docs/GATES.md` (G5 PARTIAL). The settle diagram is drawn, not recorded, and says in frame that capture, remainder
  release and void are proven on the sandbox in G1 and G4.
- The proof numbers and run ids are copied from `docs/GATES.md`; both latency misses are stated. G3 reads IN PROGRESS
  until its final reading.
- The judge beat shows the `/try` key field as a password field (dots) and a terminal that uses `$KEY`; the throwaway
  key of the CI run is generated in the job, masked and destroyed with the runner. The shared judging key lives only
  in the Devpost testing instructions and is never in the repository or the film.
- Not shown: a PayPal login, the hosted sandbox capture, the APIMatic SDK.

## How it is made

Everything runs in GitHub Actions (nothing is rendered on a laptop or the VM):

1. [`launch-film.yml`](../../../.github/workflows/launch-film.yml) records the judge flow with the composite action
   [`record-ui`](../../../.github/actions/record-ui/action.yml) (shared with the silent cut): the web app is built
   against a local server, six browsers (host, two phones, console, big screen, docs) are driven by
   [`record.mjs`](../../../graphics/motion-silent/record.mjs) and recorded on one shared clock, with named events
   (press, release, bids, verify) and element rectangles for the camera. The `silent-raw` artifact can be reused with
   the `raw_run` input.
2. [`graphics/motion-film/`](../../../graphics/motion-film/) is a [Remotion](https://www.remotion.dev) project.
   `compose.mjs` resolves the recording into scene props (frames, speeds, event times, camera targets, captions),
   renders the `Film` composition, and writes the poster, SRT, timeline, contact sheets and `report.txt`; above 48 MB
   it re-encodes under a bitrate cap. Remotion is free for individuals and companies of up to three people.
3. Inputs: `fps` (60 for the final, 30 for a quick pass), `raw_run`, `record_only`, `webm`.

The run that produced these files: https://github.com/harshbhx/gavel-auction/actions/runs/42763598583 (artifact
`launch-film`, which also holds the contact sheets and `report.txt`).
