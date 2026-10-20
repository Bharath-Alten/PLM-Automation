export const config = {
  appName: 'PLM Automation',
  port: Number(process.env.PORT || 4000),
  // Only this machine by default: a run drives a browser signed in to PLM as the person who started it.
  host: process.env.HOST || '127.0.0.1',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  uploadDir: 'uploads',
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB || 20) * 1024 * 1024,
  // A run waits for the sign-in and then walks every routing, so the ceiling is generous (60 minutes).
  automationTimeoutMs: Number(process.env.AUTOMATION_TIMEOUT_MS || 3_600_000)
};
