import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  EMAIL_PROVIDER: z.enum(['resend', 'console']).default('console'),
  EMAIL_FROM: z.string().min(1).max(320).default('RelayDesk <no-reply@example.com>'),
  RESEND_API_KEY: z.string().optional(),
});

export type RelayDeskEnv = z.infer<typeof EnvSchema>;

export const env: RelayDeskEnv = EnvSchema.parse({
  DATABASE_URL: process.env.DATABASE_URL,
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
  REDIS_URL: process.env.REDIS_URL,
  EMAIL_PROVIDER: process.env.EMAIL_PROVIDER,
  EMAIL_FROM: process.env.EMAIL_FROM,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
});
