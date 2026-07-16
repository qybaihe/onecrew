import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ImageGridSplitInput {
  bytes: Uint8Array;
  rows: number;
  columns: number;
  ffmpegPath?: string;
}

export interface ImageGridTile {
  index: number;
  row: number;
  column: number;
  bytes: Uint8Array;
  contentType: 'image/png';
}

export class InvalidImageGridError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidImageGridError';
  }
}

function validateGrid(rows: number, columns: number): number {
  if (!Number.isInteger(rows) || !Number.isInteger(columns) || rows < 1 || columns < 1) {
    throw new InvalidImageGridError('Image grid rows and columns must be positive integers');
  }
  const count = rows * columns;
  if (rows > 3 || columns > 3 || count < 2 || count > 9) {
    throw new InvalidImageGridError('Image grid must contain 2 to 9 tiles with at most 3 rows and 3 columns');
  }
  return count;
}

export function buildImageGridFilter(rows: number, columns: number): string {
  const count = validateGrid(rows, columns);
  const splitOutputs = Array.from({ length: count }, (_, index) => `[grid${index}]`).join('');
  const crops = Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    return `[grid${index}]crop=iw/${columns}:ih/${rows}:${column}*iw/${columns}:${row}*ih/${rows}[tile${index}]`;
  });
  return [`[0:v]split=${count}${splitOutputs}`, ...crops].join(';');
}

export async function splitImageGrid(input: ImageGridSplitInput): Promise<ImageGridTile[]> {
  const count = validateGrid(input.rows, input.columns);
  if (input.bytes.byteLength < 1 || input.bytes.byteLength > 50 * 1024 * 1024) {
    throw new InvalidImageGridError('Image grid input must be between 1 byte and 50 MiB');
  }
  const directory = await mkdtemp(join(tmpdir(), 'onecrew-image-grid-'));
  try {
    const sourcePath = join(directory, 'source');
    await writeFile(sourcePath, input.bytes);
    const outputPaths = Array.from({ length: count }, (_, index) => join(directory, `tile-${index}.png`));
    const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', sourcePath, '-filter_complex', buildImageGridFilter(input.rows, input.columns)];
    for (const [index, outputPath] of outputPaths.entries()) {
      args.push('-map', `[tile${index}]`, '-frames:v', '1', outputPath);
    }
    try {
      await execFileAsync(input.ffmpegPath ?? 'ffmpeg', args, { maxBuffer: 2 * 1024 * 1024 });
    } catch (error) {
      const stderr = (error as { stderr?: unknown }).stderr;
      throw new InvalidImageGridError(
        `FFmpeg could not split the image grid${typeof stderr === 'string' && stderr.trim() ? `: ${stderr.trim()}` : ''}`,
      );
    }
    return await Promise.all(outputPaths.map(async (outputPath, index) => {
      const bytes = await readFile(outputPath);
      if (bytes.byteLength < 1) throw new InvalidImageGridError(`Image grid tile ${index + 1} is empty`);
      return {
        index,
        row: Math.floor(index / input.columns),
        column: index % input.columns,
        bytes: new Uint8Array(bytes),
        contentType: 'image/png' as const,
      };
    }));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
