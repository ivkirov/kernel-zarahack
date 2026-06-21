package com.zarahack.timepoverty.controller;

import com.zarahack.timepoverty.dto.auth.*;
import com.zarahack.timepoverty.security.AuthException;
import com.zarahack.timepoverty.security.CurrentUser;
import com.zarahack.timepoverty.security.RateLimiter;
import com.zarahack.timepoverty.service.AuthService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    private static final long MINUTE = 60_000L;

    private final AuthService auth;
    private final RateLimiter rateLimiter;

    public AuthController(AuthService auth, RateLimiter rateLimiter) {
        this.auth = auth;
        this.rateLimiter = rateLimiter;
    }

    @PostMapping("/register")
    public AuthResponse register(@RequestBody RegisterRequest req, HttpServletRequest http) {
        // Throttle signup spam per source IP. Generous because a shared upstream
        // proxy can collapse many legitimate clients onto one address.
        if (!rateLimiter.allow("register:" + clientIp(http), 20, 10 * MINUTE)) {
            throw new AuthException(429, "RATE_LIMITED", "Too many attempts. Please wait and try again.");
        }
        return auth.register(req);
    }

    @PostMapping("/login")
    public AuthResponse login(@RequestBody LoginRequest req, HttpServletRequest http) {
        // Throttle by IP and by targeted account, so neither a single source nor a
        // single victim email can be hammered (PBKDF2 already makes each try costly).
        String email = req.email == null ? "" : req.email.trim().toLowerCase();
        // Per-account is the tight one (targeted brute force); per-IP is coarse/generous
        // because of shared proxies. `&` (not &&) so both counters always increment.
        boolean ok = rateLimiter.allow("login-ip:" + clientIp(http), 30, MINUTE)
                   & rateLimiter.allow("login-acct:" + email, 10, MINUTE);
        if (!ok) {
            throw new AuthException(429, "RATE_LIMITED", "Too many attempts. Please wait and try again.");
        }
        return auth.login(req);
    }

    /** Best-effort client IP for rate-limit keying (remote address; proxy-aware deployments should set a trusted header upstream). */
    private static String clientIp(HttpServletRequest http) {
        String addr = http.getRemoteAddr();
        return addr == null ? "unknown" : addr;
    }

    /** Self-serve paywall "payment": activates the current account's paid access. */
    @PostMapping("/activate")
    public AuthResponse activate() {
        return auth.activate(CurrentUser.require());
    }

    /** Current account (used by the frontend to bootstrap role-aware UI on load). */
    @GetMapping("/me")
    public UserView me() {
        return UserView.of(CurrentUser.require());
    }
}
