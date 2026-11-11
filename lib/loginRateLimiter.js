/**
 * Login Rate Limiter
 * 
 * In-memory rate limiter for restaurant owner login attempts.
 * Enforces max 10 failed attempts per owner_phone per 15-minute window.
 * Returns HTTP 429 with retryAfter (seconds) when limit is exceeded.
 * 
 * Validates: Requirement 3.9
 */

const loginAttempts = new Map(); // phone -> { count, windowStart }

const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Checks if a login attempt is allowed for the given phone number.
 * If the window has expired, resets and starts a new window.
 * 
 * @param {string} phone - The owner phone number
 * @returns {{ allowed: true } | { allowed: false, retryAfter: number }}
 */
function checkLoginRateLimit(phone) {
  const now = Date.now();
  const entry = loginAttempts.get(phone);

  // No previous attempts or window has expired — allow and start fresh window
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    return { allowed: true };
  }

  // Window is active and limit has been reached
  if (entry.count >= MAX_ATTEMPTS) {
    const retryAfter = Math.ceil((entry.windowStart + WINDOW_MS - now) / 1000);
    return { allowed: false, retryAfter };
  }

  // Window is active but under limit — allow
  return { allowed: true };
}

/**
 * Records a failed login attempt for the given phone number.
 * If no entry exists or the window has expired, starts a new window.
 * 
 * @param {string} phone - The owner phone number
 */
function recordFailedAttempt(phone) {
  const now = Date.now();
  const entry = loginAttempts.get(phone);

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    loginAttempts.set(phone, { count: 1, windowStart: now });
  } else {
    entry.count++;
  }
}

/**
 * Resets the failed attempt counter for the given phone number.
 * Called on successful login.
 * 
 * @param {string} phone - The owner phone number
 */
function resetAttempts(phone) {
  loginAttempts.delete(phone);
}

module.exports = {
  checkLoginRateLimit,
  recordFailedAttempt,
  resetAttempts,
  // Exported for testing purposes
  _loginAttempts: loginAttempts,
  _MAX_ATTEMPTS: MAX_ATTEMPTS,
  _WINDOW_MS: WINDOW_MS,
};
