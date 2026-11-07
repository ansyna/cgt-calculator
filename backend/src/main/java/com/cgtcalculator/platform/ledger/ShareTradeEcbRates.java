package com.cgtcalculator.platform.ledger;

import java.time.LocalDate;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.stream.Collectors;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DataAccessException;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

import com.cgtcalculator.platform.market.EcbRates;

import jakarta.annotation.PreDestroy;

/**
 * The ECB's reference rate of each trade's day, kept with the trade beside the rate it was entered with: looked up as
 * a trade is saved, and a little later for those it couldn't be then (many saved at once, the ECB not reached, the
 * trades from before it was kept): each currency's days in one request to the ECB.
 */
@Component
public class ShareTradeEcbRates {

    private static final Logger log = LoggerFactory.getLogger(ShareTradeEcbRates.class);

    /** How far back the last rate before a day without one (a weekend, a run of holidays) is looked for. */
    static final int DAYS_BACK = 10;

    private final ShareTradeRepository trades;
    private final EcbRates rates;
    private final TransactionTemplate transaction;
    private final boolean background;
    private final ExecutorService later = Executors.newSingleThreadExecutor(Thread.ofVirtual().name("trade-ecb-rates").factory());
    private final AtomicBoolean queued = new AtomicBoolean();

    ShareTradeEcbRates(ShareTradeRepository trades, EcbRates rates, PlatformTransactionManager transactionManager,
                       @Value("${app.ledger.ecb-rates-background:true}") boolean background) {
        this.trades = trades;
        this.rates = rates;
        this.transaction = new TransactionTemplate(transactionManager);
        this.background = background;
    }

    /** A trade's rate before it's saved, if the ECB has one for its day (kept, or in one request). */
    void lookUp(ShareTrade trade) {
        if (trade.getEcbRate() != null) return;
        rates.rate(trade.getCurrency(), trade.getDate()).ifPresent(r -> trade.setEcbRate(r.date(), r.rate()));
    }

    /** Looks up the trades without a rate once what's being saved is committed: on another thread, not holding up the request. */
    void soon() {
        if (!background) return;
        Runnable queue = () -> {
            if (queued.compareAndSet(false, true)) later.execute(() -> {
                queued.set(false);
                fill();
            });
        };
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    queue.run();
                }
            });
        } else {
            queue.run();
        }
    }

    /** A minute after starting (the trades from before a deploy), then every hour: the trades still without a rate. */
    @Scheduled(fixedDelayString = "${app.ledger.ecb-rates-every:PT1H}", initialDelayString = "${app.ledger.ecb-rates-after:PT1M}")
    void scheduled() {
        if (background) fill();
    }

    /** Fills in the ECB's rate of every trade without one that the ECB has a rate for; how many were filled in. */
    public synchronized int fill() {
        int filled = 0;
        long after = 0;
        List<ShareTrade> missing;
        while (!(missing = trades.findTop500ByEcbRateIsNullAndCurrencyNotAndIdGreaterThanOrderByIdAsc("EUR", after)).isEmpty()) {
            after = missing.getLast().getId();
            Map<String, List<ShareTrade>> byCurrency = missing.stream().collect(Collectors.groupingBy(ShareTrade::getCurrency));
            for (Map.Entry<String, List<ShareTrade>> e : byCurrency.entrySet()) filled += fill(e.getKey(), e.getValue());
        }
        if (filled > 0) log.info("Filled in the ECB rate of {} trades", filled);
        return filled;
    }

    /** One currency's trades, from one request for their days. */
    private int fill(String currency, List<ShareTrade> missing) {
        LocalDate first = missing.stream().map(ShareTrade::getDate).min(Comparator.naturalOrder()).orElseThrow();
        LocalDate last = missing.stream().map(ShareTrade::getDate).max(Comparator.naturalOrder()).orElseThrow();
        TreeMap<LocalDate, EcbRates.Rate> byDay = new TreeMap<>();
        for (EcbRates.Rate r : rates.rates(currency, first.minusDays(DAYS_BACK), last)) byDay.put(r.date(), r);
        if (byDay.isEmpty()) return 0;
        int filled = 0;
        for (ShareTrade t : missing) {
            Optional<EcbRates.Rate> rate = Optional.ofNullable(byDay.floorEntry(t.getDate())).map(Map.Entry::getValue)
                    .filter(r -> !r.date().isBefore(t.getDate().minusDays(DAYS_BACK)));
            if (rate.isEmpty()) continue;
            try {
                Integer set = transaction.execute(s -> trades.setEcbRate(t.getId(), t.getDate(), t.getCurrency(), rate.get().rate(), rate.get().date()));
                if (set != null) filled += set;
            } catch (DataAccessException ex) {
                log.warn("Couldn't keep the ECB rate of trade {}: {}", t.getId(), ex.getMessage());
            }
        }
        return filled;
    }

    @PreDestroy
    void stop() {
        later.shutdownNow();
    }
}
