import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { GalleryScreen } from '../../src/screens/gallery/GalleryScreen';
import { TEST_IDS } from '../../src/testing/testids';

describe('test id contract (T-WEB-059)', () => {
  const ids = Object.values(TEST_IDS);

  it('has no duplicate ids in the map', () => {
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('renders every id in the gallery, once', () => {
    const { container } = render(createElement(GalleryScreen));
    const seen = Array.from(container.querySelectorAll('[data-testid]')).map((el) =>
      el.getAttribute('data-testid'),
    );
    for (const id of ids) {
      expect(seen.filter((s) => s === id)).toHaveLength(1);
    }
    expect(new Set(seen).size).toBe(seen.length);
  });
});
