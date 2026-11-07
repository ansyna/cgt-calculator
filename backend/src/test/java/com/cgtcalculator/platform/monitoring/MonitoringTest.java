package com.cgtcalculator.platform.monitoring;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;

import com.cgtcalculator.platform.web.ApiExceptionHandler;

import io.sentry.Breadcrumb;
import io.sentry.SentryEvent;
import io.sentry.protocol.Message;
import io.sentry.protocol.Request;
import io.sentry.protocol.SentryException;

class MonitoringTest {

    @AfterEach
    void clear() {
        MDC.clear();
    }

    @Test
    void logsMaskTokensInQueryStrings() {
        assertThat(RequestLogFilter.mask("token=abc&ticker=AAPL")).isEqualTo("token=***&ticker=AAPL");
        assertThat(RequestLogFilter.mask("ticker=AAPL&apikey=k")).isEqualTo("ticker=AAPL&apikey=***");
        assertThat(RequestLogFilter.mask("ticker=AAPL")).isEqualTo("ticker=AAPL");
        assertThat(RequestLogFilter.mask(null)).isNull();
    }

    @Test
    void errorReportsLeaveOutKeysTokensAndEmails() {
        SentryEvent event = new SentryEvent();
        Message message = new Message();
        message.setFormatted("Could not send \"Reset\" to ivy@example.com");
        message.setParams(List.of("ivy@example.com"));
        event.setMessage(message);
        SentryException exception = new SentryException();
        exception.setValue("Key (email)=(ann@example.com) already exists");
        event.setExceptions(List.of(exception));
        Request request = new Request();
        request.setUrl("https://screener.example/api/auth/invitation?token=secret1");
        request.setQueryString("token=secret1");
        request.setCookies("ss_refresh=abc");
        request.setHeaders(new java.util.HashMap<>(Map.of("Authorization", "Bearer x", "Accept", "json")));
        event.setRequest(request);
        // as Sentry records an outgoing request to an API with a key
        Breadcrumb http = Breadcrumb.http("https://api.example.com/v3/quote/AAPL?apikey=k3y", "GET");
        Breadcrumb raw = new Breadcrumb();
        raw.setData("url", "https://api.example.com/v3/quote/AAPL?apikey=k3y");
        event.setBreadcrumbs(List.of(http, raw));
        event.setRelease("");

        SentryConfig.scrub(event);

        assertThat(event.getMessage().getFormatted()).isEqualTo("Could not send \"Reset\" to [email]");
        assertThat(event.getMessage().getParams()).containsExactly("[email]");
        assertThat(event.getExceptions().get(0).getValue()).isEqualTo("Key (email)=([email]) already exists");
        assertThat(event.getRequest().getUrl()).isEqualTo("https://screener.example/api/auth/invitation?token=***");
        assertThat(event.getRequest().getQueryString()).isEqualTo("token=***");
        assertThat(event.getRequest().getCookies()).isNull();
        assertThat(event.getRequest().getHeaders()).containsOnlyKeys("Accept");
        assertThat(http.getData()).containsEntry("http.query", "apikey=***");
        assertThat(raw.getData()).containsEntry("url", "https://api.example.com/v3/quote/AAPL?apikey=***");
        assertThat(event.getRelease()).isNull();
    }

    @Test
    void breadcrumbsFromLogLinesLeaveOutEmails() {
        Breadcrumb log = new Breadcrumb("Created initial admin user admin@example.com");
        assertThat(SentryConfig.scrub(log).getMessage()).isEqualTo("Created initial admin user [email]");
    }

    @Test
    void serverErrorsGiveAReferenceToLookUp() {
        MDC.put(RequestLogFilter.MDC_KEY, "a1b2c3");
        var response = new ApiExceptionHandler().handleOther(new IllegalStateException("boom"));
        assertThat(response.getStatusCode().value()).isEqualTo(500);
        assertThat(response.getBody().message()).isEqualTo("Server error (reference a1b2c3)");
    }

    @Test
    void aSentryDsnPastedWithQuotesIsCleanedAndAnUnusableOneIgnored() {
        assertThat(SentryDsnCheck.clean("  \"https://key@o1.ingest.sentry.io/2\" ")).isEqualTo("https://key@o1.ingest.sentry.io/2");
        assertThat(SentryDsnCheck.clean("'https://key@o1.ingest.sentry.io/2'")).isEqualTo("https://key@o1.ingest.sentry.io/2");
        assertThat(SentryDsnCheck.isDsn("https://key@o1.ingest.sentry.io/2")).isTrue();
        assertThat(SentryDsnCheck.isDsn("https://key:secret@sentry.example.com/path/12")).isTrue();
        assertThat(SentryDsnCheck.isDsn("not-a-dsn")).isFalse();
        assertThat(SentryDsnCheck.isDsn("https://o1.ingest.sentry.io/2")).isFalse();
        assertThat(SentryDsnCheck.isDsn("https://key@o1.ingest.sentry.io/")).isFalse();
        assertThat(SentryDsnCheck.isDsn("dsn: https://key@o1.ingest.sentry.io/2")).isFalse();
    }
}
