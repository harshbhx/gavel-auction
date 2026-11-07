'use client';

import { Chip } from '@/components/holdline/chip';
import { gateById, repoData } from '@/lib/repo-data';
import { DiagramFrame } from './frame';
import { Defs, Legend, Node, T } from './kit';

// D3. Voice pipeline. Stages follow packages/voice (segment, stt, parser, decide) and the room
// side in packages/server (src/voice/bridge.ts, src/room/confirm.ts). The three outcomes of the
// decision step are accept, confirm and drop (packages/voice/src/decide/policy.ts, decide.ts).
export function VoiceDiagram() {
  const wrong = repoData.speech.map((r) => Number(r.wrongAccept));
  const lo = Math.min(...wrong).toFixed(3);
  const hi = Math.max(...wrong).toFixed(3);
  const g5 = gateById('G5');
  return (
    <DiagramFrame
      title="Voice pipeline and the confirm gate"
      desc="Audio goes from the microphone through a segmenter, speech to text, a parser and a decision step. The decision is accept, confirm or drop. Confirm goes to the confirm gate: the bidder is asked a question, yes places the bid after it is checked again, no or expiry places nothing. Drop is logged and places nothing. Manual entry and tap to bid skip speech and enter at the engine. A dashed path shows that a clean, high confidence parse can be accepted without the gate; the default build keeps scores below that line."
      width={1200}
      height={470}
      badge={<Chip kind={g5.status === 'FAIL' ? 'stop' : g5.status === 'PASS' ? 'solid' : 'hatched'}>{`G5 ${g5.status}`}</Chip>}
      caption={
        <>
          Read from <code>packages/voice/src/decide/policy.ts</code>, <code>decide.ts</code>, <code>score.ts</code>,{' '}
          <code>packages/server/src/voice/bridge.ts</code> and <code>room/confirm.ts</code>. The dashed red path is what
          the code allows, not what the default build does: with one parser the score tops out at 0.82, so a spoken
          bid confirms. Accuracy numbers are in the table below the figure, not drawn here.
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
            Gate G5 reads {g5.status} in docs/GATES.md. Wrong-accept {lo} to {hi} on 24 synthetic clips per set, against a limit of 0.05. No real-room or noisy-room test exists.
          </p>
        </>
      }
      render={(p) => (
        <>
          <Defs p={p} />
          <rect x={0} y={0} width={1200} height={470} style={{ fill: 'var(--hl-bg)' }} />

          {/* the speech steps */}
          <Node x={20} y={110} w={120} h={56} label="MICROPHONE" sub="audio" />
          <Node x={180} y={110} w={120} h={56} label="SEGMENTER" sub="speech segments" />
          <Node x={340} y={110} w={120} h={56} label="STT" sub="cached by default" />
          <Node x={500} y={110} w={120} h={56} label="PARSER" sub="amount, paddle" />
          <Node x={660} y={110} w={120} h={56} label="DECIDE" sub="score, classify" />
          {[140, 300, 460, 620].map((x) => (
            <path key={x} d={`M${x} 138 H${x + 40}`} className="edge" markerEnd={`url(#${p}-arrow)`} />
          ))}

          {/* confirm: the normal road */}
          <path d="M780 138 H820" className="edge-thick" markerEnd={`url(#${p}-arrow-dark)`} />
          <T x={800} y={158} anchor="middle" cls="t-small t-muted">confirm</T>
          <path d="M820 96 H990 L1000 106 V180 H820 Z" className="node" style={{ strokeWidth: 3, stroke: 'var(--hl-signal-ink)' }} />
          <rect x={820} y={96} width={180} height={7} className="rule-money" />
          <T x={910} y={134} anchor="middle" cls="t-big">CONFIRM GATE</T>
          <T x={910} y={152} anchor="middle" cls="t-small t-muted">the bidder answers</T>
          <T x={910} y={167} anchor="middle" cls="t-small t-muted">before the engine sees it</T>
          <path d="M1000 138 H1090" className="edge-thick" markerEnd={`url(#${p}-arrow-dark)`} />
          <Node x={1090} y={110} w={90} h={56} label="ENGINE" sub="then the ledger" kind="term" />

          {/* accept: the dashed bypass, above everything else so nothing crosses it */}
          <path d="M720 110 V58 H1135 V110" className="edge-stop" markerEnd={`url(#${p}-arrow-stop)`} />
          <polygon points="720,110 734,110 734,96" className="fill-stop" />
          <rect x={760} y={44} width={330} height={20} style={{ fill: 'var(--hl-bg)' }} />
          <T x={925} y={58} anchor="middle" cls="t-small t-stop">accept: skips the gate (two parsers agree, 0.85 or more)</T>
          <T x={925} y={82} anchor="middle" cls="t-small t-muted">not the default build: its scores stay under 0.85</T>

          {/* drop */}
          <path d="M700 166 V250" className="edge" markerEnd={`url(#${p}-arrow)`} />
          <T x={712} y={214} cls="t-small t-muted">drop</T>
          <rect x={590} y={250} width={220} height={56} rx={2} className="node" />
          <T x={700} y={273} anchor="middle" cls="t-small">not a bid, or too uncertain</T>
          <T x={700} y={290} anchor="middle" cls="t-small t-muted">logged, nothing placed</T>

          {/* the prompt and its two exits */}
          <path d="M910 180 V230" className="edge-thick" markerEnd={`url(#${p}-arrow-dark)`} />
          <rect x={820} y={230} width={180} height={76} rx={2} className="node" />
          <T x={910} y={252} anchor="middle" cls="t-small">Prompt to the bidder</T>
          <T x={910} y={270} anchor="middle" cls="t-small t-muted">&quot;Did you mean $150</T>
          <T x={910} y={286} anchor="middle" cls="t-small t-muted">for paddle 12?&quot;</T>

          <path d="M1000 268 H1135 V166" className="edge-thick" markerEnd={`url(#${p}-arrow-dark)`} />
          <T x={1010} y={258} cls="t-small">yes: checked again</T>
          <T x={1010} y={288} cls="t-small t-muted">against the live price</T>

          <path d="M910 306 V350" className="edge" markerEnd={`url(#${p}-arrow)`} />
          <T x={922} y={334} cls="t-small t-muted">no, or 15 s pass</T>
          <rect x={820} y={350} width={180} height={50} rx={2} className="node-stop" />
          <T x={910} y={372} anchor="middle" cls="t-small">nothing is placed</T>
          <T x={910} y={388} anchor="middle" cls="t-small t-muted">logged</T>

          {/* explicit sources skip speech */}
          <rect x={1030} y={330} width={150} height={70} rx={2} className="node" />
          <T x={1105} y={351} anchor="middle" cls="t-small">Manual entry</T>
          <T x={1105} y={367} anchor="middle" cls="t-small">Tap to bid (QR)</T>
          <T x={1105} y={388} anchor="middle" cls="t-small t-muted">skip the speech steps</T>
          <path d="M1165 330 V166" className="edge" markerEnd={`url(#${p}-arrow)`} />

          <Legend p={p} x={20} y={436} />
        </>
      )}
    />
  );
}
