import { spawn } from "child_process";
import { Logger } from "./logger.js";
import { AGY_LIMITS, ERROR_MESSAGES } from "../constants.js";

// Node clamps longer delays to 1 ms, so long limits need more than one timer.
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;

export interface CommandLimits {
  /** Stop the process this long after spawn (SIGTERM then SIGKILL on POSIX; taskkill on Windows). */
  killAfterMs?: number;
  /** Stop the process when the caller's request is cancelled. */
  signal?: AbortSignal;
}

export async function executeCommand(
  command: string,
  args: string[],
  onProgress?: (newOutput: string) => void,
  cwd?: string,
  limits: CommandLimits = {}
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (limits.signal?.aborted) {
      reject(new Error(ERROR_MESSAGES.AGY_CANCELLED));
      return;
    }

    const startTime = Date.now();
    Logger.commandExecution(command, args, startTime);

    // Give limited POSIX commands their own process group. agy's MCP children
    // inherit it, so a stop can reach them even if agy ignores SIGTERM.
    const grouped = process.platform !== "win32" &&
      (limits.killAfterMs !== undefined || limits.signal !== undefined);
    const childProcess = spawn(command, args, {
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      ...(cwd && { cwd }),
      ...(grouped && { detached: true }),
    });

    // Use array buffers for O(n) performance instead of O(n²) string concatenation
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    let isResolved = false;
    let stopError: Error | undefined;
    let resourceExhausted = false;
    let ceilingTimer: NodeJS.Timeout | undefined;
    let graceTimer: NodeJS.Timeout | undefined;
    let closeTimer: NodeJS.Timeout | undefined;

    const settle = () => {
      isResolved = true;
      clearTimeout(ceilingTimer);
      clearTimeout(graceTimer);
      clearTimeout(closeTimer);
      limits.signal?.removeEventListener("abort", onAbort);
    };

    const signalProcessGroup = (signal: NodeJS.Signals) => {
      try {
        if (grouped && childProcess.pid !== undefined) {
          process.kill(-childProcess.pid, signal);
        } else {
          childProcess.kill(signal);
        }
      } catch {
        // A process can exit between the timer and the signal. If the group
        // signal failed for another reason, still try to stop agy itself.
        if (grouped) childProcess.kill(signal);
      }
    };

    const signalWindowsTree = () => {
      if (childProcess.pid === undefined) {
        childProcess.kill("SIGKILL");
        return;
      }
      // Windows has no negative-PID group signal. Kill the tree while the
      // parent PID still exists, before its children can become orphaned.
      const killer = spawn("taskkill", ["/PID", String(childProcess.pid), "/T", "/F"], {
        shell: false,
        stdio: "ignore",
        windowsHide: true,
      });
      killer.on("error", (error) => {
        Logger.error("Could not stop the Windows process tree:", error);
        childProcess.kill("SIGKILL");
      });
      killer.on("close", (code) => {
        if (code !== 0 && !isResolved) {
          Logger.error(`taskkill could not stop the Windows process tree (exit ${code})`);
          childProcess.kill("SIGKILL");
        }
      });
    };

    const finishStopped = (code: number | null) => {
      if (isResolved) return;
      settle();
      Logger.commandComplete(startTime, code);
      reject(stopError);
    };

    const forceStop = () => {
      if (isResolved) return;
      if (process.platform === "win32") signalWindowsTree();
      else signalProcessGroup("SIGKILL");
      // A detached descendant can keep inherited pipes open after agy dies.
      // Bound that wait and drop the logger's copy of the prompt either way.
      closeTimer = setTimeout(() => {
        childProcess.stdout.destroy?.();
        childProcess.stderr.destroy?.();
        finishStopped(childProcess.exitCode ?? null);
      }, AGY_LIMITS.KILL_CLOSE_WAIT_MS);
    };

    const stop = (error: Error) => {
      if (isResolved || stopError) return;
      stopError = error;
      clearTimeout(ceilingTimer);
      limits.signal?.removeEventListener("abort", onAbort);
      Logger.error(error.message);
      if (process.platform === "win32") signalWindowsTree();
      else signalProcessGroup("SIGTERM");
      graceTimer = setTimeout(forceStop, AGY_LIMITS.KILL_GRACE_MS);
    };
    function onAbort() {
      stop(new Error(ERROR_MESSAGES.AGY_CANCELLED));
    }

    if (limits.killAfterMs !== undefined) {
      const limitMs = limits.killAfterMs;
      const deadline = Date.now() + limitMs;
      const scheduleCeiling = () => {
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          stop(new Error(`${ERROR_MESSAGES.AGY_HUNG}: limit ${Math.round(limitMs / 1000)}s`));
        } else {
          ceilingTimer = setTimeout(scheduleCeiling, Math.min(remaining, MAX_TIMER_DELAY_MS));
        }
      };
      scheduleCeiling();
    }
    limits.signal?.addEventListener("abort", onAbort, { once: true });
    if (limits.signal?.aborted) onAbort();

    childProcess.stdout.on("data", (data) => {
      if (stopError) return;
      const chunk = data.toString();
      stdoutChunks.push(chunk);

      // Report immediately if callback provided (no substring calculation needed)
      if (onProgress) {
        onProgress(chunk);
      }
    });


    // CLI level errors
    childProcess.stderr.on("data", (data) => {
      if (stopError) return;
      const chunk = data.toString();
      stderrChunks.push(chunk);
      // Surface resource/quota failures from the backend without attempting
      // fallback. Build the structured error once, on the first marker.
      if (!resourceExhausted && chunk.includes("RESOURCE_EXHAUSTED")) {
        resourceExhausted = true;
        const stderrSoFar = stderrChunks.join('');
        const modelMatch = stderrSoFar.match(/Quota exceeded for quota metric '([^']+)'/);
        const statusMatch = stderrSoFar.match(/status["\s]*[:=]\s*(\d+)/);
        const reasonMatch = stderrSoFar.match(/"reason":\s*"([^"]+)"/);
        const model = modelMatch ? modelMatch[1] : "Unknown Model";
        const status = statusMatch ? statusMatch[1] : "429";
        const reason = reasonMatch ? reasonMatch[1] : "rateLimitExceeded";
        const errorJson = {
          error: {
            code: parseInt(status),
            message: `GMCPT: --> Quota exceeded for ${model}`,
            details: {
              model: model,
              reason: reason,
              statusText: `Too Many Requests from Antigravity CLI backend`,
            }
          }
        };
        Logger.error(`Antigravity resource error: ${JSON.stringify(errorJson, null, 2)}`);
      }
    });
    childProcess.on("error", (error) => {
      if (!isResolved) {
        if (stopError) return;
        settle();
        Logger.error(`Process error:`, error);
        Logger.commandComplete(startTime, null);
        reject(new Error(`Failed to spawn command: ${error.message}`));
      }
    });
    childProcess.on("close", (code) => {
      if (isResolved) return;
      if (stopError) {
        // A parent can exit before its children. Clear any survivors from its
        // process group before reporting that the request has stopped.
        if (grouped && childProcess.pid !== undefined) signalProcessGroup("SIGKILL");
        finishStopped(code);
        return;
      }
      settle();
      // Join array buffers efficiently
      const stdout = stdoutChunks.join('');
      const stderr = stderrChunks.join('');

      // Treat an exit-0 run as failed only when it reported quota exhaustion
      // AND produced no usable stdout — so a quota error with empty output is
      // surfaced (not silently "recovered"), while a run that still returned a
      // real answer is kept.
      const quotaFailure = resourceExhausted && stdout.trim() === "";
      if (code === 0 && !quotaFailure) {
        Logger.commandComplete(startTime, code, stdout.length);
        resolve(stdout.trim());
      } else {
        Logger.commandComplete(startTime, code);
        Logger.error(`Failed with exit code ${code}`);
        const errorMessage = stderr.trim() || (resourceExhausted ? "RESOURCE_EXHAUSTED" : "Unknown error");
        reject(
          new Error(`Command failed with exit code ${code}: ${errorMessage}`),
        );
      }
    });
  });
}
