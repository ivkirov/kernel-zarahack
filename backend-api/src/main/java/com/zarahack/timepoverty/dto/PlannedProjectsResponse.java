package com.zarahack.timepoverty.dto;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Civic Accountability Radar (Pillar 3): planned municipal builds from the AOP cache. */
public class PlannedProjectsResponse {
    public boolean available;                         // false until the scraper table exists
    public int total;
    public Map<String, Integer> byAmenity = new LinkedHashMap<>();
    public List<Project> projects = new java.util.ArrayList<>();

    public static class Project {
        public String procurementNumber;
        public String buyerName;
        public String projectName;
        public String amenityType;
        public String scrapedAt;
        public Double lat;          // build location (municipality centroid) — may be null
        public Double lon;
        public String district;     // Latin province name, for the ML optimal-site lookup
    }
}
