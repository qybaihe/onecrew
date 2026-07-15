import { spawn } from 'node:child_process';

export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class ControlledProcessError extends Error {
  constructor(
    readonly executable: string,
    readonly exitCode: number,
    readonly stderrSummary: string,
  ) {
    super(`${executable} exited with code ${exitCode}: ${stderrSummary}`);
    this.name = 'ControlledProcessError';
  }
}

export async function runControlledProcess(
  executable: string,
  args: readonly string[],
  options: {
    timeoutMs?: number;
    maxOutputBytes?: number;
    allowFailure?: boolean;
    signal?: AbortSignal;
  } = {},
): Promise<ProcessResult> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const maxOutputBytes = options.maxOutputBytes ?? 32 * 1024 * 1024;
  return new Promise<ProcessResult>((resolve, reject) => {
    const child = spawn(executable, [...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let timedOut = false;
    let aborted = false;

    const abort = () => {
      aborted = true;
      child.kill('SIGKILL');
    };
    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener('abort', abort, { once: true });

    const collect = (chunks: Buffer[], value: Buffer) => {
      outputBytes += value.byteLength;
      if (outputBytes > maxOutputBytes) {
        child.kill('SIGKILL');
        reject(new Error(`${executable} exceeded controlled output limit`));
        return;
      }
      chunks.push(value);
    };
    child.stdout.on('data', (value: Buffer) => collect(stdout, value));
    child.stderr.on('data', (value: Buffer) => collect(stderr, value));
    child.once('error', reject);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    timer.unref();
    child.once('close', (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      const result: ProcessResult = {
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        exitCode: code ?? -1,
      };
      if (timedOut) {
        reject(new Error(`${executable} timed out after ${timeoutMs}ms`));
        return;
      }
      if (aborted) {
        reject(new Error(`${executable} was cancelled`));
        return;
      }
      if (result.exitCode !== 0 && !options.allowFailure) {
        reject(
          new ControlledProcessError(
            executable,
            result.exitCode,
            result.stderr.trim().slice(-2_000) || 'no stderr',
          ),
        );
        return;
      }
      resolve(result);
    });
  });
}
