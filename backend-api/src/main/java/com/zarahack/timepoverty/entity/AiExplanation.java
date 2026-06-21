package com.zarahack.timepoverty.entity;

import jakarta.persistence.*;
import java.time.OffsetDateTime;

/**
 * A cached AI explanation, keyed by a hash of the spot + the household's filters.
 *
 * The text depends only on those inputs (never on who asked), so one row serves
 * every user who requests the same place with the same needs/car/language. The
 * first request generates and stores it; everyone after reads it back.
 *
 * Schema is owned by the Python data-engine (00c_create_ai_cache_schema.py); JPA
 * runs with ddl-auto=validate and never mutates it.
 */
@Entity
@Table(name = "ai_explanation_cache")
public class AiExplanation {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** sha256 hex of the canonical "kind|lat|lon|needs|has_car|language". */
    @Column(name = "cache_key", nullable = false, unique = true)
    private String cacheKey;

    /** Explanation family — currently only "personal_area". */
    @Column(nullable = false)
    private String kind;

    @Column(nullable = false)
    private double lat;

    @Column(nullable = false)
    private double lon;

    /** Sorted, comma-joined needs the text was grounded on (debug/readability). */
    @Column
    private String needs;

    @Column(name = "has_car")
    private Boolean hasCar;

    @Column
    private String language;

    @Column(nullable = false)
    private String explanation;

    @Column(name = "created_at", insertable = false, updatable = false)
    private OffsetDateTime createdAt;

    protected AiExplanation() { }   // JPA

    public AiExplanation(String cacheKey, String kind, double lat, double lon,
                         String needs, Boolean hasCar, String language, String explanation) {
        this.cacheKey = cacheKey;
        this.kind = kind;
        this.lat = lat;
        this.lon = lon;
        this.needs = needs;
        this.hasCar = hasCar;
        this.language = language;
        this.explanation = explanation;
    }

    public Long getId() { return id; }
    public String getCacheKey() { return cacheKey; }
    public String getKind() { return kind; }
    public double getLat() { return lat; }
    public double getLon() { return lon; }
    public String getNeeds() { return needs; }
    public Boolean getHasCar() { return hasCar; }
    public String getLanguage() { return language; }
    public String getExplanation() { return explanation; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
}
