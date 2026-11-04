import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

vi.mock('../utils/logger.js', () => ({
  Logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn(), toolInvocation: vi.fn() },
}));

const mockExecuteAgyJson = vi.fn();
vi.mock('../utils/agyExecutor.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/agyExecutor.js')>();
  return { ...actual, executeAgyJson: (...args: any[]) => mockExecuteAgyJson(...args) };
});

const mockSnapshotWorkingTree = vi.fn().mockReturnValue({ root: '/repo', lines: [], hashes: new Map(), truncated: false });
vi.mock('../utils/gitStatusGuard.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/gitStatusGuard.js')>();
  return { ...actual, snapshotWorkingTree: (...args: any[]) => mockSnapshotWorkingTree(...args) };
});

import {
  screenReviewTool,
  screenReviewArgsSchema,
  buildScreenReviewPrompt,
  deriveReviewVerdict,
  type ScreenReviewResult,
} from '../tools/screen-review.tool.js';
import { ERROR_MESSAGES, LIVE_PASS, MODELS } from '../constants.js';
import { makeTempDir, cleanupTempDirs } from './utils/test-helpers.js';

// ------------------------------------------------------------------ helpers

const makeWorkDir = () => makeTempDir('screen-review');

function writeFile(dir: string, name: string, contents = 'x'): string {
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  return file;
}

function makeReviewResult(overrides: Partial<ScreenReviewResult> = {}): ScreenReviewResult {
  return {
    verdict: 'APPROVE',
    screens: [],
    cross_screen_findings: [],
    summary: 'Everything reads correctly.',
    ...overrides,
  };
}

function makeScreen(
  file: string,
  findings: ScreenReviewResult['screens'][number]['findings'] = [],
  route_file = ''
) {
  return { file, subject: 'home / default', route_file, inventory: ['Retry button', 'Title'], findings };
}

function makeFinding(overrides: Partial<ScreenReviewResult['cross_screen_findings'][number]> = {}) {
  return {
    severity: 'MAJOR' as const,
    confirmed: true,
    location: 'header, right edge',
    observed: 'the title is cut off after "Order det"',
    rule: 'composition contract §2',
    fix: 'let the title wrap to two lines',
    ...overrides,
  };
}

function envelope(structured: unknown, overrides: Record<string, unknown> = {}) {
  return {
    conversation_id: 'conv-xyz',
    status: 'SUCCESS',
    response: '',
    structured_output: structured,
    num_turns: 2,
    duration_seconds: 20,
    usage: { input_tokens: 9000, output_tokens: 400, total_tokens: 9400 },
    denied_actions: [],
    ...overrides,
  };
}

function run(args: Record<string, unknown>): Promise<string> {
  return screenReviewTool.execute(args as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSnapshotWorkingTree.mockReturnValue({ root: '/repo', lines: [], hashes: new Map(), truncated: false });
});

afterEach(cleanupTempDirs);

// ------------------------------------------------------------------- schema

describe('screenReviewArgsSchema', () => {
  it('applies the documented defaults', () => {
    const workDir = makeWorkDir();
    const image = writeFile(workDir, 'home.png');

    const parsed = screenReviewArgsSchema.parse({
      mode: 'review', instructions: 'judge these', workingDirectory: workDir, images: [image],
    });

    expect(parsed.yolo).toBe(false);
    expect(parsed.model).toBe(MODELS.MEDIUM);
    expect(parsed.model).toBe('Gemini 3.8 Flash (Medium)');
    expect(parsed.printTimeout).toBe(LIVE_PASS.SCREEN_REVIEW_PRINT_TIMEOUT);
  });

  it.each([
    ['no images key', {}],
    ['an empty images list', { images: [] }],
    ['a relative image path', { images: ['frames/home.png'] }],
    ['an image that does not exist', { images: ['/tmp/definitely-not-here-9d3f.png'] }],
  ])('rejects review mode with %s', (_label, overrides) => {
    const workDir = makeWorkDir();

    expect(() => screenReviewArgsSchema.parse({
      mode: 'review', instructions: 'judge these', workingDirectory: workDir, ...overrides,
    })).toThrow();
  });

  it('rejects paths containing whitespace, which agy cannot resolve as an @reference', () => {
    const workDir = makeWorkDir();
    const spaced = writeFile(workDir, 'my frames/home.png');

    expect(() => screenReviewArgsSchema.parse({
      mode: 'review', instructions: 'i', workingDirectory: workDir, images: [spaced],
    })).toThrow(ERROR_MESSAGES.UNREFERENCEABLE_PATH);

    const spacedRoute = writeFile(workDir, 'my app/orders.tsx');
    expect(() => screenReviewArgsSchema.parse({
      mode: 'plan', instructions: 'i', workingDirectory: workDir, routeFile: spacedRoute,
    })).toThrow(ERROR_MESSAGES.UNREFERENCEABLE_PATH);
  });

  it('rejects a non-image file in review mode', () => {
    const workDir = makeWorkDir();
    const notAnImage = writeFile(workDir, 'notes.txt');

    expect(() => screenReviewArgsSchema.parse({
      mode: 'review', instructions: 'judge these', workingDirectory: workDir, images: [notAnImage],
    })).toThrow(/PNG or JPEG/);
  });

  it('rejects a routeFile in review mode and images in plan mode', () => {
    const workDir = makeWorkDir();
    const image = writeFile(workDir, 'home.png');
    const route = writeFile(workDir, 'app/orders.tsx');

    expect(() => screenReviewArgsSchema.parse({
      mode: 'review', instructions: 'i', workingDirectory: workDir, images: [image], routeFile: route,
    })).toThrow(/plan mode only/);
    expect(() => screenReviewArgsSchema.parse({
      mode: 'plan', instructions: 'i', workingDirectory: workDir, routeFile: route, images: [image],
    })).toThrow(/review mode only/);
  });

  it('rejects a plan routeFile that is missing, relative or outside the working directory', () => {
    const workDir = makeWorkDir();
    const outside = writeFile(makeWorkDir(), 'other.tsx');

    for (const routeFile of [undefined, 'app/orders.tsx', '/tmp/nope-8a21.tsx', outside]) {
      expect(() => screenReviewArgsSchema.parse({
        mode: 'plan', instructions: 'i', workingDirectory: workDir, routeFile,
      })).toThrow(ERROR_MESSAGES.SCREEN_REVIEW_ROUTE_FILE);
    }
  });

  it('rejects baseRef in plan mode', () => {
    const workDir = makeWorkDir();
    const route = writeFile(workDir, 'app/orders.tsx');

    expect(() => screenReviewArgsSchema.parse({
      mode: 'plan', instructions: 'i', workingDirectory: workDir, routeFile: route, baseRef: 'origin/main',
    })).toThrow(/baseRef is review mode only/);
  });

  it('accepts a plan routeFile inside the working directory', () => {
    const workDir = makeWorkDir();
    const route = writeFile(workDir, 'app/orders.tsx');

    const parsed = screenReviewArgsSchema.parse({
      mode: 'plan', instructions: 'i', workingDirectory: workDir, routeFile: route,
    });

    expect(parsed.routeFile).toBe(route);
  });
});

// ------------------------------------------------------------------- prompt

describe('buildScreenReviewPrompt', () => {
  it('puts one @reference per image and demands schema-only output', () => {
    const prompt = buildScreenReviewPrompt({
      mode: 'review',
      instructions: '## Reviewer prompt\nCheck every control.',
      context: 'composition contract v3',
      images: ['/frames/a.png', '/frames/b.png'],
    });

    expect(prompt).toContain('Open every image below before reading any code');
    expect(prompt).toContain('@/frames/a.png\n@/frames/b.png');
    expect(prompt).toContain('## Reviewer prompt');
    expect(prompt).toContain('composition contract v3');
    expect(prompt).toContain('Enumerate what is in each image');
    expect(prompt).toContain('ONLY the schema JSON');
  });

  it('keeps the caller instructions verbatim and first in their own block', () => {
    const instructions = 'ROLE: screen reviewer\nCheck every control.';
    const prompt = buildScreenReviewPrompt({ mode: 'review', instructions, images: ['/frames/a.png'] });

    expect(prompt).toContain(`## Instructions\n${instructions}`);
  });

  it.each(['review', 'plan'] as const)('labels the caller context under its own heading in %s mode', (mode) => {
    const supplied = buildScreenReviewPrompt({
      mode,
      instructions: 'ROLE: screen reviewer',
      context: 'composition contract v3\nchanged: app/orders.tsx',
      images: mode === 'review' ? ['/frames/a.png'] : undefined,
      routeFile: mode === 'plan' ? '/work/app/orders.tsx' : undefined,
    });
    const absent = buildScreenReviewPrompt({
      mode,
      instructions: 'ROLE: screen reviewer',
      images: mode === 'review' ? ['/frames/a.png'] : undefined,
      routeFile: mode === 'plan' ? '/work/app/orders.tsx' : undefined,
    });

    const heading = '## Context supplied by the caller (composition contract, changed files)';
    expect(supplied).toContain(`${heading}\ncomposition contract v3\nchanged: app/orders.tsx`);
    expect(absent).toContain(`${heading}\nNo context supplied.`);
  });

  it('tells Gemini to echo each image path verbatim as screens[].file', () => {
    const images = ['/frames/a.png', '/frames/b space.png'];
    const prompt = buildScreenReviewPrompt({ mode: 'review', instructions: 'i', images });

    for (const image of images) {
      expect(prompt).toContain(image);
    }
    expect(prompt).toContain('absolute path copied verbatim from the @ line');
    expect(prompt).toContain('One "screens" entry per image');
  });

  it('references the route file and asks for no verdict in plan mode', () => {
    const prompt = buildScreenReviewPrompt({
      mode: 'plan',
      instructions: 'inventory the actions',
      routeFile: '/work/app/orders.tsx',
    });

    expect(prompt).toContain('@/work/app/orders.tsx');
    expect(prompt).toContain('no verdict');
    expect(prompt).not.toContain('Open every image');
  });
});

describe('buildScreenReviewPrompt: bounded reads', () => {
  const SHARED = [
    'Read only the code the checklist needs as evidence, and only the lines you need:',
    '- the changed files listed above or named in the context;',
    '- the producer lines (serializers, services, hooks) behind a capability or viewer-scoped field the checklist asks about;',
    '- the rule files and READMEs the instructions cite, and the board or design files they name.',
  ];
  const BANNED = 'Never run tests, Jest, npm or any package script. Never read node_modules, release notes or changelog fragments. Never re-read the file the instructions came from: they are above, verbatim.';
  const SHA = '0123456789abcdef0123456789abcdef01234567';

  const review = (overrides: { mergeBase?: string; changedRoutes?: string[] } = {}) =>
    buildScreenReviewPrompt({ mode: 'review', instructions: 'i', images: ['/frames/a.png'], ...overrides });
  const plan = () => buildScreenReviewPrompt({ mode: 'plan', instructions: 'i', routeFile: '/work/app/orders.tsx' });

  it.each([['review', review], ['plan', plan]] as const)('allows the evidence reads and bans tests, npm, node_modules and release notes in %s mode', (_mode, build) => {
    const prompt = build();

    expect(prompt).toContain('## Reading code (bounded)');
    for (const line of SHARED) {
      expect(prompt).toContain(line);
    }
    expect(prompt).toContain(BANNED);
  });

  it('lets review mode read the route file each image shows and what it renders, changed or not', () => {
    expect(review()).toContain('- the route file each image shows, and the components and UI primitives it renders;');
  });

  it('lets plan mode read its own route file and what it renders', () => {
    expect(plan()).toContain('- the route file above, and the components and UI primitives it renders;');
  });

  it('puts the changed files the reading rule points at above it', () => {
    const prompt = review({ changedRoutes: ['app/orders.tsx'] });

    expect(prompt.indexOf('## Changed files in this diff')).toBeLessThan(prompt.indexOf('## Reading code (bounded)'));
  });

  it('allows only three-dot git diff and git show against the resolved merge base in review mode', () => {
    const prompt = review({ mergeBase: SHA });

    expect(prompt).toContain(`The diff under review is ${SHA}...HEAD (${SHA} is the merge base of the caller's base ref and HEAD, resolved for you).`);
    expect(prompt).toContain(`you may run read-only \`git diff ${SHA}...HEAD\`, optionally with \`--name-only\` and \`-- <paths>\`, and \`git show ${SHA}:<path>\`. No other git command.`);
    expect(prompt).not.toContain('Never run git.');
  });

  it('allows no git in review mode without a merge base, nor in plan mode', () => {
    expect(review()).toContain('Never run git.');
    expect(review()).not.toContain('git diff');
    expect(plan()).toContain('Never run git.');
    expect(plan()).not.toContain('git diff');
  });

  it('keeps the image instruction ahead of any code reading', () => {
    const prompt = review({ mergeBase: SHA });

    expect(prompt).toContain('Open every image below before reading any code. You are the second pair of eyes on frames someone else captured');
    expect(prompt.indexOf('Open every image below')).toBeLessThan(prompt.indexOf('## Reading code (bounded)'));
  });
});

// ----------------------------------------------------------------- verdicts

describe('deriveReviewVerdict', () => {
  const image = '/frames/a.png';

  it('requests changes for a confirmed MAJOR even when Gemini approved', () => {
    const result = makeReviewResult({ screens: [makeScreen(image, [makeFinding()])] });

    const decision = deriveReviewVerdict(result, [image]);

    expect(decision.verdict).toBe('REQUEST_CHANGES');
    expect(decision.reported).toBe('APPROVE');
  });

  it('requests changes for any BLOCKER', () => {
    const result = makeReviewResult({
      screens: [makeScreen(image, [makeFinding({ severity: 'BLOCKER', confirmed: false })])],
    });

    expect(deriveReviewVerdict(result, [image]).verdict).toBe('REQUEST_CHANGES');
  });

  it('approves when the only MAJOR is unconfirmed, and counts the downgrade', () => {
    const result = makeReviewResult({
      screens: [makeScreen(image, [makeFinding({ confirmed: false })])],
    });

    const decision = deriveReviewVerdict(result, [image]);

    expect(decision.verdict).toBe('APPROVE');
    expect(decision.downgraded).toBe(1);
  });

  it('requests changes when an image was never reviewed', () => {
    const decision = deriveReviewVerdict(makeReviewResult({ screens: [makeScreen(image)] }), [image, '/frames/b.png']);

    expect(decision.verdict).toBe('REQUEST_CHANGES');
    expect(decision.unreviewed).toEqual(['/frames/b.png']);
  });

  it('matches an image Gemini echoed through a different spelling of the same path', () => {
    const workDir = makeWorkDir();
    const supplied = writeFile(workDir, 'frames/home.png');
    const echoed = path.join(workDir, 'frames', '.', 'home.png');

    const decision = deriveReviewVerdict(makeReviewResult({ screens: [makeScreen(echoed)] }), [supplied]);

    expect(decision.unreviewed).toEqual([]);
    expect(decision.unknownFiles).toEqual([]);
    expect(decision.verdict).toBe('APPROVE');
  });

  it('notes screens naming an image that was not supplied', () => {
    const decision = deriveReviewVerdict(makeReviewResult({ screens: [makeScreen('/frames/ghost.png')] }), [image]);

    expect(decision.unknownFiles).toEqual(['/frames/ghost.png']);
  });

  it('requests changes when a changed screen has no frame, even with only MINOR findings', () => {
    const result = makeReviewResult({
      screens: [makeScreen(image, [makeFinding({ severity: 'MINOR' })], 'app/(tabs)/orders.tsx')],
    });

    const decision = deriveReviewVerdict(result, [image], ['app/(tabs)/orders.tsx', 'app/(tabs)/settings.tsx']);

    expect(decision.verdict).toBe('REQUEST_CHANGES');
    expect(decision.reported).toBe('APPROVE');
    expect(decision.reasons).toContain('no evidence for changed screen app/(tabs)/settings.tsx');
    expect(decision.coverage).toEqual([
      { route: 'app/(tabs)/orders.tsx', image },
      { route: 'app/(tabs)/settings.tsx', image: null },
    ]);
  });

  it('leaves the verdict alone when every changed screen has a frame', () => {
    const second = '/frames/b.png';
    const result = makeReviewResult({
      screens: [
        makeScreen(image, [], 'app/(tabs)/orders.tsx'),
        makeScreen(second, [], 'src/app/(tabs)/settings.tsx'),
      ],
    });

    const decision = deriveReviewVerdict(result, [image, second], ['app/(tabs)/orders.tsx', 'app/(tabs)/settings.tsx']);

    expect(decision.verdict).toBe('APPROVE');
    expect(decision.reasons).toEqual([]);
  });

  it('refuses a truncated route_file that would cover several changed screens', () => {
    const result = makeReviewResult({ screens: [makeScreen(image, [], 'app/orders.tsx')] });

    const decision = deriveReviewVerdict(result, [image], [
      'apps/admin/app/orders.tsx',
      'apps/customer/app/orders.tsx',
    ]);

    expect(decision.verdict).toBe('REQUEST_CHANGES');
    expect(decision.coverage.every(entry => entry.image === null)).toBe(true);
  });

  it('still accepts an absolute route_file naming the changed path', () => {
    const result = makeReviewResult({
      screens: [makeScreen(image, [], '/repo/apps/admin/app/orders.tsx')],
    });

    const decision = deriveReviewVerdict(result, [image], ['apps/admin/app/orders.tsx']);

    expect(decision.verdict).toBe('APPROVE');
    expect(decision.coverage[0].image).toBe(image);
  });

  it('only warns for a changed component with no frame', () => {
    const result = makeReviewResult({ screens: [makeScreen(image, [], 'app/(tabs)/orders.tsx')] });

    const decision = deriveReviewVerdict(result, [image], ['app/(tabs)/orders.tsx', 'components/ActionRow.tsx']);

    expect(decision.verdict).toBe('APPROVE');
    expect(decision.warnings).toEqual(['changed component with no frame showing it: components/ActionRow.tsx']);
  });

  it('reports no coverage at all when changedRoutes is omitted', () => {
    const decision = deriveReviewVerdict(makeReviewResult({ screens: [makeScreen(image)] }), [image]);

    expect(decision.coverage).toEqual([]);
    expect(decision.verdict).toBe('APPROVE');
  });

  it('counts cross-screen findings too', () => {
    const result = makeReviewResult({ cross_screen_findings: [makeFinding()] });

    expect(deriveReviewVerdict(result, []).verdict).toBe('REQUEST_CHANGES');
  });
});

// ------------------------------------------------------------------ execute

describe('screen-review execute', () => {
  it('runs read-only from the working directory and adds every image directory', async () => {
    const workDir = makeWorkDir();
    const image = writeFile(workDir, 'frames/home.png');
    mockExecuteAgyJson.mockResolvedValue(envelope(makeReviewResult({ screens: [makeScreen(image)] })));

    await run({ mode: 'review', instructions: 'judge', workingDirectory: workDir, images: [image] });

    const [prompt, options] = mockExecuteAgyJson.mock.calls[0];
    expect(prompt).toContain(`@${image}`);
    expect(options).toMatchObject({ cwd: workDir, yolo: false, noCache: true, model: MODELS.MEDIUM });
    expect(options.includeDirectories).toEqual([workDir, path.dirname(image)]);
  });

  it('resolves baseRef to its merge base with HEAD and prints that commit', async () => {
    const workDir = makeWorkDir();
    const git = (...args: string[]) => execFileSync('git', args, { cwd: workDir, encoding: 'utf-8' }).trim();
    const commit = (message: string) => git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '--quiet', '--allow-empty', '-m', message);
    git('init', '--quiet', '--initial-branch', 'main');
    commit('base');
    const mergeBase = git('rev-parse', 'HEAD');
    git('checkout', '--quiet', '-b', 'feature');
    commit('feature work');
    git('checkout', '--quiet', 'main');
    commit('main moved on');
    git('checkout', '--quiet', 'feature');
    const image = writeFile(workDir, 'frames/home.png');
    mockExecuteAgyJson.mockResolvedValue(envelope(makeReviewResult({ screens: [makeScreen(image)] })));

    await run({ mode: 'review', instructions: 'judge', workingDirectory: workDir, images: [image], baseRef: 'main' });

    expect(mockExecuteAgyJson.mock.calls[0][0]).toContain(`\`git diff ${mergeBase}...HEAD\``);
  });

  it.each([
    ['an unknown ref', 'no-such-branch'],
    ['an option-like ref', '--output=/tmp/screen-review-should-not-exist'],
    ['a brace expansion that would spell options in a shell', '{-1..-2}'],
  ])('fails before calling Gemini on %s', async (_label, baseRef) => {
    const workDir = makeWorkDir();
    execFileSync('git', ['init', '--quiet'], { cwd: workDir });
    execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '--quiet', '--allow-empty', '-m', 'base'], { cwd: workDir });
    const image = writeFile(workDir, 'frames/home.png');

    await expect(run({ mode: 'review', instructions: 'judge', workingDirectory: workDir, images: [image], baseRef }))
      .rejects.toThrow(`${ERROR_MESSAGES.SCREEN_REVIEW_BASE_REF}: '${baseRef}'. fatal: Not a valid object name ${baseRef}`);
    expect(mockExecuteAgyJson).not.toHaveBeenCalled();
    expect(fs.existsSync('/tmp/screen-review-should-not-exist')).toBe(false);
  });

  it('fails before calling Gemini when baseRef is given outside a git checkout', async () => {
    const workDir = makeWorkDir();
    const image = writeFile(workDir, 'frames/home.png');

    await expect(run({ mode: 'review', instructions: 'judge', workingDirectory: workDir, images: [image], baseRef: 'main' }))
      .rejects.toThrow(`${ERROR_MESSAGES.SCREEN_REVIEW_BASE_REF}: 'main'.`);
    expect(mockExecuteAgyJson).not.toHaveBeenCalled();
  });

  it('rejects a working directory that does not exist', async () => {
    const workDir = makeWorkDir();
    const image = writeFile(workDir, 'home.png');

    await expect(run({
      mode: 'review', instructions: 'judge', workingDirectory: '/no/such/dir/here', images: [image],
    })).rejects.toThrow();
    expect(mockExecuteAgyJson).not.toHaveBeenCalled();
  });

  it('reports the review as text with inventory, findings and the conversation line', async () => {
    const workDir = makeWorkDir();
    const image = writeFile(workDir, 'frames/home.png');
    mockExecuteAgyJson.mockResolvedValue(envelope(makeReviewResult({
      screens: [makeScreen(image, [makeFinding(), makeFinding({ confirmed: false, observed: 'maybe clipped' })])],
    })));

    const report = await run({ mode: 'review', instructions: 'judge', workingDirectory: workDir, images: [image] });

    expect(report).toContain('[GEMINI_CONVERSATION_ID=conv-xyz]');
    expect(report).toContain('# Screen review: REQUEST_CHANGES (Gemini reported APPROVE)');
    expect(report).toContain('inventory: Retry button, Title');
    expect(report).toContain('MAJOR — the title is cut off');
    expect(report).toContain('MINOR (unconfirmed, downgraded) — maybe clipped');
    expect(report).toContain('Usage:');
    expect(report).not.toMatch(/data:image|base64/);
  });

  it('lists the changed files for Gemini and prints the coverage table', async () => {
    const workDir = makeWorkDir();
    const image = writeFile(workDir, 'frames/orders.png');
    mockExecuteAgyJson.mockResolvedValue(envelope(makeReviewResult({
      screens: [makeScreen(image, [], 'app/(tabs)/orders.tsx')],
    })));

    const report = await run({
      mode: 'review', instructions: 'judge', workingDirectory: workDir, images: [image],
      changedRoutes: ['app/(tabs)/orders.tsx', 'app/(tabs)/settings.tsx'],
    });

    const prompt = mockExecuteAgyJson.mock.calls[0][0];
    expect(prompt).toContain('## Changed files in this diff\n- app/(tabs)/orders.tsx\n- app/(tabs)/settings.tsx');
    expect(prompt).toContain('Set each screen\'s "route_file"');
    expect(report).toContain('## Screenshot coverage');
    expect(report).toContain(`- app/(tabs)/orders.tsx → ${image}`);
    expect(report).toContain('- app/(tabs)/settings.tsx → MISSING');
    expect(report).toContain('# Screen review: REQUEST_CHANGES (Gemini reported APPROVE)');
  });

  it('omits the coverage section when no changed routes were given', async () => {
    const workDir = makeWorkDir();
    const image = writeFile(workDir, 'frames/orders.png');
    mockExecuteAgyJson.mockResolvedValue(envelope(makeReviewResult({ screens: [makeScreen(image)] })));

    const report = await run({ mode: 'review', instructions: 'judge', workingDirectory: workDir, images: [image] });

    expect(report).not.toContain('Screenshot coverage');
    expect(report).not.toContain('Changed files in this diff');
  });

  it('renders the plan table in the documented column order with no verdict', async () => {
    const workDir = makeWorkDir();
    const route = writeFile(workDir, 'app/orders.tsx');
    mockExecuteAgyJson.mockResolvedValue(envelope({
      route_file: route,
      controls: [{
        control: 'Reassign', primitive: 'ActionRow', placement: 'top slot', promoted: true,
        verb_today: 'Reassign', verb_per_rule: 'Reassign driver', operation: 'update',
        capability: 'orders:write', scope: 'order',
      }],
      top_slot_priority: ['Reassign', 'Cancel'],
      hand_rolls_to_delete: [{ line: 'app/orders.tsx:42', primitive: 'ActionRow' }],
      notes: 'Cancel is destructive.',
    }));

    const report = await run({ mode: 'plan', instructions: 'inventory', workingDirectory: workDir, routeFile: route });

    expect(report).toContain('| control | primitive | placement | promoted | verb today | verb per rule | operation | capability | scope |');
    expect(report).toContain('| Reassign | ActionRow | top slot | true |');
    expect(report).toContain('app/orders.tsx:42 → ActionRow');
    expect(report).not.toContain('APPROVE');
    expect(report).not.toContain('Warnings');
  });

  it('reports uninvited edits in plan mode too, when yolo gave Gemini a shell', async () => {
    const workDir = makeWorkDir();
    const route = writeFile(workDir, 'app/orders.tsx');
    mockSnapshotWorkingTree
      .mockReturnValueOnce({ root: workDir, lines: [], hashes: new Map(), truncated: false })
      .mockReturnValueOnce({ root: workDir, lines: [' M app/orders.tsx'], hashes: new Map(), truncated: false });
    mockExecuteAgyJson.mockResolvedValue(envelope({
      route_file: route, controls: [], top_slot_priority: [], hand_rolls_to_delete: [], notes: '',
    }));

    const report = await run({
      mode: 'plan', instructions: 'inventory', workingDirectory: workDir, routeFile: route, yolo: true,
    });

    expect(report).toContain('## Working tree');
    expect(report).toContain('app/orders.tsx');
  });

  it('reports uninvited edits when the agy call itself fails', async () => {
    const workDir = makeWorkDir();
    const image = writeFile(workDir, 'frames/home.png');
    mockSnapshotWorkingTree
      .mockReturnValueOnce({ root: workDir, lines: [], hashes: new Map(), truncated: false })
      .mockReturnValueOnce({
        root: workDir,
        lines: [' M app/orders.tsx'],
        hashes: new Map(),
        truncated: false,
      });
    mockExecuteAgyJson.mockRejectedValue(new Error('Error: timed out waiting for response'));

    await expect(run({
      mode: 'review', instructions: 'judge', workingDirectory: workDir, images: [image], yolo: true,
    })).rejects.toThrow(/timed out[\s\S]*Working tree[\s\S]*app\/orders\.tsx/);
  });

  it('accepts a route file reached through a symlinked spelling of the working directory', () => {
    const workDir = makeWorkDir();
    const route = writeFile(workDir, 'app/orders.tsx');
    const link = path.join(makeWorkDir(), 'link');
    fs.symlinkSync(workDir, link);

    const parsed = screenReviewArgsSchema.parse({
      mode: 'plan', instructions: 'i', workingDirectory: link, routeFile: route,
    });

    expect(parsed.routeFile).toBe(route);
  });

  it('warns when the plan answer names a different route file', async () => {
    const workDir = makeWorkDir();
    const route = writeFile(workDir, 'app/orders.tsx');
    mockExecuteAgyJson.mockResolvedValue(envelope({
      route_file: '/somewhere/else.tsx',
      controls: [], top_slot_priority: [], hand_rolls_to_delete: [], notes: '',
    }));

    const report = await run({ mode: 'plan', instructions: 'inventory', workingDirectory: workDir, routeFile: route });

    expect(report).toContain('## Warnings');
    expect(report).toContain('/somewhere/else.tsx');
  });

  it('says so when the answer does not match the schema', async () => {
    const workDir = makeWorkDir();
    const image = writeFile(workDir, 'home.png');
    mockExecuteAgyJson.mockResolvedValue(envelope({ verdict: 'MAYBE' }));

    const report = await run({ mode: 'review', instructions: 'judge', workingDirectory: workDir, images: [image] });

    expect(report).toContain('no usable answer');
    expect(report).toContain('Schema issues');
  });
});
