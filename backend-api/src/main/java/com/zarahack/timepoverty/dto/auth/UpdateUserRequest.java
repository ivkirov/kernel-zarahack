package com.zarahack.timepoverty.dto.auth;

/** Admin edit of an account. Null fields are left unchanged. */
public class UpdateUserRequest {
    public String role;            // ADMIN | FREE_USER | PAID_USER | REPORTER | MUNICIPALITY
    public Boolean accessGranted;  // activate/deactivate paid access
}
