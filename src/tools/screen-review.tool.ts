import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
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

const IMAGE_EXTENSIONS = /\.(png|jpe?g)$/i;
const WHITESPACE = /\s/;

// ---------------------------------------------------------------- arguments

function fileExists(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

export const screenReviewArgsSchema = z.object({
  mode: z.enum(['review', 'plan']).describe("'review' judges screenshots after a live pass. 'plan' inventories a route file before any screenshot exists and returns no verdict."),
  instructions: z.string().min(1).describe("The caller's reviewer prompt, verbatim. Passed through unchanged so rule citations stay exact."),
  context: z.string().optional().describe("Optional extra context: composition contract, changed-file list, issue text."),
  workingDirectory: z.string().min(1).describe("Absolute path to the checkout the instructions cite. Used as the agy cwd and workspace root, so repository-relative rule paths resolve."),
  images: z.array(z.string()).optional().describe("review mode only: absolute paths to the PNG/JPEG frames to judge. Each must exist."),
  changedRoutes: z.array(z.string()).optional().describe("review mode: repo-relative route/component files the diff touched (from `git diff --name-only`). Every changed screen file (under an `app/` directory) that no image shows makes the review REQUEST_CHANGES; a changed file under `components/` only warns."),
  routeFile: z.string().optional().describe("plan mode only: absolute path to the route/screen source file to inventory. Must exist inside workingDirectory."),
  model: z.string().default(MODELS.MEDIUM).describe(`${MODEL_CHOICE_DESCRIPTION} Defaults to '${MODELS.MEDIUM}'.`),
  printTimeout: z.string().default(LIVE_PASS.SCREEN_REVIEW_PRINT_TIMEOUT).describe("agy --print-timeout for the review."),
  yolo: z.boolean().default(false).describe("Pass --dangerously-skip-permissions. Defaults to false because a review only reads. Set it to true when the instructions ask Gemini to read repository files that are not passed as images: it reaches for a shell to do that, headless agy denies the shell, and the call then fails naming the denied action."),
  conversationId: z.string().min(1).optional().describe("Resume a previous review so round 2 keeps round 1's visual analysis."),
}).superRefine((value, ctx) => {
  if (value.mode === 'review') {
    if (value.routeFile) {
      ctx.addIssue({ code: 'custom', message: 'routeFile is plan mode only', path: ['routeFile'] });
    }
    if (!value.images || value.images.length === 0) {
      ctx.addIssue({ code: 'custom', message: ERROR_MESSAGES.SCREEN_REVIEW_NO_IMAGES, path: ['images'] });
      return;
    }
    value.images.forEach((image, index) => {
      if (!path.isAbsolute(image)) {
        ctx.addIssue({ code: 'custom', message: `image path must be absolute: ${image}`, path: ['images', index] });
      } else if (WHITESPACE.test(image)) {
        ctx.addIssue({ code: 'custom', message: `${ERROR_MESSAGES.UNREFERENCEABLE_PATH}: ${image}`, path: ['images', index] });
      } else if (!fileExists(image)) {
        ctx.addIssue({ code: 'custom', message: `${ERROR_MESSAGES.SCREEN_REVIEW_IMAGE_MISSING}: ${image}`, path: ['images', index] });
      } else if (!IMAGE_EXTENSIONS.test(image)) {
        ctx.addIssue({ code: 'custom', message: `image must be a PNG or JPEG: ${image}`, path: ['images', index] });
      }
    });
    return;
  }

  if (value.images) {
    ctx.addIssue({ code: 'custom', message: 'images is review mode only', path: ['images'] });
  }
  const routeFile = value.routeFile;
  if (!routeFile || !path.isAbsolute(routeFile) || !fileExists(routeFile)) {
    ctx.addIssue({ code: 'custom', message: ERROR_MESSAGES.SCREEN_REVIEW_ROUTE_FILE, path: ['routeFile'] });
    return;
  }
  if (WHITESPACE.test(routeFile)) {
    ctx.addIssue({ code: 'custom', message: `${ERROR_MESSAGES.UNREFERENCEABLE_PATH}: ${routeFile}`, path: ['routeFile'] });
    return;
  }
  // Realpath'd on both sides: execute resolves workingDirectory the same way,
  // so a symlinked spelling must not reject a route file that is really inside.
  if (!isWithin(realpathOfExistingPrefix(value.workingDirectory), realpathOfExistingPrefix(routeFile))) {
    ctx.addIssue({
      code: 'custom',
      message: `${ERROR_MESSAGES.SCREEN_REVIEW_ROUTE_FILE}. '${routeFile}' is outside the working directory.`,
      path: ['routeFile'],
    });
  }
});

export type ScreenReviewArgs = z.infer<typeof screenReviewArgsSchema>;

// ----------------------------------------------------------- result schemas

const reviewFindingSchema = z.object({
  severity: z.enum(['BLOCKER', 'MAJOR', 'MINOR']),
  confirmed: z.boolean().describe("True only when you read the line or pixel yourself and it is really there. When unsure, file it MINOR instead of guessing."),
  location: z.string().describe("Where it is: the region of the screen, and the file:line when you verified one."),
  observed: z.string().describe("What the image shows. This is the first thing the reader sees, so describe the image, not the rule."),
  rule: z.string().describe("The rule or contract this violates, cited as the instructions cite it."),
  fix: z.string(),
});

export const screenReviewResultSchema = z.object({
  verdict: z.enum(['APPROVE', 'REQUEST_CHANGES']),
  screens: z.array(z.object({
    file: z.string().describe("The image path you were given, copied exactly."),
    subject: z.string().describe("Which screen and state this image shows."),
    route_file: z.string().describe("Repo-relative path of the route or screen source file this image shows, chosen from the changed files when one fits. Empty string when you genuinely cannot tell."),
    inventory: z.array(z.string()).describe("Every control, label and region visible in this image. Enumerate before judging."),
    findings: z.array(reviewFindingSchema),
  })),
  cross_screen_findings: z.array(reviewFindingSchema),
  summary: z.string(),
});

export const screenPlanResultSchema = z.object({
  route_file: z.string(),
  controls: z.array(z.object({
    control: z.string(),
    primitive: z.string(),
    placement: z.string(),
    promoted: z.boolean(),
    verb_today: z.string(),
    verb_per_rule: z.string(),
    operation: z.string(),
    capability: z.string(),
    scope: z.string(),
  })),
  top_slot_priority: z.array(z.string()),
  hand_rolls_to_delete: z.array(z.object({ line: z.string(), primitive: z.string() })),
  notes: z.string(),
});

export type ScreenReviewResult = z.infer<typeof screenReviewResultSchema>;
export type ScreenPlanResult = z.infer<typeof screenPlanResultSchema>;

export const SCREEN_REVIEW_RESULT_JSON_SCHEMA = toAgyJsonSchema(screenReviewResultSchema);
export const SCREEN_PLAN_RESULT_JSON_SCHEMA = toAgyJsonSchema(screenPlanResultSchema);
const SCHEMA_TEXT = {
  review: JSON.stringify(SCREEN_REVIEW_RESULT_JSON_SCHEMA),
  plan: JSON.stringify(SCREEN_PLAN_RESULT_JSON_SCHEMA),
};

// ------------------------------------------------------------------- prompt

export function buildScreenReviewPrompt(config: {
  mode: 'review' | 'plan';
  instructions: string;
  context?: string;
  images?: string[];
  routeFile?: string;
  changedRoutes?: string[];
}): string {
  // The heading is explicit and always present: a reviewer checklist that files
  // "no composition contract" as a finding must be able to see that one WAS
  // supplied (or that none was) rather than infer it from silence.
  const contextSection = `\n## Context supplied by the caller (composition contract, changed files)\n` +
    `${config.context?.trim() || 'No context supplied.'}\n`;

  if (config.mode === 'plan') {
    return `# Screen plan

Read this route file and inventory the actions it exposes. There is no screenshot and no verdict: this runs before anything is built.

@${config.routeFile}

## Instructions
${config.instructions}
${contextSection}## Contract
- Cover this route only. Do not wander into other routes or shared components except to name the primitive a control should use.
- Every control that is visible or reachable on this route gets a row, including ones hidden behind a menu.
- Your answer is ONLY the schema JSON. No prose before or after it, no markdown fences.`;
  }

  const changed = config.changedRoutes ?? [];
  const changedSection = changed.length > 0
    ? `\n## Changed files in this diff\n${changed.map(route => `- ${route}`).join('\n')}\n`
    : '\n';

  const imageRefs = (config.images ?? []).map(image => `@${image}`).join('\n');
  return `# Screen review

Open every image below before reading any code. You are the second pair of eyes on frames someone else captured; the caller never opens them, so every judgement must be grounded in a sentence about what an image shows.

${imageRefs}

## Instructions
${config.instructions}
${contextSection}${changedSection}## Contract
- Enumerate what is in each image (every control, label and region) BEFORE judging it. Fill "inventory" first.
- Set each screen's "route_file" to the repo-relative path of the route or screen source file that image shows, choosing from the changed files above when one of them fits. Use "" only when you genuinely cannot tell — the caller uses this to check that every changed screen has a screenshot.
- Each finding's "observed" clause describes what the image shows; "rule" cites the rule it breaks.
- Set "confirmed": true only when you read the line or pixel yourself and it is really there. When unsure, file it MINOR.
- One "screens" entry per image above, and set its "file" to that image's absolute path copied verbatim from the @ line — character for character, no renaming, no relative path, no basename. The caller matches your entries back to the paths it gave you.
- If you could not open an image, say so in "summary" and leave it out of "screens".
- Your answer is ONLY the schema JSON. No prose before or after it, no markdown fences, no image data, no base64.`;
}

// ----------------------------------------------------------------- verdicts

export interface ReviewDecision {
  verdict: 'APPROVE' | 'REQUEST_CHANGES';
  reported: string;
  reasons: string[];
  unreviewed: string[];
  unknownFiles: string[];
  downgraded: number;
  coverage: { route: string; image: string | null }[];
  warnings: string[];
}

function normalizeRoute(route: string): string {
  return route.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

/**
 * A reported route_file claims a changed file when it names that exact path, or
 * is an absolute/longer spelling of it. A TRUNCATED report is never accepted:
 * `app/orders.tsx` would otherwise claim both `apps/admin/app/orders.tsx` and
 * `apps/customer/app/orders.tsx`, letting one image cover two changed screens.
 */
function claimsRoute(routeFile: string, changedRoute: string): boolean {
  const reported = normalizeRoute(routeFile);
  const changed = normalizeRoute(changedRoute);
  if (!reported || !changed) return false;
  return reported === changed || reported.endsWith(`/${changed}`);
}

// git paths are repo-relative, so `app/orders.tsx` has no leading slash to match on.
function isUnderDirectory(route: string, directory: string): boolean {
  return `/${normalizeRoute(route)}`.includes(`/${directory}/`);
}

/** Gemini's verdict is advisory; unconfirmed MAJORs are downgraded, unreviewed images always block. */
export function deriveReviewVerdict(
  result: ScreenReviewResult,
  images: string[],
  changedRoutes: string[] = []
): ReviewDecision {
  const reasons: string[] = [];
  const warnings: string[] = [];
  let downgraded = 0;

  const allFindings = [
    ...result.screens.flatMap(screen => screen.findings.map(finding => ({ ...finding, where: screen.file }))),
    ...result.cross_screen_findings.map(finding => ({ ...finding, where: 'cross-screen' })),
  ];

  for (const finding of allFindings) {
    if (finding.severity === 'BLOCKER') {
      reasons.push(`BLOCKER (${finding.where}): ${finding.observed}`);
    } else if (finding.severity === 'MAJOR' && finding.confirmed) {
      reasons.push(`MAJOR confirmed (${finding.where}): ${finding.observed}`);
    } else if (finding.severity === 'MAJOR') {
      downgraded += 1;
    }
  }

  // Compare resolved paths: Gemini may echo a realpath'd or ./-stripped
  // spelling of the same image, and treating that as "not reviewed" would fail
  // a review that actually happened.
  const reviewedFiles = new Map(result.screens.map(screen => [realpathOfExistingPrefix(screen.file), screen.file]));
  const unreviewed = images.filter(image => !reviewedFiles.has(realpathOfExistingPrefix(image)));
  for (const image of unreviewed) {
    reasons.push(`not reviewed: ${image}`);
  }

  const imageKeys = new Set(images.map(realpathOfExistingPrefix));
  const unknownFiles = [...reviewedFiles]
    .filter(([key]) => !imageKeys.has(key))
    .map(([, reported]) => reported);

  // Partial screenshot coverage is as unreviewed as no screenshot at all.
  const coverage = changedRoutes.map(route => ({
    route,
    image: result.screens.find(screen => claimsRoute(screen.route_file, route))?.file ?? null,
  }));
  for (const entry of coverage.filter(entry => !entry.image)) {
    if (isUnderDirectory(entry.route, 'app')) {
      reasons.push(`no evidence for changed screen ${entry.route}`);
    } else if (isUnderDirectory(entry.route, 'components')) {
      warnings.push(`changed component with no frame showing it: ${entry.route}`);
    }
  }

  return {
    verdict: reasons.length > 0 ? 'REQUEST_CHANGES' : 'APPROVE',
    reported: result.verdict,
    reasons,
    unreviewed,
    unknownFiles,
    downgraded,
    coverage,
    warnings,
  };
}

// ------------------------------------------------------------------ reports

function renderFinding(finding: z.infer<typeof reviewFindingSchema>): string {
  const severity = finding.severity === 'MAJOR' && !finding.confirmed
    ? 'MINOR (unconfirmed, downgraded)'
    : finding.severity;
  return `${severity} — ${finding.observed}\n  location: ${finding.location}\n  rule: ${finding.rule}\n  fix: ${finding.fix}`;
}

export function formatScreenReviewReport(input: {
  envelope: AgyJsonEnvelope;
  result: ScreenReviewResult;
  decision: ReviewDecision;
  deniedActions: string;
  workingTree: WorkingTreeDiff;
}): string {
  const { envelope, result, decision } = input;
  const headline = decision.verdict === decision.reported
    ? `# Screen review: ${decision.verdict}`
    : `# Screen review: ${decision.verdict} (Gemini reported ${decision.reported})`;

  const parts: string[] = [];
  if (envelope.conversation_id) parts.push(formatConversationLine(envelope.conversation_id));
  parts.push(headline);
  parts.push(formatAgyUsageLine(envelope));
  parts.push(section('Why', bulletList(decision.reasons)));

  if (decision.coverage.length > 0) {
    parts.push(section('Screenshot coverage', decision.coverage
      .map(entry => `- ${entry.route} → ${entry.image ?? 'MISSING'}`)
      .join('\n')));
  }

  for (const screen of result.screens) {
    parts.push(section(`${screen.subject}`, [
      `file: ${screen.file}`,
      screen.route_file ? `route: ${screen.route_file}` : 'route: not identified',
      `inventory: ${screen.inventory.join(', ') || 'none reported'}`,
      `findings:`,
      bulletList(screen.findings.map(renderFinding)),
    ].join('\n')));
  }

  parts.push(section('Cross-screen findings', bulletList(result.cross_screen_findings.map(renderFinding))));
  parts.push(section('Summary', result.summary || '- not reported'));

  const notes: string[] = [...decision.warnings];
  if (decision.downgraded > 0) {
    notes.push(`${decision.downgraded} unconfirmed MAJOR finding(s) shown as MINOR`);
  }
  if (decision.unknownFiles.length > 0) {
    notes.push(`answer named images that were not supplied: ${decision.unknownFiles.join(', ')}`);
  }
  if (input.deniedActions) {
    notes.push(`agy denied actions: ${input.deniedActions}`);
  }
  if (notes.length > 0) parts.push(section('Notes', bulletList(notes)));

  const workingTreeSection = formatWorkingTreeSection(input.workingTree);
  if (workingTreeSection) parts.push(workingTreeSection);

  return parts.join('\n\n');
}

const PLAN_COLUMNS = [
  'control', 'primitive', 'placement', 'promoted', 'verb today', 'verb per rule',
  'operation', 'capability', 'scope',
] as const;

export function formatScreenPlanReport(input: {
  envelope: AgyJsonEnvelope;
  result: ScreenPlanResult;
  routeFile: string;
  deniedActions: string;
  workingTree: WorkingTreeDiff;
}): string {
  const { envelope, result, routeFile } = input;
  const rows = result.controls.map(control => `| ${[
    control.control, control.primitive, control.placement, String(control.promoted),
    control.verb_today, control.verb_per_rule, control.operation, control.capability, control.scope,
  ].join(' | ')} |`);

  const table = [
    `| ${PLAN_COLUMNS.join(' | ')} |`,
    `|${PLAN_COLUMNS.map(() => '---').join('|')}|`,
    ...rows,
  ].join('\n');

  const parts: string[] = [];
  if (envelope.conversation_id) parts.push(formatConversationLine(envelope.conversation_id));
  parts.push(`# Screen plan: ${routeFile}`);
  parts.push(formatAgyUsageLine(envelope));
  parts.push(section('Controls', result.controls.length > 0 ? table : '- none reported'));
  parts.push(section('Top slot priority', bulletList(result.top_slot_priority)));
  parts.push(section('Hand-rolls to delete', bulletList(
    result.hand_rolls_to_delete.map(item => `${item.line} → ${item.primitive}`)
  )));
  parts.push(section('Notes', result.notes || '- none'));

  const warnings: string[] = [];
  if (result.route_file && path.resolve(result.route_file) !== path.resolve(routeFile)) {
    warnings.push(`answer named route_file '${result.route_file}' but the request was '${routeFile}'`);
  }
  if (input.deniedActions) {
    warnings.push(`agy denied actions: ${input.deniedActions}`);
  }
  if (warnings.length > 0) parts.push(section('Warnings', bulletList(warnings)));

  const workingTreeSection = formatWorkingTreeSection(input.workingTree);
  if (workingTreeSection) parts.push(workingTreeSection);

  return parts.join('\n\n');
}

// ------------------------------------------------------------------ execute

export const screenReviewTool: UnifiedTool = {
  name: "screen-review",
  description: "Delegate screen review to Gemini: in 'review' mode it opens the given PNGs, inventories what each shows, and returns findings with an APPROVE / REQUEST_CHANGES verdict; in 'plan' mode it inventories the controls of a route file before anything is built. Text only — no image reaches the caller's context.",
  zodSchema: screenReviewArgsSchema,
  prompt: {
    description: "Have Gemini judge captured screens against a reviewer prompt (review mode), or inventory a route file's controls before implementation (plan mode).",
  },
  category: 'gemini',
  annotations: {
    title: "Screen Review",
    readOnlyHint: true,
    openWorldHint: true,
  },
  execute: async (args, onProgress) => {
    const input = screenReviewArgsSchema.parse(args);
    const workingDirectory = resolveWorkingDirectory(input.workingDirectory);
    const isPlan = input.mode === 'plan';

    // agy resolves an @reference only under a workspace directory, so every
    // image's parent has to be added explicitly.
    const imageDirs = [...new Set((input.images ?? []).map(image => path.dirname(image)))];

    const before = input.yolo ? await snapshotWorkingTree(workingDirectory) : null;

    const afterWorkingTree = async () => diffWorkingTree(
      before,
      input.yolo ? await snapshotWorkingTree(workingDirectory) : null
    );

    let envelope: AgyJsonEnvelope;
    try {
      envelope = await executeAgyJson(
        buildScreenReviewPrompt({
          mode: input.mode,
          instructions: input.instructions,
          context: input.context,
          images: input.images,
          routeFile: input.routeFile,
          changedRoutes: input.changedRoutes,
        }),
        {
          model: input.model,
          yolo: input.yolo,
          printTimeout: input.printTimeout,
          conversationId: input.conversationId,
          includeDirectories: [workingDirectory, ...imageDirs],
          cwd: workingDirectory,
          jsonSchema: isPlan ? SCHEMA_TEXT.plan : SCHEMA_TEXT.review,
          noCache: true,
        },
        onProgress
      );
    } catch (error) {
      // A timeout or CLI failure can land after Gemini has used the shell yolo
      // gave it, so the warning travels with the error.
      failWithWorkingTree(error, await afterWorkingTree());
    }

    const deniedActions = deniedActionsSummary(envelope);
    // Both modes and both exits: yolo gave Gemini a shell either way.
    const workingTree = await afterWorkingTree();

    if (isPlan) {
      const parsed = screenPlanResultSchema.safeParse(envelope.structured_output);
      if (!parsed.success) {
        return [
          renderUnparsableEnvelope(envelope, '# Screen plan: no usable answer', formatZodIssues(parsed.error)),
          formatWorkingTreeSection(workingTree),
        ].filter(Boolean).join('\n\n');
      }
      return formatScreenPlanReport({
        envelope,
        result: parsed.data,
        routeFile: input.routeFile as string,
        deniedActions,
        workingTree,
      });
    }

    const parsed = screenReviewResultSchema.safeParse(envelope.structured_output);
    if (!parsed.success) {
      return [
        renderUnparsableEnvelope(envelope, '# Screen review: no usable answer', formatZodIssues(parsed.error)),
        formatWorkingTreeSection(workingTree),
      ].filter(Boolean).join('\n\n');
    }

    return formatScreenReviewReport({
      envelope,
      result: parsed.data,
      decision: deriveReviewVerdict(parsed.data, input.images ?? [], input.changedRoutes ?? []),
      deniedActions,
      workingTree,
    });
  },
};
