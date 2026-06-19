package com.zarahack.timepoverty.entity;

import jakarta.persistence.*;

@Entity
@Table(name = "infrastructure_nodes")
public class InfrastructureNode {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "osm_id")        private Long osmId;
    @Column(name = "service_type")  private String serviceType;
    @Column(name = "amenity_raw")   private String amenityRaw;
    private String name;
    private Double lat;
    private Double lon;
    private String district;
    @Column(name = "is_simulated")  private boolean simulated;

    // --- getters / setters ---
    public Long getId() { return id; }
    public String getServiceType() { return serviceType; }
    public String getName() { return name; }
    public Double getLat() { return lat; }
    public Double getLon() { return lon; }
    public String getDistrict() { return district; }
    public boolean isSimulated() { return simulated; }
    public void setServiceType(String s) { this.serviceType = s; }
    public void setLat(Double v) { this.lat = v; }
    public void setLon(Double v) { this.lon = v; }
    public void setDistrict(String d) { this.district = d; }
    public void setSimulated(boolean b) { this.simulated = b; }
}
