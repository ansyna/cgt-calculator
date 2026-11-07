package com.cgtcalculator.apps.cgt;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

import com.cgtcalculator.platform.user.User;
import com.cgtcalculator.platform.user.UserRepository;
import com.cgtcalculator.platform.user.UserService;

/** The CGT calculator's API through the whole app, with real users. */
@SpringBootTest(properties = "app.market.ecb-url=http://localhost:9/unreachable/")
@AutoConfigureMockMvc
@ActiveProfiles("test")
class CgtApiTest {

    @Autowired
    private MockMvc mvc;
    @Autowired
    private UserRepository users;
    @Autowired
    private UserService userService;
    @Autowired
    private JdbcTemplate jdbc;

    private User anna;
    private User ben;

    @BeforeEach
    void users() {
        String unique = Long.toString(System.nanoTime());
        anna = users.save(new User("Anna", "anna" + unique + "@example.com", "x"));
        ben = users.save(new User("Ben", "ben" + unique + "@example.com", "x"));
        jdbc.update("delete from fx_rates");
    }

    private static RequestPostProcessor as(User user) {
        return jwt().jwt(token -> token.subject(user.getId().toString())).authorities(new SimpleGrantedAuthority("ROLE_investor"));
    }

    private static MockHttpServletRequestBuilder json(MockHttpServletRequestBuilder request, String body) {
        return request.contentType(MediaType.APPLICATION_JSON).content(body);
    }

    private static String trade(String kind, String date, String symbol, String quantity, String price, String currency, String extra) {
        return """
                {"kind":"%s","date":"%s","symbol":"%s","quantity":%s,"price":%s,"currency":"%s"%s}"""
                .formatted(kind, date, symbol, quantity, price, currency, extra);
    }

    private long create(User user, String body) throws Exception {
        String location = mvc.perform(json(post("/api/cgt/transactions"), body).with(as(user)))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        return Long.parseLong(location.replaceAll(".*\"id\":(\\d+).*", "$1"));
    }

    @Test
    void eachUserSeesAndChangesOnlyTheirOwn() throws Exception {
        long annas = create(anna, trade("BUY", "2024-02-01", "acme", "10", "100", "EUR", ",\"fees\":5,\"source\":\"RSU\""));
        mvc.perform(get("/api/cgt/transactions").with(as(anna))).andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].symbol").value("ACME"))
                .andExpect(jsonPath("$[0].source").value("RSU"))
                .andExpect(jsonPath("$[0].eurRate").value(1))
                .andExpect(jsonPath("$[0].eurValue").value(1000.0));
        mvc.perform(get("/api/cgt/transactions").with(as(ben))).andExpect(jsonPath("$", hasSize(0)));
        String change = trade("BUY", "2024-02-01", "ACME", "1", "1", "EUR", "");
        mvc.perform(json(put("/api/cgt/transactions/" + annas), change).with(as(ben))).andExpect(status().isNotFound());
        mvc.perform(delete("/api/cgt/transactions/" + annas).with(as(ben))).andExpect(status().isNotFound());
        mvc.perform(json(put("/api/cgt/transactions/" + annas), change).with(as(anna))).andExpect(status().isOk())
                .andExpect(jsonPath("$.quantity").value(1));
        mvc.perform(delete("/api/cgt/transactions/" + annas).with(as(anna))).andExpect(status().isNoContent());
        mvc.perform(get("/api/cgt/transactions").with(as(anna))).andExpect(jsonPath("$", hasSize(0)));
    }

    @Test
    void foreignTradesTakeTheEcbRateOfTheDayOrAskForIt() throws Exception {
        jdbc.update("insert into fx_rates (currency, rate_date, rate) values ('USD', '2025-09-17', 1.1712)");
        create(anna, trade("BUY", "2025-09-17", "ACME", "10", "117.12", "usd", ""));
        mvc.perform(get("/api/cgt/transactions").with(as(anna)))
                .andExpect(jsonPath("$[0].currency").value("USD"))
                .andExpect(jsonPath("$[0].eurRate").value(1.1712))
                .andExpect(jsonPath("$[0].eurValue").value(1000.0));

        // no rate for that day (and the ECB unreachable here): the user enters it
        mvc.perform(json(post("/api/cgt/transactions"), trade("BUY", "2025-10-06", "ACME", "1", "100", "USD", "")).with(as(anna)))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.errors.eurRate[0]").value(org.hamcrest.Matchers.startsWith("The ECB has no USD rate")));
        create(anna, trade("BUY", "2025-10-06", "ACME", "1", "100", "USD", ",\"eurRate\":1.17"));
    }

    @Test
    void worksTheYearOutAtTheEcbRatesTooTheTradesAsEntered() throws Exception {
        jdbc.update("insert into fx_rates (currency, rate_date, rate) values ('USD', '2025-05-01', 1.13), ('USD', '2025-05-14', 1.1297)");
        // entered at the rates the broker converted at
        create(anna, trade("BUY", "2025-05-01", "NKE", "4", "113", "USD", ",\"eurRate\":1.10"));
        create(anna, trade("SELL", "2025-05-14", "NKE", "4", "125", "USD", ",\"eurRate\":1.12211"));
        // 500 / 1.12211 = 445.59 for 452 / 1.10 = 410.91
        mvc.perform(get("/api/cgt/overview").param("year", "2025").with(as(anna))).andExpect(status().isOk())
                .andExpect(jsonPath("$.summary.considerationEur").value(445.59))
                .andExpect(jsonPath("$.summary.disposals[0].costEur").value(410.91));
        // at the ECB's: 500 / 1.1297 = 442.60 for 452 / 1.13 = 400.00
        mvc.perform(get("/api/cgt/overview").param("year", "2025").param("rates", "ECB").with(as(anna))).andExpect(status().isOk())
                .andExpect(jsonPath("$.summary.considerationEur").value(442.6))
                .andExpect(jsonPath("$.summary.disposals[0].costEur").value(400.0))
                .andExpect(jsonPath("$.summary.problems", hasSize(0)));
        // the trades as they were entered
        mvc.perform(get("/api/cgt/transactions").with(as(anna)))
                .andExpect(jsonPath("$[1].eurRate").value(1.12211));
        // an ECB rate not known yet (the ECB unreachable here): the rate entered, and said
        create(anna, trade("BUY", "2025-05-10", "NKE", "1", "125", "USD", ",\"eurRate\":1.12"));
        mvc.perform(get("/api/cgt/overview").param("year", "2025").param("rates", "ECB").with(as(anna)))
                .andExpect(jsonPath("$.summary.problems[0]").value("The ECB rate isn't known yet for 1 trade: it's worked out at the rate entered."));
    }

    @Test
    void showsTheEcbRateOfTheDayBesideTheRateEntered() throws Exception {
        jdbc.update("insert into fx_rates (currency, rate_date, rate) values ('USD', '2025-09-17', 1.1712)");
        create(anna, trade("SELL", "2025-09-17", "ACME", "10", "117.12", "USD", ",\"eurRate\":1.17"));
        create(anna, trade("BUY", "2025-09-15", "ACME", "10", "100", "EUR", ""));
        mvc.perform(get("/api/cgt/transactions").with(as(anna)))
                // in euro: one, that day's
                .andExpect(jsonPath("$[0].ecbRate").value(1))
                .andExpect(jsonPath("$[0].ecbRateDate").value("2025-09-15"))
                // the rate entered is the one the euro figures are worked out at; the ECB's is beside it
                .andExpect(jsonPath("$[1].eurRate").value(1.17))
                .andExpect(jsonPath("$[1].ecbRate").value(1.1712))
                .andExpect(jsonPath("$[1].ecbRateDate").value("2025-09-17"))
                .andExpect(jsonPath("$[1].eurValue").value(1001.03));
    }

    @Test
    void aPeriodsTransactionsAreDeletedToImportItAgain() throws Exception {
        create(anna, trade("BUY", "2025-03-03", "ACME", "10", "100", "EUR", ""));
        create(anna, trade("BUY", "2026-01-02", "ACME", "10", "100", "EUR", ""));
        create(anna, trade("SELL", "2026-10-01", "ACME", "5", "120", "EUR", ""));
        create(ben, trade("BUY", "2026-02-02", "ACME", "10", "100", "EUR", ""));

        mvc.perform(delete("/api/cgt/transactions?from=2026-01-01&to=2026-12-31").with(as(anna))).andExpect(status().isOk())
                .andExpect(jsonPath("$.deleted").value(2));
        mvc.perform(get("/api/cgt/transactions").with(as(anna))).andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].date").value("2025-03-03"));
        // nobody else's
        mvc.perform(get("/api/cgt/transactions").with(as(ben))).andExpect(jsonPath("$", hasSize(1)));
        // both days are included; nothing in the period is fine
        mvc.perform(delete("/api/cgt/transactions?from=2025-03-03&to=2025-03-03").with(as(anna))).andExpect(jsonPath("$.deleted").value(1));
        mvc.perform(delete("/api/cgt/transactions?from=2020-01-01&to=2020-12-31").with(as(anna))).andExpect(jsonPath("$.deleted").value(0));

        mvc.perform(delete("/api/cgt/transactions?from=2026-12-31&to=2026-01-01").with(as(ben)))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.errors.to[0]").value("The last day can't be before the first."));
        mvc.perform(delete("/api/cgt/transactions").with(as(ben))).andExpect(status().is4xxClientError());
        mvc.perform(get("/api/cgt/transactions").with(as(ben))).andExpect(jsonPath("$", hasSize(1)));
    }

    @Test
    void entriesAreChecked() throws Exception {
        mvc.perform(json(post("/api/cgt/transactions"), trade("SELL", "2999-01-01", "AC ME", "-1", "-2", "dollars", ",\"fees\":-1"))
                        .with(as(anna)))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.errors.date[0]").value("The date can't be in the future."))
                .andExpect(jsonPath("$.errors.symbol[0]").value("Use the ticker, e.g. AAPL or BRK.B."))
                .andExpect(jsonPath("$.errors.quantity[0]").value("The number of shares must be more than 0."))
                .andExpect(jsonPath("$.errors.price[0]").value("The price can't be negative."))
                .andExpect(jsonPath("$.errors.currency[0]").value("Use the three-letter currency code, e.g. EUR or USD."))
                .andExpect(jsonPath("$.errors.fees[0]").value("Fees can't be negative."));
        mvc.perform(get("/api/cgt/overview?year=99999").with(as(anna))).andExpect(status().is4xxClientError());
    }

    @Test
    void theOverviewHasTheTaxYearTheSharesHeldAndEarlierLosses() throws Exception {
        create(anna, trade("BUY", "2020-02-03", "ACME", "100", "10", "EUR", ""));
        create(anna, trade("SELL", "2025-06-02", "ACME", "60", "40", "EUR", ",\"fees\":10"));
        mvc.perform(json(put("/api/cgt/settings"), "{\"lossesBefore\":500}").with(as(anna))).andExpect(status().isNoContent());
        // proceeds 2,400, fees 10, cost 600: gain 1,790; less 500 earlier losses: 1,290; less 1,270: 20 × 33% = 6.60
        mvc.perform(get("/api/cgt/overview?year=2025").with(as(anna))).andExpect(status().isOk())
                .andExpect(jsonPath("$.summary.year").value(2025))
                .andExpect(jsonPath("$.summary.disposalCount").value(1))
                .andExpect(jsonPath("$.summary.considerationEur").value(2400.0))
                .andExpect(jsonPath("$.summary.gainsEur").value(1790.0))
                .andExpect(jsonPath("$.summary.lossesUsedEur").value(500.0))
                .andExpect(jsonPath("$.summary.taxEur").value(6.6))
                .andExpect(jsonPath("$.summary.initialDue").value("2025-12-15"))
                .andExpect(jsonPath("$.summary.disposals[0].matches[0].rule").value("FIRST_IN_FIRST_OUT"))
                .andExpect(jsonPath("$.holdings[0].symbol").value("ACME"))
                .andExpect(jsonPath("$.holdings[0].quantity").value(40))
                .andExpect(jsonPath("$.lossesBefore").value(500.0))
                .andExpect(jsonPath("$.years").value(org.hamcrest.Matchers.hasItem(2025)));
        // by default the latest year with sales, this year listed too; without sales, this year
        int thisYear = java.time.LocalDate.now().getYear();
        mvc.perform(get("/api/cgt/overview").with(as(anna))).andExpect(status().isOk())
                .andExpect(jsonPath("$.summary.year").value(2025))
                .andExpect(jsonPath("$.years").value(org.hamcrest.Matchers.hasItem(thisYear)));
        mvc.perform(get("/api/cgt/overview").with(as(ben))).andExpect(status().isOk())
                .andExpect(jsonPath("$.summary.year").value(thisYear))
                .andExpect(jsonPath("$.summary.disposalCount").value(0));
    }

    private static String importOf(String... rows) {
        return "{\"transactions\":[" + String.join(",", rows) + "]}";
    }

    @Test
    void anImportRecordsAllItsRowsOrNone() throws Exception {
        jdbc.update("insert into fx_rates (currency, rate_date, rate) values ('USD', '2025-09-17', 1.1712)");
        String eur = trade("BUY", "2020-02-03", "ACME", "100", "10", "EUR", ",\"source\":\"RSU\"");
        String usdWithEcbRate = trade("SELL", "2025-09-17", "ACME", "10", "117.12", "USD", ",\"fees\":0.05");
        String usdWithoutRate = trade("BUY", "2025-10-06", "BETA", "5", "100", "USD", "");

        // the third row has no rate for its day: nothing is recorded, and the error names the row
        mvc.perform(json(post("/api/cgt/transactions/import"), importOf(eur, usdWithEcbRate, usdWithoutRate)).with(as(anna)))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.errors['transactions[2].eurRate'][0]").value(org.hamcrest.Matchers.startsWith("Row 3: The ECB has no USD rate")));
        // every row without a rate is named at once
        String anotherWithoutRate = trade("SELL", "2025-10-07", "BETA", "1", "100", "USD", "");
        mvc.perform(json(post("/api/cgt/transactions/import"), importOf(usdWithoutRate, eur, anotherWithoutRate)).with(as(anna)))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.message").value("2 rows can't be recorded."))
                .andExpect(jsonPath("$.errors['transactions[0].eurRate']").exists())
                .andExpect(jsonPath("$.errors['transactions[2].eurRate']").exists());
        mvc.perform(get("/api/cgt/transactions").with(as(anna))).andExpect(jsonPath("$", hasSize(0)));

        // a row's own mistakes are named by row too
        mvc.perform(json(post("/api/cgt/transactions/import"), importOf(eur, trade("BUY", "2020-02-03", "ACME", "0", "10", "EUR", "")))
                        .with(as(anna)))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.errors['transactions[1].quantity'][0]").value("The number of shares must be more than 0."));

        String usdWithOwnRate = trade("BUY", "2025-10-06", "BETA", "5", "100", "USD", ",\"eurRate\":1.17");
        mvc.perform(json(post("/api/cgt/transactions/import"), importOf(eur, usdWithEcbRate, usdWithOwnRate)).with(as(anna)))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.imported").value(3));
        mvc.perform(get("/api/cgt/transactions").with(as(anna))).andExpect(jsonPath("$", hasSize(3)))
                .andExpect(jsonPath("$[1].eurRate").value(1.1712))
                .andExpect(jsonPath("$[1].fees").value(0.05));
        mvc.perform(get("/api/cgt/transactions").with(as(ben))).andExpect(jsonPath("$", hasSize(0)));
    }

    @Test
    void aStatementOfHundredsOfRowsFitsThroughTheRequestSizeLimit() throws Exception {
        String[] rows = new String[600];
        for (int i = 0; i < rows.length; i++) {
            rows[i] = trade("BUY", java.time.LocalDate.of(2020, 1, 1).plusDays(i).toString(), "ACME", "1.5", "123.456", "EUR",
                    ",\"note\":\"imported from a statement\"");
        }
        String body = importOf(rows);
        assertThat(body.length()).isGreaterThan(64 * 1024);
        mvc.perform(json(post("/api/cgt/transactions/import"), body).with(as(anna)))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.imported").value(600));
    }

    @Test
    void aUsersCgtDataGoesWithTheUser() throws Exception {
        create(anna, trade("BUY", "2020-02-03", "ACME", "100", "10", "EUR", ""));
        mvc.perform(json(put("/api/cgt/settings"), "{\"lossesBefore\":500}").with(as(anna))).andExpect(status().isNoContent());
        userService.delete(anna.getId(), false, "test");
        assertThat(jdbc.queryForObject("select count(*) from share_trades where user_id = ?", Integer.class, anna.getId())).isZero();
        assertThat(jdbc.queryForObject("select count(*) from cgt_settings where user_id = ?", Integer.class, anna.getId())).isZero();
    }

    @Test
    void onlyForThoseWithAccessToTheApps() throws Exception {
        mvc.perform(get("/api/cgt/transactions")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/cgt/transactions").with(jwt().jwt(t -> t.subject(anna.getId().toString())))).andExpect(status().isForbidden());
    }
}
