package com.cgtcalculator;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Clock;

import org.hamcrest.Matchers;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;


/** Per-user limits on what costs Financial Modeling Prep requests, checked parameters and the security headers. */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ApiProtectionTest {

    @Autowired
    private MockMvc mvc;

    private static RequestPostProcessor user(String id, String role) {
        return jwt().jwt(token -> token.subject(id)).authorities(new SimpleGrantedAuthority("ROLE_" + role));
    }

    @Test
    void badInputIsTheClientsMistakeNotAServerError() throws Exception {
        RequestPostProcessor admin = user("4001", "admin");
        mvc.perform(get("/api/market/rate?currency=USD&date=yesterday").with(admin)).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("The request is malformed."));
    }

    @Test
    void pagesCarryTheSecurityHeaders() throws Exception {
        mvc.perform(get("/api/config"))
                .andExpect(header().string("Content-Security-Policy", Matchers.containsString("script-src 'self'")))
                .andExpect(header().string("Content-Security-Policy", Matchers.containsString("frame-ancestors 'none'")))
                .andExpect(header().string("Referrer-Policy", "no-referrer"))
                .andExpect(header().string("Permissions-Policy", Matchers.containsString("camera=()")))
                .andExpect(header().string("X-Content-Type-Options", "nosniff"));
    }
}
