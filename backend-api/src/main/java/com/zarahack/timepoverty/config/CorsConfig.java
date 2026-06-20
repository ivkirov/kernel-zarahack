package com.zarahack.timepoverty.config;

import org.springframework.context.annotation.*;
import org.springframework.web.servlet.config.annotation.*;

@Configuration
public class CorsConfig implements WebMvcConfigurer {
    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOriginPatterns("http://localhost:5500", "http://127.0.0.1:5500",
                                       "http://localhost:7001", "http://127.0.0.1:7001",
                                       "https://*.vs2.openkbs.com")
                .allowedMethods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
                .allowedHeaders("*");   // includes the Authorization bearer header
    }
}
