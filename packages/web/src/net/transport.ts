import type { SettlementView } from '../ladder/ladderModel';
import type { AuctionConfig, ClientMessage, ServerMessage } from '../wire';

export type Unsubscribe = () => void;
export type TransportStatus = 'connecting' | 'open' | 'closed';

/** Transport seam (SPEC-web 5.2). The app never touches a WebSocket directly. */
export interface Transport {
  connect(): void;
  send(msg: ClientMessage): void;
  onMessage(cb: (m: ServerMessage) => void): Unsubscribe;
  onStatus(cb: (s: TransportStatus) => void): Unsubscribe;
  close(): void;
  /** WebSocket close code of the socket that ended last, when the transport knows it. */
  readonly lastCloseCode?: number | null;
}

/** The price, leader paddle (0 for none) and seq the auctioneer saw when confirming a hammer. */
export interface HammerExpectation {
  priceCents: number;
  leaderPaddle: number;
  seq: number;
}

/** Auctioneer-only commands (HTTP, OQ-WEB-2). */
export interface ControlPort {
  open(lotId: string): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  extend(ms: number): Promise<void>;
  hammer(lotId: string, expected?: HammerExpectation): Promise<void>;
  kill(confirm: 'STOP'): Promise<void>;
}

export type Fault = 'drop' | 'dup' | 'reorder' | 'disconnect' | `delay:${number}`;

export interface ScenarioStep {
  /** Milliseconds from connect(). */
  at: number;
  emit?: ServerMessage;
  expectClient?: Partial<ClientMessage>;
  fault?: Fault;
}

/** Scripted room history (SPEC-web 5.5). */
export interface Scenario {
  name: string;
  description: string;
  roomConfig: AuctionConfig;
  steps: ScenarioStep[];
  /** Per-hold settlement detail for the ladder, in the order the settlement updates are emitted. */
  settlementViews?: readonly SettlementView[];
}
