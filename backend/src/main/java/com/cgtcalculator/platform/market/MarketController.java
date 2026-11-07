package com.cgtcalculator.platform.market;

import java.time.Clock;
import java.time.Duration;
import java.time.LocalDate;
import java.util.Locale;

import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.cgtcalculator.platform.auth.RateLimiter;
import com.cgtcalculator.platform.web.ApiExceptionHandler.NotFoundException;
import com.cgtcalculator.platform.web.ApiExceptionHandler.TooManyRequestsException;

import jakarta.validation.constraints.Pattern;

/** Market data for the calculator's pages: the ECB's exchange rates. */
@RestController
@RequestMapping("/api/market")
public class MarketController {

    /** Days' exchange rates a user can look up an hour (each may be a request to the ECB): forms look them up as you type. */
    static final int RATES_PER_HOUR = 300;

    private final EcbRates rates;
    private final RateLimiter rateLookups;

    public MarketController(EcbRates rates, Clock clock) {
        this.rates = rates;
        this.rateLookups = new RateLimiter(RATES_PER_HOUR, Duration.ofHours(1), clock);
    }

    /** The ECB's rate for a currency on a day (or the last before it): units of the currency per euro. */
    @GetMapping("/rate")
    public EcbRates.Rate rate(@RequestParam @Pattern(regexp = "[A-Za-z]{3}") String currency,
                              @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date,
                              @AuthenticationPrincipal Jwt jwt) {
        RateLimiter.Decision decision = rateLookups.acquire(jwt.getSubject());
        if (!decision.allowed()) {
            throw new TooManyRequestsException("Too many exchange rate lookups: try again later, or enter the rate.", decision.retryAfterSeconds());
        }
        return rates.rate(currency, date).orElseThrow(() -> new NotFoundException("The ECB has no rate for " + currency.toUpperCase(Locale.ROOT)
                + " on that day, or couldn't be reached: enter the rate."));
    }
}
