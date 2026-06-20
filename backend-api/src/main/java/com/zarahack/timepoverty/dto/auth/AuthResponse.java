package com.zarahack.timepoverty.dto.auth;

public class AuthResponse {
    public String token;
    public UserView user;

    public AuthResponse(String token, UserView user) {
        this.token = token;
        this.user = user;
    }
}
