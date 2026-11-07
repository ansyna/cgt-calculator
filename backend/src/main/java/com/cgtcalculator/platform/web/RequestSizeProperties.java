package com.cgtcalculator.platform.web;

import java.util.Map;

import org.jspecify.annotations.Nullable;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.util.unit.DataSize;

/**
 * Request body limits (app.request-size).
 *
 * @param largeBodies paths that may take more than the usual 64 KB, and how much
 */
@ConfigurationProperties(prefix = "app.request-size")
public record RequestSizeProperties(@Nullable Map<String, DataSize> largeBodies) {

    public RequestSizeProperties {
        largeBodies = largeBodies == null ? Map.of() : Map.copyOf(largeBodies);
    }
}
