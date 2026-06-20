package com.zarahack.timepoverty.service;

import com.zarahack.timepoverty.dto.PlannedProjectsResponse;
import org.springframework.jdbc.BadSqlGrammarException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;

/**
 * Reads the AOP scraper's cache table (planned_municipal_projects) for the Radar UI.
 * Uses JdbcTemplate (not JPA) so a not-yet-created table can't break app start-up:
 * the table is owned by the Python scraper and may be absent until its first write.
 */
@Service
public class RadarService {

    private final JdbcTemplate jdbc;

    public RadarService(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public PlannedProjectsResponse plannedProjects(String amenity) {
        PlannedProjectsResponse out = new PlannedProjectsResponse();
        String base = "SELECT procurement_number, buyer_name, project_name, amenity_type, scraped_at, "
                    + "lat, lon, district FROM planned_municipal_projects";
        boolean filtered = amenity != null && !amenity.isBlank() && !amenity.equalsIgnoreCase("all");

        try {
            List<Map<String, Object>> rows = filtered
                ? jdbc.queryForList(base + " WHERE amenity_type = ? ORDER BY scraped_at DESC", amenity)
                : jdbc.queryForList(base + " ORDER BY scraped_at DESC");

            for (Map<String, Object> r : rows) {
                PlannedProjectsResponse.Project p = new PlannedProjectsResponse.Project();
                p.procurementNumber = str(r.get("procurement_number"));
                p.buyerName        = str(r.get("buyer_name"));
                p.projectName      = str(r.get("project_name"));
                p.amenityType      = str(r.get("amenity_type"));
                p.scrapedAt        = str(r.get("scraped_at"));
                p.lat              = dbl(r.get("lat"));
                p.lon              = dbl(r.get("lon"));
                p.district         = str(r.get("district"));
                out.projects.add(p);
                if (p.amenityType != null) out.byAmenity.merge(p.amenityType, 1, Integer::sum);
            }
            out.total = out.projects.size();
            out.available = true;
        } catch (BadSqlGrammarException notCreatedYet) {
            // Scraper hasn't written its first batch — table doesn't exist. Empty, not an error.
            out.available = false;
        }
        return out;
    }

    private static String str(Object o) { return o == null ? null : o.toString(); }
    private static Double dbl(Object o) { return o == null ? null : ((Number) o).doubleValue(); }
}
