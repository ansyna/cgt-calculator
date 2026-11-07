package com.cgtcalculator.apps.cgt;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Test;

import com.cgtcalculator.apps.cgt.CgtCalculator.Disposal;
import com.cgtcalculator.apps.cgt.CgtCalculator.Kind;
import com.cgtcalculator.apps.cgt.CgtCalculator.Rule;
import com.cgtcalculator.apps.cgt.CgtCalculator.Trade;
import com.cgtcalculator.apps.cgt.CgtCalculator.YearSummary;

/** The rules on small cases worked out by hand (amounts in euro unless a rate is given). */
class CgtCalculatorTest {

    private final List<Trade> trades = new ArrayList<>();

    private void trade(Kind kind, String date, String symbol, String quantity, String price, String fees, String currency, String rate) {
        trades.add(new Trade(trades.size() + 1, kind, LocalDate.parse(date), symbol, new BigDecimal(quantity), new BigDecimal(price),
                currency, new BigDecimal(fees), new BigDecimal(rate)));
    }

    private void buy(String date, String symbol, String quantity, String price) {
        trade(Kind.BUY, date, symbol, quantity, price, "0", "EUR", "1");
    }

    private void sell(String date, String symbol, String quantity, String price) {
        trade(Kind.SELL, date, symbol, quantity, price, "0", "EUR", "1");
    }

    private CgtCalculator calculate() {
        return calculate("0");
    }

    private CgtCalculator calculate(String lossesBefore) {
        return new CgtCalculator(trades, new BigDecimal(lossesBefore));
    }

    private static BigDecimal eur(String amount) {
        return new BigDecimal(amount).setScale(2);
    }

    @Test
    void aDaysPurchasesAreMatchedInTheOrderEntered() {
        // entered 3 then 5
        trades.add(new Trade(3, Kind.BUY, LocalDate.parse("2024-02-01"), "ACME", BigDecimal.TEN, BigDecimal.TEN, "EUR", BigDecimal.ZERO, BigDecimal.ONE));
        trades.add(new Trade(5, Kind.BUY, LocalDate.parse("2024-02-01"), "ACME", BigDecimal.TEN, new BigDecimal("20"), "EUR", BigDecimal.ZERO, BigDecimal.ONE));
        trades.add(new Trade(7, Kind.SELL, LocalDate.parse("2025-02-01"), "ACME", BigDecimal.TEN, new BigDecimal("30"), "EUR", BigDecimal.ZERO, BigDecimal.ONE));
        Disposal d = calculate().disposals().getFirst();
        assertThat(d.matches().getFirst().purchaseId()).isEqualTo(3);
        assertThat(d.costEur()).isEqualTo(eur("100"));
    }

    @Test
    void sharesBoughtBackAfterASplitRestrictTheLossInTheSharesSold() {
        // 100 bought at €10, sold at €5 (a €500 loss), split 10 for 1, 100 new shares (10 old ones) bought back
        buy("2024-01-10", "ACME", "100", "10");
        sell("2024-03-01", "ACME", "100", "5");
        buy("2024-03-05", "ACME", "100", "0.5");
        CgtCalculator c = new CgtCalculator(trades, List.of(new CgtCalculator.Split(LocalDate.parse("2024-03-02"), "ACME", BigDecimal.TEN)),
                BigDecimal.ZERO);
        assertThat(c.disposals().getFirst().restrictedLossEur()).isEqualTo(eur("50"));
    }

    @Test
    void aTickerWrittenTwoWaysIsOneCompanyAndTradesLeftOutAreTold() {
        buy("2024-01-10", "BRK.B", "10", "300");
        sell("2024-06-10", "BRK-B", "10", "350");
        CgtCalculator c = new CgtCalculator(trades, List.of(), BigDecimal.ZERO, List.of("The sale of X on 2024-05-07 is left out."));
        assertThat(c.disposals().getFirst().unmatchedQuantity()).isEqualByComparingTo("0");
        assertThat(c.disposals().getFirst().gainEur()).isEqualTo(eur("500"));
        assertThat(c.year(2024).problems()).contains("The sale of X on 2024-05-07 is left out.");
    }

    @Test
    void aSplitGivesMoreSharesForTheSameCostAndIsNoSale() {
        // 1 share for €100, split 20 for 1, then 10 of the 20 sold at €6: half the cost
        buy("2022-01-10", "ACME", "1", "100");
        sell("2023-01-10", "ACME", "10", "6");
        CgtCalculator c = new CgtCalculator(trades, List.of(new CgtCalculator.Split(LocalDate.parse("2022-07-18"), "ACME", new BigDecimal("20"))),
                BigDecimal.ZERO);
        Disposal d = c.disposals().getFirst();
        assertThat(d.costEur()).isEqualTo(eur("50"));
        assertThat(d.gainEur()).isEqualTo(eur("10"));
        assertThat(d.unmatchedQuantity()).isEqualByComparingTo("0");
        assertThat(c.holdings().getFirst().quantity()).isEqualByComparingTo("10");
        assertThat(c.holdings().getFirst().costEur()).isEqualTo(eur("50"));
        // a split after the last trade: the shares held now
        CgtCalculator later = new CgtCalculator(trades.subList(0, 1),
                List.of(new CgtCalculator.Split(LocalDate.parse("2024-06-10"), "ACME", new BigDecimal("4"))), BigDecimal.ZERO);
        assertThat(later.holdings().getFirst().quantity()).isEqualByComparingTo("4");
    }

    @Test
    void aSaleWhosePurchaseIsntRecordedMayGiveWhatItsSharesCost() {
        trades.add(new Trade(1, Kind.SELL, LocalDate.parse("2024-05-07"), "OLD", new BigDecimal("3"), new BigDecimal("30"), "EUR",
                BigDecimal.ZERO, BigDecimal.ONE, new BigDecimal("60")));
        Disposal d = calculate().disposals().getFirst();
        assertThat(d.costEur()).isEqualTo(eur("60"));
        assertThat(d.gainEur()).isEqualTo(eur("30"));
        assertThat(d.unmatchedQuantity()).isEqualByComparingTo("0");
        assertThat(calculate().year(2024).problems()).noneMatch(p -> p.contains("more than was bought"));
    }

    @Test
    void aGainIsTheSalePriceLessItsFeesAndTheCostWithItsFees() {
        trade(Kind.BUY, "2024-01-10", "ACME", "10", "100", "10", "EUR", "1");
        trade(Kind.SELL, "2025-03-03", "ACME", "10", "150", "10", "EUR", "1");
        Disposal d = calculate().disposals().getFirst();
        assertThat(d.proceedsEur()).isEqualTo(eur("1500"));
        assertThat(d.feesEur()).isEqualTo(eur("10"));
        assertThat(d.costEur()).isEqualTo(eur("1010"));
        assertThat(d.gainEur()).isEqualTo(eur("480"));
        assertThat(d.allowableEur()).isEqualTo(eur("480"));
    }

    @Test
    void theGainIsTheDifferenceOfTheAmountsShown() {
        // 5,005 / 1.087 = 4,604.4158 and 4,000 / 1.17 = 3,418.8034: the loss is 3,418.80 − 4,604.42, not 1,185.6124
        trade(Kind.BUY, "2024-03-04", "BETA", "50", "100", "5", "USD", "1.087");
        trade(Kind.SELL, "2025-12-10", "BETA", "50", "80", "0", "USD", "1.17");
        Disposal d = calculate().disposals().getFirst();
        assertThat(d.proceedsEur()).isEqualTo(eur("3418.80"));
        assertThat(d.costEur()).isEqualTo(eur("4604.42"));
        assertThat(d.gainEur()).isEqualTo(eur("-1185.62"));
    }

    @Test
    void theEarliestSharesAreSoldFirst() {
        buy("2020-02-01", "ACME", "10", "100");
        buy("2021-02-01", "ACME", "10", "200");
        sell("2025-06-02", "ACME", "15", "300");
        Disposal d = calculate().disposals().getFirst();
        assertThat(d.matches()).extracting(m -> m.quantity().toPlainString(), m -> m.costEur(), CgtCalculator.Match::rule)
                .containsExactly(org.assertj.core.groups.Tuple.tuple("10", eur("1000"), Rule.FIRST_IN_FIRST_OUT),
                        org.assertj.core.groups.Tuple.tuple("5", eur("1000"), Rule.FIRST_IN_FIRST_OUT));
        assertThat(d.gainEur()).isEqualTo(eur("2500"));
        assertThat(calculate().holdings()).singleElement().satisfies(h -> {
            assertThat(h.quantity().toPlainString()).isEqualTo("5");
            assertThat(h.costEur()).isEqualTo(eur("1000"));
        });
    }

    @Test
    void sharesBoughtInTheFourWeeksBeforeASaleAreSoldFirstTheLatestFirst() {
        buy("2020-02-03", "ACME", "10", "100");
        buy("2025-05-10", "ACME", "5", "190");
        buy("2025-05-25", "ACME", "5", "200");
        sell("2025-06-01", "ACME", "7", "210");
        Disposal d = calculate().disposals().getFirst();
        assertThat(d.matches()).extracting(m -> m.purchased().toString(), m -> m.quantity().toPlainString(), CgtCalculator.Match::rule)
                .containsExactly(org.assertj.core.groups.Tuple.tuple("2025-05-25", "5", Rule.FOUR_WEEKS),
                        org.assertj.core.groups.Tuple.tuple("2025-05-10", "2", Rule.FOUR_WEEKS));
        // 5 × 200 + 2 × 190, not the 2020 shares at 100
        assertThat(d.costEur()).isEqualTo(eur("1380"));
    }

    @Test
    void fourWeeksMeans28Days() {
        buy("2020-02-03", "ACME", "10", "100");
        buy("2025-05-04", "ACME", "1", "200"); // 28 days before
        buy("2025-05-03", "ACME", "1", "300"); // 29 days before
        sell("2025-06-01", "ACME", "2", "210");
        assertThat(calculate().disposals().getFirst().matches())
                .extracting(m -> m.purchased().toString(), CgtCalculator.Match::rule)
                .containsExactly(org.assertj.core.groups.Tuple.tuple("2025-05-04", Rule.FOUR_WEEKS),
                        org.assertj.core.groups.Tuple.tuple("2020-02-03", Rule.FIRST_IN_FIRST_OUT));
    }

    @Test
    void sharesBoughtAndSoldTheSameDayAreMatched() {
        buy("2020-02-03", "ACME", "10", "100");
        sell("2025-06-02", "ACME", "5", "210");
        buy("2025-06-02", "ACME", "5", "200");
        Disposal d = calculate().disposals().getFirst();
        assertThat(d.matches()).singleElement().satisfies(m -> assertThat(m.rule()).isEqualTo(Rule.FOUR_WEEKS));
        assertThat(d.gainEur()).isEqualTo(eur("50"));
    }

    @Test
    void eachTradeIsInEuroAtItsOwnDaysRate() {
        // bought at 1.10 dollars a euro, sold at 1.20: the currency's move is part of the gain
        trade(Kind.BUY, "2024-01-10", "ACME", "10", "100", "0", "USD", "1.10");
        trade(Kind.SELL, "2025-03-03", "ACME", "10", "120", "6", "USD", "1.20");
        Disposal d = calculate().disposals().getFirst();
        assertThat(d.costEur()).isEqualTo(eur("909.09"));
        assertThat(d.proceedsEur()).isEqualTo(eur("1000"));
        assertThat(d.feesEur()).isEqualTo(eur("5"));
        assertThat(d.gainEur()).isEqualTo(eur("85.91"));
    }

    @Test
    void aLossOnSharesBoughtBackWithinFourWeeksIsRestrictedToThem() {
        buy("2024-01-02", "ACME", "100", "10");
        sell("2025-03-03", "ACME", "100", "8"); // a loss of 200
        buy("2025-03-20", "ACME", "50", "8"); // half bought back: half the loss is restricted
        sell("2025-08-01", "ACME", "50", "12"); // a gain of 200 on those shares
        CgtCalculator calc = calculate();
        Disposal loss = calc.disposals().get(0);
        assertThat(loss.gainEur()).isEqualTo(eur("-200"));
        assertThat(loss.restrictedLossEur()).isEqualTo(eur("100"));
        assertThat(loss.allowableEur()).isEqualTo(eur("-100"));
        Disposal gain = calc.disposals().get(1);
        assertThat(gain.gainEur()).isEqualTo(eur("200"));
        assertThat(gain.restrictedLossUsedEur()).isEqualTo(eur("100"));
        assertThat(gain.allowableEur()).isEqualTo(eur("100"));
        YearSummary year = calc.year(2025);
        assertThat(year.gainsEur()).isEqualTo(eur("100"));
        assertThat(year.lossesEur()).isEqualTo(eur("100"));
        assertThat(year.taxEur()).isEqualTo(eur("0"));
    }

    @Test
    void aRestrictedLossIsLostWhenTheSharesBoughtBackAreSoldAtALoss() {
        buy("2024-01-02", "ACME", "10", "10");
        sell("2025-03-03", "ACME", "10", "8"); // loss 20, all bought back
        buy("2025-03-10", "ACME", "10", "8");
        sell("2025-09-01", "ACME", "10", "7"); // loss 10
        CgtCalculator calc = calculate();
        assertThat(calc.disposals().get(0).allowableEur()).isEqualTo(eur("0"));
        Disposal second = calc.disposals().get(1);
        assertThat(second.restrictedLossLostEur()).isEqualTo(eur("20"));
        assertThat(second.allowableEur()).isEqualTo(eur("-10"));
    }

    @Test
    void buyingBackAfterFourWeeksDoesNotRestrictTheLoss() {
        buy("2024-01-02", "ACME", "10", "10");
        sell("2025-03-03", "ACME", "10", "8");
        buy("2025-04-01", "ACME", "10", "8"); // 29 days later
        assertThat(calculate().disposals().getFirst().allowableEur()).isEqualTo(eur("-20"));
    }

    @Test
    void theExemptionComesAfterTheLossesAndTheRestIsTaxedAt33Percent() {
        buy("2020-02-03", "ACME", "10", "100");
        sell("2025-06-02", "ACME", "10", "350"); // gain 2,500
        buy("2020-02-03", "BETA", "10", "100");
        sell("2025-06-16", "BETA", "10", "80"); // loss 200
        YearSummary year = calculate().year(2025);
        assertThat(year.gainsEur()).isEqualTo(eur("2500"));
        assertThat(year.lossesEur()).isEqualTo(eur("200"));
        assertThat(year.chargeableGainEur()).isEqualTo(eur("2300"));
        assertThat(year.exemptionEur()).isEqualTo(eur("1270"));
        assertThat(year.taxableGainEur()).isEqualTo(eur("1030"));
        assertThat(year.taxEur()).isEqualTo(eur("339.90"));
        assertThat(year.disposalCount()).isEqualTo(2);
        assertThat(year.considerationEur()).isEqualTo(eur("4300"));
    }

    @Test
    void earlierLossesAreUsedBeforeTheExemptionEvenWhenThatWastesIt() {
        buy("2020-02-03", "ACME", "10", "100");
        sell("2025-06-02", "ACME", "10", "300"); // gain 2,000
        YearSummary some = calculate("1000").year(2025);
        assertThat(some.lossesUsedEur()).isEqualTo(eur("1000"));
        assertThat(some.chargeableGainEur()).isEqualTo(eur("1000"));
        assertThat(some.exemptionEur()).isEqualTo(eur("1000"));
        assertThat(some.taxEur()).isEqualTo(eur("0"));
        assertThat(some.lossesCarriedForwardEur()).isEqualTo(eur("0"));

        YearSummary more = calculate("3000").year(2025);
        assertThat(more.lossesUsedEur()).isEqualTo(eur("2000"));
        assertThat(more.lossesCarriedForwardEur()).isEqualTo(eur("1000"));
    }

    @Test
    void aYearsUnusedLossIsCarriedForward() {
        buy("2020-02-03", "ACME", "10", "100");
        sell("2024-05-02", "ACME", "10", "50"); // loss 500
        buy("2020-02-03", "BETA", "10", "100");
        sell("2025-05-02", "BETA", "10", "400"); // gain 3,000
        CgtCalculator calc = calculate();
        assertThat(calc.year(2024).lossesCarriedForwardEur()).isEqualTo(eur("500"));
        YearSummary year = calc.year(2025);
        assertThat(year.lossesBroughtForwardEur()).isEqualTo(eur("500"));
        assertThat(year.chargeableGainEur()).isEqualTo(eur("2500"));
        assertThat(year.taxEur()).isEqualTo(eur("405.90"));
        // and through a year without sales
        assertThat(calc.year(2023).lossesCarriedForwardEur()).isEqualTo(eur("0"));
        assertThat(calc.year(2026).lossesBroughtForwardEur()).isEqualTo(eur("0"));
    }

    @Test
    void januaryToNovemberIsPaidBy15DecemberAndDecemberBy31January() {
        buy("2020-02-03", "ACME", "100", "10");
        sell("2025-06-02", "ACME", "100", "40"); // gain 3,000 in the initial period
        buy("2020-02-03", "BETA", "50", "30");
        sell("2025-12-10", "BETA", "50", "10"); // loss 1,000 in December
        YearSummary year = calculate().year(2025);
        assertThat(year.initialPeriod().gainsEur()).isEqualTo(eur("3000"));
        assertThat(year.laterPeriod().lossesEur()).isEqualTo(eur("1000"));
        // the year: (2,000 − 1,270) × 33%; January to November alone: (3,000 − 1,270) × 33%
        assertThat(year.taxEur()).isEqualTo(eur("240.90"));
        assertThat(year.initialPaymentEur()).isEqualTo(eur("570.90"));
        assertThat(year.initialDue()).isEqualTo(LocalDate.of(2025, 12, 15));
        // December's loss: a refund of what was paid
        assertThat(year.laterPaymentEur()).isEqualTo(eur("-330.00"));
        assertThat(year.laterDue()).isEqualTo(LocalDate.of(2026, 1, 31));
        assertThat(year.returnDue()).isEqualTo(LocalDate.of(2026, 10, 31));
        // on the return, December's net gain would be negative: flagged
        assertThat(year.form11().initialNetGainEur()).isEqualTo(eur("1730"));
        assertThat(year.form11().laterNetGainEur()).isEqualTo(eur("-1000"));
        assertThat(year.problems()).anyMatch(p -> p.startsWith("December's losses lower the year's gain"));
    }

    @Test
    void salesFrom7October2026AreTaxedAt31Percent() {
        buy("2020-02-03", "ACME", "40", "100");
        sell("2026-10-06", "ACME", "10", "300"); // gain 2,000 at 33%
        sell("2026-10-07", "ACME", "10", "400"); // gain 3,000 at 31%
        assertThat(calculate().disposals()).extracting(Disposal::ratePercent).containsExactly(new BigDecimal("33"), new BigDecimal("31"));
        buy("2020-02-03", "BETA", "10", "100");
        sell("2026-11-02", "BETA", "10", "50"); // loss 500
        sell("2026-12-03", "ACME", "10", "200"); // gain 1,000 at 31%, in December
        YearSummary year = calculate().year(2026);
        assertThat(year.gainsByRate()).containsExactly(new CgtCalculator.AtRate(new BigDecimal("33"), eur("2000")),
                new CgtCalculator.AtRate(new BigDecimal("31"), eur("4000")));
        // the loss and the exemption come off the 33% gains first: (2,000 − 500 − 1,270) × 33% + 4,000 × 31%
        assertThat(year.taxableGainEur()).isEqualTo(eur("4230"));
        assertThat(year.taxEur()).isEqualTo(eur("1315.90"));
        // January to November: 230 × 33% + 3,000 × 31%; December: 1,000 × 31%
        assertThat(year.initialPaymentEur()).isEqualTo(eur("1005.90"));
        assertThat(year.laterPaymentEur()).isEqualTo(eur("310.00"));
        // on Form 11, a line for each rate and period
        assertThat(year.form11().netGainsByRate()).containsExactly(
                new CgtCalculator.RateLine(new BigDecimal("33"), eur("230"), eur("0")),
                new CgtCalculator.RateLine(new BigDecimal("31"), eur("3000"), eur("1000")));
        assertThat(year.form11().initialNetGainEur()).isEqualTo(eur("3230"));
        assertThat(year.problems()).isEmpty();
    }

    @Test
    void laterYearsAreTaxedAt31PercentAndEarlierOnesAt33() {
        buy("2020-02-03", "ACME", "20", "100");
        sell("2025-05-05", "ACME", "10", "400"); // gain 3,000
        sell("2027-05-05", "ACME", "10", "400"); // gain 3,000
        assertThat(calculate().year(2025).taxEur()).isEqualTo(eur("570.90"));
        assertThat(calculate().year(2027).taxEur()).isEqualTo(eur("536.30"));
        assertThat(calculate().year(2027).form11().netGainsByRate()).containsExactly(
                new CgtCalculator.RateLine(new BigDecimal("31"), eur("1730"), eur("0")));
    }

    @Test
    void theSharesStillHeldByPurchaseWithTheirCost() {
        buy("2025-06-16", "ACME", "150", "40");
        sell("2025-06-17", "ACME", "70", "41");
        buy("2025-09-15", "ACME", "75", "35");
        sell("2025-09-16", "ACME", "40", "36");
        buy("2024-01-02", "BETA", "10", "100");
        List<CgtCalculator.OpenLot> lots = calculate().openLots();
        // what's left of each purchase, at its part of the cost
        assertThat(lots).extracting(CgtCalculator.OpenLot::symbol, CgtCalculator.OpenLot::date, CgtCalculator.OpenLot::quantity,
                        CgtCalculator.OpenLot::costEur)
                .containsExactly(
                        org.assertj.core.groups.Tuple.tuple("ACME", LocalDate.of(2025, 6, 16), new BigDecimal("80"), eur("3200")),
                        org.assertj.core.groups.Tuple.tuple("ACME", LocalDate.of(2025, 9, 15), new BigDecimal("35"), eur("1225")),
                        org.assertj.core.groups.Tuple.tuple("BETA", LocalDate.of(2024, 1, 2), new BigDecimal("10"), eur("1000")));
    }

    @Test
    void form11sCapitalGainsFigures() {
        buy("2020-02-03", "ACME", "10", "100");
        sell("2025-06-02", "ACME", "10", "350"); // gain 2,500
        buy("2020-02-03", "BETA", "10", "100");
        sell("2025-06-16", "BETA", "10", "80"); // loss 200
        buy("2020-02-03", "GAMMA", "10", "100");
        sell("2025-12-05", "GAMMA", "10", "200"); // gain 1,000 in December
        YearSummary year = calculate("500").year(2025);
        CgtCalculator.Form11 form = year.form11();
        // gains less the year's losses; then earlier losses, the exemption, the net chargeable gain
        assertThat(form.gainsNetOfLossesEur()).isEqualTo(eur("3300"));
        assertThat(year.lossesUsedEur()).isEqualTo(eur("500"));
        assertThat(year.exemptionEur()).isEqualTo(eur("1270"));
        assertThat(year.taxableGainEur()).isEqualTo(eur("1530"));
        // by period: January to November (2,300 − 500 − 1,270), and December's
        assertThat(form.initialNetGainEur()).isEqualTo(eur("530"));
        assertThat(form.laterNetGainEur()).isEqualTo(eur("1000"));
        assertThat(year.initialPaymentEur()).isEqualTo(eur("174.90"));
        assertThat(year.laterPaymentEur()).isEqualTo(eur("330.00"));
        assertThat(form.currentLossesCarriedForwardEur()).isEqualTo(eur("0"));
        assertThat(form.earlierLossesCarriedForwardEur()).isEqualTo(eur("0"));
        assertThat(year.problems()).isEmpty();
        // panel M: none of the shares were acquired in 2025
        assertThat(form.sharesAcquired()).isZero();
    }

    @Test
    void form11sSharesAcquiredInTheYearAtTheirCostInEuro() {
        trade(Kind.BUY, "2025-06-16", "ACME", "150", "39.80", "0", "USD", "1.18"); // an RSU vest at its market value
        trade(Kind.BUY, "2025-09-15", "ACME", "75", "36.20", "1.95", "USD", "1.18");
        buy("2024-03-01", "ACME", "10", "100");
        YearSummary year = calculate().year(2025);
        assertThat(year.form11().sharesAcquired()).isEqualTo(2);
        // (150 × 39.80 + 75 × 36.20 + 1.95) / 1.18
        assertThat(year.form11().sharesAcquiredEur()).isEqualTo(eur("7361.82"));
    }

    @Test
    void form11sLossesCarriedForwardAreTheYearsAndEarlierOnes() {
        buy("2020-02-03", "BETA", "10", "100");
        sell("2025-06-16", "BETA", "10", "80"); // loss 200
        YearSummary year = calculate("500").year(2025);
        assertThat(year.form11().gainsNetOfLossesEur()).isEqualTo(eur("0"));
        assertThat(year.form11().currentLossesCarriedForwardEur()).isEqualTo(eur("200"));
        assertThat(year.form11().earlierLossesCarriedForwardEur()).isEqualTo(eur("500"));
        assertThat(year.lossesCarriedForwardEur()).isEqualTo(eur("700"));
        assertThat(year.form11().initialNetGainEur()).isEqualTo(eur("0"));
    }

    @Test
    void aSaleWithoutItsPurchaseIsFlagged() {
        buy("2020-02-03", "ACME", "5", "100");
        sell("2025-06-02", "ACME", "8", "150");
        CgtCalculator calc = calculate();
        assertThat(calc.disposals().getFirst().unmatchedQuantity().toPlainString()).isEqualTo("3");
        assertThat(calc.year(2025).problems()).singleElement().asString().contains("3 missing");
    }

    @Test
    void yearsBefore2013AreFlagged() {
        buy("2010-02-03", "ACME", "5", "100");
        sell("2012-06-04", "ACME", "5", "150");
        assertThat(calculate().year(2012).problems()).singleElement().asString().contains("other CGT rates");
    }

    @Test
    void companiesAreMatchedSeparatelyAndFractionsOfSharesWork() {
        buy("2024-02-01", "ACME", "1.5", "100");
        buy("2024-02-01", "BETA", "3", "50");
        sell("2025-06-02", "BETA", "0.75", "80");
        Disposal d = calculate().disposals().getFirst();
        assertThat(d.costEur()).isEqualTo(eur("37.50"));
        assertThat(d.gainEur()).isEqualTo(eur("22.50"));
        assertThat(calculate().holdings()).extracting(h -> h.symbol() + " " + h.quantity().toPlainString())
                .containsExactly("ACME 1.5", "BETA 2.25");
    }
}
