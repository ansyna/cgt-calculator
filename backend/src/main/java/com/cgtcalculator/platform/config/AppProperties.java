package com.cgtcalculator.platform.config;

import java.util.List;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "app")
public record AppProperties(
        Jwt jwt,
        Admin admin,
        Cors cors,
        String contactEmail) {

    public record Jwt(String secret, long expirationMinutes) {
    }

    public record Admin(String name, String email, String password) {
    }

    public record Cors(List<String> allowedOrigins) {
    }
}
