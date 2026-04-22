/**
 * offlineAuth.js
 *
 * Provides secure offline credential verification for the psyzx PWA.
 *
 * Security model:
 *  - Raw passwords are NEVER stored. Only a PBKDF2-derived hash + random salt.
 *  - Offline access is only granted to users who logged in online at least once.
 *  - Credentials are scoped to a single username — no privilege escalation possible.
 *  - Cleared on explicit logout.
 *
 * Attack surface:
 *  - LocalStorage is accessible by same-origin JS only (no XSS-free guarantee,
 *    but that is true of the auth cookie too in a PWA context).
 *  - PBKDF2 with 200k iterations / SHA-256 makes brute-force significantly
 *    harder than storing a plain hash.
 */

const OFFLINE_AUTH_KEY  = 'psyzx_offline_auth';
const OFFLINE_USER_KEY  = 'psyzx_offline_user';
const PBKDF2_ITERATIONS = 200_000;

// ── CRYPTO HELPERS ──────────────────────────────────────────────────────────

/**
 * Derives a fixed-length hex string from a password + salt using PBKDF2/SHA-256.
 * @param {string} password
 * @param {Uint8Array} saltBytes  - raw salt (16 bytes recommended)
 * @returns {Promise<string>}     - 64-char hex string
 */
async function pbkdf2Hex(password, saltBytes) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        enc.encode(password),
        { name: 'PBKDF2' },
        false,
        ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
        {
            name:       'PBKDF2',
            salt:       saltBytes,
            iterations: PBKDF2_ITERATIONS,
            hash:       'SHA-256',
        },
        keyMaterial,
        256
    );
    return Array.from(new Uint8Array(bits))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

/**
 * Constant-time string comparison (prevents timing-oracle attacks on the hash).
 * Both strings are converted to Uint8Array and compared byte-by-byte with
 * no early-exit on mismatch.
 */
function safeEqual(a, b) {
    if (a.length !== b.length) return false;
    const ua = new TextEncoder().encode(a);
    const ub = new TextEncoder().encode(b);
    let diff = 0;
    for (let i = 0; i < ua.length; i++) diff |= ua[i] ^ ub[i];
    return diff === 0;
}

// ── PUBLIC API ───────────────────────────────────────────────────────────────

/**
 * Called after a successful **online** login.
 * Stores a PBKDF2 hash of the password alongside the user's cached profile.
 *
 * @param {string} username
 * @param {string} password  - plaintext (used only to derive hash, never stored)
 * @param {object} userData  - the server-returned user object
 */
export async function saveOfflineCredentials(username, password, userData) {
    try {
        const saltBytes = crypto.getRandomValues(new Uint8Array(16));
        const saltHex   = Array.from(saltBytes).map(b => b.toString(16).padStart(2, '0')).join('');
        const hash      = await pbkdf2Hex(password, saltBytes);

        const record = {
            username: username.trim().toLowerCase(),
            saltHex,
            hash,
            savedAt: Date.now(),
        };

        localStorage.setItem(OFFLINE_AUTH_KEY, JSON.stringify(record));
        // Cache the latest user object so we can restore the session offline
        localStorage.setItem(OFFLINE_USER_KEY, JSON.stringify(userData));
    } catch (err) {
        // Non-fatal — online login still succeeded
        console.warn('[OfflineAuth] Could not save offline credentials:', err);
    }
}

/**
 * Refreshes only the cached user profile (called on every successful checkAuth
 * so the offline user object stays current without touching the credential hash).
 *
 * @param {object} userData
 */
export function refreshOfflineUserData(userData) {
    try {
        if (localStorage.getItem(OFFLINE_AUTH_KEY)) {
            localStorage.setItem(OFFLINE_USER_KEY, JSON.stringify(userData));
        }
    } catch { /* non-fatal */ }
}

/**
 * Verifies a login attempt against stored offline credentials.
 *
 * @param {string} username
 * @param {string} password
 * @returns {Promise<object|null>}  - cached userData on success, null on failure
 */
export async function verifyOfflineLogin(username, password) {
    try {
        const rawAuth = localStorage.getItem(OFFLINE_AUTH_KEY);
        const rawUser = localStorage.getItem(OFFLINE_USER_KEY);
        if (!rawAuth || !rawUser) return null;

        const { username: storedUser, saltHex, hash: storedHash } = JSON.parse(rawAuth);

        // Username must match (case-insensitive, trimmed)
        if (username.trim().toLowerCase() !== storedUser) return null;

        // Re-derive hash from the entered password using the stored salt
        const saltBytes      = new Uint8Array(saltHex.match(/.{2}/g).map(h => parseInt(h, 16)));
        const candidateHash  = await pbkdf2Hex(password, saltBytes);

        if (!safeEqual(candidateHash, storedHash)) return null;

        return JSON.parse(rawUser);
    } catch (err) {
        console.warn('[OfflineAuth] Verification error:', err);
        return null;
    }
}

/**
 * Returns true if offline credentials have been saved (i.e. the user has
 * logged in online at least once on this device).
 */
export function hasOfflineCredentials() {
    return (
        !!localStorage.getItem(OFFLINE_AUTH_KEY) &&
        !!localStorage.getItem(OFFLINE_USER_KEY)
    );
}

/**
 * Wipes all offline auth data. Call this on logout.
 */
export function clearOfflineCredentials() {
    localStorage.removeItem(OFFLINE_AUTH_KEY);
    localStorage.removeItem(OFFLINE_USER_KEY);
}