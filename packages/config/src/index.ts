import { z } from 'zod';

const logLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
const optionalEnvString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().min(1).optional(),
);
const optionalPositiveInteger = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.coerce.number().int().min(256).max(4_096).optional(),
);

export const appEnvSchema = z
  .object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3_000),
  LOG_LEVEL: z.enum(logLevels).default('info'),
  APP_VERSION: z.string().min(1).default('0.1.0-dev'),
  DATABASE_URL: z
    .url()
    .refine((value) => value.startsWith('postgres://') || value.startsWith('postgresql://'), {
      message: 'must use the postgres or postgresql protocol',
    })
    .default('postgresql://onecrew:onecrew-local-postgres@127.0.0.1:55432/onecrew'),
  REDIS_URL: z
    .url()
    .refine((value) => value.startsWith('redis://') || value.startsWith('rediss://'), {
      message: 'must use the redis or rediss protocol',
    })
    .default('redis://:onecrew-local-redis@127.0.0.1:56379/0'),
  S3_ENDPOINT: z.url().default('http://127.0.0.1:59000'),
  S3_REGION: z.string().min(1).default('us-east-1'),
  S3_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/).default('onecrew'),
  S3_ACCESS_KEY: z.string().min(1).default('onecrew'),
  S3_SECRET_KEY: z.string().min(1).default('onecrew-local-minio-secret'),
  PROVIDER_MODE: z.enum(['mock', 'real']).default('mock'),
  PROVIDER_PROFILE: z
    .enum(['opencode-agnes-mimo', 'openai-volcengine-elevenlabs'])
    .default('opencode-agnes-mimo'),
  PROVIDER_QUEUE_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(5),
  PROVIDER_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(2_000),
  PROVIDER_SOFT_BUDGET_RATIO: z.coerce.number().positive().max(1).default(0.8),
  PROVIDER_CALLBACK_SECRET: optionalEnvString,
  RENDER_QUEUE_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(1),
  RENDER_CANCEL_POLL_MS: z.coerce.number().int().min(100).max(10_000).default(500),
  QC_QUEUE_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(1),
  QC_PROVIDER_POLL_MS: z.coerce.number().int().min(100).max(60_000).default(500),
  QC_PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(600_000),
  QC_PROVIDER_FAILURE_GRACE_MS: z.coerce.number().int().min(0).max(300_000).default(5_000),
  QC_CANCEL_POLL_MS: z.coerce.number().int().min(100).max(10_000).default(500),
  LOCALIZATION_QUEUE_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(1),
  FFMPEG_PATH: z.string().min(1).default('ffmpeg'),
  FFPROBE_PATH: z.string().min(1).default('ffprobe'),
  REMOTION_BROWSER_EXECUTABLE: optionalEnvString,
  REMOTION_FINAL_MAX_DIMENSION: optionalPositiveInteger,
  OPENCODE_GO_API_KEY: optionalEnvString,
  OPENCODE_GO_BASE_URL: z.url().default('https://opencode.ai/zen/go/v1'),
  OPENCODE_GO_LLM_MODEL: z.string().min(1).default('glm-5.2'),
  OPENCODE_GO_VLM_MODEL: z.string().min(1).default('minimax-m3'),
  OPENCODE_GO_LLM_INPUT_CNY_PER_MILLION_TOKENS: z.coerce.number().nonnegative().default(0),
  OPENCODE_GO_LLM_OUTPUT_CNY_PER_MILLION_TOKENS: z.coerce.number().nonnegative().default(0),
  OPENCODE_GO_VLM_INPUT_CNY_PER_MILLION_TOKENS: z.coerce.number().nonnegative().default(0),
  OPENCODE_GO_VLM_OUTPUT_CNY_PER_MILLION_TOKENS: z.coerce.number().nonnegative().default(0),
  AGNES_API_KEY: optionalEnvString,
  AGNES_BASE_URL: z.url().default('https://apihub.agnes-ai.com'),
  AGNES_IMAGE_MODEL: z.string().min(1).default('agnes-image-2.1-flash'),
  AGNES_IMAGE_COST_CNY_PER_IMAGE: z.coerce.number().nonnegative().default(0),
  AGNES_VIDEO_MODEL: z.string().min(1).default('agnes-video-v2.0'),
  AGNES_VIDEO_COST_CNY_PER_SECOND: z.coerce.number().nonnegative().default(0),
  MIMO_API_KEY: optionalEnvString,
  MIMO_BASE_URL: z.url().default('https://api.xiaomimimo.com/v1'),
  MIMO_TTS_MODEL: z.string().min(1).default('mimo-v2.5-tts'),
  MIMO_TTS_ZH_VOICES: z.string().min(1).default('冰糖,茉莉,苏打,白桦'),
  MIMO_TTS_EN_VOICES: z.string().min(1).default('Mia,Chloe,Milo,Dean'),
  MIMO_TTS_COST_CNY_PER_THOUSAND_CHARACTERS: z.coerce.number().nonnegative().default(0),
  OPENAI_API_KEY: optionalEnvString,
  OPENAI_BASE_URL: z.url().default('https://api.openai.com/v1'),
  OPENAI_MODEL: optionalEnvString,
  OPENAI_VLM_MODEL: optionalEnvString,
  OPENAI_INPUT_CNY_PER_MILLION_TOKENS: z.coerce.number().nonnegative().default(0),
  OPENAI_OUTPUT_CNY_PER_MILLION_TOKENS: z.coerce.number().nonnegative().default(0),
  VOLCENGINE_ARK_API_KEY: optionalEnvString,
  VOLCENGINE_ARK_BASE_URL: z.url().default('https://ark.cn-beijing.volces.com/api/v3'),
  SEEDREAM_MODEL: optionalEnvString,
  SEEDREAM_COST_CNY_PER_IMAGE: z.coerce.number().nonnegative().default(0),
  SEEDANCE_MODEL: optionalEnvString,
  SEEDANCE_COST_CNY_PER_SECOND: z.coerce.number().nonnegative().default(0),
  ELEVENLABS_API_KEY: optionalEnvString,
  ELEVENLABS_BASE_URL: z.url().default('https://api.elevenlabs.io/v1'),
  ELEVENLABS_MODEL: optionalEnvString,
  ELEVENLABS_COST_CNY_PER_THOUSAND_CHARACTERS: z.coerce.number().nonnegative().default(0),
  FEISHU_APP_ID: optionalEnvString,
  FEISHU_APP_SECRET: optionalEnvString,
  FEISHU_BASE_APP_TOKEN: optionalEnvString,
  FEISHU_VERIFICATION_TOKEN: optionalEnvString,
  FEISHU_ENCRYPT_KEY: optionalEnvString,
  FEISHU_ALLOWED_OPEN_IDS: optionalEnvString,
  FEISHU_QC_RECEIVE_ID: optionalEnvString,
  FEISHU_QC_RECEIVE_ID_TYPE: z
    .enum(['open_id', 'user_id', 'union_id', 'email', 'chat_id'])
    .default('open_id'),
  })
  .superRefine((env, context) => {
    if (env.PROVIDER_MODE !== 'real') return;
    const requiredStrings =
      env.PROVIDER_PROFILE === 'opencode-agnes-mimo'
        ? (['PROVIDER_CALLBACK_SECRET', 'OPENCODE_GO_API_KEY', 'AGNES_API_KEY', 'MIMO_API_KEY'] as const)
        : ([
            'PROVIDER_CALLBACK_SECRET',
            'OPENAI_API_KEY',
            'OPENAI_MODEL',
            'OPENAI_VLM_MODEL',
            'VOLCENGINE_ARK_API_KEY',
            'SEEDREAM_MODEL',
            'SEEDANCE_MODEL',
            'ELEVENLABS_API_KEY',
            'ELEVENLABS_MODEL',
          ] as const);
    for (const key of requiredStrings) {
      if (!env[key]) context.addIssue({ code: 'custom', path: [key], message: 'required in real provider mode' });
    }
    if (env.PROVIDER_PROFILE !== 'openai-volcengine-elevenlabs') return;
    const requiredCosts = [
      'OPENAI_INPUT_CNY_PER_MILLION_TOKENS',
      'OPENAI_OUTPUT_CNY_PER_MILLION_TOKENS',
      'SEEDREAM_COST_CNY_PER_IMAGE',
      'SEEDANCE_COST_CNY_PER_SECOND',
      'ELEVENLABS_COST_CNY_PER_THOUSAND_CHARACTERS',
    ] as const;
    for (const key of requiredCosts) {
      if (env[key] <= 0) context.addIssue({ code: 'custom', path: [key], message: 'must be positive in real provider mode' });
    }
  });

export type AppEnv = z.infer<typeof appEnvSchema>;

export class EnvironmentValidationError extends Error {
  readonly issues: Array<{ path: string; message: string }>;

  constructor(issues: Array<{ path: string; message: string }>) {
    super(`Invalid OneCrew environment: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`);
    this.name = 'EnvironmentValidationError';
    this.issues = issues;
  }
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const result = appEnvSchema.safeParse(source);

  if (!result.success) {
    throw new EnvironmentValidationError(
      result.error.issues.map((issue) => ({
        path: issue.path.join('.') || 'environment',
        message: issue.message,
      })),
    );
  }

  return result.data;
}
