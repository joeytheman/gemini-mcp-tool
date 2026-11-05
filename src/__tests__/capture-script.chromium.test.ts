import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import { fileURLToPath, pathToFileURL } from 'url';
import { chromium, type Browser, type Page } from 'playwright-core';
import { LAYOUT_CHECK_SNIPPET, LIVE_PASS } from '../constants.js';
import { prescribedTargetFiles, writeCaptureScripts, type LivePassTarget, type TargetFiles } from '../tools/live-pass.tool.js';
import { parseViewport, saveLayoutFunction, type Viewport } from '../utils/captureScript.js';
import { layoutFileName, readLayoutCheck, type LayoutCheck } from '../utils/layoutCheck.js';
import { makeTempDir, cleanupTempDirs } from './utils/test-helpers.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'layout');
const START_VIEWPORT = { width: 1024, height: 768 };

// @playwright/mcp 0.0.84's runCode exposedGlobals, verbatim.
const RUN_CODE_EXPOSED_GLOBALS = [
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'setImmediate',
  'clearImmediate',
  'queueMicrotask',
  'URL',
  'URLSearchParams',
  'TextEncoder',
  'TextDecoder',
  'AbortController',
  'AbortSignal',
  'fetch',
  'Headers',
  'Request',
  'Response',
  'FormData',
  'Blob',
  'Buffer',
  'crypto',
  'atob',
  'btoa',
  'structuredClone',
];

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: START_VIEWPORT });
});

afterAll(async () => {
  await browser.close();
});

afterEach(cleanupTempDirs);

async function open(fixture: string): Promise<void> {
  await page.setViewportSize(START_VIEWPORT);
  await page.goto(pathToFileURL(path.join(FIXTURES, fixture)).href);
}

/** browser_run_code_unsafe {filename}: the file's text run as `(<text>)(page)` in a vm holding `page` and the exposed globals. */
async function runCaptureFile(file: string): Promise<string> {
  const context: Record<string, unknown> = { page };
  for (const name of RUN_CODE_EXPOSED_GLOBALS) context[name] = (globalThis as Record<string, unknown>)[name];
  vm.createContext(context);
  context.__fn__ = vm.runInContext('(' + fs.readFileSync(file, 'utf-8') + ')', context);
  return JSON.stringify(await vm.runInContext('__fn__(page)', context));
}

/** browser_evaluate {function, filename}: the result written as JSON, then read back by the report's validator. */
async function saveLayout(key: string, file: string, artifactDir: string, width: number): Promise<LayoutCheck> {
  const runStartMs = Date.now();
  const result = await page.evaluate(async (expression) => {
    const value = eval(`(${expression})`);
    return await (typeof value === 'function' ? value() : value);
  }, saveLayoutFunction(key));
  fs.writeFileSync(file, JSON.stringify(result, null, 2) ?? 'undefined', 'utf-8');
  return readLayoutCheck(file, artifactDir, runStartMs, width);
}

function pngSize(file: string): { width: number; height: number } {
  const header = fs.readFileSync(file).subarray(0, 24);
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

function targetFiles(viewport: string, artifactDir: string): TargetFiles {
  const target: LivePassTarget = { screen: 'screen', state: 'state', viewport, expected: 'x' };
  writeCaptureScripts([target], artifactDir);
  return [...prescribedTargetFiles([target], artifactDir).values()][0];
}

async function capture(viewport: string, artifactDir = makeTempDir('capture')) {
  const files = targetFiles(viewport, artifactDir);
  const result = await runCaptureFile(files.capture);
  const viewportAfter = page.viewportSize();
  const layout = await saveLayout(files.frameName, files.layout, artifactDir, (parseViewport(viewport) as Viewport).width);
  return { result, frameFile: files.frame, frameName: files.frameName, viewportAfter, layout };
}

describe('capture script in headless Chromium, run as browser_run_code_unsafe runs it', () => {
  it.each([
    ['a page that fits', 'capture-fits.html', '390x844', 844],
    ['a page whose last text ends within 24 px of the bottom edge', 'capture-near-bottom.html', '390x844', 844],
    ['an RN-web screen with a fixed header, an inner scroller and a tab bar', 'capture-rn-web.html', '390x844', 1524],
    ['a flex-grow centred screen 12 px taller than 568', 'capture-centred.html', '320x568', 604],
    ['a screen 12 px taller than 568 with a bottom-anchored toast', 'capture-toast.html', '320x568', 604],
  ])('captures %s at its known height and leaves the viewport at the target size', async (_label, fixture, viewport, shotHeight) => {
    const { width, height } = parseViewport(viewport) as Viewport;
    await open(fixture);

    const shot = await capture(viewport);

    expect(shot.result).toBe(JSON.stringify(`saved ${shot.frameFile} at ${width}x${shotHeight}`));
    expect(pngSize(shot.frameFile)).toEqual({ width, height: shotHeight });
    expect(shot.viewportAfter).toEqual({ width, height });
    expect(shot.layout.status).toBe('OK');
  });

  it('stores the report of a page that fits, measured at the target viewport', async () => {
    await open('capture-fits.html');

    const shot = await capture('390x844');

    expect(shot.layout.report).toEqual({
      check: LIVE_PASS.LAYOUT_CHECK_ID,
      viewport: { width: 390, height: 844 },
      found: 0,
      entries: [],
      clamped: [],
    });
  });

  it("stores the report of a scrolling screen, equal to the layout snippet run directly at the shot's size", async () => {
    await open('capture-rn-web.html');

    const shot = await capture('390x844');
    await page.setViewportSize({ width: 390, height: 1524 });
    const direct = await page.evaluate((expression) => eval(`(${expression})`)(), LAYOUT_CHECK_SNIPPET);

    expect(shot.layout.report?.viewport).toEqual({ width: 390, height: 1524 });
    expect(shot.layout.report).toEqual(direct);
  });

  it('still saves the frame and restores the viewport when the layout step throws, and leaves no earlier report behind', async () => {
    await open('capture-fits.html');
    await page.evaluate(() => {
      (window as unknown as { __livePassLayout: object }).__livePassLayout = { 'screen-state-390x844.png': { earlier: true } };
      window.getComputedStyle = () => { throw new Error('layout boom'); };
    });

    const shot = await capture('390x844');

    expect(shot.result).toBe(JSON.stringify(`saved ${shot.frameFile} at 390x844; layout not measured: page.evaluate: Error: layout boom`));
    expect(pngSize(shot.frameFile)).toEqual({ width: 390, height: 844 });
    expect(shot.viewportAfter).toEqual({ width: 390, height: 844 });
    expect(shot.layout).toMatchObject({ status: 'MALFORMED', problem: 'not valid JSON' });
  });

  it('fails the capture when the screenshot cannot be saved, and still restores the viewport it grew', async () => {
    const artifactDir = makeTempDir('capture');
    const files = targetFiles('390x844', artifactDir);
    fs.mkdirSync(files.frame);
    await open('capture-rn-web.html');

    await expect(runCaptureFile(files.capture)).rejects.toThrow(/EISDIR/);
    expect(page.viewportSize()).toEqual({ width: 390, height: 844 });
  });

  it('captures to the right file when the worktree path holds quotes, a backslash and ${', async () => {
    const artifactDir = path.join(makeTempDir('capture'), `it's "a" \\ \${x}`, '.live-pass');
    fs.mkdirSync(artifactDir, { recursive: true });
    await open('capture-fits.html');

    const shot = await capture('390x844', artifactDir);

    expect(shot.frameFile.startsWith(artifactDir)).toBe(true);
    expect(shot.result).toBe(JSON.stringify(`saved ${shot.frameFile} at 390x844`));
    expect(pngSize(shot.frameFile)).toEqual({ width: 390, height: 844 });
    expect(shot.layout.status).toBe('OK');
  });

  it('saves undefined for a key whose capture never ran, which the report reads as not run', async () => {
    const artifactDir = makeTempDir('capture');
    const file = path.join(artifactDir, layoutFileName('never-captured.png'));
    await open('capture-fits.html');

    const beforeAnyCapture = await saveLayout('never-captured.png', file, artifactDir, 390);
    await page.evaluate(() => {
      (window as unknown as { __livePassLayout: object }).__livePassLayout = { 'another-target.png': { check: 'layout-check/1' } };
    });
    const besideAnotherReport = await saveLayout('never-captured.png', file, artifactDir, 390);

    expect(fs.readFileSync(file, 'utf-8')).toBe('undefined');
    expect(beforeAnyCapture).toMatchObject({ status: 'MALFORMED', problem: 'not valid JSON' });
    expect(besideAnotherReport).toMatchObject({ status: 'MALFORMED', problem: 'not valid JSON' });
  });
});
