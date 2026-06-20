package com.zarahack.timepoverty.service;

import com.zarahack.timepoverty.dto.auth.*;
import com.zarahack.timepoverty.entity.AppUser;
import com.zarahack.timepoverty.entity.Role;
import com.zarahack.timepoverty.repository.AppUserRepository;
import com.zarahack.timepoverty.security.AuthException;
import com.zarahack.timepoverty.security.JwtUtil;
import com.zarahack.timepoverty.security.PasswordHasher;
import org.springframework.stereotype.Service;

@Service
public class AuthService {

    private final AppUserRepository users;
    private final PasswordHasher hasher;
    private final JwtUtil jwt;

    public AuthService(AppUserRepository users, PasswordHasher hasher, JwtUtil jwt) {
        this.users = users;
        this.hasher = hasher;
        this.jwt = jwt;
    }

    public AuthResponse register(RegisterRequest req) {
        String email = req.email == null ? "" : req.email.trim().toLowerCase();
        if (email.isEmpty() || !email.contains("@")) {
            throw new AuthException(400, "BAD_EMAIL", "Enter a valid email address.");
        }
        if (req.password == null || req.password.length() < 6) {
            throw new AuthException(400, "WEAK_PASSWORD", "Password must be at least 6 characters.");
        }
        if (users.existsByEmail(email)) {
            throw new AuthException(409, "EMAIL_TAKEN", "An account with that email already exists.");
        }

        // Persona → role. Individuals are free & immediately usable; reporters and
        // municipalities are paid-only, so they land locked until an admin grants access.
        Role role;
        boolean granted;
        switch (req.persona == null ? "individual" : req.persona.trim().toLowerCase()) {
            case "reporter"     -> { role = Role.REPORTER;     granted = false; }
            case "municipality" -> { role = Role.MUNICIPALITY; granted = false; }
            default             -> { role = Role.FREE_USER;    granted = true;  }
        }

        AppUser u = new AppUser();
        u.setEmail(email);
        u.setPasswordHash(hasher.hash(req.password));
        u.setDisplayName(req.displayName == null || req.displayName.isBlank()
                ? email.substring(0, email.indexOf('@')) : req.displayName.trim());
        u.setRole(role);
        u.setAccessGranted(granted);
        u.setFreeGuessesUsed(0);
        u = users.save(u);

        return token(u);
    }

    public AuthResponse login(LoginRequest req) {
        String email = req.email == null ? "" : req.email.trim().toLowerCase();
        AppUser u = users.findByEmail(email)
                .filter(x -> req.password != null && hasher.matches(req.password, x.getPasswordHash()))
                .orElseThrow(() -> new AuthException(401, "BAD_CREDENTIALS", "Wrong email or password."));
        return token(u);
    }

    private AuthResponse token(AppUser u) {
        return new AuthResponse(jwt.issue(u.getId(), u.getEmail(), u.getRole().name()), UserView.of(u));
    }
}
