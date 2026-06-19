package com.zarahack.timepoverty.entity;

import jakarta.persistence.*;

@Entity
@Table(name = "demographic_weights")
public class DemographicWeight {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "cell_id")   private String cellId;
    private String settlement;
    private String district;
    private Double lat;
    private Double lon;
    @Column(name = "group_key") private String groupKey;
    private Integer population;

    public String getCellId() { return cellId; }
    public String getSettlement() { return settlement; }
    public String getDistrict() { return district; }
    public Double getLat() { return lat; }
    public Double getLon() { return lon; }
    public String getGroupKey() { return groupKey; }
    public Integer getPopulation() { return population; }
}
