package com.zarahack.timepoverty.controller;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * Reports the commit this backend was deployed from. Public by design — the
 * AuthFilter never rejects and this endpoint never calls CurrentUser.require().
 * Reads the deploy stamp written by scripts/deploy.sh and streams it back
 * verbatim (already valid JSON); absent/blank/unreadable path (e.g. a local run
 * with no deploy) yields {"status":"unknown"} rather than a 500. Returning the
 * raw string keeps this free of any JSON-mapper dependency.
 */
@RestController
@RequestMapping("/api/v1/version")
public class VersionController {

    private static final String UNKNOWN = "{\"status\":\"unknown\"}";

    @Value("${app.deploy-stamp-path:}")
    private String stampPath;

    @GetMapping(produces = MediaType.APPLICATION_JSON_VALUE)
    public String version() {
        if (stampPath != null && !stampPath.isBlank()) {
            Path p = Path.of(stampPath);
            if (Files.isReadable(p)) {
                try {
                    String body = Files.readString(p, StandardCharsets.UTF_8).trim();
                    if (!body.isEmpty()) {
                        return body;
                    }
                } catch (Exception ignored) {
                    // fall through to unknown
                }
            }
        }
        return UNKNOWN;
    }
}
