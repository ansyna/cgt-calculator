package com.cgtcalculator.platform.ledger;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.client.RestClient;

import com.cgtcalculator.platform.market.EcbRates;
import com.cgtcalculator.platform.user.User;
import com.cgtcalculator.platform.user.UserRepository;

/** Each trade's ECB rate: looked up as it's saved, and the rest filled in later, a currency's days in one request. */
@SpringBootTest(properties = "app.market.ecb-url=http://localhost:9/unreachable/")
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ShareTradeEcbRatesTest {

    @Autowired
    private ShareTradeService service;
    @Autowired
    private ShareTradeRepository repository;
    @Autowired
    private UserRepository users;
    @Autowired
    private PlatformTransactionManager transactions;
    @Autowired
    private JdbcTemplate jdbc;

    private User anna;

    @BeforeEach
    void user() {
        anna = users.save(new User("Anna", "anna" + System.nanoTime() + "@example.com", "x"));
        jdbc.update("delete from fx_rates");
        // other tests' trades without a rate: theirs, not these tests'
        jdbc.update("update share_trades set ecb_rate = 1, ecb_rate_date = trade_date where ecb_rate is null");
    }

    /** The ECB, as far as these tests go: each currency's rates by day, and the requests asked of it. */
    private static final class FakeEcb extends EcbRates {
        final Map<String, List<Rate>> rates;
        final List<String> asked = new ArrayList<>();

        FakeEcb(Map<String, List<Rate>> rates) {
            super(RestClient.builder(), new Store() {
                @Override
                public Optional<Rate> on(String currency, LocalDate date) {
                    return Optional.empty();
                }

                @Override
                public void save(String currency, List<Rate> rates) {
                }
            }, "http://localhost:9/", Clock.systemUTC());
            this.rates = rates;
        }

        @Override
        public List<Rate> rates(String currency, LocalDate from, LocalDate to) {
            asked.add(currency + " " + from + " " + to);
            return rates.getOrDefault(currency, List.of()).stream().filter(r -> !r.date().isBefore(from) && !r.date().isAfter(to)).toList();
        }
    }

    private ShareTrade trade(String date, String currency, String rate) {
        return new ShareTrade(anna.getId(), ShareTrade.App.CGT, Instant.now()).byPrice(ShareTrade.Kind.BUY, LocalDate.parse(date), "ACME",
                BigDecimal.TEN, new BigDecimal("50"), currency, BigDecimal.ZERO, new BigDecimal(rate), Instant.now());
    }

    private static EcbRates.Rate rate(String date, String rate) {
        return new EcbRates.Rate(LocalDate.parse(date), new BigDecimal(rate));
    }

    @Test
    void looksUpTheDaysRateAsATradeIsSavedBesideTheRateItsEnteredWith() {
        jdbc.update("insert into fx_rates (currency, rate_date, rate) values ('USD', '2025-06-17', 1.1755)");
        ShareTrade sale = service.save(trade("2025-06-17", "USD", "1.17"));
        assertThat(sale.getEurRate()).isEqualByComparingTo("1.17");
        assertThat(sale.getEcbRate()).isEqualByComparingTo("1.1755");
        assertThat(sale.getEcbRateDate()).isEqualTo(LocalDate.parse("2025-06-17"));
        // in euro: one
        assertThat(service.save(trade("2025-07-05", "EUR", "1")).getEcbRate()).isEqualByComparingTo("1");
        // the ECB not reached: none yet
        assertThat(service.save(trade("2025-07-05", "USD", "1.17")).getEcbRate()).isNull();
        // another day: the rate's looked up again
        ShareTrade moved = service.get(anna.getId(), sale.getId());
        moved.byPrice(ShareTrade.Kind.BUY, LocalDate.parse("2025-06-18"), "ACME", BigDecimal.TEN, new BigDecimal("50"), "USD", BigDecimal.ZERO,
                new BigDecimal("1.17"), Instant.now());
        assertThat(moved.getEcbRate()).isNull();
    }

    @Test
    void fillsInTheTradesWithoutARateACurrencysDaysInOneRequest() {
        ShareTrade saturday = service.save(trade("2025-07-05", "USD", "1.17"));
        ShareTrade monday = service.save(trade("2025-07-07", "USD", "1.18"));
        ShareTrade pounds = service.save(trade("2025-06-17", "GBP", "0.86"));
        ShareTrade tooEarly = service.save(trade("2001-01-02", "CHF", "1.5"));
        FakeEcb ecb = new FakeEcb(Map.of(
                "USD", List.of(rate("2025-06-26", "1.16"), rate("2025-07-04", "1.1774"), rate("2025-07-07", "1.1728")),
                "GBP", List.of(rate("2025-06-17", "0.8612"))));
        ShareTradeEcbRates backfill = new ShareTradeEcbRates(repository, ecb, transactions, true);

        assertThat(backfill.fill()).isEqualTo(3);
        // a Saturday's: the Friday's rate
        ShareTrade sat = service.get(anna.getId(), saturday.getId());
        assertThat(sat.getEcbRate()).isEqualByComparingTo("1.1774");
        assertThat(sat.getEcbRateDate()).isEqualTo(LocalDate.parse("2025-07-04"));
        assertThat(service.get(anna.getId(), monday.getId()).getEcbRate()).isEqualByComparingTo("1.1728");
        assertThat(service.get(anna.getId(), pounds.getId()).getEcbRate()).isEqualByComparingTo("0.8612");
        // the rate entered is kept as it was
        assertThat(sat.getEurRate()).isEqualByComparingTo("1.17");
        // one request a currency, from ten days before its first trade to its last
        assertThat(ecb.asked).containsExactlyInAnyOrder("USD 2025-06-25 2025-07-07", "GBP 2025-06-07 2025-06-17", "CHF 2000-12-23 2001-01-02");
        // none the ECB has: left for later
        assertThat(service.get(anna.getId(), tooEarly.getId()).getEcbRate()).isNull();
        assertThat(backfill.fill()).isZero();
    }

    @Test
    void aTradeChangedMeanwhileKeepsTheChange() {
        ShareTrade t = service.save(trade("2025-07-05", "USD", "1.17"));
        // looked up for the 8th, but the trade's on the 5th
        Integer set = new TransactionTemplate(transactions).execute(
                s -> repository.setEcbRate(t.getId(), LocalDate.parse("2025-07-08"), "USD", new BigDecimal("1.1"), LocalDate.parse("2025-07-08")));
        assertThat(set).isZero();
        assertThat(service.get(anna.getId(), t.getId()).getEcbRate()).isNull();
    }
}
