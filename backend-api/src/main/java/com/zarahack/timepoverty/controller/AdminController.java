package com.zarahack.timepoverty.controller;

import com.zarahack.timepoverty.dto.auth.UpdateUserRequest;
import com.zarahack.timepoverty.dto.auth.UserView;
import com.zarahack.timepoverty.security.AuthException;
import com.zarahack.timepoverty.security.CurrentUser;
import com.zarahack.timepoverty.service.RadarScrapeService;
import com.zarahack.timepoverty.service.UserAdminService;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/** Admin-only settings: user management + Civic Radar scraper control. */
@RestController
@RequestMapping("/api/v1/admin")
public class AdminController {

    private final UserAdminService userAdmin;
    private final RadarScrapeService radarScrape;

    public AdminController(UserAdminService userAdmin, RadarScrapeService radarScrape) {
        this.userAdmin = userAdmin;
        this.radarScrape = radarScrape;
    }

    private void requireAdmin() {
        CurrentUser.require();
        if (!CurrentUser.isAdmin()) {
            throw new AuthException(403, "FORBIDDEN", "Admins only.");
        }
    }

    @GetMapping("/users")
    public List<UserView> users() {
        requireAdmin();
        return userAdmin.list();
    }

    @PatchMapping("/users/{id}")
    public UserView update(@PathVariable Long id, @RequestBody UpdateUserRequest req) {
        requireAdmin();
        return userAdmin.update(id, req);
    }

    // ---- Civic Radar scraper control ----

    /** Trigger a one-shot scrape on demand (the normal cadence is bi-weekly). */
    @PostMapping("/radar/scrape")
    public RadarScrapeService.Status forceScrape() {
        requireAdmin();
        return radarScrape.trigger();
    }

    /** Poll the status of the current/last force scrape. */
    @GetMapping("/radar/scrape")
    public RadarScrapeService.Status scrapeStatus() {
        requireAdmin();
        return radarScrape.status();
    }
}
