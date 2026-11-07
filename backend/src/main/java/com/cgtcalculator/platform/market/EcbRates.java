package com.cgtcalculator.platform.market;

import java.math.BigDecimal;
import java.net.URI;
import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.util.UriComponentsBuilder;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;

/**
 * The ECB's euro reference rates (the "official" rate Revenue converts foreign purchases and sales with): for a
 * day, that day's rate, or the last one before it on days without (weekends, holidays). Rates are kept once fetched,
 * and a past day's answer remembered, so a weekend's is asked once. Without a connection to the ECB there's no rate, and the user enters it.
 */
@Service
public class EcbRates {

    /** A rate: units of the currency per euro, and the day it is the ECB's rate of. */
    public record Rate(LocalDate date, BigDecimal rate) {
    }

    /** Where rates are kept once fetched. */
    public interface Store {
        /** The rate of the day itself, if kept. */
        Optional<Rate> on(String currency, LocalDate date);

        void save(String currency, List<Rate> rates);
    }

    /** The days fetched before a date, to find the last rate before a weekend or a run of holidays. */
    static final int DAYS_BACK = 10;

    private static final Logger log = LoggerFactory.getLogger(EcbRates.class);

    /** Where the ECB is: its rates come out at about 16:00 there. */
    private static final ZoneId FRANKFURT = ZoneId.of("Europe/Berlin");

    private final RestClient http;
    private final Store store;
    private final String baseUrl;
    private final Clock clock;
    /** The answers for days before yesterday, which won't change: a day without a rate's among them. */
    private final Cache<String, Rate> settled = Caffeine.newBuilder().maximumSize(20_000).build();

    public EcbRates(RestClient.Builder http, Store store,
                    @Value("${app.market.ecb-url:https://data-api.ecb.europa.eu/service/data/EXR/}") String baseUrl, Clock clock) {
        this.http = http.build();
        this.store = store;
        this.baseUrl = baseUrl;
        this.clock = clock;
    }

    /** The rate for a currency (three letters) on a day; empty when the ECB has none or can't be reached. */
    public Optional<Rate> rate(String currency, LocalDate date) {
        String code = currency.toUpperCase(Locale.ROOT);
        if (code.equals("EUR")) return Optional.of(new Rate(date, BigDecimal.ONE));
        String key = code + "|" + date;
        Rate known = settled.getIfPresent(key);
        if (known != null) return Optional.of(known);
        Optional<Rate> kept = store.on(code, date);
        if (kept.isPresent()) return kept;
        List<Rate> fetched = fetch(code, date.minusDays(DAYS_BACK), date);
        if (fetched.isEmpty()) return Optional.empty();
        store.save(code, fetched);
        Optional<Rate> rate = fetched.stream().filter(r -> !r.date().isAfter(date)).reduce((a, b) -> b.date().isAfter(a.date()) ? b : a);
        if (rate.isPresent() && date.isBefore(LocalDate.now(clock.withZone(FRANKFURT)).minusDays(1))) settled.put(key, rate.get());
        return rate;
    }

    /**
     * The rates for a currency from one day to another, in one request to the ECB (and kept); none for the euro, or
     * when the ECB has none or can't be reached.
     */
    public List<Rate> rates(String currency, LocalDate from, LocalDate to) {
        String code = currency.toUpperCase(Locale.ROOT);
        if (code.equals("EUR")) return List.of();
        List<Rate> fetched = fetch(code, from, to);
        if (!fetched.isEmpty()) store.save(code, fetched);
        return fetched;
    }

    private List<Rate> fetch(String currency, LocalDate from, LocalDate to) {
        URI uri = UriComponentsBuilder.fromUriString(baseUrl).path("D." + currency + ".EUR.SP00.A")
                .queryParam("startPeriod", from).queryParam("endPeriod", to).queryParam("format", "csvdata")
                .build().encode().toUri();
        try {
            String csv = http.get().uri(uri).header("Accept", "text/csv").retrieve().body(String.class);
            return csv == null ? List.of() : parse(csv);
        } catch (RestClientException | IllegalArgumentException e) {
            // 404 when the ECB has no rate for the currency or the days
            log.info("No ECB rate for {} {} to {}: {}", currency, from, to, e.getMessage());
            return List.of();
        }
    }

    /** The ECB's CSV: a header row, then one row per day; the day and rate are found by their column names. */
    static List<Rate> parse(String csv) {
        String[] lines = csv.strip().split("\r?\n");
        if (lines.length < 2) return List.of();
        List<String> header = fields(lines[0]);
        int day = header.indexOf("TIME_PERIOD");
        int value = header.indexOf("OBS_VALUE");
        if (day < 0 || value < 0) throw new IllegalArgumentException("Not the ECB's CSV: " + header);
        List<Rate> rates = new ArrayList<>();
        for (int i = 1; i < lines.length; i++) {
            List<String> row = fields(lines[i]);
            if (row.size() <= Math.max(day, value) || row.get(value).isBlank()) continue;
            rates.add(new Rate(LocalDate.parse(row.get(day)), new BigDecimal(row.get(value))));
        }
        return rates;
    }

    /** A CSV line's fields; quoted fields may hold commas and doubled quotes. */
    static List<String> fields(String line) {
        List<String> fields = new ArrayList<>();
        StringBuilder field = new StringBuilder();
        boolean quoted = false;
        for (int i = 0; i < line.length(); i++) {
            char c = line.charAt(i);
            if (quoted) {
                if (c == '"' && i + 1 < line.length() && line.charAt(i + 1) == '"') {
                    field.append('"');
                    i++;
                } else if (c == '"') {
                    quoted = false;
                } else {
                    field.append(c);
                }
            } else if (c == '"') {
                quoted = true;
            } else if (c == ',') {
                fields.add(field.toString());
                field.setLength(0);
            } else {
                field.append(c);
            }
        }
        fields.add(field.toString());
        return fields;
    }
}
