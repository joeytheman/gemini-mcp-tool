import { LAYOUT_CHECK_SNIPPET, LIVE_PASS } from '../constants.js';

export interface Viewport {
  width: number;
  height: number;
}

/**
 * With a shown aria-modal sheet open, only the scrollers inside it count, so a
 * sheet over a long screen is still shot at the viewport. `shown` and the modal
 * lookup match src/layout-check.snippet.js, so both agree on which sheet counts.
 */
export const SCROLL_OVERFLOW_SNIPPET = `() => {
    const shown = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[aria-hidden="true"],[inert]');
    };
    const scrolls = (el) => el.tagName !== 'TEXTAREA' && /^(auto|scroll)$/.test(getComputedStyle(el).overflowY) && shown(el);
    const modal = [...document.querySelectorAll('[aria-modal="true"]')].find(shown);
    let overflow = modal ? 0 : (document.scrollingElement || document.documentElement).scrollHeight - innerHeight;
    for (const el of modal ? [modal, ...modal.querySelectorAll('*')] : document.querySelectorAll('*')) {
      const extra = el.scrollHeight - el.clientHeight;
      if (extra > overflow && scrolls(el)) overflow = extra;
    }
    return overflow;
  }`;

export function parseViewport(viewport: string): Viewport | null {
  const match = /^\s*([1-9]\d*)\s*x\s*([1-9]\d*)\s*$/i.exec(viewport);
  return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
}

export function saveLayoutFunction(key: string): string {
  return `() => window.__livePassLayout?.[${JSON.stringify(key)}]`;
}

/**
 * The text of one target's capture file, run by @playwright/mcp's
 * browser_run_code_unsafe as `(<text>)(page)` in a vm context that holds only
 * `page` and a few timer and web globals: it must stay one expression, with no
 * `require`, `fs` or `process`, and no trailing `;` or line comment.
 */
export function buildCaptureScript(config: { viewport: Viewport; frameFile: string; key: string }): string {
  const capture = JSON.stringify({
    ...config,
    settleMs: LIVE_PASS.CAPTURE_SETTLE_MS,
    maxHeight: Math.max(LIVE_PASS.CAPTURE_MAX_HEIGHT, config.viewport.height),
    maxGrows: LIVE_PASS.CAPTURE_MAX_GROWS,
  });
  return `async (page) => {
  const { viewport, frameFile, key, settleMs, maxHeight, maxGrows } = ${capture};
  const settle = () => new Promise((resolve) => setTimeout(resolve, settleMs));
  const firstLine = (error) => String((error && error.message) || error).split('\\n')[0];
  const overflow = () => page.evaluate(${SCROLL_OVERFLOW_SNIPPET});
  const shoot = async () => {
    let height = viewport.height;
    for (let grown = 0, last = Infinity; grown < maxGrows && height < maxHeight; grown++) {
      const by = await overflow();
      if (by <= 1 || by >= last) break;
      height = Math.min(height + Math.ceil(by), maxHeight);
      await page.setViewportSize({ width: viewport.width, height });
      await settle();
      last = by;
    }
    await page.screenshot({ path: frameFile, type: 'png', scale: 'css' });
    const saved = 'saved ' + frameFile + ' at ' + viewport.width + 'x' + height;
    try {
      await page.evaluate((key) => {
        const reports = (window.__livePassLayout = window.__livePassLayout || {});
        delete reports[key];
        reports[key] = (${LAYOUT_CHECK_SNIPPET})();
      }, key);
      return saved;
    } catch (error) {
      return saved + '; layout not measured: ' + firstLine(error);
    }
  };
  const restore = () => page.setViewportSize(viewport).then(() => '', (error) => '; viewport not restored: ' + firstLine(error));
  await page.setViewportSize(viewport);
  await settle();
  let result;
  try {
    result = await shoot();
  } catch (error) {
    await restore();
    throw error;
  }
  return result + (await restore());
}
`;
}
