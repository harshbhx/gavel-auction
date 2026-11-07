#!/usr/bin/env bash
# Render the audio evaluation clips of fixtures/audio/manifest.json with eSpeak NG (free, runs in CI).
# The speech is synthetic and noise-free: the manifest noise field is NOT applied here, so these
# clips do not test a noisy room. Output: <out dir>/<clip id>.wav, 16 kHz mono s16le, with 300 ms of
# silence on both sides.
#
# Usage: render-clips.sh [out dir]   (default fixtures/audio/recordings)
# Needs: espeak-ng, ffmpeg, jq.
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
out="${1:-$here/fixtures/audio/recordings}"
manifest="$here/fixtures/audio/manifest.json"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$out"

voice_of() {
  case "$1" in
    tts-en-GB-1) echo "en-gb" ;;
    tts-en-IN-1) echo "en-gb-x-rp+f3" ;;
    team-voice-1) echo "en-us+m3" ;;
    team-voice-2) echo "en-us+f2" ;;
    *) echo "en-us" ;;
  esac
}

jq -r '.[] | [.id, .voice, .text] | @tsv' "$manifest" | while IFS=$'\t' read -r id voice text; do
  espeak-ng -v "$(voice_of "$voice")" -s 150 -w "$tmp/$id.raw.wav" "$text" </dev/null
  ffmpeg -nostdin -y -v error -i "$tmp/$id.raw.wav" -af "adelay=300|300,apad=pad_dur=0.3" \
    -ar 16000 -ac 1 -c:a pcm_s16le -fflags +bitexact -flags:a +bitexact -map_metadata -1 \
    "$out/$id.wav"
done
echo "rendered $(find "$out" -name '*.wav' | wc -l) clips into $out"
