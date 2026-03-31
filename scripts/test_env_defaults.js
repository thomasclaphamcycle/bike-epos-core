#!/usr/bin/env node

const applyTestEnvDefaults = (sourceEnv = process.env) => {
  const env = {
    ...sourceEnv,
  };

  if (!env.DATABASE_URL && env.TEST_DATABASE_URL) {
    env.DATABASE_URL = env.TEST_DATABASE_URL;
  }
  if (!env.TEST_BASE_URL) {
    env.TEST_BASE_URL = "http://localhost:3100";
  }
  if (!env.NODE_ENV) {
    env.NODE_ENV = "test";
  }

  if (
    env.ALLOW_EXISTING_SERVER !== "1" &&
    /^http:\/\/localhost:3000\/?$/i.test(env.TEST_BASE_URL)
  ) {
    env.TEST_BASE_URL = "http://localhost:3100";
  }

  if (!env.PORT) {
    try {
      const parsed = new URL(env.TEST_BASE_URL);
      if (parsed.port) {
        env.PORT = parsed.port;
      }
    } catch {
      // Keep default server port behavior if TEST_BASE_URL is not a valid URL.
    }
  }

  return env;
};

module.exports = {
  applyTestEnvDefaults,
};
