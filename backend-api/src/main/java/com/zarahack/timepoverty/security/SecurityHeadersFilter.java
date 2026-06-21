package com.zarahack.timepoverty.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * Adds defensive response headers to every API response. The JSON API is
 * consumed by fetch(), never framed or sniffed, and may carry account data
 * (e.g. /me, /admin/users), so we mark it non-cacheable and lock down framing /
 * MIME sniffing / referrer leakage. Cheap defense-in-depth alongside the
 * frontend CSP.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class SecurityHeadersFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
            throws ServletException, IOException {
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("X-Frame-Options", "DENY");
        res.setHeader("Referrer-Policy", "no-referrer");
        res.setHeader("Permissions-Policy", "geolocation=(), camera=(), microphone=()");
        // API payloads can be account-specific; keep them out of shared/browser caches.
        res.setHeader("Cache-Control", "no-store");
        chain.doFilter(req, res);
    }
}
