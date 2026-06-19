package com.zarahack.timepoverty;

import com.zarahack.timepoverty.service.GeoUtil;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class GeoUtilTest {

    @Test
    void zeroDistanceForSamePoint() {
        double km = GeoUtil.haversineKm(42.192, 24.333, 42.192, 24.333);
        assertEquals(0.0, km, 1e-9);
    }

    @Test
    void haversineMatchesKnownDistance() {
        // Pazardzhik town -> Plovdiv center is ~36 km great-circle.
        double km = GeoUtil.haversineKm(42.192, 24.333, 42.143, 24.749);
        assertTrue(km > 30 && km < 42, "expected ~36 km, got " + km);
    }

    @Test
    void travelMinutesScalesWithSpeed() {
        // 4.5 km at 4.5 km/h == exactly 60 minutes one-way.
        assertEquals(60.0, GeoUtil.travelMinutes(4.5, 4.5), 1e-9);
        // Halving the distance halves the time.
        assertEquals(30.0, GeoUtil.travelMinutes(2.25, 4.5), 1e-9);
    }
}
