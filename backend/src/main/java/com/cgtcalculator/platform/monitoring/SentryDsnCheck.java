package com.cgtcalculator.platform.monitoring;

import java.net.URI;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.apache.commons.logging.Log;
import org.springframework.boot.EnvironmentPostProcessor;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.logging.DeferredLogFactory;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.MapPropertySource;

/**
 * Error reporting is optional, so its setting must never stop the app: Sentry refuses to start with a DSN it can't
 * parse, which took the whole site down. A DSN pasted with quotes or spaces is cleaned; one that still isn't a
 * DSN turns error reporting off, with a warning in the log.
 */
public class SentryDsnCheck implements EnvironmentPostProcessor {

    static final List<String> PROPERTIES = List.of("sentry.dsn", "app.monitoring.frontend-dsn");

    private final Log log;

    public SentryDsnCheck(DeferredLogFactory logFactory) {
        this.log = logFactory.getLog(SentryDsnCheck.class);
    }

    @Override
    public void postProcessEnvironment(ConfigurableEnvironment environment, SpringApplication application) {
        Map<String, Object> corrected = new LinkedHashMap<>();
        for (String property : PROPERTIES) {
            String configured = environment.getProperty(property);
            if (configured == null || configured.isBlank()) {
                continue;
            }
            String cleaned = clean(configured);
            String usable = isDsn(cleaned) ? cleaned : "";
            if (usable.isEmpty()) {
                log.warn(property + " is not a Sentry DSN (https://<key>@<host>/<project>): error reporting is off");
            }
            if (!usable.equals(configured)) {
                corrected.put(property, usable);
            }
        }
        if (!corrected.isEmpty()) {
            environment.getPropertySources().addFirst(new MapPropertySource("sentryDsnCheck", corrected));
        }
    }

    /** Without surrounding spaces or quotes. */
    static String clean(String dsn) {
        String text = dsn.strip();
        while (text.length() >= 2 && (text.startsWith("\"") && text.endsWith("\"") || text.startsWith("'") && text.endsWith("'"))) {
            text = text.substring(1, text.length() - 1).strip();
        }
        return text;
    }

    /** What Sentry accepts: an http(s) address with a public key and a project id, e.g. https://key@o1.ingest.sentry.io/2. */
    static boolean isDsn(String dsn) {
        try {
            URI uri = new URI(dsn);
            String path = uri.getPath();
            return ("https".equalsIgnoreCase(uri.getScheme()) || "http".equalsIgnoreCase(uri.getScheme()))
                    && uri.getHost() != null
                    && uri.getUserInfo() != null && !uri.getUserInfo().split(":", -1)[0].isEmpty()
                    && path != null && path.lastIndexOf('/') >= 0 && !path.substring(path.lastIndexOf('/') + 1).isEmpty();
        } catch (Exception e) {
            return false;
        }
    }
}
