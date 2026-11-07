package com.cgtcalculator.platform.web;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import jakarta.servlet.http.HttpServletRequest;

class ClientAddressFilterTest {

    private final ClientAddressFilter filter = new ClientAddressFilter(new ProxyProperties(
            List.of("10.0.0.0/8", "172.64.0.0/13", "104.24.0.0/14", "2606:4700::/32"), List.of("104.28.0.0/16")));

    /** What the app sees of a request from {@code peer} with the given headers (name, value, ...). */
    private HttpServletRequest seen(String peer, String... headers) throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/auth/login");
        request.setRemoteAddr(peer);
        for (int i = 0; i < headers.length; i += 2) request.addHeader(headers[i], headers[i + 1]);
        MockFilterChain chain = new MockFilterChain();
        filter.doFilter(request, new MockHttpServletResponse(), chain);
        return (HttpServletRequest) chain.getRequest();
    }

    @Test
    void theVisitorBehindCloudflare() throws Exception {
        // what production showed: Cloudflare connects, the visitor is in X-Forwarded-For
        assertThat(seen("172.71.146.22", "X-Forwarded-For", "187.40.35.102").getRemoteAddr()).isEqualTo("187.40.35.102");
        // Cloudflare's own header wins
        assertThat(seen("172.71.146.22", "X-Forwarded-For", "6.6.6.6", "CF-Connecting-IP", "187.40.35.102").getRemoteAddr())
                .isEqualTo("187.40.35.102");
        // through Render's private network too
        assertThat(seen("10.1.2.3", "X-Forwarded-For", "187.40.35.102, 172.71.146.22").getRemoteAddr()).isEqualTo("187.40.35.102");
    }

    @Test
    void addressesTheVisitorMakesUpDoNotCount() throws Exception {
        // entries before the one the proxy appended
        assertThat(seen("172.71.146.22", "X-Forwarded-For", "1.2.3.4, 187.40.35.102").getRemoteAddr()).isEqualTo("187.40.35.102");
        // headers from someone connecting directly
        assertThat(seen("187.40.35.102", "X-Forwarded-For", "1.2.3.4", "CF-Connecting-IP", "1.2.3.4").getRemoteAddr())
                .isEqualTo("187.40.35.102");
        // a WARP user's address is theirs, not a proxy's
        assertThat(seen("172.71.146.22", "X-Forwarded-For", "1.2.3.4, 104.28.5.5").getRemoteAddr()).isEqualTo("104.28.5.5");
        // host names are never looked up
        assertThat(seen("172.71.146.22", "X-Forwarded-For", "example.com, 187.40.35.102").getRemoteAddr()).isEqualTo("187.40.35.102");
    }

    @Test
    void httpsAsTheVisitorUsedIt() throws Exception {
        HttpServletRequest https = seen("172.71.146.22", "X-Forwarded-Proto", "https");
        assertThat(https.isSecure()).isTrue();
        assertThat(https.getScheme()).isEqualTo("https");
        assertThat(seen("187.40.35.102", "X-Forwarded-Proto", "https").isSecure()).isFalse();
    }
}
