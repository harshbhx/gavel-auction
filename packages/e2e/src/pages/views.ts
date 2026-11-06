import type { Locator, Page } from '@playwright/test';
import type { BrowserStack } from '../fixtures/base';
import type { SeededRoom } from '../fixtures/room';

/**
 * Page objects for the room views a browser spec drives (R-QA-031, T-QA-045): bidder, auctioneer
 * and public. Each one knows its route and the element that says the view has rendered. The audit
 * view needs a reviewer token that the seeded room does not mint, so it has no page object yet.
 */

/** The public screen at /r/:id/screen, reached with the room's token in the URL fragment. */
export class PublicView {
  constructor(
    private readonly page: Page,
    private readonly stack: BrowserStack,
    private readonly room: SeededRoom,
  ) {}

  async open(): Promise<void> {
    await this.page.goto(
      `${this.stack.webUrl}/r/${this.room.auctionId}/screen#token=${this.room.auctioneerToken}`,
    );
    await this.root.waitFor();
  }

  get root(): Locator {
    return this.page.locator('main.gv-screen');
  }

  get sold(): Locator {
    return this.page.getByTestId('sold');
  }

  get clock(): Locator {
    return this.page.locator('.gv-screen__clock');
  }

  get join(): Locator {
    return this.page.locator('.gv-screen__join');
  }
}

/** The auctioneer console at /r/:id/console, with its settlement ladder. */
export class AuctioneerView {
  constructor(
    private readonly page: Page,
    private readonly stack: BrowserStack,
    private readonly room: SeededRoom,
  ) {}

  async open(): Promise<void> {
    await this.page.goto(
      `${this.stack.webUrl}/r/${this.room.auctionId}/console#token=${this.room.auctioneerToken}`,
    );
    await this.columns.waitFor();
  }

  get columns(): Locator {
    return this.page.getByTestId('console-columns');
  }
}

/** The bidder register form at /r/:id/register, behind the session stored by the invite step. */
export class BidderView {
  constructor(
    private readonly page: Page,
    private readonly stack: BrowserStack,
    private readonly room: SeededRoom,
  ) {}

  async open(): Promise<void> {
    // Stored from a loaded page of the same origin, as the axe spec does for WebKit.
    await this.page.goto(`${this.stack.webUrl}/gallery`);
    await this.page.evaluate(
      ({ id, token, bidderId }) => {
        sessionStorage.setItem(`gavel:session:${id}:bidder`, JSON.stringify({ token, bidderId }));
      },
      { id: this.room.auctionId, token: this.room.token, bidderId: this.room.bidderId },
    );
    await this.page.goto(`${this.stack.webUrl}/r/${this.room.auctionId}/register`);
    await this.form.waitFor();
  }

  get form(): Locator {
    return this.page.locator('form');
  }
}
