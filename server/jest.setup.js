// Runs before any module (including config.ts) loads. DEV_MODE lets config boot
// without real Azure/iTrent secrets; a fixed CAPTCHA secret makes signed-token
// tests deterministic.
process.env.DEV_MODE = 'true';
process.env.CAPTCHA_SECRET = 'test-captcha-secret';
process.env.SUPPORT_EMAIL = 'it.support@hakimgroup.co.uk';
process.env.SUPPORT_STANDARD_QUEUE = 'standard-support-queue';
