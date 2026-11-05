import { spawn } from "child_process";
import { Logger } from "./logger.js";
import { AGY_LIMITS, ERROR_MESSAGES } from "../constants.js";

// setTimeout fires after 1 ms for any longer delay.
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;

export interface CommandLimits {
  /** Stop the process this long after spawn (SIGTERM, then SIGKILL after a grace period). */
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

    const childProcess = spawn(command, args, {
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      ...(cwd && { cwd }),
    });

    // Use array buffers for O(n) performance instead of O(n²) string concatenation
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    let isResolved = false;
    let resourceExhausted = false;
    let ceilingTimer: NodeJS.Timeout | undefined;
    let graceTimer: NodeJS.Timeout | undefined;

    const settle = () => {
      isResolved = true;
      clearTimeout(ceilingTimer);
      limits.signal?.removeEventListener("abort", onAbort);
    };
    const stop = (error: Error) => {
      if (isResolved) return;
      settle();
      Logger.error(error.message);
      childProcess.kill("SIGTERM");
      graceTimer = setTimeout(() => childProcess.kill("SIGKILL"), AGY_LIMITS.KILL_GRACE_MS);
      reject(error);
    };
    function onAbort() {
      stop(new Error(ERROR_MESSAGES.AGY_CANCELLED));
    }

    if (limits.killAfterMs !== undefined) {
      const limitMs = limits.killAfterMs;
      ceilingTimer = setTimeout(
        () => stop(new Error(`${ERROR_MESSAGES.AGY_HUNG}: limit ${Math.round(limitMs / 1000)}s`)),
        Math.min(limitMs, MAX_TIMER_DELAY_MS)
      );
    }
    limits.signal?.addEventListener("abort", onAbort, { once: true });
    childProcess.on("exit", () => clearTimeout(graceTimer));

    childProcess.stdout.on("data", (data) => {
      const chunk = data.toString();
      stdoutChunks.push(chunk);

      // Report immediately if callback provided (no substring calculation needed)
      if (onProgress) {
        onProgress(chunk);
      }
    });


    // CLI level errors
    childProcess.stderr.on("data", (data) => {
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
        settle();
        Logger.error(`Process error:`, error);
        reject(new Error(`Failed to spawn command: ${error.message}`));
      }
    });
    childProcess.on("close", (code) => {
      if (isResolved) {
        // Stopped or failed earlier: record the exit so the logger drops this command's args.
        Logger.commandComplete(startTime, code);
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
