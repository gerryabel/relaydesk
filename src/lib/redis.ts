import Redis from "ioredis";

const connectionString = process.env.REDIS_URL;

if (!connectionString) {
  throw new Error("REDIS_URL is not set");
}

export const redis = new Redis(connectionString);
