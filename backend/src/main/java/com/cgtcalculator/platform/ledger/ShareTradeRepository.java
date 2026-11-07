package com.cgtcalculator.platform.ledger;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** The share trades; apps use them through {@link ShareTradeService}. */
interface ShareTradeRepository extends JpaRepository<ShareTrade, Long> {

    List<ShareTrade> findByUserIdOrderByDateAscIdAsc(Long userId);

    long countByUserId(Long userId);

    Optional<ShareTrade> findByIdAndUserId(Long id, Long userId);

    /** Everyone's trades without the ECB's rate of their day yet (not in {@code currency}: the euro), after a trade, in order. */
    List<ShareTrade> findTop500ByEcbRateIsNullAndCurrencyNotAndIdGreaterThanOrderByIdAsc(String currency, Long afterId);

    /**
     * Sets a trade's ECB rate, unless it was changed meanwhile (another day or currency) or has one already: nothing else
     * of the trade is written, so a change the user makes at the same time is kept.
     */
    @Modifying
    @Query("""
            update ShareTrade t set t.ecbRate = :rate, t.ecbRateDate = :rateDate
            where t.id = :id and t.date = :date and t.currency = :currency and t.ecbRate is null""")
    int setEcbRate(@Param("id") Long id, @Param("date") LocalDate date, @Param("currency") String currency, @Param("rate") BigDecimal rate,
                   @Param("rateDate") LocalDate rateDate);
}
