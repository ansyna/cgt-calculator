package com.cgtcalculator.platform.market;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.client.ExpectedCount.once;
import static org.springframework.test.web.client.ExpectedCount.times;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withResourceNotFound;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

class EcbRatesTest {

    /** The ECB's CSV as data-api.ecb.europa.eu sends it (columns trimmed to those around the values). */
    static final String CSV = """
            KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE,OBS_STATUS,OBS_CONF,TITLE,TITLE_COMPL,UNIT,UNIT_MULT
            EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2025-10-02,1.1730,A,F,US dollar/Euro,"ECB reference exchange rate, US dollar/Euro, 2:15 pm (C.E.T.)",USD,0
            EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2025-10-03,1.1712,A,F,US dollar/Euro,"ECB reference exchange rate, US dollar/Euro, 2:15 pm (C.E.T.)",USD,0
            """;

    static final String BASE = "https://ecb.test/EXR/";

    /** Rates kept in memory. */
    static final class MemoryStore implements EcbRates.Store {
        final Map<String, EcbRates.Rate> rates = new HashMap<>();

        @Override
        public Optional<EcbRates.Rate> on(String currency, LocalDate date) {
            return Optional.ofNullable(rates.get(currency + date));
        }

        @Override
        public void save(String currency, List<EcbRates.Rate> list) {
            list.forEach(r -> rates.put(currency + r.date(), r));
        }
    }

    private final RestClient.Builder builder = RestClient.builder();
    private final MockRestServiceServer ecb = MockRestServiceServer.bindTo(builder).build();
    private final MemoryStore store = new MemoryStore();
    private final EcbRates rates = new EcbRates(builder, store, BASE, Clock.fixed(Instant.parse("2025-10-22T12:00:00Z"), ZoneOffset.UTC));

    private static String url(String currency, String from, String to) {
        return BASE + "D." + currency + ".EUR.SP00.A?startPeriod=" + from + "&endPeriod=" + to + "&format=csvdata";
    }

    @Test
    void theDaysRateFromTheEcbThenFromWhatWasKept() {
        ecb.expect(once(), requestTo(url("USD", "2025-09-23", "2025-10-03"))).andRespond(withSuccess(CSV, MediaType.parseMediaType("text/csv")));
        assertThat(rates.rate("usd", LocalDate.parse("2025-10-03"))).contains(new EcbRates.Rate(LocalDate.parse("2025-10-03"), new BigDecimal("1.1712")));
        // both days kept: no more requests
        assertThat(rates.rate("USD", LocalDate.parse("2025-10-02"))).contains(new EcbRates.Rate(LocalDate.parse("2025-10-02"), new BigDecimal("1.1730")));
        ecb.verify();
    }

    @Test
    void aWeekendTakesFridaysRate() {
        ecb.expect(once(), requestTo(url("USD", "2025-09-25", "2025-10-05"))).andRespond(withSuccess(CSV, MediaType.parseMediaType("text/csv")));
        assertThat(rates.rate("USD", LocalDate.parse("2025-10-05"))).contains(new EcbRates.Rate(LocalDate.parse("2025-10-03"), new BigDecimal("1.1712")));
        ecb.verify();
    }

    @Test
    void aWeekendIsAskedOnce() {
        ecb.expect(once(), requestTo(url("USD", "2025-09-25", "2025-10-05"))).andRespond(withSuccess(CSV, MediaType.parseMediaType("text/csv")));
        LocalDate sunday = LocalDate.parse("2025-10-05");
        assertThat(rates.rate("USD", sunday)).contains(new EcbRates.Rate(LocalDate.parse("2025-10-03"), new BigDecimal("1.1712")));
        // Sunday has no rate of its own to keep: remembered, not fetched again
        assertThat(rates.rate("USD", sunday)).contains(new EcbRates.Rate(LocalDate.parse("2025-10-03"), new BigDecimal("1.1712")));
        ecb.verify();
    }

    @Test
    void yesterdaysAnswerIsntRememberedBeforeTheRateIsOut() {
        // "today" is 22 October: a rate for the 21st may come out later
        ecb.expect(times(2), requestTo(url("USD", "2025-10-11", "2025-10-21"))).andRespond(withSuccess(CSV, MediaType.parseMediaType("text/csv")));
        rates.rate("USD", LocalDate.parse("2025-10-21"));
        rates.rate("USD", LocalDate.parse("2025-10-21"));
        ecb.verify();
    }

    @Test
    void euroIsOneWithoutAsking() {
        assertThat(rates.rate("EUR", LocalDate.parse("2025-10-05"))).contains(new EcbRates.Rate(LocalDate.parse("2025-10-05"), BigDecimal.ONE));
        ecb.verify();
    }

    @Test
    void noRateWhenTheEcbHasNone() {
        ecb.expect(once(), requestTo(url("XYZ", "2025-09-23", "2025-10-03"))).andRespond(withResourceNotFound());
        assertThat(rates.rate("XYZ", LocalDate.parse("2025-10-03"))).isEmpty();
        assertThat(store.rates).isEmpty();
    }

    @Test
    void quotedFieldsKeepTheirCommas() {
        assertThat(EcbRates.fields("a,\"b, c\",\"say \"\"hi\"\"\",d")).containsExactly("a", "b, c", "say \"hi\"", "d");
        assertThat(EcbRates.parse(CSV)).hasSize(2);
        assertThat(EcbRates.parse("")).isEmpty();
    }
}
