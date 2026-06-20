package com.zarahack.timepoverty.security;

/**
 * Carries an HTTP status + a machine-readable {@code code} the frontend keys on
 * (e.g. PAYWALL_QUOTA, PAYWALL_FILTER, ACCESS_PENDING) to drive paywall modals.
 */
public class AuthException extends RuntimeException {
    private final int status;
    private final String code;

    public AuthException(int status, String code, String message) {
        super(message);
        this.status = status;
        this.code = code;
    }

    public int getStatus() { return status; }
    public String getCode() { return code; }
}
