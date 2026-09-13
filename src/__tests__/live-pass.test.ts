import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

vi.mock('../utils/logger.js', () => ({
  Logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn(), toolInvocation: vi.fn() },
}));

const mockExecuteAgyJson = vi.fn();
vi.mock('../utils/agyExecutor.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/agyExecutor.js')>();
  return { ...actual, executeAgyJson: (...args: any[]) => mockExecuteAgyJson(...args) };
});

const cleanSnapshot = (root = '/repo') => ({
  root,
  lines: [] as string[],
  hashes: new Map<string, string>(),
  truncated: false,
});
const mockSnapshotWorkingTree = vi.fn().mockReturnValue(cleanSnapshot());
vi.mock('../utils/gitStatusGuard.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/gitStatusGuard.js')>();
  return { ...actual, snapshotWorkingTree: (...args: any[]) => mockSnapshotWorkingTree(...args) };
});

import {
  livePassTool,
  livePassArgsSchema,
  livePassResultSchema,
  LIVE_PASS_RESULT_JSON_SCHEMA,
  buildLivePassPrompt,
  frameFileName,
  prescribedFrameNames,
  validateFrames,
  checkCoverage,
  deriveVerdict,
  runPublishCommand,
  type LivePassResult,
  type LivePassTarget,
} from '../tools/live-pass.tool.js';
import { ERROR_MESSAGES, LIVE_PASS, MODELS } from '../constants.js';
import { makeTempDir, cleanupTempDirs } from './utils/test-helpers.js';

// ------------------------------------------------------------------ helpers

const makeWorkDir = () => makeTempDir('live-pass');

const HOME_TARGET: LivePassTarget = {
  screen: 'home',
  state: 'default',
  viewport: '390x844',
  expected: "heading 'Hello'",
};

function makeFrame(overrides: Partial<LivePassResult['frames'][number]> = {}) {
  return {
    file: '/tmp/frame.png',
    screen: 'home',
    state: 'default',
    expected: "heading 'Hello'",
    viewport: '390x844',
    verdict: 'PASS' as const,
    observed: 'Shows the Hello heading above the list.',
    ...overrides,
  };
}

function makeResult(overrides: Partial<LivePassResult> = {}): LivePassResult {
  return {
    verdict: 'PASS',
    summary: 'Everything rendered.',
    served_branch_check: "footer reads 'BRANCH: smoke'",
    frames: [makeFrame()],
    findings: [],
    regressions: [],
    resolved: [],
    changes: [],
    skipped: [],
    ...overrides,
  };
}

const CLEAN_VALIDATION = { checks: [], okFiles: [], problems: [], notes: [], unreportedCaptures: [] };
const CLEAN_COVERAGE = { uncovered: [], skipped: [], extraFrames: [] };

function writeFrameFile(artifactDir: string, name: string): string {
  fs.mkdirSync(artifactDir, { recursive: true });
  const file = path.join(artifactDir, name);
  fs.writeFileSync(file, 'PNG');
  return file;
}

function writeManifest(artifactDir: string, frames: unknown[]): void {
  fs.writeFileSync(
    path.join(artifactDir, LIVE_PASS.MANIFEST_FILE),
    JSON.stringify({ run_started: new Date().toISOString(), driver: 'playwright', frames, skipped: [] })
  );
}

function envelope(structured: unknown, overrides: Record<string, unknown> = {}) {
  return {
    conversation_id: 'conv-abc',
    status: 'SUCCESS',
    response: '',
    structured_output: structured,
    num_turns: 3,
    duration_seconds: 42,
    usage: { input_tokens: 16000, output_tokens: 900, total_tokens: 16900 },
    denied_actions: [],
    ...overrides,
  };
}

function run(args: Record<string, unknown>): Promise<string> {
  return livePassTool.execute(args as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSnapshotWorkingTree.mockReturnValue(cleanSnapshot());
});

afterEach(cleanupTempDirs);

// ------------------------------------------------------------------- schema

describe('livePassArgsSchema', () => {
  const minimal = {
    targets: [HOME_TARGET],
    brief: 'Base URL http://localhost:8123',
    workingDirectory: '/tmp/project',
    driver: 'playwright',
  };

  it('applies the documented defaults', () => {
    const parsed = livePassArgsSchema.parse(minimal);

    expect(parsed.yolo).toBe(true);
    expect(parsed.printTimeout).toBe(LIVE_PASS.DEFAULT_PRINT_TIMEOUT);
    expect(parsed.printTimeout).toBe('15m');
    expect(parsed.model).toBe(MODELS.MEDIUM);
  });

  it('requires a driver and at least one target', () => {
    expect(() => livePassArgsSchema.parse({ ...minimal, driver: undefined })).toThrow();
    expect(() => livePassArgsSchema.parse({ ...minimal, targets: [] })).toThrow();
  });

  it('rejects a duplicate screen/state/viewport triple', () => {
    expect(() => livePassArgsSchema.parse({
      ...minimal,
      targets: [HOME_TARGET, { ...HOME_TARGET, screen: ' Home ' }],
    })).toThrow(/duplicate target/);
  });

  it('keeps two states of the same screen', () => {
    const parsed = livePassArgsSchema.parse({
      ...minimal,
      targets: [HOME_TARGET, { ...HOME_TARGET, state: 'empty' }],
    });

    expect(parsed.targets).toHaveLength(2);
  });
});

describe('LIVE_PASS_RESULT_JSON_SCHEMA', () => {
  it('has no $schema key and requires every result section', () => {
    expect(LIVE_PASS_RESULT_JSON_SCHEMA).not.toHaveProperty('$schema');
    expect(LIVE_PASS_RESULT_JSON_SCHEMA.required).toEqual(expect.arrayContaining([
      'verdict', 'summary', 'served_branch_check', 'frames',
      'findings', 'regressions', 'resolved', 'changes', 'skipped',
    ]));
  });

  it('requires expected and observed on every frame', () => {
    const frames = (LIVE_PASS_RESULT_JSON_SCHEMA.properties as any).frames;

    expect(frames.items.required).toEqual(expect.arrayContaining(['file', 'expected', 'observed', 'verdict']));
  });
});

// ------------------------------------------------------------------- prompt

describe('frameFileName', () => {
  it('slugifies every segment so spaces and slashes cannot collide', () => {
    expect(frameFileName({ screen: 'Settings/Profile', state: 'sheet open', viewport: '390x844' }))
      .toBe('settings-profile-sheet-open-390x844.png');
    expect(frameFileName({ screen: '  Order Detail  ', state: 'Empty!', viewport: '1280 x 800' }))
      .toBe('order-detail-empty-1280-x-800.png');
  });

  it('suffixes a name two different targets would otherwise slugify onto', () => {
    const names = prescribedFrameNames([
      { screen: 'settings/profile', state: 'default', viewport: '390x844' },
      { screen: 'settings-profile', state: 'default', viewport: '390x844' },
    ]);

    expect([...names.values()]).toEqual([
      'settings-profile-default-390x844.png',
      'settings-profile-default-390x844-2.png',
    ]);
  });

  it('gives two viewports of the same screen and state different files', () => {
    const mobile = frameFileName({ screen: 'home', state: 'default', viewport: '390x844' });
    const desktop = frameFileName({ screen: 'home', state: 'default', viewport: '1280x800' });

    expect(mobile).not.toBe(desktop);
  });
});

describe('buildLivePassPrompt', () => {
  const base = {
    brief: 'Base URL http://localhost:8123; marker: footer BRANCH: smoke',
    targets: [HOME_TARGET, { ...HOME_TARGET, state: 'offline', expected: 'offline notice plus Retry' }],
    workingDirectory: '/work/tree',
    artifactDir: '/work/tree/.live-pass/run1',
  };

  it('renders the targets as a numbered list with their expected state', () => {
    const prompt = buildLivePassPrompt({ ...base, driver: 'playwright', resumed: false });

    expect(prompt).toContain('1. screen: home | state: default | viewport: 390x844');
    expect(prompt).toContain("expected: heading 'Hello'");
    expect(prompt).toContain('2. screen: home | state: offline | viewport: 390x844');
    expect(prompt).toContain('expected: offline notice plus Retry');
  });

  it('carries the playwright procedure and the evidence discipline', () => {
    const prompt = buildLivePassPrompt({ ...base, driver: 'playwright', resumed: false });

    expect(prompt).toContain('browser_take_screenshot');
    expect(prompt).toContain('/work/tree/.live-pass/run1');
    expect(prompt).toContain('never use fullPage');
    expect(prompt).toContain('answer is ONLY the schema JSON');
    expect(prompt).toContain('a spinner, blank page, skeleton, error, or the wrong screen is a FAIL');
    expect(prompt).toContain('PASSES when it shows that state with everything "expected" names');
    expect(prompt).toContain('Something "expected" does not ask for is at most a MINOR finding');
    expect(prompt).toContain(LIVE_PASS.MANIFEST_FILE);
    expect(prompt).not.toContain('list_devices');
  });

  it('prints one prescribed absolute file path per target, for both drivers', () => {
    for (const driver of ['playwright', 'maestro'] as const) {
      const prompt = buildLivePassPrompt({ ...base, driver, resumed: false });

      expect(prompt).toContain(`   file: /work/tree/.live-pass/run1/${frameFileName(base.targets[0])}`);
      expect(prompt).toContain(`   file: /work/tree/.live-pass/run1/${frameFileName(base.targets[1])}`);
      // The viewport is part of every prescribed name, so two viewports of one
      // screen/state can never land in the same file.
      expect(prompt).toContain('home-default-390x844.png');
      expect(prompt).toContain('home-offline-390x844.png');
      expect(prompt).toContain('a file that answers two targets is treated as no evidence at all');
      expect(prompt).toContain('never reuse another target\'s file');
    }
  });

  it('carries the maestro procedure instead for the maestro driver', () => {
    const prompt = buildLivePassPrompt({ ...base, driver: 'maestro', resumed: false });

    expect(prompt).toContain('list_devices');
    expect(prompt).toContain('xcrun simctl io');
    expect(prompt).toContain('Never use take_screenshot for evidence');
    expect(prompt).not.toContain('browser_take_screenshot');
  });

  it('adds the delta paragraph only for a resumed pass', () => {
    const fresh = buildLivePassPrompt({ ...base, driver: 'playwright', resumed: false });
    const resumed = buildLivePassPrompt({ ...base, driver: 'playwright', resumed: true });

    expect(fresh).not.toContain('Delta reporting');
    expect(fresh).toContain('This is a fresh pass');
    expect(resumed).toContain('Delta reporting');
    expect(resumed).toContain('Never put an improvement in "findings" or "regressions"');
  });
});

// --------------------------------------------------------------- validation

describe('validateFrames', () => {
  it('accepts a fresh, non-empty frame inside the artifact directory', () => {
    const artifactDir = path.join(makeWorkDir(), 'frames');
    const file = writeFrameFile(artifactDir, 'home-default.png');
    writeManifest(artifactDir, [{ file }]);

    const validation = validateFrames(makeResult({ frames: [makeFrame({ file })] }), artifactDir, Date.now());

    expect(validation.checks[0].status).toBe('OK');
    expect(validation.okFiles).toEqual([file]);
    expect(validation.problems).toEqual([]);
  });

  it.each([
    ['MISSING', (dir: string) => path.join(dir, 'never-written.png')],
    ['EMPTY', (dir: string) => {
      const file = path.join(dir, 'empty.png');
      fs.writeFileSync(file, '');
      return file;
    }],
    ['STALE', (dir: string) => {
      const file = writeFrameFile(dir, 'stale.png');
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      fs.utimesSync(file, yesterday, yesterday);
      return file;
    }],
  ])('flags a %s frame', (status, makeFile) => {
    const artifactDir = path.join(makeWorkDir(), 'frames');
    fs.mkdirSync(artifactDir, { recursive: true });
    const file = makeFile(artifactDir);
    writeManifest(artifactDir, [{ file }]);

    const validation = validateFrames(makeResult({ frames: [makeFrame({ file })] }), artifactDir, Date.now());

    expect(validation.checks[0].status).toBe(status);
    expect(validation.okFiles).toEqual([]);
    expect(validation.problems.join('\n')).toContain(status);
  });

  it('marks every frame after the first that reuses an evidence file as DUPLICATE', () => {
    const artifactDir = path.join(makeWorkDir(), 'frames');
    const file = writeFrameFile(artifactDir, 'home-default-390x844.png');
    writeManifest(artifactDir, [{ file }, { file }]);
    const wide = { ...HOME_TARGET, viewport: '1280x800' };

    const validation = validateFrames(
      makeResult({ frames: [makeFrame({ file }), makeFrame({ file, viewport: '1280x800' })] }),
      artifactDir,
      Date.now(),
      [HOME_TARGET, wide]
    );

    expect(validation.checks.map(check => check.status)).toEqual(['OK', 'DUPLICATE']);
    expect(validation.okFiles).toEqual([file]);
    expect(validation.problems.join('\n')).toContain('reused evidence file');
  });

  it('notes a frame saved under a name other than the one prescribed, without failing it', () => {
    const artifactDir = path.join(makeWorkDir(), 'frames');
    const file = writeFrameFile(artifactDir, 'whatever-i-felt-like.png');
    writeManifest(artifactDir, [{ file }]);

    const validation = validateFrames(
      makeResult({ frames: [makeFrame({ file })] }), artifactDir, Date.now(), [HOME_TARGET]
    );

    expect(validation.checks[0].status).toBe('OK');
    expect(validation.checks[0].misnamed).toBe(true);
    expect(validation.problems).toEqual([]);
    expect(validation.notes.join('\n')).toContain('MISNAMED');
    expect(validation.notes.join('\n')).toContain(frameFileName(HOME_TARGET));
  });

  it('treats a directory reported as a frame as MISSING', () => {
    const artifactDir = path.join(makeWorkDir(), 'frames');
    const file = path.join(artifactDir, 'home-default.png');
    fs.mkdirSync(file, { recursive: true });
    writeManifest(artifactDir, [{ file }]);

    const validation = validateFrames(makeResult({ frames: [makeFrame({ file })] }), artifactDir, Date.now());

    expect(validation.checks[0].status).toBe('MISSING');
    expect(validation.okFiles).toEqual([]);
  });

  it('flags a frame written outside the artifact directory', () => {
    const workDir = makeWorkDir();
    const artifactDir = path.join(workDir, 'frames');
    fs.mkdirSync(artifactDir, { recursive: true });
    const outside = writeFrameFile(workDir, 'escaped.png');
    writeManifest(artifactDir, [{ file: outside }]);

    const validation = validateFrames(makeResult({ frames: [makeFrame({ file: outside })] }), artifactDir, Date.now());

    expect(validation.checks[0].status).toBe('OUTSIDE');
  });

  it('reports a missing manifest and captures that were never reported', () => {
    const artifactDir = path.join(makeWorkDir(), 'frames');
    const reported = writeFrameFile(artifactDir, 'home-default.png');
    writeFrameFile(artifactDir, 'orphan.png');

    const validation = validateFrames(makeResult({ frames: [makeFrame({ file: reported })] }), artifactDir, Date.now());

    expect(validation.problems.join('\n')).toContain('was not written');
    expect(validation.unreportedCaptures).toEqual([path.join(artifactDir, 'orphan.png')]);
  });

  it('rejects a manifest left over from an earlier run in a reused artifact directory', () => {
    const artifactDir = path.join(makeWorkDir(), 'frames');
    const file = writeFrameFile(artifactDir, 'home-default-390x844.png');
    writeManifest(artifactDir, [{ file }]);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    fs.utimesSync(path.join(artifactDir, LIVE_PASS.MANIFEST_FILE), yesterday, yesterday);

    const validation = validateFrames(
      makeResult({ frames: [makeFrame({ file })] }), artifactDir, Date.now(), [HOME_TARGET]
    );

    expect(validation.problems.join('\n')).toContain('predates this run');
  });

  it('reports a manifest whose frame count disagrees with the answer', () => {
    const artifactDir = path.join(makeWorkDir(), 'frames');
    const file = writeFrameFile(artifactDir, 'home-default.png');
    writeManifest(artifactDir, []);

    const validation = validateFrames(makeResult({ frames: [makeFrame({ file })] }), artifactDir, Date.now());

    expect(validation.problems.join('\n')).toContain('lists 0 frames');
  });
});

describe('checkCoverage', () => {
  it('matches a target to its frame exactly', () => {
    const coverage = checkCoverage([HOME_TARGET], makeResult());

    expect(coverage.uncovered).toEqual([]);
    expect(coverage.extraFrames).toEqual([]);
  });

  it('matches despite case and whitespace differences', () => {
    const result = makeResult({
      frames: [makeFrame({ screen: ' HOME ', state: 'Default', viewport: '390 x 844' })],
    });

    expect(checkCoverage([HOME_TARGET], result).uncovered).toEqual([]);
  });

  it('reports a target with no frame as uncovered', () => {
    const missing = { ...HOME_TARGET, screen: 'settings' };

    const coverage = checkCoverage([HOME_TARGET, missing], makeResult());

    expect(coverage.uncovered).toEqual([missing]);
  });

  it('reports a target only present in skipped as skipped', () => {
    const missing = { ...HOME_TARGET, screen: 'settings' };
    const result = makeResult({ skipped: [{ target: 'settings / default', reason: 'route 500s' }] });

    const coverage = checkCoverage([HOME_TARGET, missing], result);

    expect(coverage.uncovered).toEqual([]);
    expect(coverage.skipped).toEqual([{ target: missing, reason: 'route 500s' }]);
  });

  it('keeps a frame that matches no requested target as an extra', () => {
    const result = makeResult({
      frames: [makeFrame(), makeFrame({ screen: 'bonus', file: '/tmp/bonus.png' })],
    });

    expect(checkCoverage([HOME_TARGET], result).extraFrames).toEqual(['/tmp/bonus.png']);
  });
});

describe('deriveVerdict', () => {
  it('downgrades a reported PASS when a frame failed', () => {
    const result = makeResult({ frames: [makeFrame({ verdict: 'FAIL' })] });

    const decision = deriveVerdict({ result, validation: CLEAN_VALIDATION, coverage: CLEAN_COVERAGE, deniedActions: '' });

    expect(decision.verdict).toBe('FAIL');
    expect(decision.reported).toBe('PASS');
    expect(decision.reasons.join('\n')).toContain('frame FAIL: home / default');
  });

  it('downgrades a reported PASS when a target was never covered', () => {
    const decision = deriveVerdict({
      result: makeResult(),
      validation: CLEAN_VALIDATION,
      coverage: { ...CLEAN_COVERAGE, uncovered: [{ ...HOME_TARGET, screen: 'settings' }] },
      deniedActions: '',
    });

    expect(decision.verdict).toBe('FAIL');
    expect(decision.reasons.join('\n')).toContain('uncovered target: settings');
  });

  it('downgrades a reported PASS when a frame did not validate', () => {
    const decision = deriveVerdict({
      result: makeResult(),
      validation: { ...CLEAN_VALIDATION, problems: ['STALE: /tmp/frame.png (home / default)'] },
      coverage: CLEAN_COVERAGE,
      deniedActions: '',
    });

    expect(decision.verdict).toBe('FAIL');
  });

  it.each([
    ['BLOCKER' as const, 'FAIL'],
    ['MAJOR' as const, 'FAIL'],
    ['MINOR' as const, 'PASS'],
  ])('treats a %s finding as %s', (severity, expected) => {
    const result = makeResult({ findings: [{ severity, screen: 'home', description: 'label clipped' }] });

    const decision = deriveVerdict({ result, validation: CLEAN_VALIDATION, coverage: CLEAN_COVERAGE, deniedActions: '' });

    expect(decision.verdict).toBe(expected);
  });

  it('fails a target Gemini skipped: a reason explains missing evidence, it does not excuse it', () => {
    const decision = deriveVerdict({
      result: makeResult(),
      validation: CLEAN_VALIDATION,
      coverage: {
        ...CLEAN_COVERAGE,
        skipped: [{ target: { ...HOME_TARGET, screen: 'settings' }, reason: 'simulator busy' }],
      },
      deniedActions: '',
    });

    expect(decision.verdict).toBe('FAIL');
    expect(decision.reasons.join('\n')).toContain('skipped target: settings / default (simulator busy)');
  });

  it('is BLOCKED whenever Gemini reported BLOCKED', () => {
    const result = makeResult({ verdict: 'BLOCKED', frames: [] });

    const decision = deriveVerdict({ result, validation: CLEAN_VALIDATION, coverage: CLEAN_COVERAGE, deniedActions: '' });

    expect(decision.verdict).toBe('BLOCKED');
  });

  it('is BLOCKED whenever an action was denied, whatever Gemini reported', () => {
    const decision = deriveVerdict({
      result: makeResult(),
      validation: CLEAN_VALIDATION,
      coverage: CLEAN_COVERAGE,
      deniedActions: 'RunCommand (command)',
    });

    expect(decision.verdict).toBe('BLOCKED');
    expect(decision.reasons.join('\n')).toContain('RunCommand (command)');
  });

  it('fails on a regression and passes on resolved or neutral changes', () => {
    const regressed = deriveVerdict({
      result: makeResult({ regressions: [{ severity: 'MAJOR', screen: 'home', description: 'Retry no longer works' }] }),
      validation: CLEAN_VALIDATION,
      coverage: CLEAN_COVERAGE,
      deniedActions: '',
    });
    const improved = deriveVerdict({
      result: makeResult({
        resolved: [{ screen: 'home', description: 'clipped label now wraps' }],
        changes: [{ screen: 'home', description: 'Retry moved below the message' }],
      }),
      validation: CLEAN_VALIDATION,
      coverage: CLEAN_COVERAGE,
      deniedActions: '',
    });

    expect(regressed.verdict).toBe('FAIL');
    expect(improved.verdict).toBe('PASS');
  });
});

// --------------------------------------------------------------- publishing

describe('runPublishCommand', () => {
  it('substitutes shell-quoted file paths', async () => {
    const dir = makeWorkDir();
    const file = writeFrameFile(dir, "it's here.png");

    const result = await runPublishCommand('echo {files}', [file], dir);

    expect(result.ran).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(file);
  });

  it('does not run without a command or without OK frames', async () => {
    const dir = makeWorkDir();

    expect((await runPublishCommand(undefined, ['/tmp/a.png'], dir)).ran).toBe(false);
    const skipped = await runPublishCommand('echo {files}', [], dir);
    expect(skipped.ran).toBe(false);
    expect(skipped.skippedReason).toContain('no frames validated OK');
  });

  it('does not hang on a command that reads stdin', async () => {
    const dir = makeWorkDir();

    const result = await runPublishCommand('cat; echo done', ['/tmp/a.png'], dir);

    expect(result.ran).toBe(true);
    expect(result.stdout).toBe('done');
  });

  it('reports a non-zero exit instead of throwing', async () => {
    const dir = makeWorkDir();

    const result = await runPublishCommand('echo boom >&2; exit 3', ['/tmp/a.png'], dir);

    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain('boom');
  });
});

// ------------------------------------------------------------------ execute

describe('live-pass execute', () => {
  it('rejects a working directory that is a root or does not exist', async () => {
    const base = { targets: [HOME_TARGET], brief: 'b', driver: 'playwright' };

    await expect(run({ ...base, workingDirectory: '/' })).rejects.toThrow(ERROR_MESSAGES.INVALID_WORKING_DIRECTORY);
    await expect(run({ ...base, workingDirectory: '/no/such/dir/here' })).rejects.toThrow(ERROR_MESSAGES.INVALID_WORKING_DIRECTORY);
    expect(mockExecuteAgyJson).not.toHaveBeenCalled();
  });

  it.each([
    ['outside the working directory', (workDir: string) => path.join(path.dirname(workDir), 'elsewhere')],
    ['equal to the working directory', (workDir: string) => workDir],
    ['relative', () => '.live-pass/run1'],
  ])('rejects an artifactDir that is %s', async (_label, makeDir) => {
    const workDir = makeWorkDir();

    await expect(run({
      targets: [HOME_TARGET], brief: 'b', driver: 'playwright',
      workingDirectory: workDir, artifactDir: makeDir(workDir),
    })).rejects.toThrow(ERROR_MESSAGES.LIVE_PASS_ARTIFACT_DIR);
    expect(mockExecuteAgyJson).not.toHaveBeenCalled();
  });

  it('accepts an artifactDir reached through a symlinked spelling of the worktree', async () => {
    const workDir = makeWorkDir();
    const link = path.join(makeWorkDir(), 'link');
    fs.symlinkSync(workDir, link);
    mockExecuteAgyJson.mockResolvedValue(envelope(makeResult()));

    await run({
      targets: [HOME_TARGET], brief: 'b', driver: 'playwright',
      workingDirectory: link, artifactDir: path.join(link, '.live-pass', 'run1'),
    });

    const options = mockExecuteAgyJson.mock.calls[0][1];
    expect(options.cwd).toBe(workDir);
    expect(options.includeDirectories[1]).toBe(path.join(workDir, '.live-pass', 'run1'));
  });

  it('refuses the default artifact directory when .live-pass is a symlink out of the worktree', async () => {
    const workDir = makeWorkDir();
    const outside = makeWorkDir();
    fs.symlinkSync(outside, path.join(workDir, LIVE_PASS.DEFAULT_ARTIFACT_SEGMENT));

    await expect(run({
      targets: [HOME_TARGET], brief: 'b', driver: 'playwright', workingDirectory: workDir,
    })).rejects.toThrow(ERROR_MESSAGES.LIVE_PASS_ARTIFACT_DIR);
    expect(mockExecuteAgyJson).not.toHaveBeenCalled();
  });

  it('reports uninvited edits when the agy call itself fails', async () => {
    const workDir = makeWorkDir();
    mockSnapshotWorkingTree
      .mockReturnValueOnce(cleanSnapshot(workDir))
      .mockReturnValueOnce({
        root: workDir,
        lines: [' M src/app/index.tsx'],
        hashes: new Map(),
        truncated: false,
      });
    mockExecuteAgyJson.mockRejectedValue(new Error('Error: timed out waiting for response'));

    await expect(run({
      targets: [HOME_TARGET], brief: 'b', driver: 'playwright', workingDirectory: workDir,
    })).rejects.toThrow(/timed out[\s\S]*Working tree[\s\S]*src\/app\/index\.tsx/);
  });

  it('defaults the artifact directory to a timestamped folder under the worktree', async () => {
    const workDir = makeWorkDir();
    mockExecuteAgyJson.mockResolvedValue(envelope(makeResult()));

    await run({ targets: [HOME_TARGET], brief: 'b', driver: 'playwright', workingDirectory: workDir });

    const options = mockExecuteAgyJson.mock.calls[0][1];
    const artifactDir = options.includeDirectories[1];
    expect(artifactDir.startsWith(path.join(workDir, LIVE_PASS.DEFAULT_ARTIFACT_SEGMENT))).toBe(true);
    expect(fs.existsSync(artifactDir)).toBe(true);
  });

  it('forwards the agy options the pass depends on', async () => {
    const workDir = makeWorkDir();
    const artifactDir = path.join(workDir, '.live-pass', 'run1');
    mockExecuteAgyJson.mockResolvedValue(envelope(makeResult()));

    await run({
      targets: [HOME_TARGET], brief: 'b', driver: 'playwright',
      workingDirectory: workDir, artifactDir, conversationId: 'conv-abc',
    });

    const [prompt, options] = mockExecuteAgyJson.mock.calls[0];
    expect(prompt).toContain('Delta reporting');
    expect(options).toMatchObject({
      cwd: workDir,
      noCache: true,
      conversationId: 'conv-abc',
      yolo: true,
      model: MODELS.MEDIUM,
      printTimeout: LIVE_PASS.DEFAULT_PRINT_TIMEOUT,
    });
    expect(options.includeDirectories).toEqual([workDir, artifactDir]);
    expect(JSON.parse(options.jsonSchema).properties).toHaveProperty('frames');
  });

  it('reports PASS with frames, PR markdown and no image data', async () => {
    const workDir = makeWorkDir();
    const artifactDir = path.join(workDir, '.live-pass', 'run1');
    let file = '';
    mockExecuteAgyJson.mockImplementation(async () => {
      file = writeFrameFile(artifactDir, 'home-default-390x844.png');
      writeManifest(artifactDir, [{ file }]);
      return envelope(makeResult({ frames: [makeFrame({ file })] }));
    });

    const report = await run({
      targets: [HOME_TARGET], brief: 'b', driver: 'playwright',
      workingDirectory: workDir, artifactDir, publishCommand: 'echo "![home]({files})"',
    });

    expect(report).toContain('[GEMINI_CONVERSATION_ID=conv-abc]');
    expect(report).toContain('# Live pass: PASS');
    expect(report).toContain(file);
    expect(report).toContain('## PR markdown');
    expect(report).toContain('![home](');
    expect(report).not.toMatch(/data:image|base64/);
    expect(report).not.toContain('WARNING');
  });

  it('fails two targets answered by one screenshot, even when Gemini reports PASS', async () => {
    const workDir = makeWorkDir();
    const artifactDir = path.join(workDir, '.live-pass', 'run1');
    const wide = { ...HOME_TARGET, viewport: '1280x800' };
    mockExecuteAgyJson.mockImplementation(async () => {
      const file = writeFrameFile(artifactDir, frameFileName(HOME_TARGET));
      writeManifest(artifactDir, [{ file }, { file }]);
      return envelope(makeResult({
        frames: [makeFrame({ file }), makeFrame({ file, viewport: '1280x800' })],
      }));
    });

    const report = await run({
      targets: [HOME_TARGET, wide], brief: 'b', driver: 'playwright',
      workingDirectory: workDir, artifactDir,
    });

    expect(report).toContain('# Live pass: FAIL (Gemini reported PASS)');
    expect(report).toContain('reused evidence file');
  });

  it('passes the same two targets when each has its own screenshot', async () => {
    const workDir = makeWorkDir();
    const artifactDir = path.join(workDir, '.live-pass', 'run1');
    const wide = { ...HOME_TARGET, viewport: '1280x800' };
    mockExecuteAgyJson.mockImplementation(async () => {
      const mobile = writeFrameFile(artifactDir, frameFileName(HOME_TARGET));
      const desktop = writeFrameFile(artifactDir, frameFileName(wide));
      writeManifest(artifactDir, [{ file: mobile }, { file: desktop }]);
      return envelope(makeResult({
        frames: [makeFrame({ file: mobile }), makeFrame({ file: desktop, viewport: '1280x800' })],
      }));
    });

    const report = await run({
      targets: [HOME_TARGET, wide], brief: 'b', driver: 'playwright',
      workingDirectory: workDir, artifactDir,
    });

    expect(report).toContain('# Live pass: PASS');
    expect(report).not.toContain('reused evidence file');
    expect(report).not.toContain('MISNAMED');
  });

  it('derives FAIL from an uncovered target even when Gemini reports PASS', async () => {
    const workDir = makeWorkDir();
    const artifactDir = path.join(workDir, '.live-pass', 'run1');
    mockExecuteAgyJson.mockImplementation(async () => {
      const file = writeFrameFile(artifactDir, 'home-default-390x844.png');
      writeManifest(artifactDir, [{ file }]);
      return envelope(makeResult({ frames: [makeFrame({ file })] }));
    });

    const report = await run({
      targets: [HOME_TARGET, { ...HOME_TARGET, screen: 'missing', state: 'not-found', expected: '404 text' }],
      brief: 'b', driver: 'playwright', workingDirectory: workDir, artifactDir,
    });

    expect(report).toContain('# Live pass: FAIL (Gemini reported PASS)');
    expect(report).toContain('uncovered target: missing / not-found');
  });

  it('passes a resumed re-pass whose only earlier defect is now fixed', async () => {
    const workDir = makeWorkDir();
    const artifactDir = path.join(workDir, '.live-pass', 'run2');
    mockExecuteAgyJson.mockImplementation(async () => {
      const file = writeFrameFile(artifactDir, 'home-default-390x844.png');
      writeManifest(artifactDir, [{ file }]);
      return envelope(makeResult({
        frames: [makeFrame({ file })],
        resolved: [{ screen: 'home', description: 'the clipped Retry label now wraps' }],
      }));
    });

    const report = await run({
      targets: [HOME_TARGET], brief: 'b', driver: 'playwright',
      workingDirectory: workDir, artifactDir, conversationId: 'conv-abc',
    });

    expect(report).toContain('# Live pass: PASS');
    expect(report).toContain('the clipped Retry label now wraps');
  });

  it('fails a resumed re-pass that reports a regression', async () => {
    const workDir = makeWorkDir();
    const artifactDir = path.join(workDir, '.live-pass', 'run2');
    mockExecuteAgyJson.mockImplementation(async () => {
      const file = writeFrameFile(artifactDir, 'home-default-390x844.png');
      writeManifest(artifactDir, [{ file }]);
      return envelope(makeResult({
        frames: [makeFrame({ file })],
        regressions: [{ severity: 'MAJOR', screen: 'home', description: 'Retry no longer reloads' }],
      }));
    });

    const report = await run({
      targets: [HOME_TARGET], brief: 'b', driver: 'playwright',
      workingDirectory: workDir, artifactDir, conversationId: 'conv-abc',
    });

    expect(report).toContain('# Live pass: FAIL');
    expect(report).toContain('Retry no longer reloads');
  });

  it('blocks and skips publishing when actions were denied', async () => {
    const workDir = makeWorkDir();
    const artifactDir = path.join(workDir, '.live-pass', 'run1');
    const marker = path.join(workDir, 'published.txt');
    mockExecuteAgyJson.mockResolvedValue(envelope(makeResult({ verdict: 'BLOCKED', frames: [] }), {
      denied_actions: [{ action: 'command', display_name: 'RunCommand' }],
    }));

    const report = await run({
      targets: [HOME_TARGET], brief: 'b', driver: 'playwright',
      workingDirectory: workDir, artifactDir, publishCommand: `touch ${marker}`,
    });

    expect(report).toContain('# Live pass: BLOCKED');
    expect(report).toContain('RunCommand (command)');
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('blocks when the answer does not match the result schema', async () => {
    const workDir = makeWorkDir();
    mockExecuteAgyJson.mockResolvedValue(envelope({ verdict: 'MAYBE' }));

    const report = await run({
      targets: [HOME_TARGET], brief: 'b', driver: 'playwright', workingDirectory: workDir,
    });

    expect(report).toContain('# Live pass: BLOCKED');
    expect(report).toContain('Schema issues');
    expect(report).toContain('Raw answer (truncated)');
  });

  it('still reports uninvited edits when the answer is off-schema', async () => {
    const workDir = makeWorkDir();
    mockSnapshotWorkingTree
      .mockReturnValueOnce(cleanSnapshot(workDir))
      .mockReturnValueOnce({ root: workDir, lines: [' M src/app/index.tsx'], hashes: new Map(), truncated: false });
    mockExecuteAgyJson.mockResolvedValue(envelope({ verdict: 'MAYBE' }));

    const report = await run({
      targets: [HOME_TARGET], brief: 'b', driver: 'playwright', workingDirectory: workDir,
    });

    expect(report).toContain('# Live pass: BLOCKED');
    expect(report).toContain('## Working tree');
    expect(report).toContain('src/app/index.tsx');
  });

  it('warns when the working tree changed during the pass', async () => {
    const workDir = makeWorkDir();
    const artifactDir = path.join(workDir, '.live-pass', 'run1');
    mockSnapshotWorkingTree
      .mockReturnValueOnce(cleanSnapshot(workDir))
      .mockReturnValueOnce({ root: workDir, lines: [' M src/app/index.tsx'], hashes: new Map(), truncated: false });
    mockExecuteAgyJson.mockImplementation(async () => {
      const file = writeFrameFile(artifactDir, 'home-default-390x844.png');
      writeManifest(artifactDir, [{ file }]);
      return envelope(makeResult({ frames: [makeFrame({ file })] }));
    });

    const report = await run({
      targets: [HOME_TARGET], brief: 'b', driver: 'playwright',
      workingDirectory: workDir, artifactDir,
    });

    expect(report).toContain('## Working tree');
    expect(report).toContain('WARNING');
    expect(report).toContain('src/app/index.tsx');
  });
});

describe('livePassResultSchema', () => {
  it('accepts a fresh pass with empty delta arrays', () => {
    expect(livePassResultSchema.safeParse(makeResult()).success).toBe(true);
  });

  it('rejects a frame verdict outside PASS/FAIL', () => {
    const result = makeResult({ frames: [makeFrame({ verdict: 'BLOCKED' as any })] });

    expect(livePassResultSchema.safeParse(result).success).toBe(false);
  });
});
