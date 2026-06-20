package com.zarahack.timepoverty.security;

import org.springframework.stereotype.Component;

import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import java.security.SecureRandom;
import java.util.Base64;

/**
 * Password hashing with PBKDF2-HMAC-SHA256 — JDK-only, no external crypto deps.
 * Stored format: {@code pbkdf2$<iterations>$<saltB64>$<hashB64>}.
 */
@Component
public class PasswordHasher {

    private static final int ITERATIONS = 120_000;
    private static final int KEY_BITS = 256;
    private static final int SALT_BYTES = 16;
    private static final SecureRandom RNG = new SecureRandom();
    private static final Base64.Encoder ENC = Base64.getEncoder();
    private static final Base64.Decoder DEC = Base64.getDecoder();

    public String hash(String raw) {
        byte[] salt = new byte[SALT_BYTES];
        RNG.nextBytes(salt);
        byte[] dk = pbkdf2(raw.toCharArray(), salt, ITERATIONS);
        return "pbkdf2$" + ITERATIONS + "$" + ENC.encodeToString(salt) + "$" + ENC.encodeToString(dk);
    }

    public boolean matches(String raw, String stored) {
        try {
            String[] parts = stored.split("\\$");
            if (parts.length != 4 || !"pbkdf2".equals(parts[0])) return false;
            int iterations = Integer.parseInt(parts[1]);
            byte[] salt = DEC.decode(parts[2]);
            byte[] expected = DEC.decode(parts[3]);
            byte[] actual = pbkdf2(raw.toCharArray(), salt, iterations);
            return constantTimeEquals(expected, actual);
        } catch (Exception e) {
            return false;
        }
    }

    private static byte[] pbkdf2(char[] pw, byte[] salt, int iterations) {
        try {
            PBEKeySpec spec = new PBEKeySpec(pw, salt, iterations, KEY_BITS);
            SecretKeyFactory f = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256");
            return f.generateSecret(spec).getEncoded();
        } catch (Exception e) {
            throw new IllegalStateException("PBKDF2 hashing failed", e);
        }
    }

    private static boolean constantTimeEquals(byte[] a, byte[] b) {
        if (a.length != b.length) return false;
        int r = 0;
        for (int i = 0; i < a.length; i++) r |= a[i] ^ b[i];
        return r == 0;
    }
}
