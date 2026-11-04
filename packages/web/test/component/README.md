# Component tests

Every screen has one component test per state in SPEC-web section 8.12 (R-WEB-106, R-WEB-123),
driven by a scenario fixture from `src/testing/scenarios`.

## Helper

```tsx
import { renderWithScenario } from '../../src/testing/renderWithScenario';

const view = renderWithScenario('/r/r1/bid', happy, { atStep: 3 });
```

`renderWithScenario(route, scenario, { atStep })` renders the app at `route`, plays the scenario
into a fresh room store up to and including step `atStep` (default: the last step) and returns
the render result plus `store`, `transport` and the latest `settlementView`. Time never runs on
its own, so the same scenario and step always give the same screen.

## Coverage checklist

Mark a cell with the test file that covers it. An empty cell is a gap.

| Route    | empty | loading | error | offline |
| -------- | ----- | ------- | ----- | ------- |
| landing  | n/a   | n/a     |       |         |
| register |       |         |       |         |
| join     |       |         |       |         |
| bid      |       |         |       |         |
| console  |       |         |       |         |
| screen   |       |         |       |         |
| audit    |       |         |       |         |
| receipt  |       |         |       |         |
| replay   | n/a   |         |       |         |

Covered so far:

- Routing shell, titles, focus, token and 404 states: `routes.test.tsx`
- Ladder rungs, verification lines, invariant banner: `Ladder.test.tsx`
- Replay controls: `ReplayControls.test.tsx`
- Provenance label: `Provenance.test.tsx`
- Harness itself: `renderWithScenario.test.tsx`
