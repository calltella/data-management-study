import { defineConfig, bindings } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig({
  worker: {
    name: "data-management-study",
    compatibilityDate: "2026-11-18",
    entrypoint,
    env: {
      SUPABASE_URL: bindings.text("https://wynsjztgvadvrmthdmsc.supabase.co"),
      SUPABASE_PUBLISHABLE_KEY: bindings.secret(),
      SUPABASE_SECRET_KEY: bindings.secret(),
      MAILGUN_API_KEY: bindings.secret(),
      MAILGUN_DOMAIN: bindings.secret(),
      MAILGUN_FROM: bindings.secret(),
      MAILGUN_REGION: bindings.text("US"),
      REGISTRATION_LIMITER: bindings.rateLimit({
        namespace: "1001",
        simple: { limit: 5, period: 60 },
      }),
      DELETE_AUTH_USER: bindings.text("false"),
      QUESTION_IMAGES: bindings.r2({ name: "data-management-study-images" }),
    },
    assets: {
      notFoundHandling: "single-page-application",
      runWorkerFirst: ["/api/*"],
    },
    observability: {
      enabled: true,
      traces: { enabled: true },
    },
  },
});
