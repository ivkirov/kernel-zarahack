package com.zarahack.timepoverty.service;

public final class GeoUtil {
    private static final double EARTH_RADIUS_KM = 6371.0088;

    private GeoUtil() {}

    /** Great-circle distance in kilometers. */
    public static double haversineKm(double lat1, double lon1, double lat2, double lon2) {
        double dLat = Math.toRadians(lat2 - lat1);
        double dLon = Math.toRadians(lon2 - lon1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                 + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
                 * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    /** One-way travel time in minutes given an assumed speed (km/h). */
    public static double travelMinutes(double km, double speedKmh) {
        return (km / speedKmh) * 60.0;
    }
}
