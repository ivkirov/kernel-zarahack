package com.zarahack.timepoverty.config;

import org.springframework.context.annotation.*;
import org.springframework.web.servlet.config.annotation.*;

@Configuration
public class CorsConfig implements WebMvcConfigurer {
    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                // Explicit origins only (the dev frontend + the OpenKBS proxy subdomains).
                .allowedOriginPatterns("http://localhost:5500", "http://127.0.0.1:5500",
                                       "http://localhost:7001", "http://127.0.0.1:7001",
                                       "https://*.vs2.openkbs.com")
                .allowedMethods("GET", "POST", "PATCH", "OPTIONS")
                // Only the headers the client actually sends — not a blanket "*".
                .allowedHeaders("Authorization", "Content-Type")
                // Auth is a stateless bearer token, never a cookie, so credentials
                // (cookies / basic auth) are intentionally NOT allowed cross-origin.
                .allowCredentials(false)
                .maxAge(3600);
    }
}
