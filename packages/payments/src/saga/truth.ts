import type { JournalHold } from '../types.js';

/**
 * The arguments of a truth read for a journaled hold. The order id is passed when
 * known so a real gateway can list the order's captures; without it they are not
 * observable (R8-P01).
 */
export function truthArgs(hold: Pick<JournalHold, 'holdId' | 'authId' | 'orderId'>): {
  holdId: string;
  authId: string;
  orderId?: string;
} {
  return {
    holdId: hold.holdId,
    authId: hold.authId,
    ...(hold.orderId === undefined || hold.orderId === '' ? {} : { orderId: hold.orderId }),
  };
}
