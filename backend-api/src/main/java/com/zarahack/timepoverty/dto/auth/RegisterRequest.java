package com.zarahack.timepoverty.dto.auth;

public class RegisterRequest {
    public String email;
    public String password;
    public String displayName;
    /** Self-selected persona at signup: "individual" | "reporter" | "municipality". */
    public String persona;
}
