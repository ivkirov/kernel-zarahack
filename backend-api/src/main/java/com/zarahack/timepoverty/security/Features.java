package com.zarahack.timepoverty.security;

import com.zarahack.timepoverty.entity.AppUser;
import com.zarahack.timepoverty.entity.Role;

import java.util.Set;

/**
 * Single source of truth for role/tier/quota gating, shared by every feature
 * endpoint. Keeps the policy in one place rather than scattered across controllers.
 */
public final class Features {

    private Features() {}

    /** Free relocation checks allowed before the paywall kicks in. */
    public static final int FREE_GUESS_LIMIT = 3;

    /**
     * Amenities a FREE_USER may filter/compare by. Everything else (kindergarten
     * today; gyms, barbers, … later) is shown-but-locked behind the paywall.
     * Mirrors the frontend's TPM.FREE_ALLOWED_AMENITIES.
     */
    public static final Set<String> FREE_ALLOWED_AMENITIES =
            Set.of("school", "clinic", "hospital", "pharmacy");

    /** Whether a paid-tier role has had its access activated by an admin. */
    public static boolean hasGrant(AppUser u) {
        return u.getRole() == Role.ADMIN || !u.getRole().requiresGrant() || u.isAccessGranted();
    }

    // ---- lens entitlements (admin may use every lens) ----
    public static boolean canMunicipal(AppUser u) {
        return u.getRole() == Role.ADMIN || (u.getRole() == Role.MUNICIPALITY && u.isAccessGranted());
    }
    public static boolean canReporter(AppUser u) {
        return u.getRole() == Role.ADMIN || (u.getRole() == Role.REPORTER && u.isAccessGranted());
    }
    public static boolean canPersonal(AppUser u) {
        return u.getRole() == Role.ADMIN || u.getRole() == Role.FREE_USER || u.getRole() == Role.PAID_USER;
    }
    /** Paid personal extras: AI explanation, area suggestions, full filter set. */
    public static boolean hasPaidPersonal(AppUser u) {
        return u.getRole() == Role.ADMIN || (u.getRole() == Role.PAID_USER && u.isAccessGranted());
    }
    public static boolean isFree(AppUser u) {
        return u.getRole() == Role.FREE_USER;
    }
}
