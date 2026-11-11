'use client';

import type { ReactNode } from 'react';
import { GateBadge } from '@/components/holdline/chip';
import { repoData } from '@/lib/repo-data';
import { DiagramFrame } from './frame';
import { DetailPanel, StepControls, stepStyle, useHot, useSteps, type Steps } from './interactive';
import { Defs, Legend, T, hatch } from './kit';

// D11. Voice pipeline in detail. Every box, number and label below was read from the code:
//   browser capture   packages/voice/src/browser/mute.ts (keepalive 5000 ms, push to talk),
//                     audio/queue.ts (50 batches, oldest dropped), browser/degraded.ts (DropMonitor:
//                     more than 2000 ms dropped in 10 s), browser/capture-state.ts (degraded message)
//   /audio socket     packages/server/src/host/audio-ws.ts (auth message within 5 s, auctioneer token,
//                     close codes), packages/voice/src/session.ts (rate and session limits)
//   provider chain    packages/server/src/voice/stt.ts (chooseStt), packages/voice/src/stt/failover.ts
//                     (3000 ms silence, 4000 ms late final, two errors, 30000 ms circuit), select.ts
//   decide            packages/voice/src/segment/*, decide/policy.ts (HARD_FLAGS, 0.85, 0.50)
//   room              packages/server/src/voice/bridge.ts, room/confirm.ts (needsConfirm, 15 s hold)

type Item = { id: string; step: number; title: string; detail: ReactNode };

const items: Item[] = [
  {
    id: 'mic',
    step: 0,
    title: 'Microphone',
    detail: 'The browser captures audio and cuts it into 20 ms frames (packages/voice/src/browser/capture.ts, audio/frame.ts).',
  },
  {
    id: 'mute',
    step: 0,
    title: 'MuteController',
    detail: (
      <>
        Mute, push to talk and device loss sit in front of the sink (<code>browser/mute.ts</code>). While muted no audio is sent;
        an empty keepalive batch goes out every 5000 ms so the stream stays open, and muting tells the provider the
        utterance is over. Push to talk starts muted and un-mutes on the talk key. One automatic restart is tried when
        the microphone track ends.
      </>
    ),
  },
  {
    id: 'queue',
    step: 1,
    title: 'AudioQueue',
    detail: (
      <>
        A bounded send queue of 50 batches (<code>audio/queue.ts</code>). When it is full, or the socket buffer is over
        65536 bytes, the oldest batch is dropped and the next batch carries a discontinuity flag. Dropped milliseconds are counted.
      </>
    ),
  },
  {
    id: 'drop',
    step: 1,
    title: 'DropMonitor',
    detail: (
      <>
        A sliding window over the queue counters (<code>browser/degraded.ts</code>): more than 2000 ms dropped inside 10 s
        raises <code>queue_drop</code>; 10 s with no new drop raises <code>recovered</code>.
      </>
    ),
  },
  {
    id: 'degraded',
    step: 1,
    title: 'Capture state: degraded',
    detail: (
      <>
        <code>browser/capture-state.ts</code> moves running to degraded and the person sees: &quot;Connection is slow, voice
        bids may be missed. Use manual entry.&quot; Manual entry always works.
      </>
    ),
  },
  {
    id: 'ws',
    step: 2,
    title: '/audio WebSocket',
    detail: (
      <>
        The first message must be an auth text frame with the auctioneer token within 5 seconds, or the socket closes with 4401
        (<code>host/audio-ws.ts</code>). The token is not in the URL. Limits from <code>voice/src/session.ts</code>: 64 KiB per second, 100
        frames per second, 30 minutes per stream, 2 streams per token, 4 per room. The microphone is the room&apos;s: the bidder
        comes from the paddle that was heard, never from the token.
      </>
    ),
  },
  {
    id: 'stt',
    step: 3,
    title: 'Deepgram',
    detail: (
      <>
        With <code>VOICE_STT</code> unset the cached provider runs and needs no key. With <code>VOICE_STT=deepgram</code> and a Groq key the
        chain is Deepgram, then Groq, then cached replay (<code>server/src/voice/stt.ts</code>). A provider is replaced when it is
        silent 3000 ms after audio starts, answers a final more than 4000 ms after speech ends, errors twice in a row, fails fatally
        or closes (<code>stt/failover.ts</code>). The last 5000 ms of audio is replayed into the next provider. Deepgram is probed again after 30 s.
      </>
    ),
  },
  {
    id: 'groq',
    step: 3,
    title: 'Groq',
    detail: 'Second in the chain (stt/groq.ts). Used when Deepgram has no key, or after Deepgram was switched out. It is called with the audio over HTTP rather than a socket.',
  },
  {
    id: 'cached',
    step: 3,
    title: 'Cached replay',
    detail: 'The last link: recorded transcripts played back (stt/replay.ts). It is the whole chain in the default build and needs no key. A cached provider with no recording hears nothing, so it is never swapped in for a live one.',
  },
  {
    id: 'seg',
    step: 4,
    title: 'Segmenter',
    detail: (
      <>
        Turns final transcripts into segments and drops empty, too long, auctioneer talk (&quot;going once&quot;, &quot;sold&quot;) and
        duplicate ones (<code>segment/segmenter.ts</code>, <code>segment/echo.ts</code>).
      </>
    ),
  },
  {
    id: 'parser',
    step: 4,
    title: 'Rule parser',
    detail: 'Reads amount, paddle and intent from the words (packages/voice/src/parser). The parser emits only a few confidence values; see the G5 calibration in docs/GATES.md.',
  },
  {
    id: 'decide',
    step: 4,
    title: 'Score and classify',
    detail: (
      <>
        <code>decide/policy.ts</code>: no bid found is a drop; a hard flag (correction, hedged, several amounts or bidders, homophone, unregistered paddle,
        large jump, implausible amount and others) always confirms; below 0.50 drops; below 0.85 confirms; otherwise accept.
      </>
    ),
  },
  {
    id: 'accept',
    step: 5,
    title: 'accept',
    detail: 'Confidence 0.85 or more and no hard flag. The bridge turns it into a voice bid that carries its confidence (server/src/voice/bridge.ts).',
  },
  {
    id: 'confirm',
    step: 5,
    title: 'confirm',
    detail: 'Between 0.50 and 0.85, or any hard flag. The bridge submits it as a voice bid flagged ambiguous; the room holds it.',
  },
  {
    id: 'dropout',
    step: 5,
    title: 'drop',
    detail: 'Below 0.50 or nothing that looks like a bid. No bid is placed.',
  },
  {
    id: 'gate',
    step: 5,
    title: 'Room gate',
    detail: (
      <>
        <code>needsConfirm</code> in <code>room/confirm.ts</code>: a voice bid below the threshold (a missing confidence counts as zero) or flagged ambiguous is
        held. The room&apos;s threshold is 0.85 (<code>boot/compose.ts</code>). A bid labelled qr or manual that carries a transcript or confidence is held like a voice bid.
      </>
    ),
  },
  {
    id: 'droprec',
    step: 5,
    title: 'Drop record',
    detail: 'A decision that made no bid is stored in the audit trail without its transcript (dropOf in server/src/voice/bridge.ts). Confirm options that were not held are recorded too.',
  },
  {
    id: 'held',
    step: 6,
    title: 'Held for 15 s',
    detail: (
      <>
        The engine has not seen the bid. Its bidder is asked (<code>confirm_request</code>) and has 15 seconds (<code>CONFIRM_TTL_MS</code> in <code>room/confirm.ts</code>). One held bid per bidder.
      </>
    ),
  },
  {
    id: 'engine',
    step: 6,
    title: 'Engine',
    detail: 'A yes runs the normal bid pipeline at the server time of the answer, so price, increment and ceiling are checked again (room.ts respondConfirm). A bid at 0.85 or more that is not flagged goes here directly.',
  },
];

const byId = Object.fromEntries(items.map((i) => [i.id, i]));
const details = Object.fromEntries(
  items.map((i) => [i.id, <span key={i.id}><strong>{i.title}.</strong> {i.detail}</span>]),
);

const stepLabels: ReactNode[] = [
  <span key="0"><strong>Capture.</strong> The browser captures audio. Muting stops the audio and sends a keepalive every 5 seconds instead.</span>,
  <span key="1"><strong>Send queue and drop monitor.</strong> If the connection is too slow, old audio is dropped, and more than 2 seconds lost in 10 seconds puts capture into the degraded state with a message to use manual entry.</span>,
  <span key="2"><strong>Audio socket.</strong> The auctioneer token is the first message; limits apply to rate, size and duration. The microphone belongs to the room.</span>,
  <span key="3"><strong>Speech to text.</strong> Deepgram, then Groq, then cached replay, switching on silence, lateness, errors or a closed stream.</span>,
  <span key="4"><strong>Understand.</strong> Segments are parsed, scored and classified as accept, confirm or drop. Hard flags always confirm.</span>,
  <span key="5"><strong>Room gate.</strong> Confirm and low confidence bids are held, a drop is recorded, a clean bid at 0.85 or more goes to the engine.</span>,
  <span key="6"><strong>Answer.</strong> Yes is checked again by the engine at the time of the answer. No, or 15 seconds of silence, places nothing and is audited.</span>,
];

function Box({
  id,
  x,
  y,
  w,
  h = 56,
  steps,
  hot,
  kind = 'node',
  held,
  p,
  sub,
}: {
  id: string;
  x: number;
  y: number;
  w: number;
  h?: number;
  steps: Steps;
  hot: ReturnType<typeof useHot>;
  kind?: 'node' | 'stop' | 'term';
  held?: boolean;
  p: string;
  sub?: string;
}) {
  const it = byId[id];
  if (!it) return null;
  const active = hot.active === id;
  return (
    <g {...hot.props(id)} aria-label={it.title} style={{ ...stepStyle(steps, it.step), cursor: 'pointer', outline: 'none' }}>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={2}
        className={kind === 'stop' ? 'node-stop' : kind === 'term' ? 'node-term' : 'node'}
        style={{ ...(held ? { fill: hatch(p) } : {}), strokeWidth: active || steps.index === it.step ? 3 : undefined }}
              />
      <rect x={x + 8} y={y + h / 2 - (sub ? 15 : 9)} width={w - 16} height={sub ? 34 : 18} rx={1} style={{ fill: 'var(--hl-panel)', opacity: held ? 0.92 : 0 }} />
      <text x={x + w / 2} y={y + (sub ? h / 2 - 2 : h / 2 + 4.5)} textAnchor="middle" className="t-big" style={{ fontSize: 12.5 }}>
        {it.title}
      </text>
      {sub && (
        <text x={x + w / 2} y={y + h / 2 + 13} textAnchor="middle" className="t-muted t-small">
          {sub}
        </text>
      )}
    </g>
  );
}

function Edge({ d, step, steps, p, cls = 'edge', arrow = 'arrow', label, lx, ly, anchor = 'middle' }: {
  d: string;
  step: number;
  steps: Steps;
  p: string;
  cls?: string;
  arrow?: 'arrow' | 'arrow-stop' | 'arrow-dark';
  label?: string;
  lx?: number;
  ly?: number;
  anchor?: 'start' | 'middle' | 'end';
}) {
  return (
    <g style={stepStyle(steps, step)}>
      <path d={d} className={cls} markerEnd={`url(#${p}-${arrow})`} />
      {label && lx !== undefined && ly !== undefined && (
        <T x={lx} y={ly} anchor={anchor} cls="t-small t-muted">
          {label}
        </T>
      )}
    </g>
  );
}

export function VoicePipelineDiagram() {
  const steps = useSteps(7, 6);
  const hot = useHot();
  const wrong = repoData.speech.map((r) => Number(r.wrongAccept));
  const lo = Math.min(...wrong).toFixed(3);
  const hi = Math.max(...wrong).toFixed(3);
  return (
    <DiagramFrame
      title="Voice pipeline in detail: capture to engine"
      desc="Four bands from top to bottom. Browser: microphone, mute controller, a 50 batch audio queue, a drop monitor and the degraded state. Server: the audio socket with a token in the first message, then speech to text through Deepgram, Groq and cached replay, then a segmenter. Decide: rule parser, score and classify into accept, confirm or drop. Room: the room gate holds low confidence or ambiguous bids for 15 seconds and asks the bidder; a yes goes to the engine, a clean bid at 0.85 or more goes straight to the engine, a drop is recorded without its transcript."
      width={1200}
      height={590}
      badge={<GateBadge id="G5" />}
      toolbar={
        <div className="space-y-3">
          <StepControls steps={steps} labels={stepLabels} />
          <DetailPanel active={hot.active} details={details} hint="Hover or focus a box for what it does and which file implements it." />
        </div>
      }
      caption={
        <>
          Read from <code>packages/voice/src/browser</code> (mute, queue, drop monitor), <code>packages/server/src/host/audio-ws.ts</code>,{' '}
          <code>packages/server/src/voice/stt.ts</code>, <code>packages/voice/src/stt/failover.ts</code>, <code>packages/voice/src/decide/policy.ts</code>,{' '}
          <code>packages/server/src/voice/bridge.ts</code> and <code>packages/server/src/room/confirm.ts</code>. The default build plays cached transcripts;
          a live provider needs <code>VOICE_STT</code> and its key. Speech accuracy gate G5 was tested with synthetic voice clips: wrong-accept {lo} to {hi} on 24 synthetic, noise-free clips per set (limit 0.05), after fixes chosen on those same clips; voice was tested with
          synthetic speech clips. A clean bid at 0.85 or more is not held by the code today, so spoken bids go through the confirm
          prompt by decision in <code>docs/GATES.md</code>, not by a code switch.
        </>
      }
      transcript={
        <>
          <ol>
            <li>Browser: the microphone feeds a mute controller. Muted means no audio, a keepalive every 5000 ms, and the utterance is ended.</li>
            <li>A send queue holds 50 batches and drops the oldest when full. The drop monitor raises a degraded state when more than 2000 ms were dropped in 10 s; the person is told to use manual entry. It recovers after 10 s without drops.</li>
            <li>The /audio socket needs the auctioneer token as its first message within 5 s. Limits: 64 KiB per second, 100 frames per second, 30 minutes, 2 streams per token, 4 per room.</li>
            <li>Speech to text: Deepgram, then Groq, then cached replay when VOICE_STT is deepgram and a Groq key exists. Switch triggers: silent 3000 ms, late final 4000 ms, two errors in a row, fatal, closed. Deepgram is tried again after 30 s.</li>
            <li>The segmenter removes auctioneer talk and duplicates. The rule parser reads amount, paddle and intent. Decide classifies: hard flags confirm, below 0.50 drop, below 0.85 confirm, else accept.</li>
            <li>The room holds a voice bid below 0.85 or flagged ambiguous for 15 seconds and asks the bidder. A drop is stored without its transcript. A clean bid at 0.85 or more goes to the engine.</li>
            <li>A yes is checked again by the engine at the server time of the answer. A no or an expiry places nothing and is audited.</li>
          </ol>
          <p>
            Gate G5: wrong-accept {lo} to {hi} on 24 synthetic, noise-free clips per set (limit 0.05), fixes chosen on the same clips. Tested with synthetic clips; the confirm step stays.
          </p>
        </>
      }
      render={(p) => (
        <>
          <Defs p={p} />
          <rect x={0} y={0} width={1200} height={590} style={{ fill: 'var(--hl-bg)' }} />
          <Legend p={p} x={30} y={8} />

          {/* band 1: browser */}
          <rect x={10} y={40} width={1180} height={130} className="panel" />
          <T x={1180} y={58} anchor="end" cls="t-small t-ink">BROWSER</T>
          <Box id="mic" x={30} y={84} w={110} steps={steps} hot={hot} p={p} />
          <Box id="mute" x={190} y={84} w={190} steps={steps} hot={hot} p={p} sub="mute, push to talk" />
          <Box id="queue" x={430} y={84} w={180} steps={steps} hot={hot} p={p} sub="50 batches, drops oldest" />
          <Box id="drop" x={660} y={84} w={180} steps={steps} hot={hot} p={p} sub="over 2 s lost in 10 s" />
          <Box id="degraded" x={890} y={84} w={280} steps={steps} hot={hot} p={p} kind="stop" sub="manual entry offered" />
          <Edge d="M140 112 H190" step={0} steps={steps} p={p} />
          <Edge d="M380 112 H430" step={1} steps={steps} p={p} />
          <Edge d="M610 112 H660" step={1} steps={steps} p={p} cls="edge-dash" />
          <Edge d="M840 112 H890" step={1} steps={steps} p={p} cls="edge-stop" arrow="arrow-stop" />
          <T x={285} y={158} anchor="middle" cls="t-small t-muted">keepalive every 5 s while muted</T>

          {/* band 2: server */}
          <rect x={10} y={190} width={1180} height={160} className="panel" />
          <T x={1180} y={208} anchor="end" cls="t-small t-ink">SERVER: /audio SOCKET AND SPEECH TO TEXT</T>
          <Box id="ws" x={30} y={232} w={210} steps={steps} hot={hot} p={p} sub="auctioneer token in 5 s" />
          <rect x={282} y={224} width={540} height={72} fill="none" className="guide-dash" style={stepStyle(steps, 3)} />
          <Box id="stt" x={300} y={232} w={130} steps={steps} hot={hot} p={p} sub="first" />
          <Box id="groq" x={490} y={232} w={110} steps={steps} hot={hot} p={p} sub="second" />
          <Box id="cached" x={660} y={232} w={140} steps={steps} hot={hot} p={p} sub="last" />
          <Box id="seg" x={880} y={232} w={160} steps={steps} hot={hot} p={p} sub="drops echo, duplicates" />
          <Edge d="M520 140 V180 H135 V232" step={2} steps={steps} p={p} />
          <Edge d="M240 260 H300" step={3} steps={steps} p={p} />
          <Edge d="M430 260 H490" step={3} steps={steps} p={p} />
          <Edge d="M600 260 H660" step={3} steps={steps} p={p} />
          <Edge d="M822 260 H880" step={4} steps={steps} p={p} />
          <T x={300} y={316} cls="t-small t-muted">VOICE_STT=deepgram with a Groq key. Switch on: no event 3 s after audio, final later than 4 s,</T>
          <T x={300} y={331} cls="t-small t-muted">two errors in a row, fatal, closed. Deepgram is tried again after 30 s. Default build: cached replay only.</T>

          {/* band 3: decide, room, engine */}
          <rect x={10} y={370} width={1180} height={210} className="panel" />
          <T x={1180} y={388} anchor="end" cls="t-small t-ink">DECIDE, ROOM GATE AND ENGINE</T>
          <Box id="parser" x={30} y={406} w={130} steps={steps} hot={hot} p={p} sub="amount, paddle" />
          <Box id="decide" x={200} y={406} w={170} steps={steps} hot={hot} p={p} sub="hard flags confirm" />
          <Box id="accept" x={420} y={392} w={150} h={40} steps={steps} hot={hot} p={p} />
          <Box id="confirm" x={420} y={440} w={150} h={40} steps={steps} hot={hot} p={p} />
          <Box id="dropout" x={420} y={488} w={150} h={40} steps={steps} hot={hot} p={p} />
          <Box id="gate" x={650} y={420} w={190} steps={steps} hot={hot} p={p} sub="below 0.85 or ambiguous" />
          <Box id="droprec" x={650} y={488} w={190} h={40} steps={steps} hot={hot} p={p} />
          <Box id="held" x={890} y={412} w={150} steps={steps} hot={hot} p={p} held sub="bidder is asked" />
          <Box id="engine" x={1075} y={412} w={100} steps={steps} hot={hot} p={p} kind="term" />
          <Edge d="M960 288 V360 H95 V406" step={4} steps={steps} p={p} />
          <Edge d="M160 434 H200" step={4} steps={steps} p={p} />
          <Edge d="M370 434 H395 V412 H420" step={5} steps={steps} p={p} />
          <Edge d="M395 434 V460 H420" step={5} steps={steps} p={p} />
          <Edge d="M395 434 V508 H420" step={5} steps={steps} p={p} />
          <Edge d="M570 412 H610 V440 H650" step={5} steps={steps} p={p} />
          <Edge d="M570 460 H610 V456 H650" step={5} steps={steps} p={p} />
          <Edge d="M570 508 H650" step={5} steps={steps} p={p} />
          <Edge d="M840 440 H890" step={5} steps={steps} p={p} label="hold" lx={865} ly={432} />
          <Edge d="M1040 440 H1075" step={6} steps={steps} p={p} arrow="arrow-dark" label="yes" lx={1058} ly={432} />
          <Edge d="M840 466 H860 V548 H1125 V468" step={6} steps={steps} p={p} arrow="arrow-dark" />
          <T x={990} y={564} anchor="middle" cls="t-small t-muted">0.85 or more and not flagged: straight to the engine</T>
          <Edge d="M965 468 V518" step={6} steps={steps} p={p} cls="edge-stop" arrow="arrow-stop" />
          <T x={975} y={534} anchor="start" cls="t-small t-stop">no or 15 s: no bid, audited</T>
        </>
      )}
    />
  );
}
