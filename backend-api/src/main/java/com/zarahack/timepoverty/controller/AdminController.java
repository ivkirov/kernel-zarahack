package com.zarahack.timepoverty.controller;

import com.zarahack.timepoverty.dto.auth.UpdateUserRequest;
import com.zarahack.timepoverty.dto.auth.UserView;
import com.zarahack.timepoverty.security.AuthException;
import com.zarahack.timepoverty.security.CurrentUser;
import com.zarahack.timepoverty.service.UserAdminService;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/** Admin-only user management: list accounts, grant paid access, change roles. */
@RestController
@RequestMapping("/api/v1/admin")
public class AdminController {

    private final UserAdminService userAdmin;

    public AdminController(UserAdminService userAdmin) {
        this.userAdmin = userAdmin;
    }

    private void requireAdmin() {
        CurrentUser.require();
        if (!CurrentUser.isAdmin()) {
            throw new AuthException(403, "FORBIDDEN", "Admins only.");
        }
    }

    @GetMapping("/users")
    public List<UserView> users() {
        requireAdmin();
        return userAdmin.list();
    }

    @PatchMapping("/users/{id}")
    public UserView update(@PathVariable Long id, @RequestBody UpdateUserRequest req) {
        requireAdmin();
        return userAdmin.update(id, req);
    }
}
