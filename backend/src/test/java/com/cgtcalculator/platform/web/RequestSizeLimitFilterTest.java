package com.cgtcalculator.platform.web;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import jakarta.servlet.http.HttpServletRequestWrapper;

class RequestSizeLimitFilterTest {

    /** A body sent in chunks: its length isn't known in advance. */
    private static HttpServletRequestWrapper chunked(byte[] body) {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/auth/login");
        request.setContent(body);
        return new HttpServletRequestWrapper(request) {
            @Override
            public int getContentLength() {
                return -1;
            }

            @Override
            public long getContentLengthLong() {
                return -1;
            }
        };
    }

    @Test
    void chunkedBodiesAreCountedToo() throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();
        new RequestSizeLimitFilter(new RequestSizeProperties(null)).doFilter(chunked(new byte[RequestSizeLimitFilter.MAX_BYTES + 1]), response, chain);
        assertThat(response.getStatus()).isEqualTo(413);
        assertThat(chain.getRequest()).isNull();
    }

    @Test
    void smallChunkedBodiesArePassedOnWhole() throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();
        new RequestSizeLimitFilter(new RequestSizeProperties(null)).doFilter(chunked("{\"a\":1}".getBytes(StandardCharsets.UTF_8)), response, chain);
        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(new String(chain.getRequest().getInputStream().readAllBytes(), StandardCharsets.UTF_8)).isEqualTo("{\"a\":1}");
    }

    @Test
    void configuredPathsTakeLargerBodiesAndOnlyThose() throws Exception {
        RequestSizeLimitFilter filter = new RequestSizeLimitFilter(
                new RequestSizeProperties(java.util.Map.of("/api/import", org.springframework.util.unit.DataSize.ofKilobytes(100))));
        byte[] body = new byte[RequestSizeLimitFilter.MAX_BYTES + 1];
        MockHttpServletRequest toImport = new MockHttpServletRequest("POST", "/api/import");
        toImport.setContent(body);
        MockHttpServletResponse response = new MockHttpServletResponse();
        filter.doFilter(toImport, response, new MockFilterChain());
        assertThat(response.getStatus()).isEqualTo(200);

        MockHttpServletRequest tooMuch = new MockHttpServletRequest("POST", "/api/import");
        tooMuch.setContent(new byte[100 * 1024 + 1]);
        response = new MockHttpServletResponse();
        filter.doFilter(tooMuch, response, new MockFilterChain());
        assertThat(response.getStatus()).isEqualTo(413);

        MockHttpServletRequest elsewhere = new MockHttpServletRequest("POST", "/api/auth/login");
        elsewhere.setContent(body);
        response = new MockHttpServletResponse();
        filter.doFilter(elsewhere, response, new MockFilterChain());
        assertThat(response.getStatus()).isEqualTo(413);
    }

    @Test
    void aPatternTakesTheLargerBodiesForEachPathItMatches() throws Exception {
        RequestSizeLimitFilter filter = new RequestSizeLimitFilter(
                new RequestSizeProperties(java.util.Map.of("/api/things/*", org.springframework.util.unit.DataSize.ofKilobytes(100))));
        assertThat(filter.limitFor("/api/things/12")).isEqualTo(100 * 1024);
        assertThat(filter.limitFor("/api/things/12/more")).isEqualTo(RequestSizeLimitFilter.MAX_BYTES);
        assertThat(filter.limitFor("/api/things")).isEqualTo(RequestSizeLimitFilter.MAX_BYTES);
        assertThat(filter.limitFor("/api/other/12")).isEqualTo(RequestSizeLimitFilter.MAX_BYTES);
    }
}
