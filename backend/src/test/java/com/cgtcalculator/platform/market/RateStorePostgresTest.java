package com.cgtcalculator.platform.market;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import com.cgtcalculator.CgtCalculatorApplication;

/**
 * Rates fetched while a request reads (a read-only transaction) or writes are kept on a real Postgres
 * (TEST_POSTGRES_URL / _USER / _PASSWORD, set in CI), where H2 lets through what Postgres refuses: an insert in a
 * read-only transaction, and a transaction going on after a duplicate key.
 */
class RateStorePostgresTest {

    private static final EcbRates.Rate FRIDAY = new EcbRates.Rate(LocalDate.parse("2025-10-03"), new BigDecimal("1.1712"));

    @Test
    void keepsRatesFetchedInAnyTransaction() throws SQLException, InterruptedException {
        String server = System.getenv("TEST_POSTGRES_URL");
        assumeTrue(server != null && !server.isBlank(), "TEST_POSTGRES_URL is not set");
        String user = System.getenv("TEST_POSTGRES_USER");
        String password = System.getenv("TEST_POSTGRES_PASSWORD") == null ? "" : System.getenv("TEST_POSTGRES_PASSWORD");
        String name = "rates_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        try (Connection connection = DriverManager.getConnection(server, user, password);
             Statement statement = connection.createStatement()) {
            statement.execute("create database " + name);
        }
        String url = server.replaceFirst("^(jdbc:\\w+://[^/]+/)[^?]*", "$1" + name);

        try (ConfigurableApplicationContext app = new SpringApplicationBuilder(CgtCalculatorApplication.class).run(
                "--spring.datasource.url=" + url, "--spring.datasource.username=" + user,
                "--spring.datasource.password=" + password, "--server.port=0",
                "--app.jwt.secret=rates-test-secret-rates-test-secret-0123456",
                "--app.admin.email=admin@example.com", "--app.admin.password=rates-test-password")) {
            EcbRates.Store store = app.getBean(EcbRates.Store.class);
            JdbcTemplate jdbc = app.getBean(JdbcTemplate.class);
            TransactionTemplate reading = new TransactionTemplate(app.getBean(PlatformTransactionManager.class));
            reading.setReadOnly(true);
            reading.executeWithoutResult(status -> store.save("USD", List.of(FRIDAY)));
            // kept once the request is done with its connection
            for (int i = 0; i < 50 && store.on("USD", FRIDAY.date()).isEmpty(); i++) Thread.sleep(100);
            assertThat(store.on("USD", FRIDAY.date()).orElseThrow().rate()).isEqualByComparingTo(FRIDAY.rate());

            // kept already, by another request say: the request's own work goes on
            TransactionTemplate writing = new TransactionTemplate(app.getBean(PlatformTransactionManager.class));
            writing.executeWithoutResult(status -> {
                store.save("USD", List.of(FRIDAY, new EcbRates.Rate(FRIDAY.date().minusDays(1), new BigDecimal("1.1730"))));
                jdbc.update("insert into users (name, email, password, created_at) values ('Ann', 'ann@example.com', 'x', now())");
            });
            assertThat(jdbc.queryForObject("select count(*) from users where email = 'ann@example.com'", Integer.class)).isEqualTo(1);
            assertThat(jdbc.queryForObject("select count(*) from fx_rates", Integer.class)).isEqualTo(2);
        }
    }
}
