package com.zarahack.timepoverty.dto;

public class SimulationRequest {
    public String district;
    public double lat;
    public double lon;
    public String amenityType;   // kindergarten|school|hospital|clinic|pharmacy
    public String townName;      // optional: nearest settlement label, for the AI site write-up
    public String language;      // optional UI locale ("bg" | "en") for the AI explanation
    public boolean explain;      // when true, attach an AI good/bad-site explanation
}
