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
        if (req.role != null && !req.role.isBlank()) {
            try {
                u.setRole(Role.valueOf(req.role.trim().toUpperCase()));
            } catch (IllegalArgumentException e) {
                throw new AuthException(400, "BAD_ROLE", "Unknown role: " + req.role);
            }
        }
        if (req.accessGranted != null) {
            u.setAccessGranted(req.accessGranted);
        }
        return UserView.of(users.save(u));
    }
}
