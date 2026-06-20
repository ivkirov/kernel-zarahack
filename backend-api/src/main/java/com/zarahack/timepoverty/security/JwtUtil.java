package com.zarahack.timepoverty.security;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Minimal HS256 JWT — JDK-only (HMAC + Base64URL), no external JWT/JSON library.
 * The payload is a tiny fixed shape, so claims are built and read by hand.
 */
@Component
public class JwtUtil {

    private final byte[] secret;
    private final long ttlSeconds;
    private static final Base64.Encoder B64 = Base64.getUrlEncoder().withoutPadding();
    private static final Base64.Decoder B64D = Base64.getUrlDecoder();
    private static final Pattern SUB = Pattern.compile("\"sub\"\\s*:\\s*\"([^\"]*)\"");
    private static final Pattern EXP = Pattern.compile("\"exp\"\\s*:\\s*(\\d+)");

    public JwtUtil(
            @Value("${app.auth.jwt-secret:tpm-dev-secret-change-me-please-0123456789}") String secret,
            @Value("${app.auth.jwt-ttl-seconds:604800}") long ttlSeconds) {   // default 7 days
        this.secret = secret.getBytes(StandardCharsets.UTF_8);
        this.ttlSeconds = ttlSeconds;
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
