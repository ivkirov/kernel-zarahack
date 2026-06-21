package com.zarahack.timepoverty;

import com.zarahack.timepoverty.security.JwtUtil;
import com.zarahack.timepoverty.security.PasswordHasher;
import com.zarahack.timepoverty.service.Districts;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Regression tests for the security hardening: JWT forgery/secret handling,
 * password hashing, and district cache-key bounding. Pure logic — no Spring
 * context or database, so they run fast in any build.
 */
class SecurityHardeningTest {

    private static final String STRONG_A = "strong-secret-A-0123456789abcdef-pad"; // >= 32 bytes
    private static final String STRONG_B = "strong-secret-B-0123456789abcdef-pad";
    private static final String OLD_DEFAULT = "tpm-dev-secret-change-me-please-0123456789";

    @Test
    void issuesAndVerifiesAValidToken() {
        JwtUtil jwt = new JwtUtil(STRONG_A, 3600);
        String token = jwt.issue(42L, "user@example.com", "ADMIN");
        assertEquals("42", jwt.verifySubject(token));
    }

    @Test
    void rejectsATamperedPayload() {
        JwtUtil jwt = new JwtUtil(STRONG_A, 3600);
        String token = jwt.issue(7L, "u@e.com", "FREE_USER");
        String[] p = token.split("\\.");
        // Flip the payload (claims) but keep the original signature → must fail.
        String forged = p[0] + "." + p[1].substring(0, p[1].length() - 2) + "XY." + p[2];
        assertNull(jwt.verifySubject(forged));
    }

    @Test
    void aTokenSignedWithAnotherKeyIsRejected() {
        JwtUtil victim = new JwtUtil(STRONG_A, 3600);
        JwtUtil attacker = new JwtUtil(STRONG_B, 3600);
        String forged = attacker.issue(1L, "admin@gmail.com", "ADMIN");
        assertNull(victim.verifySubject(forged), "a token from a different secret must not verify");
    }

    @Test
    void knowingTheOldHardcodedDefaultGrantsNothing() {
        // The whole point of removing the shipped default: a token forged with it
        // must be worthless against an instance using a real secret.
        JwtUtil server = new JwtUtil(STRONG_A, 3600);
        JwtUtil withOldDefault = new JwtUtil(OLD_DEFAULT, 3600);
        assertNull(server.verifySubject(withOldDefault.issue(1L, "admin@gmail.com", "ADMIN")));
    }

    @Test
    void refusesToBootWithAWeakSecret() {
        assertThrows(IllegalStateException.class, () -> new JwtUtil("too-short", 3600));
    }

    @Test
    void blankSecretYieldsAWorkingRandomKey() {
        // Dev convenience: still functional, just not forgeable / not stable across boots.
        JwtUtil a = new JwtUtil("", 3600);
        assertEquals("5", a.verifySubject(a.issue(5L, "u@e.com", "FREE_USER")));
        // Two blank-secret instances get independent random keys → can't cross-verify.
        JwtUtil b = new JwtUtil("", 3600);
        assertNull(b.verifySubject(a.issue(5L, "u@e.com", "FREE_USER")));
    }

    @Test
    void expiredTokenIsRejected() {
        JwtUtil jwt = new JwtUtil(STRONG_A, -10); // already expired on issue
        assertNull(jwt.verifySubject(jwt.issue(1L, "u@e.com", "ADMIN")));
    }

    @Test
    void passwordHashingRoundTripsAndUsesStrongCost() {
        PasswordHasher ph = new PasswordHasher();
        String stored = ph.hash("correct horse battery staple");
        assertTrue(stored.startsWith("pbkdf2$600000$"), "should use the OWASP-recommended cost");
        assertTrue(ph.matches("correct horse battery staple", stored));
        assertFalse(ph.matches("wrong password", stored));
        assertFalse(ph.matches("x", "not-a-valid-hash"), "malformed stored hash must not throw");
    }

    @Test
    void districtCanonicalizationBoundsTheCacheKey() {
        assertEquals("all", Districts.canonical(null));
        assertEquals("all", Districts.canonical(""));
        assertEquals("all", Districts.canonical("All Bulgaria"));
        assertEquals("Stara Zagora", Districts.canonical("stara zagora"));   // case-insensitive
        assertEquals("Sofia (Capital)", Districts.canonical("Sofia (Capital)"));
        // Arbitrary attacker input never becomes a cache key.
        assertThrows(IllegalArgumentException.class, () -> Districts.canonical("'; DROP TABLE x;--"));
        assertThrows(IllegalArgumentException.class, () -> Districts.canonical("Atlantis"));
    }
}
