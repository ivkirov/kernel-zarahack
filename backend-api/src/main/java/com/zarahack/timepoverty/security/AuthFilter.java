package com.zarahack.timepoverty.security;

import com.zarahack.timepoverty.entity.AppUser;
import com.zarahack.timepoverty.repository.AppUserRepository;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * Resolves the Bearer token on every request and, when valid, loads the fresh
 * account into {@link CurrentUser}. Never rejects on its own — endpoints decide
 * what they require — so public routes (auth, OPTIONS) pass straight through.
 */
@Component
public class AuthFilter extends OncePerRequestFilter {

    private final JwtUtil jwt;
    private final AppUserRepository users;

    public AuthFilter(JwtUtil jwt, AppUserRepository users) {
        this.jwt = jwt;
        this.users = users;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
            throws ServletException, IOException {
        try {
            String header = req.getHeader("Authorization");
            if (header != null && header.startsWith("Bearer ")) {
                String sub = jwt.verifySubject(header.substring(7).trim());
                if (sub != null) {
                    AppUser u = users.findById(Long.valueOf(sub)).orElse(null);
                    if (u != null) CurrentUser.set(u);
                }
            }
            chain.doFilter(req, res);
        } finally {
            CurrentUser.clear();
        }
    }
}
