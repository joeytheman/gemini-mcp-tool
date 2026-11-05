import { LAYOUT_CHECK_SNIPPET, LIVE_PASS } from '../constants.js';

export interface Viewport {
  width: number;
  height: number;
}

export const CONTENT_BOTTOM_SNIPPET = `() => {
    const skip = (el) => el.closest('[aria-hidden="true"]') || el.closest('[role="tab"]');
    let bottom = 0;
    for (const el of document.querySelectorAll('body *')) {
      if (skip(el)) continue;
      const hasText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!hasText) continue;
      bottom = Math.max(bottom, el.getBoundingClientRect().bottom + window.scrollY);
    }
    return bottom;
  }`;

export function parseViewport(viewport: string): Viewport | null {
  const match = /^\s*([1-9]\d*)\s*x\s*([1-9]\d*)\s*$/i.exec(viewport);
  return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
}

/** The function Gemini passes to browser_evaluate, with filename set, to save one frame's layout report. */
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
    padPx: LIVE_PASS.CAPTURE_BOTTOM_PAD_PX,
  });
  return `async (page) => {
  const { viewport, frameFile, key, settleMs, padPx } = ${capture};
  const settle = () => new Promise((resolve) => setTimeout(resolve, settleMs));
  await page.setViewportSize(viewport);
  await settle();
  try {
    const bottom = await page.evaluate(${CONTENT_BOTTOM_SNIPPET});
    let height = viewport.height;
    if (bottom > viewport.height) {
      height = Math.ceil(bottom + padPx);
      await page.setViewportSize({ width: viewport.width, height });
      await settle();
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
      return saved + '; layout not measured: ' + String((error && error.message) || error).split('\\n')[0];
    }
  } finally {
    await page.setViewportSize(viewport);
  }
}
`;
}
