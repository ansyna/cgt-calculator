package com.cgtcalculator.platform.monitoring;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.env.Environment;
import org.springframework.test.context.ActiveProfiles;

/** A mistyped SENTRY_DSN once stopped the app from starting; now it only turns error reporting off. */
@SpringBootTest(properties = "sentry.dsn=dsn: not a dsn", webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class UnusableSentryDsnTest {

    @Autowired
    private Environment environment;

    @Autowired
    private MonitoringProperties monitoring;

    @Test
    void theAppStartsWithErrorReportingOff() {
        assertThat(environment.getProperty("sentry.dsn")).isEmpty();
        assertThat(monitoring.frontendDsn()).isEmpty();
    }
}
