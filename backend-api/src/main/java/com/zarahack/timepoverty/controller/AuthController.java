package com.zarahack.timepoverty.controller;

import com.zarahack.timepoverty.dto.auth.*;
import com.zarahack.timepoverty.security.CurrentUser;
import com.zarahack.timepoverty.service.AuthService;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    private final AuthService auth;

    public AuthController(AuthService auth) {
        this.auth = auth;
    }

    @PostMapping("/register")
    public AuthResponse register(@RequestBody RegisterRequest req) {
        return auth.register(req);
    }

    @PostMapping("/login")
    public AuthResponse login(@RequestBody LoginRequest req) {
        return auth.login(req);
    }

    /** Current account (used by the frontend to bootstrap role-aware UI on load). */
    @GetMapping("/me")
    public UserView me() {
        return UserView.of(CurrentUser.require());
    }
}
