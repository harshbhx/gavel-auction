#!/usr/bin/env bash
# Render the G5 held-out noisy clip set (issue 2192, docs/evidence/G5/HELDOUT-NOISY-PREREG.md):
# 40 new utterances spoken by eSpeak NG, each mixed at 20, 10 and 5 dB SNR with a generated room
# bed or a generated babble bed through the existing scripts/mix-noise.sh. The speech is synthetic
# and the noise is simulated: this is not a real room and not a human voice.
#
# Output: <out dir>/<clip id>.wav (16 kHz mono s16le) for every row of fixtures/audio-heldout/manifest.json,
# and <out dir>/SHA256SUMS.
#
# Usage: render-heldout.sh [out dir]   (default fixtures/audio-heldout/recordings)
# Needs: espeak-ng, ffmpeg, ffprobe, jq.
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
out="${1:-$here/fixtures/audio-heldout/recordings}"
utterances="$here/fixtures/audio-heldout/utterances.json"
manifest="$here/fixtures/audio-heldout/manifest.json"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$out" "$tmp/clean" "$tmp/noise"

norm=(-ar 16000 -ac 1 -c:a pcm_s16le -fflags +bitexact -flags:a +bitexact -map_metadata -1)

# 1. Clean speech, same framing as render-clips.sh (300 ms of silence on both sides).
jq -r '.[] | [.id, .voice, .text] | @tsv' "$utterances" | while IFS=$'\t' read -r id voice text; do
  espeak-ng -v "$voice" -s 150 -w "$tmp/$id.raw.wav" "$text" </dev/null
  ffmpeg -nostdin -y -v error -i "$tmp/$id.raw.wav" -af "adelay=300|300,apad=pad_dur=0.3" \
    "${norm[@]}" "$tmp/clean/$id.wav"
done

# 2. Room bed: seeded pink noise, low-passed, with a slow level wobble. 25 s, longer than any clip.
ffmpeg -nostdin -y -v error \
  -f lavfi -i "anoisesrc=color=pink:seed=2192:duration=25:sample_rate=16000:amplitude=0.5" \
  -af "lowpass=f=3500,tremolo=f=0.3:d=0.3" "${norm[@]}" "$tmp/noise/room.wav"

# 3. Babble bed: six talkers saying unrelated sentences with no numbers, each looped and offset.
n=0
while IFS='|' read -r voice sentence; do
  n=$((n + 1))
  espeak-ng -v "$voice" -s 160 -w "$tmp/babble$n.raw.wav" "$sentence" </dev/null
  ffmpeg -nostdin -y -v error -stream_loop -1 -i "$tmp/babble$n.raw.wav" -t 25 \
    -af "adelay=$((n * 650))|$((n * 650)),aresample=16000,aformat=channel_layouts=mono" "$tmp/babble$n.wav"
done <<'LINES'
en-us|We should walk over to the other room before the viewing ends and have a look at the furniture
en-gb|The catalogue says the frame came from a house near the coast and was restored last spring
en-us+f2|Did you see the rug by the window, the colours are lovely but the edge looks a little worn
en-gb-x-rp+f3|I told her we would meet for coffee afterwards, unless the sale runs late again
en-us+m3|Please keep your phones quiet while the auctioneer is speaking to the room
en-gb|Somebody left a coat on the chair near the back and the staff are asking whose it is
LINES
ffmpeg -nostdin -y -v error \
  -i "$tmp/babble1.wav" -i "$tmp/babble2.wav" -i "$tmp/babble3.wav" \
  -i "$tmp/babble4.wav" -i "$tmp/babble5.wav" -i "$tmp/babble6.wav" \
  -filter_complex "amix=inputs=6:duration=first:normalize=0" "${norm[@]}" "$tmp/noise/babble.wav"

# 4. Mix every clip with its bed at its SNR and seed (mix-noise.sh, R-VOX-079).
jq -r '.[] | [.id, .utterance, .noise, (.snrDb | tostring), (.seed | tostring)] | @tsv' "$manifest" |
  while IFS=$'\t' read -r id utt noise snr seed; do
    # mix-noise.sh runs ffmpeg without -nostdin, which would swallow the rest of this loop's input
    # (the first run rendered 7 clips of 120), so the call gets an empty stdin.
    bash "$here/scripts/mix-noise.sh" "$tmp/clean/$utt.wav" "$out/$id.wav" "$tmp/noise/$noise.wav" "$snr" "$seed" </dev/null
  done

# Every manifest row must have produced its clip; a short render must never read as a result.
want="$(jq 'length' "$manifest")"
got="$(find "$out" -name '*.wav' | wc -l)"
if [ "$got" != "$want" ]; then
  echo "render-heldout: expected $want clips, found $got" >&2
  exit 1
fi

(cd "$out" && sha256sum ./*.wav | sed 's# \./# #' >SHA256SUMS)
echo "rendered $(find "$out" -name '*.wav' | wc -l) clips into $out"
