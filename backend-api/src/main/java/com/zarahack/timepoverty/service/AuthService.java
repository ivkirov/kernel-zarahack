package com.zarahack.timepoverty.service;

import com.zarahack.timepoverty.dto.auth.*;
import com.zarahack.timepoverty.entity.AppUser;
import com.zarahack.timepoverty.entity.Role;
import com.zarahack.timepoverty.repository.AppUserRepository;
import com.zarahack.timepoverty.security.AuthException;
import com.zarahack.timepoverty.security.JwtUtil;
import com.zarahack.timepoverty.security.PasswordHasher;
import org.springframework.stereotype.Service;

import java.util.regex.Pattern;

@Service
public class AuthService {

    // Pragmatic email shape check (one @, no spaces, a dotted domain). Not RFC-complete
    // by design — it rejects the obviously-invalid (and the markup an XSS payload needs)
    // without trying to parse every legal address.
    private static final Pattern EMAIL = Pattern.compile("^[^\\s@<>\"']{1,128}@[^\\s@<>\"']{1,127}\\.[^\\s@<>\"']{2,63}$");
    private static final int MAX_EMAIL_LEN = 256;     // matches app_users.email column
    private static final int MAX_DISPLAY_NAME_LEN = 80;
    private static final int MAX_PASSWORD_LEN = 200;   // bound PBKDF2 work per request

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
        if (email.length() > MAX_EMAIL_LEN || !EMAIL.matcher(email).matches()) {
            throw new AuthException(400, "BAD_EMAIL", "Enter a valid email address.");
        }
        if (req.password == null || req.password.length() < 6) {
            throw new AuthException(400, "WEAK_PASSWORD", "Password must be at least 6 characters.");
        }
        if (req.password.length() > MAX_PASSWORD_LEN) {
            throw new AuthException(400, "BAD_PASSWORD", "Password is too long.");
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
        u.setDisplayName(cleanDisplayName(req.displayName, email));
        u.setRole(role);
        u.setAccessGranted(granted);
        u.setFreeGuessesUsed(0);
        u = users.save(u);

        return token(u);
    }

    /**
     * Self-serve "payment". Stands in for a real checkout: it activates the
     * current account's paid access so a freshly-registered reporter/municipality
     * (or a free user upgrading) can use/test their tier without an admin grant.
     *
     *   FREE_USER → upgraded to PAID_USER (unlimited checks + AI extras), granted
     *   REPORTER / MUNICIPALITY / PAID_USER → access granted in place
     *   ADMIN → no-op (already has everything)
     */
    public AuthResponse activate(AppUser u) {
        if (u.getRole() == Role.FREE_USER) {
            u.setRole(Role.PAID_USER);
        }
        if (u.getRole() != Role.ADMIN) {
            u.setAccessGranted(true);
        }
        u = users.save(u);
        return token(u);
    }

    public AuthResponse login(LoginRequest req) {
        String email = req.email == null ? "" : req.email.trim().toLowerCase();
        // Cap before hashing so a giant password string can't burn PBKDF2 cycles.
        String password = (req.password != null && req.password.length() <= MAX_PASSWORD_LEN)
                ? req.password : null;
        AppUser u = users.findByEmail(email)
                .filter(x -> password != null && hasher.matches(password, x.getPasswordHash()))
                .orElseThrow(() -> new AuthException(401, "BAD_CREDENTIALS", "Wrong email or password."));
        return token(u);
    }

    /** Trim, strip control characters, and cap length; fall back to the email's local part. */
    private static String cleanDisplayName(String raw, String email) {
        String name = raw == null ? "" : raw.replaceAll("\\p{Cntrl}", "").trim();
        if (name.isBlank()) name = email.substring(0, email.indexOf('@'));
        return name.length() > MAX_DISPLAY_NAME_LEN ? name.substring(0, MAX_DISPLAY_NAME_LEN) : name;
    }

    private AuthResponse token(AppUser u) {
        return new AuthResponse(jwt.issue(u.getId(), u.getEmail(), u.getRole().name()), UserView.of(u));
    }
}
