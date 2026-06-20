package com.zarahack.timepoverty.security;

import com.zarahack.timepoverty.entity.AppUser;
import com.zarahack.timepoverty.entity.Role;

/**
 * Per-request holder for the authenticated account, set by {@link AuthFilter}
 * and read by controllers/services. Cleared after every request.
 */
public final class CurrentUser {

    private static final ThreadLocal<AppUser> HOLDER = new ThreadLocal<>();

    private CurrentUser() {}

    static void set(AppUser u) { HOLDER.set(u); }
    static void clear() { HOLDER.remove(); }

    /** The authenticated user, or null when the request is anonymous. */
    public static AppUser get() { return HOLDER.get(); }

    /** The authenticated user or a 401 if the request is anonymous. */
    public static AppUser require() {
        AppUser u = HOLDER.get();
        if (u == null) throw new AuthException(401, "UNAUTHENTICATED", "Sign in to continue.");
        return u;
    }

    public static boolean isAdmin() {
        AppUser u = HOLDER.get();
        return u != null && u.getRole() == Role.ADMIN;
    }
}
