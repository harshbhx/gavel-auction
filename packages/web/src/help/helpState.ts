/** Help sheet state: closed, the help menu, or the hold explainer. */
export type HelpView = 'closed' | 'menu' | 'hold';
export type HelpAction =
  | { readonly type: 'openMenu' }
  | { readonly type: 'openHold' }
  | { readonly type: 'close' };

export function helpReducer(_state: HelpView, action: HelpAction): HelpView {
  switch (action.type) {
    case 'openMenu':
      return 'menu';
    case 'openHold':
      return 'hold';
    case 'close':
      return 'closed';
  }
}
