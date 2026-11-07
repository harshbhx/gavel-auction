'use client';

import { GateBadge } from '@/components/holdline/chip';
import { repoData } from '@/lib/repo-data';
import { DiagramFrame } from './frame';
import { Defs, Legend, Node, T } from './kit';

// D3. Voice pipeline. Stages follow packages/voice (segment, stt, parser, decide) and the room
// side in packages/server (src/voice/bridge.ts, src/room/confirm.ts). The three outcomes of the
// decision step are accept, confirm and drop (packages/voice/src/decide/policy.ts, decide.ts).
export function VoiceDiagram() {
  const wrong = repoData.speech.map((r) => Number(r.wrongAccept));
  const lo = Math.min(...wrong).toFixed(3);
  const hi = Math.max(...wrong).toFixed(3);
  return (
    <DiagramFrame
      title="Voice pipeline and the confirm gate"
      desc="Audio goes from the microphone through a segmenter, speech to text, a parser and a decision step. The decision is accept, confirm or drop. Confirm goes to the confirm gate: the bidder is asked a question, yes places the bid after it is checked again, no or expiry places nothing. Drop is logged and places nothing. Manual entry and tap to bid skip speech and enter at the engine. A dashed path shows that a clean, high confidence parse can be accepted without the gate; the default build keeps scores below that line. Speech accuracy gate G5 is PARTIAL: synthetic, noise-free audio only."
      width={1200}
      height={660}
      badge={<GateBadge id="G5" />}
      caption={
        <>
          Speech accuracy gate G5 is PARTIAL (synthetic, noise-free audio, no real-room test), which is why spoken bids
          always wait for a confirmation. The dashed path is what the code allows today: a spoken bid with a clean
          parse that two parsers agree on and a confidence of 0.85 or more is accepted without the gate.
          Without a second parser opinion the score tops out at 0.82 (see{' '}
          <code>packages/voice/src/decide/score.ts</code>), so such a bid confirms. A stricter always-confirm
          setting is a product decision recorded in <code>docs/GATES.md</code>, not yet a code switch.
        </>
      }
      transcript={
        <>
          <ol>
            <li>Microphone audio is cut into segments.</li>
            <li>Speech to text turns a segment into a transcript. The default build plays cached transcripts; a live provider (Groq or Deepgram) runs only when VOICE_STT is set with its key.</li>
            <li>The parser reads amount, paddle and intent from the transcript.</li>
            <li>The decision step merges parser opinions, scores confidence and validates the bid against the room. The result is accept, confirm or drop.</li>
            <li>Confirm: the bidder is asked, for example &quot;Did you mean $150 for paddle 12?&quot;. Yes places the bid after it is checked against the current price. No or expiry places nothing and is logged.</li>
            <li>Drop: nothing is placed, the decision is logged.</li>
            <li>Accept (dashed): a clean parse with confidence of 0.85 or more that both parsers agree on skips the gate and goes to the engine.</li>
            <li>Manual entry by the auctioneer and tap to bid skip speech and enter at the engine.</li>
            <li>The engine accepts or rejects the bid and an accepted bid is appended to the hash-chained ledger.</li>
          </ol>
          <p>
            Gate G5 is PARTIAL: wrong-accept {lo} to {hi} on 24 synthetic, noise-free clips per set (limit 0.05), after fixes chosen on those same clips. No real-room or noisy-room test exists, and spoken bids always confirm.
          </p>
        </>
      }
      render={(p) => (
        <>
          <Defs p={p} />
          <rect x={0} y={0} width={1200} height={660} style={{ fill: 'var(--hl-bg)' }} />
          <Legend p={p} x={30} y={24} />

          <Node x={20} y={140} w={100} label="MICROPHONE" />
          <Node x={160} y={140} w={110} label="SEGMENTER" />
          <Node x={310} y={140} w={90} label="STT" />
          <Node x={440} y={140} w={100} label="PARSER" />
          <Node x={580} y={140} w={100} label="DECIDE" />
          <Node x={960} y={140} w={90} label="ENGINE" kind="term" />
          <Node x={1090} y={140} w={90} label="LEDGER" kind="term" />

          {/* the gate: large, notched, brass */}
          <path d="M740 124 H895 L910 139 V220 H740 Z" className="node" style={{ strokeWidth: 3, stroke: 'var(--hl-signal-ink)' }} />
          <rect x={740} y={124} width={170} height={7} className="rule-money" />
          <T x={825} y={166} anchor="middle" cls="t-big">CONFIRM GATE</T>
          <T x={825} y={186} anchor="middle" cls="t-small t-muted">the bidder answers</T>
          <T x={825} y={202} anchor="middle" cls="t-small t-muted">before the engine sees it</T>

          {/* stage notes */}
          <T x={20} y={226} cls="t-small t-muted">audio</T>
          <T x={160} y={226} cls="t-small t-muted">speech segments</T>
          <T x={310} y={226} cls="t-small t-muted">transcript</T>
          <T x={310} y={241} cls="t-small t-muted">cached by default</T>
          <T x={440} y={226} cls="t-small t-muted">amount, paddle,</T>
          <T x={440} y={241} cls="t-small t-muted">intent</T>
          <T x={580} y={226} cls="t-small t-muted">merge, score,</T>
          <T x={580} y={241} cls="t-small t-muted">validate, classify</T>

          {/* main arrows */}
          <path d="M120 168 H160" className="edge" markerEnd={`url(#${p}-arrow)`} />
          <path d="M270 168 H310" className="edge" markerEnd={`url(#${p}-arrow)`} />
          <path d="M400 168 H440" className="edge" markerEnd={`url(#${p}-arrow)`} />
          <path d="M540 168 H580" className="edge" markerEnd={`url(#${p}-arrow)`} />
          <path d="M680 168 H740" className="edge-thick" markerEnd={`url(#${p}-arrow-dark)`} />
          <T x={710} y={158} anchor="middle" cls="t-small t-muted">confirm</T>
          <path d="M910 168 H960" className="edge-thick" markerEnd={`url(#${p}-arrow-dark)`} />
          <path d="M1050 168 H1090" className="edge" markerEnd={`url(#${p}-arrow)`} />

          {/* accept: dashed bypass, with the review notch */}
          <path d="M630 140 V96 H1005 V140" className="edge-stop" markerEnd={`url(#${p}-arrow-stop)`} />
          <polygon points="630,140 644,140 644,126" className="fill-stop" />
          <T x={640} y={72} cls="t-small t-stop">accept: clean parse, both parsers agree, confidence 0.85 or more</T>
          <T x={640} y={88} cls="t-small t-muted">skips the gate. Not the default build: its scores stay below 0.85.</T>

          {/* drop */}
          <path d="M630 196 V300" className="edge" markerEnd={`url(#${p}-arrow)`} />
          <rect x={470} y={300} width={220} height={50} rx={2} className="node" />
          <T x={580} y={321} anchor="middle" cls="t-small">drop: not a bid, or</T>
          <T x={580} y={337} anchor="middle" cls="t-small t-muted">too uncertain. Logged.</T>

          {/* the prompt and its exits */}
          <path d="M825 220 V290" className="edge-thick" markerEnd={`url(#${p}-arrow-dark)`} />
          <rect x={720} y={290} width={210} height={64} rx={2} className="node" />
          <T x={825} y={313} anchor="middle" cls="t-small">Prompt to the bidder:</T>
          <T x={825} y={329} anchor="middle" cls="t-small t-muted">&quot;Did you mean $150</T>
          <T x={825} y={344} anchor="middle" cls="t-small t-muted">for paddle 12?&quot;</T>

          <path d="M930 322 H985 V196" className="edge-thick" markerEnd={`url(#${p}-arrow-dark)`} />
          <T x={995} y={262} cls="t-small">Yes: checked again</T>
          <T x={995} y={277} cls="t-small t-muted">against the live price</T>

          <path d="M825 354 V420" className="edge" markerEnd={`url(#${p}-arrow)`} />
          <rect x={720} y={420} width={210} height={50} rx={2} className="node-stop" />
          <T x={825} y={441} anchor="middle" cls="t-small">No, or the prompt expires:</T>
          <T x={825} y={457} anchor="middle" cls="t-small t-muted">nothing is placed. Logged.</T>

          {/* explicit sources skip speech */}
          <rect x={960} y={430} width={220} height={74} rx={2} className="node" />
          <T x={1070} y={452} anchor="middle" cls="t-small">Manual entry (auctioneer)</T>
          <T x={1070} y={468} anchor="middle" cls="t-small">Tap to bid (QR)</T>
          <T x={1070} y={488} anchor="middle" cls="t-small t-muted">explicit: skip the speech steps</T>
          <path d="M1040 430 V196" className="edge" markerEnd={`url(#${p}-arrow)`} />

          {/* honesty block, on the figure */}
          <rect x={20} y={380} width={660} height={160} className="panel" style={{ stroke: 'var(--hl-stop)', strokeWidth: 2 }} />
          <polygon points="666,380 680,380 680,394" className="fill-stop" />
          <T x={36} y={404} cls="t-big t-stop">G5 PARTIAL: synthetic audio only</T>
          <T x={36} y={428} cls="t-small">{`Wrong-accept ${lo} to ${hi} on 24 synthetic clips per set (limit 0.05).`}</T>
          <T x={36} y={448} cls="t-small">Default build plays cached transcripts. Live speech to text runs only</T>
          <T x={36} y={463} cls="t-small">with VOICE_STT set (groq or deepgram) and its key.</T>
          <T x={36} y={483} cls="t-small">Fixes were chosen on these same clips. No real-room test. Bids confirm.</T>
          <T x={36} y={503} cls="t-small t-muted">Hard flags always confirm: correction, hedged, large jump, several amounts</T>
          <T x={36} y={518} cls="t-small t-muted">or bidders, unregistered paddle, implausible amount.</T>

          <rect x={20} y={560} width={1160} height={70} className="panel" />
          <T x={36} y={584} cls="t-small">Where this lives:</T>
          <T x={36} y={604} cls="t-small t-muted">packages/voice/src/decide/ (policy, decide, score, answer), packages/voice/src/pipeline/pipeline.ts,</T>
          <T x={36} y={619} cls="t-small t-muted">packages/server/src/voice/bridge.ts, packages/server/src/room/confirm.ts (held bid, 15 s), voice prompt expiry 10 s.</T>
        </>
      )}
    />
  );
}
