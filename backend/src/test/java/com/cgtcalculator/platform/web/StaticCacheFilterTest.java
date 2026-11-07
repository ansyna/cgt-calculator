package com.cgtcalculator.platform.web;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class StaticCacheFilterTest {

    private static String cacheControl(String path) throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", path);
        MockHttpServletResponse response = new MockHttpServletResponse();
        new StaticCacheFilter().doFilter(request, response, new MockFilterChain());
        return response.getHeader("Cache-Control");
    }

    @Test
    void theAppIsCheckedOnEveryVisitItsHashedFilesKeptForGood() throws Exception {
        // after a deploy the page names new files: an old copy would ask for ones that are gone
        assertThat(cacheControl("/")).isEqualTo("no-cache");
        assertThat(cacheControl("/get-fair-value")).isEqualTo("no-cache");
        assertThat(cacheControl("/index.html")).isEqualTo("no-cache");
        assertThat(cacheControl("/assets/FairValue-BQwaEHBo.js")).isEqualTo("public, max-age=31536000, immutable");
        // the API sets its own
        assertThat(cacheControl("/api/cgt/transactions")).isNull();
    }
}
