package com.zarahack.timepoverty.entity;

/**
 * Account roles. The three paid tiers map to dedicated roles:
 *   tier 1 (cheapest)  → PAID_USER     personal planner + AI explanation + suggestions
 *   tier 2             → REPORTER       the Accountability Radar
 *   tier 3 (priciest)  → MUNICIPALITY   the municipal planner (matrix + simulate + recommend)
 *
 * FREE_USER is the unpaid individual (limited filters + a small usage quota).
 * ADMIN can use every lens and manage other accounts.
 */
public enum Role {
    ADMIN,
    FREE_USER,
    PAID_USER,
    REPORTER,
    MUNICIPALITY;

    /** Roles whose feature is gated behind admin-granted paid access. */
    public boolean requiresGrant() {
        return this == PAID_USER || this == REPORTER || this == MUNICIPALITY;
    }
}
