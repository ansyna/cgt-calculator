package com.cgtcalculator.platform.monitoring;

import java.io.IOException;
import java.util.UUID;
import java.util.regex.Pattern;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * Gives every request an id (in the logs, the X-Request-Id response header, error messages and Sentry reports)
 * and logs one line per API call: method, path, status and time taken. Tokens in query strings are masked.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class RequestLogFilter extends OncePerRequestFilter {

    public static final String HEADER = "X-Request-Id";
    public static final String MDC_KEY = "requestId";

    private static final Logger log = LoggerFactory.getLogger("requests");
    private static final Pattern SAFE_ID = Pattern.compile("[A-Za-z0-9-]{1,64}");
    private static final Pattern SECRET_PARAM = Pattern.compile("((?:^|&)(?:token|key|apikey)=)[^&]*", Pattern.CASE_INSENSITIVE);

    /** The query string with the values of token-like parameters replaced. */
    public static String mask(String query) {
        return query == null ? null : SECRET_PARAM.matcher(query).replaceAll("$1***");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String incoming = request.getHeader(HEADER);
        String id = incoming != null && SAFE_ID.matcher(incoming).matches()
                ? incoming : UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        MDC.put(MDC_KEY, id);
        response.setHeader(HEADER, id);
        long start = System.nanoTime();
        try {
            chain.doFilter(request, response);
        } finally {
            String path = request.getRequestURI();
            if (path.startsWith("/api/")) {
                long millis = (System.nanoTime() - start) / 1_000_000;
                String query = mask(request.getQueryString());
                int status = response.getStatus();
                String line = "{} {}{} {} {}ms";
                Object[] args = {request.getMethod(), path, query == null ? "" : "?" + query, status, millis};
                if (status >= 500) {
                    log.warn(line, args);
                } else {
                    log.info(line, args);
                }
            }
            MDC.remove(MDC_KEY);
        }
    }
}
