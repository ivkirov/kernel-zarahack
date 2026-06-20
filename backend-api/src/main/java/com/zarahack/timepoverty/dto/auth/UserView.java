package com.zarahack.timepoverty.dto.auth;

import com.zarahack.timepoverty.entity.AppUser;
import com.zarahack.timepoverty.security.Features;

/** Safe projection of an account (never exposes the password hash). */
public class UserView {
    public Long id;
    public String email;
    public String displayName;
    public String role;
    public boolean accessGranted;
    /** True once a paid-tier account is usable (granted), or for free/admin. */
    public boolean active;
    public int freeGuessesUsed;
    public int freeGuessLimit;
    public Integer freeGuessesRemaining;   // null = unlimited (paid/admin)

    public static UserView of(AppUser u) {
        UserView v = new UserView();
        v.id = u.getId();
        v.email = u.getEmail();
        v.displayName = u.getDisplayName();
        v.role = u.getRole().name();
        v.accessGranted = u.isAccessGranted();
        v.active = Features.hasGrant(u);
        v.freeGuessesUsed = u.getFreeGuessesUsed();
        v.freeGuessLimit = Features.FREE_GUESS_LIMIT;
        v.freeGuessesRemaining = Features.isFree(u)
                ? Math.max(0, Features.FREE_GUESS_LIMIT - u.getFreeGuessesUsed())
                : null;
        return v;
    }
}
