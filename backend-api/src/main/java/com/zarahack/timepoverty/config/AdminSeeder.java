package com.zarahack.timepoverty.config;

import com.zarahack.timepoverty.entity.AppUser;
import com.zarahack.timepoverty.entity.Role;
import com.zarahack.timepoverty.repository.AppUserRepository;
import com.zarahack.timepoverty.security.PasswordHasher;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

import java.security.SecureRandom;
import java.util.Base64;

/**
 * Guarantees the single admin account exists on every machine / fresh database.
 * There is exactly one admin and no other account may be promoted to ADMIN
 * (enforced in {@code UserAdminService}, not just hidden in the UI).
 *
 * <p><b>Credentials are configuration, never source.</b> The email and password
 * come from {@code app.admin.email} / {@code app.admin.password}
 * (env {@code APP_ADMIN_EMAIL} / {@code APP_ADMIN_PASSWORD}). Shipping a fixed
 * password in the binary means anyone with the source owns every deployment, so
 * if the password is unset a strong random one is generated and logged once at
 * startup — production sets the env var, local dev reads the password from the
 * log. No default password is ever baked in.
 */
@Component
public class AdminSeeder implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(AdminSeeder.class);

    private final AppUserRepository users;
    private final PasswordHasher hasher;
    private final String adminEmail;
    private final String adminPassword;

    public AdminSeeder(AppUserRepository users, PasswordHasher hasher,
                       @Value("${app.admin.email:admin@gmail.com}") String adminEmail,
                       @Value("${app.admin.password:}") String adminPassword) {
        this.users = users;
        this.hasher = hasher;
        this.adminEmail = adminEmail.trim().toLowerCase();
        this.adminPassword = adminPassword;
    }

    @Override
    public void run(String... args) {
        if (users.existsByEmail(adminEmail)) return;

        String password = adminPassword;
        if (password == null || password.isBlank()) {
            password = randomPassword();
            log.warn("app.admin.password is not set — generated a random admin password for '{}': {}  "
                    + "(set APP_ADMIN_PASSWORD to control it; this is logged once at seed time only)",
                    adminEmail, password);
        }

        AppUser admin = new AppUser();
        admin.setEmail(adminEmail);
        admin.setPasswordHash(hasher.hash(password));
        admin.setDisplayName("Administrator");
        admin.setRole(Role.ADMIN);
        admin.setAccessGranted(true);
        admin.setFreeGuessesUsed(0);
        users.save(admin);
        log.info("Seeded the admin account: {}", adminEmail);
    }

    private static String randomPassword() {
        byte[] b = new byte[18];
        new SecureRandom().nextBytes(b);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(b);
    }
}
