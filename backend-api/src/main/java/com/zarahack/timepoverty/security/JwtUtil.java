package com.zarahack.timepoverty.security;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Minimal HS256 JWT — JDK-only (HMAC + Base64URL), no external JWT/JSON library.
 * The payload is a tiny fixed shape, so claims are built and read by hand.
 *
 * <p><b>Secret handling (security-critical).</b> The signing key is read from
 * {@code app.auth.jwt-secret} (env {@code APP_AUTH_JWT_SECRET}). There is no
 * hardcoded fallback on purpose — a shipped default key means anyone with the
 * source can forge tokens for any account. Policy:
 * <ul>
 *   <li>blank / unset → a fresh random key is generated for this process and a
 *       loud warning is logged. The app still boots (dev convenience) but every
 *       restart invalidates existing tokens, which is a safe failure, never a
 *       forgeable one. Production MUST set the env var so sessions survive.</li>
 *   <li>set but shorter than {@value #MIN_SECRET_BYTES} bytes → boot fails
 *       fast: a short key is brute-forceable, so we refuse to start rather than
 *       run with a weak one.</li>
 * </ul>
 */
@Component
public class JwtUtil {

    private static final Logger log = LoggerFactory.getLogger(JwtUtil.class);

    /** Minimum acceptable key length for HS256 (256-bit). Shorter ⇒ refuse to boot. */
    static final int MIN_SECRET_BYTES = 32;

    private final byte[] secret;
    private final long ttlSeconds;
    private static final Base64.Encoder B64 = Base64.getUrlEncoder().withoutPadding();
    private static final Base64.Decoder B64D = Base64.getUrlDecoder();
    private static final Pattern SUB = Pattern.compile("\"sub\"\\s*:\\s*\"([^\"]*)\"");
    private static final Pattern EXP = Pattern.compile("\"exp\"\\s*:\\s*(\\d+)");

    public JwtUtil(
            @Value("${app.auth.jwt-secret:}") String secret,
            @Value("${app.auth.jwt-ttl-seconds:604800}") long ttlSeconds) {   // default 7 days
        this.secret = resolveSecret(secret);
        this.ttlSeconds = ttlSeconds;
    }

    /** Validate the configured secret, or mint a strong random one for dev (never a fixed default). */
    private static byte[] resolveSecret(String configured) {
        if (configured == null || configured.isBlank()) {
            byte[] random = new byte[MIN_SECRET_BYTES];
            new SecureRandom().nextBytes(random);
            log.warn("app.auth.jwt-secret is not set — generated a random per-process JWT key. "
                    + "Tokens will NOT survive a restart. Set APP_AUTH_JWT_SECRET (>= {} chars) in production.",
                    MIN_SECRET_BYTES);
            return random;
        }
        byte[] bytes = configured.getBytes(StandardCharsets.UTF_8);
        if (bytes.length < MIN_SECRET_BYTES) {
            throw new IllegalStateException("app.auth.jwt-secret is too short ("
                    + bytes.length + " bytes); use at least " + MIN_SECRET_BYTES
                    + " characters of high-entropy secret.");
        }
        return bytes;
    }

    public String issue(Long userId, String email, String role) {
        long now = System.currentTimeMillis() / 1000L;
        String header = B64.encodeToString("{\"alg\":\"HS256\",\"typ\":\"JWT\"}".getBytes(StandardCharsets.UTF_8));
        String json = "{"
                + "\"sub\":\"" + userId + "\","
                + "\"email\":\"" + escape(email) + "\","
                + "\"role\":\"" + escape(role) + "\","
                + "\"iat\":" + now + ","
                + "\"exp\":" + (now + ttlSeconds)
                + "}";
        String payload = B64.encodeToString(json.getBytes(StandardCharsets.UTF_8));
        String signingInput = header + "." + payload;
        return signingInput + "." + sign(signingInput);
    }

    /** Returns the subject (user id) if the token is valid & unexpired, else null. */
    public String verifySubject(String token) {
        if (token == null) return null;
        String[] parts = token.split("\\.");
        if (parts.length != 3) return null;
        String signingInput = parts[0] + "." + parts[1];
        if (!constantTimeEquals(sign(signingInput), parts[2])) return null;
        try {
            String json = new String(B64D.decode(parts[1]), StandardCharsets.UTF_8);
            Matcher exp = EXP.matcher(json);
            if (exp.find() && Long.parseLong(exp.group(1)) < System.currentTimeMillis() / 1000L) return null;
            Matcher sub = SUB.matcher(json);
            return sub.find() ? sub.group(1) : null;
        } catch (Exception e) {
            return null;
        }
    }

    private static String escape(String s) {
        return s == null ? "" : s.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    private String sign(String input) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret, "HmacSHA256"));
            return B64.encodeToString(mac.doFinal(input.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException("JWT signing failed", e);
        }
    }

    private static boolean constantTimeEquals(String a, String b) {
        if (a == null || b == null || a.length() != b.length()) return false;
        int r = 0;
        for (int i = 0; i < a.length(); i++) r |= a.charAt(i) ^ b.charAt(i);
        return r == 0;
    }
}
