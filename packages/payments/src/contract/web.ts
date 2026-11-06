/**
 * The hold route contract (POST /api/holds, POST /api/holds/{holdId}/approve,
 * GET and DELETE /api/holds/{holdId}) has one copy: `@gavel/shared`
 * (packages/shared/src/hold-contract.ts). Web, server and payments all name it
 * from there, so the three cannot drift apart (issue 896).
 *
 * This module only re-exports its types. Type-only imports are erased before run
 * time, so payments keeps zod as its only runtime dependency (R-PAY-153); the
 * schemas themselves are imported from `@gavel/shared` by whoever parses bodies.
 */
export type {
  AbandonHoldResponse,
  ApproveHoldRequest,
  ApproveHoldResponse,
  CreateHoldRequest,
  CreateHoldResponse,
  HoldErrorCode,
  HoldErrorResponse,
  HoldStatusName,
  HoldViewResponse,
} from '@gavel/shared';
