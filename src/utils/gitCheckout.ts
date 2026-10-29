import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 10_000;

export interface Checkout {
  /** Null on a detached HEAD. */
  branch: string | null;
  head: string;
}

/** The branch and commit checked out in `directory`, or null when it is not a git checkout with a commit. */
export async function readCheckout(directory: string): Promise<Checkout | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD', '--abbrev-ref', 'HEAD'], {
      cwd: directory,
      timeout: GIT_TIMEOUT_MS,
    });
    const [head, branch] = stdout.trim().split('\n');
    if (!head || !branch) return null;
    return { head, branch: branch === 'HEAD' ? null : branch };
  } catch {
    return null;
  }
}
