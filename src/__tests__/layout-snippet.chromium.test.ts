import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { chromium, type Browser, type Page } from 'playwright-core';
import { LAYOUT_CHECK_SNIPPET, LIVE_PASS } from '../constants.js';
import { readLayoutCheck, type LayoutReport } from '../utils/layoutCheck.js';
import { makeTempDir, cleanupTempDirs } from './utils/test-helpers.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'layout');
const VIEWPORT = { width: 390, height: 844 };

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: VIEWPORT });
});

afterAll(async () => {
  await browser.close();
});

afterEach(cleanupTempDirs);

/**
 * Evaluates our own snippet constant the way @playwright/mcp's browser_evaluate
 * does (eval of the function source, then a call), writes the
 * file it writes for a `filename` (JSON.stringify(result, null, 2)), and reads
 * that file back through the validator the report uses.
 */
async function measure(fixture: string, prepare?: (page: Page) => Promise<void>): Promise<LayoutReport> {
  await page.goto(pathToFileURL(path.join(FIXTURES, fixture)).href);
  if (prepare) await prepare(page);
  const result = await page.evaluate(async (expression) => {
    const value = eval(`(${expression})`);
    return await (typeof value === 'function' ? value() : value);
  }, LAYOUT_CHECK_SNIPPET);

  const artifactDir = makeTempDir('layout-snippet');
  const file = path.join(artifactDir, `frame${LIVE_PASS.LAYOUT_FILE_SUFFIX}`);
  fs.writeFileSync(file, JSON.stringify(result, null, 2) ?? 'undefined', 'utf-8');
  const check = readLayoutCheck(file, artifactDir, Date.now());

  expect(check.status).toBe('OK');
  return check.report as LayoutReport;
}

describe('LAYOUT_CHECK_SNIPPET in headless Chromium', () => {
  it('reports nothing on a clean page, including a chip past the edge of a horizontal scroller', async () => {
    const report = await measure('clean.html');

    expect(report).toEqual({
      check: LIVE_PASS.LAYOUT_CHECK_ID,
      viewport: VIEWPORT,
      found: 0,
      entries: [],
      clamped: [],
    });
  });

  it('reports the chip past the edge once its row stops scrolling', async () => {
    const report = await measure('clean.html', async (page) => {
      await page.evaluate(() => { (document.querySelector('[data-testid="chips"]') as HTMLElement).style.overflowX = 'hidden'; });
    });

    expect(report.entries).toEqual([
      { kind: 'text-clipped', text: 'Chip three', testID: 'chip-three', rect: { x: 300, y: 116, width: 150, height: 30 } },
      { kind: 'control-offscreen', text: 'Chip three', testID: 'chip-three', rect: { x: 300, y: 116, width: 150, height: 30 } },
    ]);
  });

  it('skips editable text, form fields, aria-hidden and inert subtrees, and controls that let taps through', async () => {
    const report = await measure('skipped-elements.html');

    expect(report.entries).toEqual([]);
    expect(report.clamped).toEqual([]);
  });

  it.each([
    ['contenteditable', '[data-testid="editable"]', 'contenteditable', [
      { kind: 'text-clipped', text: 'Editable text that runs past the box', testID: 'editable' },
    ]],
    ['aria-hidden', '[data-case="aria-hidden"]', 'aria-hidden', [
      { kind: 'text-clipped', text: 'Hidden text that runs past the box', testID: 'hidden-label' },
      { kind: 'control-covered', text: 'Hidden', testID: 'hidden-button' },
    ]],
    ['inert', '[data-case="inert"]', 'inert', [
      { kind: 'text-clipped', text: 'Inert text that runs past the box', testID: 'inert-label' },
      { kind: 'control-covered', text: 'Inert', testID: 'inert-button' },
    ]],
  ])('reports what %s was hiding once it is removed', async (_label, selector, attribute, expected) => {
    const report = await measure('skipped-elements.html', async (page) => {
      await page.evaluate(([sel, attr]) => document.querySelector(sel)?.removeAttribute(attr), [selector, attribute]);
    });

    expect(report.entries.map(({ kind, text, testID }) => ({ kind, text, testID }))).toEqual(expected);
  });

  it('reports the pass-through control as covered once it takes pointer events', async () => {
    const report = await measure('skipped-elements.html', async (page) => {
      await page.evaluate(() => { (document.querySelector('[data-testid="passthrough"]') as HTMLElement).style.pointerEvents = 'auto'; });
    });

    expect(report.entries.map(({ kind, text, testID }) => ({ kind, text, testID }))).toEqual([
      { kind: 'control-covered', text: 'Passthrough', testID: 'passthrough' },
    ]);
  });

  it('reports a span that spills past its row', async () => {
    const report = await measure('overflowing-span.html');

    expect(report.entries).toEqual([
      { kind: 'text-spill', text: 'Uploaded to the studio wins wall', testID: 'label', rect: { x: 0, y: 0, width: 320, height: 20 } },
    ]);
    expect(report.clamped).toEqual([]);
    expect(report.found).toBe(1);
  });

  it('lists line-clamped and ellipsized text as capped on purpose, never as a defect', async () => {
    const report = await measure('clamped-caption.html');

    expect(report.entries).toEqual([]);
    expect(report.found).toBe(0);
    expect(report.clamped).toEqual([
      {
        kind: 'text-clamped',
        text: 'Costume checklist: tights, shoes, hair kit, lashes, rhinestones, garment bag, an',
        testID: 'caption',
        rect: { x: 0, y: 0, width: 200, height: 40 },
      },
      {
        kind: 'text-clamped',
        text: 'Regional finals at the convention centre',
        testID: 'title',
        rect: { x: 0, y: 40, width: 150, height: 20 },
      },
    ]);
  });

  it('reports text an overflow: hidden box cuts off', async () => {
    const report = await measure('overflow-hidden-clip.html');

    expect(report.entries).toEqual([
      { kind: 'text-clipped', text: 'Junior lyrical small group', testID: 'card-title', rect: { x: 0, y: 0, width: 120, height: 20 } },
    ]);
    expect(report.clamped).toEqual([]);
  });

  it('reports the button another button covers, and not the one on top', async () => {
    const report = await measure('overlapping-buttons.html');

    expect(report.entries).toEqual([
      { kind: 'control-covered', text: 'Save', testID: 'save', rect: { x: 20, y: 20, width: 120, height: 40 } },
    ]);
  });

  it('reports a button cut off at the right edge, and its clipped label', async () => {
    const report = await measure('button-past-edge.html');

    expect(report.entries).toEqual([
      { kind: 'text-clipped', text: 'Next', testID: 'next', rect: { x: 330, y: 0, width: 100, height: 44 } },
      { kind: 'control-offscreen', text: 'Next', testID: 'next', rect: { x: 330, y: 0, width: 100, height: 44 } },
    ]);
  });

  it('reports horizontal page scroll when nothing clips the wide row, with the spilling label and cut-off button', async () => {
    const report = await measure('button-past-edge.html', async (page) => {
      await page.evaluate(() => {
        const frame = document.querySelector('div') as HTMLElement;
        frame.style.overflow = 'visible';
      });
    });

    expect(report.entries).toEqual([
      { kind: 'page-scroll-x', text: 'scrollWidth 500 > innerWidth 390', testID: null, rect: { x: 0, y: 0, width: 500, height: 844 } },
      { kind: 'text-spill', text: 'Next', testID: 'next', rect: { x: 330, y: 0, width: 100, height: 44 } },
      { kind: 'control-offscreen', text: 'Next', testID: 'next', rect: { x: 330, y: 0, width: 100, height: 44 } },
    ]);
  });

  it('ignores controls under an open aria-modal sheet', async () => {
    const report = await measure('sheet-over-content.html');

    expect(report.entries).toEqual([]);
  });

  it('reports the same covered control once the sheet is not marked aria-modal', async () => {
    const report = await measure('sheet-over-content.html', async (page) => {
      await page.evaluate(() => document.querySelector('[aria-modal]')?.removeAttribute('aria-modal'));
    });

    expect(report.entries).toEqual([
      { kind: 'control-covered', text: 'Edit', testID: 'edit', rect: { x: 0, y: 0, width: 120, height: 44 } },
    ]);
  });

  it('ignores rows scrolled partly or fully out of their scroller, hit-testing only the visible part', async () => {
    const report = await measure('scrolled-rows.html');

    expect(report.entries).toEqual([]);
  });

  it('reports the same rows as covered once their container stops clipping them under the bottom bar', async () => {
    const report = await measure('scrolled-rows.html', async (page) => {
      await page.evaluate(() => { (document.querySelector('[data-testid="list"]') as HTMLElement).style.overflowY = 'visible'; });
    });

    expect(report.entries).toEqual([
      { kind: 'control-covered', text: 'Second result', testID: 'row-2', rect: { x: 0, y: 370, width: 390, height: 60 } },
      { kind: 'control-covered', text: 'Third result', testID: 'row-3', rect: { x: 0, y: 430, width: 390, height: 60 } },
    ]);
  });

  it('ignores a tab in a horizontal scroller that sits under the row\'s own edge control', async () => {
    const report = await measure('tab-row-more.html');

    expect(report.entries).toEqual([]);
  });

  it('reports that tab as cut off and covered once its row stops scrolling', async () => {
    const report = await measure('tab-row-more.html', async (page) => {
      await page.evaluate(() => { (document.querySelector('[data-testid="sections"]') as HTMLElement).style.overflowX = 'hidden'; });
    });

    expect(report.entries).toEqual([
      { kind: 'control-offscreen', text: 'Photos', testID: 'tab-photos', rect: { x: 300, y: 0, width: 100, height: 44 } },
      { kind: 'control-covered', text: 'Photos', testID: 'tab-photos', rect: { x: 300, y: 0, width: 100, height: 44 } },
    ]);
  });

  it('ignores whitespace hanging past a pre-wrap heading where it wraps', async () => {
    const report = await measure('prewrap-heading.html');

    expect(report.entries).toEqual([]);
  });

  it('reports the heading as spilling once its words stop wrapping', async () => {
    const report = await measure('prewrap-heading.html', async (page) => {
      await page.evaluate(() => { (document.querySelector('[data-testid="heading"]') as HTMLElement).style.whiteSpace = 'pre'; });
    });

    expect(report.entries).toEqual([
      { kind: 'text-spill', text: 'Regionals results', testID: 'heading', rect: { x: 0, y: 0, width: 120, height: 20 } },
    ]);
  });

  it('reports a framework dev overlay once and keeps it out of every other check', async () => {
    const report = await measure('dev-overlay.html');

    expect(report.entries).toEqual([
      { kind: 'dev-overlay', text: 'Uncaught Error: something broke in a component Dismiss', testID: null, rect: { x: 0, y: 0, width: 390, height: 844 } },
    ]);
  });

  it('reports what the same overlay covers and clips when it is not a known dev overlay', async () => {
    const report = await measure('dev-overlay.html', async (page) => {
      await page.evaluate(() => document.getElementById('error-overlay')?.removeAttribute('id'));
    });

    expect(report.entries).toEqual([
      { kind: 'text-clipped', text: 'Uncaught Error: something broke in a component', testID: null, rect: { x: 0, y: 0, width: 100, height: 20 } },
      { kind: 'control-covered', text: 'Sign in', testID: 'sign-in', rect: { x: 0, y: 0, width: 200, height: 44 } },
    ]);
  });

  it('reports a header button overhanging the viewport by 4px as page scroll and a cut-off control', async () => {
    const report = await measure('overhang-header.html');

    expect(report.entries).toEqual([
      { kind: 'page-scroll-x', text: 'scrollWidth 394 > innerWidth 390', testID: null, rect: { x: 0, y: 0, width: 394, height: 844 } },
      { kind: 'control-offscreen', text: 'Close', testID: 'header-close', rect: { x: 350, y: 0, width: 44, height: 44 } },
    ]);
  });

  it('caps the entries at 50 and counts every one it found', async () => {
    const report = await measure('clean.html', async (page) => {
      await page.evaluate(() => {
        document.body.innerHTML = Array.from({ length: 60 }, (_, index) =>
          `<div style="width:40px;height:12px;overflow:hidden;white-space:nowrap">Clipped label ${index}</div>`).join('');
      });
    });

    expect(report.found).toBe(60);
    expect(report.entries).toHaveLength(LIVE_PASS.LAYOUT_MAX_ENTRIES);
    expect(report.entries[49].text).toBe('Clipped label 49');
  });
});
