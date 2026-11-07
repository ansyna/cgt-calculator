package com.cgtcalculator.platform.monitoring;

import java.util.Map;
import java.util.regex.Pattern;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import io.sentry.Breadcrumb;
import io.sentry.SentryEvent;
import io.sentry.SentryOptions;
import io.sentry.protocol.Message;
import io.sentry.protocol.Request;
import io.sentry.protocol.SentryException;

/**
 * Error reports leave out secrets and people: one-time tokens in URLs, email addresses in
 * messages, cookies and authorization headers. (IP addresses and users are not sent at all: send-default-pii.)
 */
@Configuration
public class SentryConfig {

    private static final Pattern SECRET_PARAM = Pattern.compile("((?:^|[?&])(?:token|key|apikey)=)[^&#\\s\"]*", Pattern.CASE_INSENSITIVE);
    private static final Pattern EMAIL = Pattern.compile("[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}");

    /** Masks token-like URL parameters and email addresses. */
    public static String scrub(String text) {
        if (text == null) {
            return null;
        }
        return EMAIL.matcher(SECRET_PARAM.matcher(text).replaceAll("$1***")).replaceAll("[email]");
    }

    @Bean
    SentryOptions.BeforeSendCallback scrubEvent() {
        return (event, hint) -> scrub(event);
    }

    @Bean
    SentryOptions.BeforeBreadcrumbCallback scrubBreadcrumb() {
        return (breadcrumb, hint) -> scrub(breadcrumb);
    }

    static SentryEvent scrub(SentryEvent event) {
        Message message = event.getMessage();
        if (message != null) {
            message.setFormatted(scrub(message.getFormatted()));
            message.setMessage(scrub(message.getMessage()));
            if (message.getParams() != null) {
                message.setParams(message.getParams().stream().map(SentryConfig::scrub).toList());
            }
        }
        if (event.getExceptions() != null) {
            for (SentryException exception : event.getExceptions()) {
                exception.setValue(scrub(exception.getValue()));
            }
        }
        if (event.getBreadcrumbs() != null) {
            event.getBreadcrumbs().forEach(SentryConfig::scrub);
        }
        Request request = event.getRequest();
        if (request != null) {
            request.setQueryString(scrub(request.getQueryString()));
            request.setUrl(scrub(request.getUrl()));
            request.setCookies(null);
            if (request.getHeaders() != null) {
                request.getHeaders().keySet().removeIf(name -> name.equalsIgnoreCase("authorization")
                        || name.equalsIgnoreCase("cookie"));
            }
        }
        if (event.getRelease() != null && event.getRelease().isBlank()) {
            event.setRelease(null);
        }
        return event;
    }

    static Breadcrumb scrub(Breadcrumb breadcrumb) {
        breadcrumb.setMessage(scrub(breadcrumb.getMessage()));
        Map<String, Object> data = breadcrumb.getData();
        data.replaceAll((key, value) -> value instanceof String text ? scrub(text) : value);
        return breadcrumb;
    }
}
