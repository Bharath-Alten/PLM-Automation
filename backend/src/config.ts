export const config = {
  appName: 'PLM Automation',
  port: Number(process.env.PORT || 4000),
  // Only this machine by default: a run drives a browser signed in to PLM as the person who started it.
  host: process.env.HOST || '127.0.0.1',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  uploadDir: 'uploads',
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB || 20) * 1024 * 1024,
  // A run waits for the sign-in and then walks every routing: about 1 minute per routing per browser,
  // and a full run of 118 routings took longer than the old 60 minutes. The ceiling is 6 hours.
  automationTimeoutMs: Number(process.env.AUTOMATION_TIMEOUT_MS || 21_600_000)
};
