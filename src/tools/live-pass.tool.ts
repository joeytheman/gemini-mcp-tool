import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { UnifiedTool, formatZodIssues } from './registry.js';
import {
  deniedActionsSummary,
  executeAgyJson,
  formatAgyUsageLine,
  formatConversationLine,
  toAgyJsonSchema,
  type AgyJsonEnvelope,
} from '../utils/agyExecutor.js';
import { bulletList, section, renderUnparsableEnvelope, formatWorkingTreeSection, failWithWorkingTree } from '../utils/agyReport.js';
import { isWithin, resolveWorkingDirectory, realpathOfExistingPrefix } from '../utils/fileReferences.js';
import { snapshotWorkingTree, diffWorkingTree, type WorkingTreeDiff } from '../utils/gitStatusGuard.js';
import { ERROR_MESSAGES, LIVE_PASS, MODELS, MODEL_CHOICE_DESCRIPTION } from '../constants.js';

const execFileAsync = promisify(execFile);

const PUBLISH_MAX_BUFFER = 10 * 1024 * 1024;
const PUBLISH_TIMEOUT_MS = 5 * 60 * 1000;
const FILES_PLACEHOLDER = '{files}';

// ---------------------------------------------------------------- arguments

export const livePassTargetSchema = z.object({
  screen: z.string().min(1).describe("Screen or route name, e.g. 'orders' or 'settings/profile'."),
  state: z.string().min(1).describe("State to capture, e.g. 'default', 'empty', 'offline', 'error', 'sheet-open'."),
  viewport: z.string().min(1).describe("Viewport as WxH, e.g. '390x844' or '1280x800'. For the maestro driver, the device form factor."),
  expected: z.string().min(1).describe("What this frame must show for a PASS. For an intentional error/empty/offline state, name the reason text and the recovery affordance."),
});

export const livePassArgsSchema = z.object({
  targets: z.array(livePassTargetSchema).min(1).describe("Every frame the pass must produce. The verdict is derived from this list: a target that produced no frame fails the pass, whether Gemini skipped it with a reason or never reported it at all — a skip explains missing evidence, it does not excuse it."),
  brief: z.string().refine(value => value.trim().length > 0, ERROR_MESSAGES.LIVE_PASS_NO_BRIEF)
    .describe("Narrative context: base URL or app id, the served-branch marker, the seed case, navigation hints, and anything Gemini cannot infer from the targets."),
  workingDirectory: z.string().min(1).describe("Absolute path to the worktree under test. Used as the agy cwd and workspace root; must exist and must not be a filesystem root."),
  artifactDir: z.string().optional().describe("Absolute directory for the captured PNGs and manifest.json. Must be strictly inside workingDirectory. Defaults to <workingDirectory>/.live-pass/<timestamp>."),
  driver: z.enum(['playwright', 'maestro']).describe("Which MCP server Gemini drives: 'playwright' for web, 'maestro' for a booted simulator."),
  model: z.string().default(MODELS.MEDIUM).describe(`${MODEL_CHOICE_DESCRIPTION} Defaults to '${MODELS.MEDIUM}'.`),
  printTimeout: z.string().default(LIVE_PASS.DEFAULT_PRINT_TIMEOUT).describe("agy --print-timeout for the whole walk. A full pass takes minutes."),
  yolo: z.boolean().default(true).describe("Pass --dangerously-skip-permissions so Gemini may drive its MCP servers unattended. Without it agy denies the tool calls and the pass is BLOCKED. Refused when workingDirectory is a filesystem root."),
  publishCommand: z.string().optional().describe("Optional shell command run in code after validation, with {files} replaced by the shell-quoted paths of the frames that validated OK. Its stdout is returned as PR markdown. Never run on a BLOCKED pass."),
  conversationId: z.string().min(1).optional().describe("Resume a previous pass so Gemini can report deltas (resolved / regressions / changes) against what it saw then. The browser or simulator still starts fresh."),
}).superRefine((value, ctx) => {
  const seen = new Set<string>();
  value.targets.forEach((target, index) => {
    const key = targetKey(target);
    if (seen.has(key)) {
      ctx.addIssue({
        code: 'custom',
        message: `duplicate target: ${target.screen} / ${target.state} / ${target.viewport}`,
        path: ['targets', index],
      });
    }
    seen.add(key);
  });
});

export type LivePassTarget = z.infer<typeof livePassTargetSchema>;
export type LivePassArgs = z.infer<typeof livePassArgsSchema>;

// ------------------------------------------------------------ result schema

const frameSchema = z.object({
  file: z.string().describe("Absolute path of the PNG you saved for this frame."),
  screen: z.string().describe("The requested target's screen string, copied exactly."),
  state: z.string().describe("The requested target's state string, copied exactly."),
  expected: z.string().describe("What the brief said this state must show."),
  viewport: z.string().describe("The requested target's viewport string, copied exactly."),
  verdict: z.enum(['PASS', 'FAIL']),
  observed: z.string().describe("What the image actually shows, in your own words, after opening it."),
});

const findingSchema = z.object({
  severity: z.enum(['BLOCKER', 'MAJOR', 'MINOR']),
  screen: z.string(),
  description: z.string(),
  evidence_file: z.string().optional(),
});

const noteSchema = z.object({
  screen: z.string(),
  description: z.string(),
  evidence_file: z.string().optional(),
});

export const livePassResultSchema = z.object({
  verdict: z.enum(['PASS', 'FAIL', 'BLOCKED']),
  summary: z.string(),
  served_branch_check: z.string().describe("How you confirmed the running app is the branch under test, or why you could not."),
  frames: z.array(frameSchema),
  findings: z.array(findingSchema),
  regressions: z.array(findingSchema).describe("Behaviour that worked in the earlier pass of this conversation and is broken now. Empty on a fresh pass."),
  resolved: z.array(noteSchema).describe("Defects reported earlier in this conversation that are now fixed. Never affects the verdict. Empty on a fresh pass."),
  changes: z.array(noteSchema).describe("Neutral differences from the earlier pass that are neither broken nor a fix. Empty on a fresh pass."),
  skipped: z.array(z.object({ target: z.string(), reason: z.string() })),
});

export type LivePassResult = z.infer<typeof livePassResultSchema>;

export const LIVE_PASS_RESULT_JSON_SCHEMA = toAgyJsonSchema(livePassResultSchema);
const LIVE_PASS_RESULT_SCHEMA_TEXT = JSON.stringify(LIVE_PASS_RESULT_JSON_SCHEMA);

// ------------------------------------------------------------------- prompt

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '');
}

function targetKey(target: { screen: string; state: string; viewport: string }): string {
  return [normalize(target.screen), normalize(target.state), normalize(target.viewport)].join('|');
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
}

/**
 * The one filename a target's evidence may use. Derived in code from the whole
 * screen/state/viewport triple so two targets can never share a file — letting
 * Gemini name frames allowed one overwritten screenshot to satisfy several
 * targets at once.
 */
export function frameFileName(target: { screen: string; state: string; viewport: string }): string {
  return `${slugify(target.screen)}-${slugify(target.state)}-${slugify(target.viewport)}.png`;
}

/**
 * One filename per target, keyed by target. Slugifying can map two distinct
 * targets (`a/b` and `a-b`) onto one name, so a collision is suffixed rather
 * than left to collapse two targets into one file.
 */
export function prescribedFrameNames(
  targets: { screen: string; state: string; viewport: string }[]
): Map<string, string> {
  const used = new Set<string>();
  const byTarget = new Map<string, string>();
  for (const target of targets) {
    const base = frameFileName(target);
    let name = base;
    for (let suffix = 2; used.has(name); suffix++) {
      name = base.replace(/\.png$/, `-${suffix}.png`);
    }
    used.add(name);
    byTarget.set(targetKey(target), name);
  }
  return byTarget;
}

function renderTargets(targets: LivePassTarget[], artifactDir: string): string {
  const names = prescribedFrameNames(targets);
  return targets
    .map((target, index) =>
      `${index + 1}. screen: ${target.screen} | state: ${target.state} | viewport: ${target.viewport}\n` +
      `   expected: ${target.expected}\n` +
      `   file: ${path.join(artifactDir, names.get(targetKey(target)) as string)}`)
    .join('\n');
}

const PLAYWRIGHT_PROCEDURE = `Driver: the "${LIVE_PASS.PLAYWRIGHT_MCP_NAME}" MCP server.
For each target, in order:
- browser_navigate to the target's route.
- Wait until the marker named in the brief is present. Never screenshot a page that still shows a spinner or skeleton when a content state was requested.
- browser_resize to the target's viewport.
- browser_take_screenshot with filename set to the exact absolute path printed as "file:" for that target below. Never invent a filename, never reuse another target's file, and never use fullPage.
- For a scrolling screen: browser_resize to (width, 4000), then browser_evaluate this snippet to measure the real content height, then browser_resize to (width, measured) and shoot:
  () => { const skip = (el) => el.closest('[aria-hidden="true"]') || el.closest('[role="tab"]'); let bottom = 0; for (const el of document.querySelectorAll('body *')) { if (skip(el)) continue; const hasText = Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim()); if (!hasText) continue; bottom = Math.max(bottom, el.getBoundingClientRect().bottom + window.scrollY); } return Math.ceil(bottom + 24); }
- Capture centred/terminal states and sheets at 390x844 and again at 320x568 when the targets ask for both.
- browser_snapshot only to locate an element. Never copy a snapshot or accessibility tree into your answer.
- Scroll a virtualized list to its end before asserting that something is absent.`;

const MAESTRO_PROCEDURE = `Driver: the "${LIVE_PASS.MAESTRO_MCP_NAME}" MCP server.
For each target, in order:
- list_devices first and use the returned udid for every later call. Never guess a device.
- run an inline YAML flow to reach the state, then inspect_screen to confirm it settled.
- Never use take_screenshot for evidence: it returns an image inline and saves nothing.
- After each settled state, shell out: xcrun simctl io <udid> screenshot <the exact absolute path printed as "file:" for that target below>. Never invent a filename and never reuse another target's file.
- Only one driver may own a simulator at a time. If the device is busy, record the target as skipped with that reason rather than fighting for it — the pass then FAILS for missing evidence, which is the honest outcome. Never fabricate or reuse a frame.`;

const RESUMED_DELTA_SECTION = `## Delta reporting (this conversation has an earlier pass)
Compare against the frames and findings you reported earlier in this conversation.
- A defect you reported before that is now fixed goes in "resolved".
- Behaviour that worked before and is broken now goes in "regressions".
- A difference that is neither (a moved control, changed copy that reads correctly) goes in "changes".
- A new defect goes in "findings".
Never put an improvement in "findings" or "regressions". The browser or simulator starts fresh: walk every target again, do not answer from memory.`;

export function buildLivePassPrompt(config: {
  brief: string;
  driver: 'playwright' | 'maestro';
  targets: LivePassTarget[];
  workingDirectory: string;
  artifactDir: string;
  resumed: boolean;
}): string {
  const { brief, driver, targets, workingDirectory, artifactDir, resumed } = config;
  const procedure = driver === 'maestro' ? MAESTRO_PROCEDURE : PLAYWRIGHT_PROCEDURE;

  return `# Live UI pass

You are walking a running application, capturing screenshots, looking at them yourself, and reporting what you saw as text. The caller never opens an image, so everything you see in a screenshot must become a sentence in your answer.
Your answer is ONLY the schema JSON. No prose before or after it, no markdown fences, no image data, no base64, no accessibility trees.

## Environment
- Artifact directory (write here, and only here): ${artifactDir}
- Working directory (read-only): ${workingDirectory}
- Never read, list or glob outside those two directories.
- Never edit product code, never create or modify files outside the artifact directory, and never run a git command that changes state (no add, commit, checkout, stash, restore, clean).

## Procedure
${procedure}

## Targets
Capture exactly these, use these exact screen / state / viewport strings in your frames, and save each one to its own "file:" path — copied verbatim into that frame's "file". One file per target: a file that answers two targets is treated as no evidence at all.
${renderTargets(targets, artifactDir)}

## Served-branch check first
Before any capture, confirm the running app is the build under test using the marker in the brief. If you cannot confirm it, stop, set verdict BLOCKED, and explain in served_branch_check. Never report on an app you cannot identify.

## Evidence discipline
- Open every PNG you saved and describe it in "observed". "observed" is what the image shows, not what you expected it to show.
- Judge each frame against the state the brief requested for it, using that target's "expected" as the checklist:
  - Where a content state was requested, a spinner, blank page, skeleton, error, or the wrong screen is a FAIL.
  - Where the brief intentionally exercises an error, empty, offline, permission-denied or other terminal state, the frame PASSES when it shows that state with everything "expected" names (for instance the reason text and the recovery affordance, when "expected" names them) and FAILS when any of that is missing. An intentional state that renders as "expected" describes it is never a finding by itself.
  - Something "expected" does not ask for is at most a MINOR finding. It never makes the frame FAIL.
- Report position separately from presence: "the control exists but sits below the fold" is not "the control is missing".
- If a target is unreachable, delete any stale PNG already sitting at that frame's filename, add the target to "skipped" with the reason, and do not invent a frame for it.
- If you cannot open a PNG you saved, say so in "observed" and mark that frame FAIL.

## Manifest
Write ${artifactDir}/${LIVE_PASS.MANIFEST_FILE} containing {"run_started": <ISO timestamp>, "driver": "${driver}", "frames": [...], "skipped": [...]} mirroring your answer.

## Verdict rules
- PASS only when every requested target was captured and each frame matches the state the brief requested.
- FAIL when any frame is FAIL, any finding is BLOCKER or MAJOR, or anything regressed.
- BLOCKED when the environment stopped you: the app is not the branch under test, the driver would not start, or a tool call was denied.
${resumed ? `\n${RESUMED_DELTA_SECTION}\n` : '\nThis is a fresh pass: return empty arrays for "resolved", "regressions" and "changes".\n'}
## Brief
${brief}`;
}

// --------------------------------------------------------------- validation

export type FrameStatus = 'OK' | 'MISSING' | 'EMPTY' | 'STALE' | 'OUTSIDE' | 'DUPLICATE';

export interface FrameCheck {
  file: string;
  screen: string;
  state: string;
  status: FrameStatus;
  /** The file exists but is not the filename prescribed for this target. Reported, never fatal. */
  misnamed: boolean;
}

export interface FramesValidation {
  checks: FrameCheck[];
  okFiles: string[];
  problems: string[];
  /** Reported alongside the problems but never affects the verdict. */
  notes: string[];
  unreportedCaptures: string[];
}

/**
 * Realpath'd like the artifact dir, so a frame reported through a symlinked
 * spelling of the same directory is not mistaken for an escape.
 */
function frameAbsolutePath(file: string, artifactDir: string): string {
  return realpathOfExistingPrefix(path.isAbsolute(file) ? file : path.resolve(artifactDir, file));
}

function checkFrameFile(absFile: string, artifactDir: string, runStartMs: number): FrameStatus {
  if (!isWithin(artifactDir, absFile)) return 'OUTSIDE';
  try {
    const stat = fs.statSync(absFile);
    if (!stat.isFile()) return 'MISSING';
    if (stat.size === 0) return 'EMPTY';
    if (stat.mtimeMs < runStartMs - LIVE_PASS.FRESHNESS_TOLERANCE_MS) return 'STALE';
    return 'OK';
  } catch {
    return 'MISSING';
  }
}

function readManifestProblems(artifactDir: string, frameCount: number, runStartMs: number): string[] {
  const manifestPath = path.join(artifactDir, LIVE_PASS.MANIFEST_FILE);
  let raw: string;
  let writtenMs: number;
  try {
    raw = fs.readFileSync(manifestPath, 'utf-8');
    writtenMs = fs.statSync(manifestPath).mtimeMs;
  } catch {
    return [`${LIVE_PASS.MANIFEST_FILE} was not written`];
  }

  // A reused artifact directory can still hold an earlier run's manifest, which
  // would pass a shape-and-count check while describing frames nobody captured.
  if (writtenMs < runStartMs - LIVE_PASS.FRESHNESS_TOLERANCE_MS) {
    return [`${LIVE_PASS.MANIFEST_FILE} predates this run: it is left over from an earlier pass`];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [`${LIVE_PASS.MANIFEST_FILE} is not valid JSON`];
  }
  const manifestFrames = (parsed as { frames?: unknown })?.frames;
  if (!Array.isArray(manifestFrames)) {
    return [`${LIVE_PASS.MANIFEST_FILE} has no frames array`];
  }
  if (manifestFrames.length !== frameCount) {
    return [`${LIVE_PASS.MANIFEST_FILE} lists ${manifestFrames.length} frames but the answer reports ${frameCount}`];
  }
  return [];
}

function listCaptures(artifactDir: string): string[] {
  try {
    return fs.readdirSync(artifactDir)
      .filter(name => /\.(png|jpe?g)$/i.test(name))
      .map(name => path.join(artifactDir, name));
  } catch {
    return [];
  }
}

/** Check every reported frame against the disk. Never throws. */
export function validateFrames(
  result: LivePassResult,
  artifactDir: string,
  runStartMs: number,
  targets: LivePassTarget[] = []
): FramesValidation {
  const prescribed = prescribedFrameNames(targets);
  const claimedBy = new Set<string>();
  const notes: string[] = [];

  const checks: FrameCheck[] = result.frames.map(frame => {
    const absFile = frameAbsolutePath(frame.file, artifactDir);
    const expectedName = prescribed.get(targetKey(frame));
    // A second frame pointing at the same file is one screenshot answering two
    // targets — no evidence for either, however good the picture is.
    const status: FrameStatus = claimedBy.has(absFile)
      ? 'DUPLICATE'
      : checkFrameFile(absFile, artifactDir, runStartMs);
    claimedBy.add(absFile);

    const misnamed = Boolean(expectedName) && path.basename(absFile) !== expectedName;
    if (misnamed) {
      notes.push(`MISNAMED: ${absFile} (${frame.screen} / ${frame.state}) — expected ${expectedName}`);
    }

    return { file: absFile, screen: frame.screen, state: frame.state, status, misnamed };
  });

  const problems = [
    ...checks.filter(check => check.status !== 'OK').map(check => check.status === 'DUPLICATE'
      ? `DUPLICATE: reused evidence file ${check.file} (${check.screen} / ${check.state})`
      : `${check.status}: ${check.file} (${check.screen} / ${check.state})`),
    ...readManifestProblems(artifactDir, result.frames.length, runStartMs),
  ];

  return {
    checks,
    okFiles: checks.filter(check => check.status === 'OK').map(check => check.file),
    problems,
    notes,
    unreportedCaptures: listCaptures(artifactDir).filter(file => !claimedBy.has(file)),
  };
}

export interface CoverageReport {
  uncovered: LivePassTarget[];
  skipped: { target: LivePassTarget; reason: string }[];
  extraFrames: string[];
}

/** Match each requested target to a reported frame, case- and whitespace-insensitively. */
export function checkCoverage(targets: LivePassTarget[], result: LivePassResult): CoverageReport {
  const frameKeys = new Map<string, string>();
  for (const frame of result.frames) {
    frameKeys.set(targetKey(frame), frame.file);
  }

  const uncovered: LivePassTarget[] = [];
  const skipped: { target: LivePassTarget; reason: string }[] = [];
  const matchedKeys = new Set<string>();

  for (const target of targets) {
    const key = targetKey(target);
    if (frameKeys.has(key)) {
      matchedKeys.add(key);
      continue;
    }
    const skip = result.skipped.find(entry => {
      const haystack = normalize(entry.target);
      return haystack.includes(normalize(target.screen)) && haystack.includes(normalize(target.state));
    });
    if (skip) {
      skipped.push({ target, reason: skip.reason });
    } else {
      uncovered.push(target);
    }
  }

  const extraFrames = result.frames
    .filter(frame => !matchedKeys.has(targetKey(frame)))
    .map(frame => frame.file);

  return { uncovered, skipped, extraFrames };
}

export interface VerdictDecision {
  verdict: 'PASS' | 'FAIL' | 'BLOCKED';
  reported: string;
  reasons: string[];
}

/** Gemini's own verdict is advisory; this is the one the caller acts on. */
export function deriveVerdict(input: {
  result: LivePassResult;
  validation: FramesValidation;
  coverage: CoverageReport;
  deniedActions: string;
}): VerdictDecision {
  const { result, validation, coverage, deniedActions } = input;
  const reasons: string[] = [];

  if (deniedActions) reasons.push(`agy denied required actions: ${deniedActions}`);
  if (result.verdict === 'BLOCKED') reasons.push('Gemini reported BLOCKED');
  if (reasons.length > 0) return { verdict: 'BLOCKED', reported: result.verdict, reasons };

  for (const frame of result.frames.filter(frame => frame.verdict === 'FAIL')) {
    reasons.push(`frame FAIL: ${frame.screen} / ${frame.state}`);
  }
  reasons.push(...validation.problems);
  for (const target of coverage.uncovered) {
    reasons.push(`uncovered target: ${target.screen} / ${target.state} / ${target.viewport}`);
  }
  for (const entry of coverage.skipped) {
    reasons.push(`skipped target: ${entry.target.screen} / ${entry.target.state} (${entry.reason})`);
  }
  for (const regression of result.regressions) {
    reasons.push(`regression: ${regression.screen} — ${regression.description}`);
  }
  for (const finding of result.findings.filter(f => f.severity === 'BLOCKER' || f.severity === 'MAJOR')) {
    reasons.push(`${finding.severity} finding: ${finding.screen} — ${finding.description}`);
  }

  return {
    verdict: reasons.length > 0 ? 'FAIL' : 'PASS',
    reported: result.verdict,
    reasons,
  };
}

// --------------------------------------------------------------- publishing

export interface PublishResult {
  ran: boolean;
  command?: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  skippedReason?: string;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export async function runPublishCommand(
  command: string | undefined,
  okFiles: string[],
  cwd: string
): Promise<PublishResult> {
  if (!command?.trim()) {
    return { ran: false, stdout: '', stderr: '', exitCode: null };
  }
  if (okFiles.length === 0) {
    return { ran: false, stdout: '', stderr: '', exitCode: null, skippedReason: 'no frames validated OK' };
  }

  const resolved = command.split(FILES_PLACEHOLDER).join(okFiles.map(shellQuote).join(' '));
  try {
    const running = execFileAsync('/bin/sh', ['-c', resolved], {
      cwd,
      maxBuffer: PUBLISH_MAX_BUFFER,
      timeout: PUBLISH_TIMEOUT_MS,
    });
    // Close stdin so a command that reads it (an upload prompting for input)
    // fails fast instead of hanging the MCP call after a finished pass.
    running.child.stdin?.end();
    const { stdout, stderr } = await running;
    return { ran: true, command: resolved, stdout: stdout.trim(), stderr: stderr.trim(), exitCode: 0 };
  } catch (error) {
    const failure = error as { code?: unknown; stdout?: string; stderr?: string; message?: string };
    return {
      ran: true,
      command: resolved,
      stdout: (failure.stdout ?? '').trim(),
      stderr: (failure.stderr ?? failure.message ?? '').trim(),
      exitCode: typeof failure.code === 'number' ? failure.code : null,
    };
  }
}

// ------------------------------------------------------------------ report

export function formatLivePassReport(input: {
  envelope: AgyJsonEnvelope;
  result: LivePassResult;
  decision: VerdictDecision;
  validation: FramesValidation;
  coverage: CoverageReport;
  driver: string;
  model: string;
  artifactDir: string;
  deniedActions: string;
  workingTree: WorkingTreeDiff;
  publish: PublishResult;
}): string {
  const { envelope, result, decision, validation, coverage, driver, model, artifactDir } = input;
  const statusById = new Map(validation.checks.map(check => [check.file, check.status]));

  const headline = decision.verdict === decision.reported
    ? `# Live pass: ${decision.verdict}`
    : `# Live pass: ${decision.verdict} (Gemini reported ${decision.reported})`;

  const parts: string[] = [];
  if (envelope.conversation_id) parts.push(formatConversationLine(envelope.conversation_id));
  parts.push(headline);
  parts.push(`driver: ${driver} · model: ${model} · artifacts: ${artifactDir}`);
  parts.push(formatAgyUsageLine(envelope));
  parts.push(section('Why', bulletList(decision.reasons)));
  parts.push(section('Served-branch check', result.served_branch_check || '- not reported'));
  parts.push(section('Summary', result.summary || '- not reported'));

  parts.push(section('Frames', bulletList(result.frames.map(frame => {
    const abs = frameAbsolutePath(frame.file, artifactDir);
    return `${frame.verdict} [${statusById.get(abs) ?? 'UNKNOWN'}] ${frame.screen} / ${frame.state} / ${frame.viewport}\n` +
      `  file: ${abs}\n  expected: ${frame.expected}\n  observed: ${frame.observed}`;
  }))));

  const renderFindings = (items: LivePassResult['findings']) => bulletList(items.map(item =>
    `${item.severity} ${item.screen}: ${item.description}${item.evidence_file ? ` (${item.evidence_file})` : ''}`));
  const renderNotes = (items: LivePassResult['resolved']) => bulletList(items.map(item =>
    `${item.screen}: ${item.description}${item.evidence_file ? ` (${item.evidence_file})` : ''}`));

  parts.push(section('Findings', renderFindings(result.findings)));
  parts.push(section('Regressions', renderFindings(result.regressions)));
  parts.push(section('Resolved', renderNotes(result.resolved)));
  parts.push(section('Changes', renderNotes(result.changes)));
  parts.push(section('Skipped', bulletList([
    ...result.skipped.map(entry => `${entry.target}: ${entry.reason}`),
    ...coverage.uncovered.map(target => `${target.screen} / ${target.state} / ${target.viewport}: no frame and no skip reason`),
  ])));

  const validationLines = [...validation.problems, ...validation.notes];
  if (validation.unreportedCaptures.length > 0) {
    validationLines.push(`captures not reported as frames: ${validation.unreportedCaptures.join(', ')}`);
  }
  if (coverage.extraFrames.length > 0) {
    validationLines.push(`frames matching no requested target: ${coverage.extraFrames.join(', ')}`);
  }
  parts.push(section('Validation', bulletList(validationLines)));

  if (input.deniedActions) {
    parts.push(section('Denied actions', `- ${input.deniedActions}`));
  }

  const workingTreeSection = formatWorkingTreeSection(input.workingTree);
  if (workingTreeSection) parts.push(workingTreeSection);

  const { publish } = input;
  if (publish.ran) {
    parts.push(section('PR markdown', publish.exitCode === 0
      ? publish.stdout || '- publish command produced no output'
      : `- publish command exited ${publish.exitCode ?? 'unknown'}\n- ${publish.stderr || 'no stderr'}`));
  } else if (publish.skippedReason) {
    parts.push(section('PR markdown', `- publish command not run: ${publish.skippedReason}`));
  }

  return parts.join('\n\n');
}

// ------------------------------------------------------------------ execute

function resolveArtifactDir(workingDirectory: string, requested?: string): string {
  // The default candidate goes through the same resolve-and-contain check as an
  // explicit one: a `.live-pass` symlink pointing outside the worktree would
  // otherwise let the default escape the boundary the tool advertises.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const candidate = requested ?? path.join(workingDirectory, LIVE_PASS.DEFAULT_ARTIFACT_SEGMENT, stamp);

  const resolved = realpathOfExistingPrefix(candidate);
  const strictlyInside = path.isAbsolute(candidate) &&
    isWithin(workingDirectory, resolved) &&
    resolved !== workingDirectory;
  if (!strictlyInside) {
    throw new Error(`${ERROR_MESSAGES.LIVE_PASS_ARTIFACT_DIR}. Received '${candidate}'.`);
  }
  return resolved;
}

export const livePassTool: UnifiedTool = {
  name: "live-pass",
  description: "Delegate a live UI pass to Gemini: it drives its own Playwright or Maestro MCP server, captures screenshots into a worktree-local artifact directory, looks at them itself, and returns a text verdict with per-frame observations. No image ever reaches the caller's context.",
  zodSchema: livePassArgsSchema,
  prompt: {
    description: "Walk a running app with Gemini driving Playwright or Maestro, capture the requested screen/state/viewport frames, and return a PASS/FAIL/BLOCKED verdict with per-frame observations, findings, and optional PR markdown.",
  },
  category: 'gemini',
  annotations: {
    title: "Live UI Pass",
    readOnlyHint: false,
    openWorldHint: true,
  },
  execute: async (args, onProgress) => {
    const input = livePassArgsSchema.parse(args);
    const workingDirectory = resolveWorkingDirectory(input.workingDirectory);
    const artifactDir = resolveArtifactDir(workingDirectory, input.artifactDir);
    fs.mkdirSync(artifactDir, { recursive: true });

    const runStartMs = Date.now();
    const before = await snapshotWorkingTree(workingDirectory);

    const afterWorkingTree = async () => diffWorkingTree(
      before,
      await snapshotWorkingTree(workingDirectory),
      { ignoreDirectory: artifactDir }
    );

    let envelope: AgyJsonEnvelope;
    try {
      envelope = await executeAgyJson(
        buildLivePassPrompt({
          brief: input.brief,
          driver: input.driver,
          targets: input.targets,
          workingDirectory,
          artifactDir,
          resumed: Boolean(input.conversationId),
        }),
        {
          model: input.model,
          yolo: input.yolo,
          printTimeout: input.printTimeout,
          conversationId: input.conversationId,
          includeDirectories: [workingDirectory, artifactDir],
          cwd: workingDirectory,
          jsonSchema: LIVE_PASS_RESULT_SCHEMA_TEXT,
          noCache: true,
        },
        onProgress
      );
    } catch (error) {
      // A timeout, a non-zero exit or an ERROR envelope can all land after
      // Gemini has already used its shell: the warning must survive the failure.
      failWithWorkingTree(error, await afterWorkingTree());
    }

    // Snapshot before branching: an off-schema answer must still report edits
    // Gemini made with the shell this pass handed it.
    const workingTree = await afterWorkingTree();

    const parsed = livePassResultSchema.safeParse(envelope.structured_output);
    if (!parsed.success) {
      return [
        renderUnparsableEnvelope(
          envelope,
          '# Live pass: BLOCKED',
          formatZodIssues(parsed.error),
          `artifacts: ${artifactDir}`
        ),
        formatWorkingTreeSection(workingTree),
      ].filter(Boolean).join('\n\n');
    }

    const result = parsed.data;
    const validation = validateFrames(result, artifactDir, runStartMs, input.targets);
    const coverage = checkCoverage(input.targets, result);
    const deniedActions = deniedActionsSummary(envelope);
    const decision = deriveVerdict({ result, validation, coverage, deniedActions });

    // A BLOCKED pass proves nothing, so its frames are never published.
    const publish = decision.verdict === 'BLOCKED'
      ? { ran: false, stdout: '', stderr: '', exitCode: null, skippedReason: 'pass was BLOCKED' }
      : await runPublishCommand(input.publishCommand, validation.okFiles, workingDirectory);

    return formatLivePassReport({
      envelope,
      result,
      decision,
      validation,
      coverage,
      driver: input.driver,
      model: input.model,
      artifactDir,
      deniedActions,
      workingTree,
      publish,
    });
  },
};
