#!/usr/bin/env bash
# Mix a noise bed under speech at a target SNR with a seeded offset, then normalize the result to
# 16 kHz mono s16le (R-VOX-079). Deterministic: the offset derives only from the seed.
#
# Usage: mix-noise.sh <speech.wav> <out.wav> <noise.wav|none> <snr_db> <seed>
# Environment variable name: FIXTURE_FFMPEG (ffmpeg binary, default ffmpeg).
set -euo pipefail

speech="$1"
out="$2"
noise="$3"
snr="$4"
seed="$5"
ffmpeg_bin="${FIXTURE_FFMPEG:-ffmpeg}"
probe_bin="${FIXTURE_FFPROBE:-ffprobe}"

norm=(-ar 16000 -ac 1 -c:a pcm_s16le -fflags +bitexact -flags:a +bitexact -map_metadata -1)

if [ "$noise" = "none" ]; then
  "$ffmpeg_bin" -y -v error -i "$speech" "${norm[@]}" "$out"
  exit 0
fi

# RMS level in dB of a file, measured on the 16 kHz mono form.
rms_db() {
  "$ffmpeg_bin" -v info -i "$1" -ar 16000 -ac 1 -af astats=metadata=0 -f null - 2>&1 |
    awk '/Overall/ {o=1} o && /RMS level dB/ {print $NF; exit}'
}

noise_len=$("$probe_bin" -v error -show_entries format=duration -of csv=p=0 "$noise")
speech_len=$("$probe_bin" -v error -show_entries format=duration -of csv=p=0 "$speech")

# Seeded offset into the noise bed, in milliseconds, kept inside the usable range.
offset_ms=$(awk -v s="$seed" -v n="$noise_len" -v d="$speech_len" 'BEGIN {
  span = (n - d) * 1000; if (span < 1) span = 1;
  x = (s * 1103515245 + 12345) % 2147483648;
  printf "%d", x % span
}')
offset=$(awk -v ms="$offset_ms" 'BEGIN {printf "%.3f", ms / 1000}')

speech_rms=$(rms_db "$speech")
noise_rms=$(rms_db "$noise")
gain=$(awk -v sp="$speech_rms" -v nz="$noise_rms" -v snr="$snr" 'BEGIN {printf "%.3f", sp - snr - nz}')

"$ffmpeg_bin" -y -v error -i "$speech" -stream_loop -1 -ss "$offset" -i "$noise" \
  -filter_complex "[1:a]aresample=16000,aformat=channel_layouts=mono,volume=${gain}dB[n];[0:a]aresample=16000,aformat=channel_layouts=mono[s];[s][n]amix=inputs=2:duration=first:normalize=0[m]" \
  -map "[m]" "${norm[@]}" "$out"
