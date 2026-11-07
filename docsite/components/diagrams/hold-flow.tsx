'use client';

import { Chip } from '@/components/holdline/chip';
import { DiagramFrame } from './frame';
import { DetailPanel, StepControls, stepStyle, useHot, useSteps, type Steps } from './interactive';
import { Defs, Legend, T, hatch } from './kit';

// D. Buyer registration and hold flow. Every message and state is read from:
//   packages/web/src/screens/register/RegisterScreen.tsx   name and ceiling presets (default 10000, 25000, 50000, 100000 cents)
//   packages/web/src/payments/paypalV6Adapter.ts           popup session, onApprove order check, release, redirect fallback
//   packages/web/src/payments/port.ts                      approval states (preparing, awaiting_buyer, confirming, held, ...)
//   packages/server/src/http/holds.ts                      the four /api/holds routes and what they check
//   packages/payments/src/holds/service.ts                 createHoldOrder, completeApproval, abandonHold, hold records
//   packages/payments/src/ceiling.ts                       ceiling validation
//   packages/payments/src/webhooks/merge.ts                the order of hold states (mergeStatus)
// Evidence: G2 PASS (wallet and guest card AUTHORIZE reached onApprove and authorized in SDK v6, sandbox,
// 5 Nov 2026). G1 captured PayPal-account orders only; capture of a guest card authorization never ran.

const W = 1100;
const H = 800;
const LANES = [
  { id: 'popup', x: 120, label: 'PayPal popup', sub: 'buyer approves' },
  { id: 'web', x: 390, label: 'Buyer browser', sub: 'packages/web' },
  { id: 'srv', x: 660, label: 'GAVEL server', sub: 'POST /api/holds' },
  { id: 'pp', x: 930, label: 'PayPal Orders API', sub: 'sandbox or fake' },
] as const;
const LX: Record<(typeof LANES)[number]['id'], number> = { popup: 120, web: 390, srv: 660, pp: 930 };
type Lane = keyof typeof LX;

const STEPS: { title: string; body: string }[] = [
  {
    title: 'Choose a name and a ceiling',
    body: 'The buyer types a display name and picks one of the room presets (the web default is 100, 250, 500 or 1,000 dollars, in cents 10000, 25000, 50000, 100000). The ceiling is the most they can ever be charged. Nothing has been sent yet.',
  },
  {
    title: 'Ask the server for a hold order',
    body: 'The browser sends POST /api/holds with the auction id and the chosen ceiling in cents. It sends no bidder id: the server takes the bidder from the session token. Web state: preparing.',
  },
  {
    title: 'The server creates the AUTHORIZE order',
    body: 'The server refuses a closed auction, then checks the ceiling: a whole number of cents, at least 100, at most the cap, and one of the auction presets. Only then does it create an Orders v2 order with intent AUTHORIZE for exactly that amount, under a fixed request id, and store a hold in PENDING_APPROVAL. The answer is 201 with holdId and orderId.',
  },
  {
    title: 'The PayPal popup opens',
    body: 'The browser loads the sandbox SDK only now and starts a one-time payment session in a popup for that order id. Web state: awaiting_buyer. The funding choice, PayPal wallet or guest card, is made inside the popup; this code does not branch on it.',
  },
  {
    title: 'The buyer approves',
    body: 'onApprove hands back an order id. The adapter accepts it only if it is the order this attempt created; any other id is an error (order_mismatch) and the unapproved hold is released. A closed popup (cancelled) or a declined instrument also releases it with DELETE /api/holds/:id.',
  },
  {
    title: 'Authorize the approved order',
    body: 'The browser sends POST /api/holds/:holdId/approve with the order id and the name. The server checks that the session owns the hold and the auction still takes holds, then authorizes the order under a fixed request id and stores the authorization id PayPal returns. Web state: confirming.',
  },
  {
    title: 'The hold is HELD',
    body: 'The record becomes HELD. Its ceiling is the smaller of the ceiling asked for and the amount PayPal authorized. The browser shows only the amount the server confirmed, and treats any other amount as an error (hold_mismatch). The bidder is then registered in the room. Web state: held.',
  },
  {
    title: 'Other paths: what else can happen',
    body: 'Popup blocked or failed: the adapter can redirect to an approve link and finish on the return route, but only when the order answer carries approveUrl, which the server route does not return today. A lost authorize answer: the order is read back and an existing CREATED authorization is adopted. Later: capture, void, expiry, denial, or an unknown reading.',
  },
];

const DETAILS: Record<string, string> = {
  PENDING_APPROVAL:
    'PENDING_APPROVAL: the order exists, nothing is held. A pending order is reused for up to 3 hours (pendingTtlMs) when the same ceiling is asked for again. packages/payments/src/holds/service.ts',
  HELD: 'HELD: PayPal returned an authorization (status CREATED). The hold stays HELD until a capture or a void. packages/payments/src/holds/service.ts, complete()',
  CAPTURED:
    'CAPTURED: the winner. Set by the settlement saga and confirmed by webhooks or reconciliation. Never moves back to HELD. packages/payments/src/webhooks/merge.ts',
  VOIDED: 'VOIDED: the authorization was released. A final state. packages/payments/src/webhooks/merge.ts',
  EXPIRED:
    'EXPIRED: an unapproved order was abandoned (cancel, decline, mismatch, a lapsed or different-amount order), or PayPal reports expiry. A final state. If PayPal already holds an authorization on that order it is voided first. packages/payments/src/holds/service.ts, abandonPending()',
  DENIED: 'DENIED: PayPal denied the authorization. A final state. packages/payments/src/types.ts, webhooks/merge.ts',
  UNKNOWN:
    'UNKNOWN: PayPal could not find the authorization when asked. Not applied on its own; the next real reading replaces it. packages/payments/src/webhooks/merge.ts, truthToStatus()',
};

function Msg({
  steps,
  at,
  from,
  to,
  y,
  label,
  dashed,
  id,
}: {
  steps: Steps;
  at: number;
  from: Lane;
  to: Lane;
  y: number;
  label: string;
  dashed?: boolean;
  id: string;
}) {
  const x1 = LX[from];
  const x2 = LX[to];
  const dir = x2 > x1 ? 1 : -1;
  return (
    <g style={stepStyle(steps, at)}>
      <path
        d={`M${x1 + dir * 4} ${y} H${x2 - dir * 4}`}
        className={dashed ? 'edge-dash' : 'edge'}
        markerEnd={`url(#${id}-arrow)`}
      />
      <T x={(x1 + x2) / 2} y={y - 7} anchor="middle" cls="t-small">
        {label}
      </T>
    </g>
  );
}

function StateBox({
  p,
  x,
  y,
  w,
  name,
  fill,
  lit,
  hot,
}: {
  p: string;
  x: number;
  y: number;
  w: number;
  name: string;
  fill: 'hatch' | 'solid' | 'hollow' | 'stop';
  lit: boolean;
  hot: ReturnType<typeof useHot>;
}) {
  return (
    <g {...hot.props(name)} style={{ cursor: 'pointer', outline: 'none', opacity: lit ? 1 : 0.4 }}>
      <rect x={x} y={y} width={w} height={40} rx={2} className={fill === 'stop' ? 'node-stop' : 'node'} />
      {fill === 'hatch' && <rect x={x + 8} y={y + 13} width={22} height={14} fill={hatch(p)} className="fill-hatch-edge" />}
      {fill === 'solid' && <rect x={x + 8} y={y + 13} width={22} height={14} className="fill-solid" />}
      {fill === 'hollow' && <rect x={x + 8} y={y + 13} width={22} height={14} className="fill-hollow" />}
      {fill === 'stop' && <polygon points={`${x + 8},${y + 27} ${x + 30},${y + 27} ${x + 30},${y + 13}`} className="fill-stop" />}
      <T x={x + 38} y={y + 25} cls="t-small">
        {name}
      </T>
    </g>
  );
}

export function HoldFlowDiagram() {
  const steps = useSteps(STEPS.length);
  const hot = useHot();
  const s = steps.index;
  const pendingLit = s >= 2;
  const heldLit = s >= 6;
  const sideLit = s === 7;

  return (
    <DiagramFrame
      title="Registration and hold: from choosing a ceiling to HELD"
      desc="A sequence diagram with four lanes: the PayPal popup, the buyer browser, the GAVEL server and the PayPal Orders API. The browser asks the server for a hold order, the server creates an AUTHORIZE order at PayPal and stores a PENDING_APPROVAL hold, the popup lets the buyer approve, the browser asks the server to authorize the order, and the hold becomes HELD. Below, the hold states PENDING_APPROVAL, HELD, CAPTURED, VOIDED, EXPIRED, DENIED and UNKNOWN."
      width={W}
      height={H}
      minWidth={900}
      badge={<Chip kind="sandbox">Sandbox: G2 PASS</Chip>}
      toolbar={
        <div className="space-y-3">
          <StepControls steps={steps} labels={STEPS.map((x) => (<span key={x.title}><strong>{x.title}.</strong> {x.body}</span>))} />
          <DetailPanel active={hot.active} details={DETAILS} hint="Hover or focus a state box below for what it means and which file sets it." />
        </div>
      }
      caption={
        <>
          Messages, checks and states are read from <code>packages/server/src/http/holds.ts</code>,{' '}
          <code>packages/payments/src/holds/service.ts</code>, <code>packages/payments/src/ceiling.ts</code>,{' '}
          <code>packages/web/src/payments/paypalV6Adapter.ts</code> and <code>packages/web/src/screens/register</code>.
          Evidence: gate G2 (sandbox, 5 Nov 2026) shows a wallet buyer and a guest card buyer both reaching
          onApprove and authorizing in SDK v6. Capture of a guest card authorization has not been run on the sandbox.
        </>
      }
      transcript={
        <>
          <ol>
            {STEPS.map((x) => (
              <li key={x.title}>
                <strong>{x.title}.</strong> {x.body}
              </li>
            ))}
          </ol>
          <p>
            Hold states: PENDING_APPROVAL then HELD, then CAPTURED (the winner) or VOIDED. An unapproved order that is
            abandoned becomes EXPIRED. PayPal can also report DENIED, and an unreadable authorization reads UNKNOWN.
            VOIDED, EXPIRED and DENIED are final.
          </p>
        </>
      }
      render={(p) => (
        <>
          <Defs p={p} />
          <rect x={0} y={0} width={W} height={H} style={{ fill: 'var(--hl-bg)' }} />

          {/* lanes */}
          {LANES.map((l) => (
            <g key={l.id}>
              <rect x={l.x - 90} y={20} width={180} height={50} rx={2} className="node" />
              <T x={l.x} y={42} anchor="middle" cls="t-big">
                {l.label}
              </T>
              <T x={l.x} y={60} anchor="middle" cls="t-small t-muted">
                {l.sub}
              </T>
              <line x1={l.x} y1={70} x2={l.x} y2={604} className="guide-dash" />
            </g>
          ))}

          {/* step 0: choice */}
          <g style={stepStyle(steps, 0)}>
            <rect x={LX.web - 120} y={96} width={240} height={30} rx={2} className="panel-2" />
            <T x={LX.web} y={116} anchor="middle" cls="t-small">
              name + ceiling preset (cents)
            </T>
          </g>

          <Msg id={p} steps={steps} at={1} from="web" to="srv" y={170} label="POST /api/holds {ceilingCents}" />
          <g style={stepStyle(steps, 2)}>
            <rect x={LX.srv - 110} y={186} width={220} height={26} rx={2} className="panel-2" />
            <T x={LX.srv} y={204} anchor="middle" cls="t-small">
              open? ceiling in cap and presets?
            </T>
          </g>
          <Msg id={p} steps={steps} at={2} from="srv" to="pp" y={244} label="POST /v2/checkout/orders AUTHORIZE" />
          <Msg id={p} steps={steps} at={2} from="pp" to="srv" y={278} label="order id, CREATED" dashed />
          <Msg id={p} steps={steps} at={2} from="srv" to="web" y={312} label="201 {holdId, orderId}" dashed />
          <g style={stepStyle(steps, 2)}>
            <rect x={LX.srv + 20} y={320} width={200} height={22} rx={2} fill={hatch(p)} className="fill-hatch-edge" />
            <rect x={LX.srv + 28} y={323} width={184} height={16} style={{ fill: 'var(--hl-panel)' }} />
            <T x={LX.srv + 120} y={335} anchor="middle" cls="t-small t-ink">
              hold: PENDING_APPROVAL
            </T>
          </g>

          <Msg id={p} steps={steps} at={3} from="web" to="popup" y={378} label="start popup for orderId" />
          <Msg id={p} steps={steps} at={4} from="popup" to="web" y={420} label="onApprove {orderId}" dashed />
          <g style={stepStyle(steps, 4)}>
            <rect x={LX.popup - 100} y={434} width={200} height={40} rx={2} className="node-stop" />
            <T x={LX.popup} y={452} anchor="middle" cls="t-small">
              cancel or decline:
            </T>
            <T x={LX.popup} y={466} anchor="middle" cls="t-small">
              DELETE /api/holds/:id
            </T>
          </g>

          <Msg id={p} steps={steps} at={5} from="web" to="srv" y={500} label="POST .../approve {orderId, name}" />
          <Msg id={p} steps={steps} at={5} from="srv" to="pp" y={530} label="authorize order" />
          <Msg id={p} steps={steps} at={5} from="pp" to="srv" y={556} label="authorization id" dashed />
          <Msg id={p} steps={steps} at={6} from="srv" to="web" y={584} label="200 {HELD, ceilingCents}" dashed />

          {/* hold state strip */}
          <T x={30} y={626} cls="t-small t-muted">
            Hold record states (hover or focus a box)
          </T>
          <StateBox p={p} x={30} y={640} w={230} name="PENDING_APPROVAL" fill="hatch" lit={pendingLit} hot={hot} />
          <path d="M260 660 H300" className="edge" markerEnd={`url(#${p}-arrow)`} />
          <StateBox p={p} x={300} y={640} w={130} name="HELD" fill="hatch" lit={heldLit} hot={hot} />
          <path d="M430 660 H470" className="edge" markerEnd={`url(#${p}-arrow)`} />
          <StateBox p={p} x={470} y={640} w={170} name="CAPTURED" fill="solid" lit={sideLit} hot={hot} />
          <path d="M365 680 V716 H470" className="edge" markerEnd={`url(#${p}-arrow)`} />
          <StateBox p={p} x={470} y={700} w={170} name="VOIDED" fill="hollow" lit={sideLit} hot={hot} />
          <path d="M145 680 V736 H180" className="edge" markerEnd={`url(#${p}-arrow)`} />
          <StateBox p={p} x={180} y={716} w={170} name="EXPIRED" fill="hollow" lit={sideLit} hot={hot} />
          <StateBox p={p} x={700} y={640} w={150} name="DENIED" fill="stop" lit={sideLit} hot={hot} />
          <StateBox p={p} x={700} y={700} w={150} name="UNKNOWN" fill="stop" lit={sideLit} hot={hot} />
          <T x={870} y={664} cls="t-small t-muted">
            final: VOIDED, EXPIRED, DENIED
          </T>
          <T x={870} y={724} cls="t-small t-muted">
            read from PayPal, replaced later
          </T>
          <Legend p={p} x={30} y={778} />
        </>
      )}
    />
  );
}
