package com.cgtcalculator.platform.monitoring;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * What the browser needs to report its own errors to Sentry.
 *
 * @param frontendDsn Sentry DSN for the React app (SENTRY_FRONTEND_DSN, else SENTRY_DSN); empty turns reporting off
 * @param environment SENTRY_ENVIRONMENT, e.g. production
 * @param release     the deployed commit (Render's RENDER_GIT_COMMIT)
 */
@ConfigurationProperties(prefix = "app.monitoring")
public record MonitoringProperties(String frontendDsn, String environment, String release) {

    public MonitoringProperties {
        frontendDsn = frontendDsn == null ? "" : frontendDsn.trim();
        environment = environment == null ? "" : environment.trim();
        release = release == null ? "" : release.trim();
    }
}
