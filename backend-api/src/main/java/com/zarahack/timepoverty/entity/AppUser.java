package com.zarahack.timepoverty.entity;

import jakarta.persistence.*;
import java.time.OffsetDateTime;

/**
 * An application account. Drives roles, paid tiers and usage-based limits.
 *
 * Schema is owned by the Python data-engine (00b_create_auth_schema.py); JPA
 * runs with ddl-auto=validate and never mutates it.
 */
@Entity
@Table(name = "app_users")
public class AppUser {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true)
    private String email;

    @Column(name = "password_hash", nullable = false)
    private String passwordHash;

    @Column(name = "display_name")
    private String displayName;

    /** ADMIN | FREE_USER | PAID_USER | REPORTER | MUNICIPALITY */
    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Role role;

    /** Paid access activated by an admin. Irrelevant for FREE_USER / ADMIN. */
    @Column(name = "access_granted", nullable = false)
    private boolean accessGranted;

    /** Usage counter for the free tier's relocation checks. */
    @Column(name = "free_guesses_used", nullable = false)
    private int freeGuessesUsed;

    @Column(name = "created_at", insertable = false, updatable = false)
    private OffsetDateTime createdAt;

    // --- getters / setters ---
    public Long getId() { return id; }
    public String getEmail() { return email; }
    public void setEmail(String v) { this.email = v; }
    public String getPasswordHash() { return passwordHash; }
    public void setPasswordHash(String v) { this.passwordHash = v; }
    public String getDisplayName() { return displayName; }
    public void setDisplayName(String v) { this.displayName = v; }
    public Role getRole() { return role; }
    public void setRole(Role v) { this.role = v; }
    public boolean isAccessGranted() { return accessGranted; }
    public void setAccessGranted(boolean v) { this.accessGranted = v; }
    public int getFreeGuessesUsed() { return freeGuessesUsed; }
    public void setFreeGuessesUsed(int v) { this.freeGuessesUsed = v; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
}
