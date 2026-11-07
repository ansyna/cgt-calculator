package com.cgtcalculator.platform.market;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import jakarta.annotation.PreDestroy;

/** The ECB rates fetched, in fx_rates. */
@Component
public class JdbcRateStore implements EcbRates.Store {

    private static final Logger log = LoggerFactory.getLogger(JdbcRateStore.class);

    private final JdbcTemplate jdbc;
    /** Keeps the rates a request that only reads fetched, once it has a connection of its own. */
    private final ExecutorService later = Executors.newSingleThreadExecutor(Thread.ofVirtual().name("fx-rates").factory());

    public JdbcRateStore(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public Optional<EcbRates.Rate> on(String currency, LocalDate date) {
        return jdbc.query("select rate_date, rate from fx_rates where currency = ? and rate_date = ?",
                (row, i) -> new EcbRates.Rate(row.getObject(1, LocalDate.class), row.getBigDecimal(2)), currency, date).stream().findFirst();
    }

    /**
     * Keeps rates with the request's own work; a request that only reads (a read-only transaction, where Postgres refuses
     * an insert) has them kept on another thread, which doesn't hold the request's connection while waiting for one.
     */
    @Override
    public void save(String currency, List<EcbRates.Rate> rates) {
        if (TransactionSynchronizationManager.isCurrentTransactionReadOnly()) {
            later.execute(() -> {
                try {
                    insert(currency, rates);
                } catch (DataAccessException e) {
                    log.warn("Couldn't keep the ECB rates for {}: {}", currency, e.getMessage());
                }
            });
        } else {
            insert(currency, rates);
        }
    }

    private void insert(String currency, List<EcbRates.Rate> rates) {
        for (EcbRates.Rate rate : rates) {
            // published rates don't change: keep the first copy (another request may have kept it, and a duplicate
            // would spoil the request's transaction on Postgres)
            jdbc.update("insert into fx_rates (currency, rate_date, rate) values (?, ?, ?) on conflict do nothing", currency, rate.date(), rate.rate());
        }
    }

    @PreDestroy
    void stop() {
        later.close();
    }
}
