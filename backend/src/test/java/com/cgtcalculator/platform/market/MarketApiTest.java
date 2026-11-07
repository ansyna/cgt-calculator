package com.cgtcalculator.platform.market;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

/** The market data the calculator's pages use: the ECB's exchange rates. */
@SpringBootTest(properties = "app.market.ecb-url=http://localhost:9/unreachable/")
@AutoConfigureMockMvc
@ActiveProfiles("test")
class MarketApiTest {

    @Autowired
    private MockMvc mvc;
    @Autowired
    private JdbcTemplate jdbc;

    private static final RequestPostProcessor INVESTOR = jwt().jwt(token -> token.subject("41")).authorities(new SimpleGrantedAuthority("ROLE_investor"));
    private static final RequestPostProcessor NO_ROLE = jwt().jwt(token -> token.subject("41"));

    @BeforeEach
    void rates() {
        jdbc.update("delete from fx_rates");
    }

    @Test
    void theEcbRateOfADayOrNone() throws Exception {
        jdbc.update("insert into fx_rates (currency, rate_date, rate) values ('USD', '2025-09-17', 1.1712)");
        mvc.perform(get("/api/market/rate?currency=usd&date=2025-09-17").with(INVESTOR)).andExpect(status().isOk())
                .andExpect(jsonPath("$.rate").value(1.1712)).andExpect(jsonPath("$.date").value("2025-09-17"));
        // none kept and the ECB unreachable here
        mvc.perform(get("/api/market/rate?currency=USD&date=2025-10-06").with(INVESTOR)).andExpect(status().isNotFound());
        mvc.perform(get("/api/market/rate?currency=EUR&date=2025-10-06").with(INVESTOR)).andExpect(jsonPath("$.rate").value(1));
        mvc.perform(get("/api/market/rate?currency=dollars&date=2025-10-06").with(INVESTOR)).andExpect(status().is4xxClientError());
    }

    @Test
    void ratesAreLookedUpAFewHundredTimesAnHourAtMost() throws Exception {
        RequestPostProcessor someone = jwt().jwt(token -> token.subject("43")).authorities(new SimpleGrantedAuthority("ROLE_investor"));
        for (int i = 0; i < MarketController.RATES_PER_HOUR; i++) {
            mvc.perform(get("/api/market/rate?currency=EUR&date=2025-10-06").with(someone)).andExpect(status().isOk());
        }
        mvc.perform(get("/api/market/rate?currency=EUR&date=2025-10-06").with(someone)).andExpect(status().isTooManyRequests());
        // someone else's aren't counted with them
        mvc.perform(get("/api/market/rate?currency=EUR&date=2025-10-06").with(INVESTOR)).andExpect(status().isOk());
    }

    @Test
    void onlyForThoseWithAccessToTheApps() throws Exception {
        mvc.perform(get("/api/market/rate?currency=USD&date=2025-09-17").with(NO_ROLE)).andExpect(status().isForbidden());
        mvc.perform(get("/api/market/rate?currency=USD&date=2025-09-17")).andExpect(status().isUnauthorized());
    }
}
