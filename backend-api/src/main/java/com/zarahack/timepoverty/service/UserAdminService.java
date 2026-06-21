package com.zarahack.timepoverty.service;

import com.zarahack.timepoverty.dto.auth.UpdateUserRequest;
import com.zarahack.timepoverty.dto.auth.UserView;
import com.zarahack.timepoverty.entity.AppUser;
import com.zarahack.timepoverty.entity.Role;
import com.zarahack.timepoverty.repository.AppUserRepository;
import com.zarahack.timepoverty.security.AuthException;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class UserAdminService {

    private final AppUserRepository users;

    public UserAdminService(AppUserRepository users) {
        this.users = users;
    }

    public List<UserView> list() {
        return users.findAll(Sort.by(Sort.Direction.DESC, "id")).stream().map(UserView::of).toList();
    }

    public UserView update(Long id, UpdateUserRequest req) {
        AppUser u = users.findById(id)
                .orElseThrow(() -> new AuthException(404, "USER_NOT_FOUND", "No such user."));

        // The seeded admin is immutable through the API. "Exactly one admin" is an
        // invariant, so an existing admin can't be demoted or have its grant flipped
        // (which would also let a hijacked admin session lock out the real one).
        if (u.getRole() == Role.ADMIN) {
            throw new AuthException(403, "ADMIN_IMMUTABLE", "The admin account cannot be edited.");
        }

        if (req.role != null && !req.role.isBlank()) {
            Role role;
            try {
                role = Role.valueOf(req.role.trim().toUpperCase());
            } catch (IllegalArgumentException e) {
                throw new AuthException(400, "BAD_ROLE", "Unknown role: " + req.role);
            }
            // No account may be promoted to ADMIN via the API — there is exactly one,
            // seeded from configuration. This is enforced here, not merely hidden in
            // the UI, so a forged/scripted request can't escalate to admin.
            if (role == Role.ADMIN) {
                throw new AuthException(403, "ADMIN_FORBIDDEN", "Accounts cannot be promoted to admin.");
            }
            u.setRole(role);
        }
        if (req.accessGranted != null) {
            u.setAccessGranted(req.accessGranted);
        }
        return UserView.of(users.save(u));
    }
}
