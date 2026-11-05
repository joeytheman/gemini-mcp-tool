import { PROTOCOL } from '../constants.js';

export type ProgressToken = string | number;

export type SendProgress = (
  progressToken: ProgressToken,
  progress: number,
  total: number | undefined,
  message: string
) => Promise<void> | void;

export type ProgressOutcome = 'success' | 'failure' | 'cancelled';

export interface ProgressUpdates {
  recordOutput(output: string): void;
  finish(outcome: ProgressOutcome): void;
}

const OUTPUT_PREVIEW_CHARS = 150;

function keepAliveMessage(operationName: string, index: number): string {
  const messages = [
    `🧠 ${operationName} - Gemini is analyzing your request...`,
    `📊 ${operationName} - Processing files and generating insights...`,
    `✨ ${operationName} - Creating structured response for your review...`,
    `⏱️ ${operationName} - Large analysis in progress (this is normal for big requests)...`,
    `🔍 ${operationName} - Still working... Gemini takes time for quality results...`,
  ];
  return messages[index % messages.length];
}

/**
 * Keep-alive progress for ONE tool call. Each call owns its timer and output
 * preview, so a call that finishes never silences another call still running
 * in the same server; a silenced call is aborted by the client.
 */
export function startProgressUpdates(
  operationName: string,
  progressToken: ProgressToken | undefined,
  send: SendProgress
): ProgressUpdates {
  if (!progressToken) {
    return { recordOutput: () => {}, finish: () => {} };
  }

  let latestOutput = '';
  let ticks = 0;
  void send(progressToken, 0, undefined, `🔍 Starting ${operationName}`);

  const interval = setInterval(() => {
    const base = keepAliveMessage(operationName, ticks);
    ticks += 1;
    const preview = latestOutput.slice(-OUTPUT_PREVIEW_CHARS).trim();
    void send(progressToken, ticks, undefined, preview ? `${base}\n📝 Output: ...${preview}` : base);
  }, PROTOCOL.KEEPALIVE_INTERVAL);

  return {
    recordOutput: (output) => { latestOutput = output; },
    finish: (outcome) => {
      clearInterval(interval);
      // A cancelled request's token is retired: the client logs progress on it as an error.
      if (outcome === 'cancelled') return;
      void send(
        progressToken,
        100,
        100,
        outcome === 'success' ? `✅ ${operationName} completed successfully` : `❌ ${operationName} failed`
      );
    },
  };
}
