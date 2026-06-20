package com.zarahack.timepoverty.config;

import com.zarahack.timepoverty.entity.AppUser;
import com.zarahack.timepoverty.entity.Role;
import com.zarahack.timepoverty.repository.AppUserRepository;
import com.zarahack.timepoverty.security.PasswordHasher;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

/**
 * Guarantees the single, hardcoded admin account exists on every machine /
 * fresh database. There is exactly one admin — its credentials are fixed here,
 * not configurable, and no other account may be promoted to ADMIN (the admin
 * panel hides that role).
 */
@Component
public class AdminSeeder implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(AdminSeeder.class);

    // The one and only admin.
    private static final String ADMIN_EMAIL = "admin@gmail.com";
    private static final String ADMIN_PASSWORD = "P4$$w0rd!";

    private final AppUserRepository users;
    private final PasswordHasher hasher;

    public AdminSeeder(AppUserRepository users, PasswordHasher hasher) {
        this.users = users;
        this.hasher = hasher;
    }

    @Override
    public void run(String... args) {
        if (users.existsByEmail(ADMIN_EMAIL)) return;
        AppUser admin = new AppUser();
        admin.setEmail(ADMIN_EMAIL);
        admin.setPasswordHash(hasher.hash(ADMIN_PASSWORD));
        admin.setDisplayName("Administrator");
        admin.setRole(Role.ADMIN);
        admin.setAccessGranted(true);
        admin.setFreeGuessesUsed(0);
        users.save(admin);
        log.info("Seeded the admin account: {}", ADMIN_EMAIL);
    }
}
