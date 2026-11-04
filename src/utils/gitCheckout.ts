import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 10_000;

export interface Checkout {
  /** Null on a detached HEAD. */
  branch: string | null;
  head: string;
}

function git(directory: string, args: string[]) {
  return execFileAsync('git', args, { cwd: directory, timeout: GIT_TIMEOUT_MS });
}

/** The branch and commit checked out in `directory`, or null when it is not a git checkout with a commit. */
export async function readCheckout(directory: string): Promise<Checkout | null> {
  try {
    const { stdout } = await git(directory, ['rev-parse', 'HEAD', '--abbrev-ref', 'HEAD']);
    const [head, branch] = stdout.trim().split('\n');
    if (!head || !branch) return null;
    return { head, branch: branch === 'HEAD' ? null : branch };
  } catch {
    return null;
  }
}

/**
 * The merge base of `ref` and HEAD in `directory`. Throws with git's own reason
 * when the ref does not resolve; `--end-of-options` keeps a ref spelled like an
 * option from being read as one.
 */
export async function resolveMergeBase(directory: string, ref: string): Promise<string> {
  try {
    const { stdout } = await git(directory, ['merge-base', '--end-of-options', ref, 'HEAD']);
    return stdout.trim();
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new Error(stderr || (error as Error).message);
  }
}
