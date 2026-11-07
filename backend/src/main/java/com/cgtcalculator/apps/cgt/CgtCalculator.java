package com.cgtcalculator.apps.cgt;

import java.math.BigDecimal;
import java.math.MathContext;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

import org.jspecify.annotations.Nullable;

import com.cgtcalculator.platform.ledger.ShareTradeService;

/**
 * Capital gains on shares under Irish rules ({@link CgtRules}): every purchase and sale in euro at its own day's rate,
 * each sale matched with the shares it disposes of, and each tax year's figures for Form 11.
 * <p>
 * Matching, per company: a sale is first matched with shares bought in the four weeks up to it (the latest first,
 * s.581 TCA 1997), then with the earliest shares still held (first in, first out, s.580). A sale at a loss followed
 * within four weeks by buying the same shares back has that share of the loss restricted: it can only be set
 * against a gain on selling the shares bought back (s.581(3)); otherwise it is lost.
 * <p>
 * Costs: the purchase price plus its fees; a sale's fees reduce its proceeds. RSUs and ESPP shares are bought at
 * their market value on the day they were taxed as income. A split gives more shares for the same cost (no disposal);
 * a sale whose purchase isn't recorded may say what its shares cost.
 */
public final class CgtCalculator {

    private static final MathContext MC = MathContext.DECIMAL128;
    private static final BigDecimal ZERO = BigDecimal.ZERO;

    public enum Kind {
        BUY, SELL
    }

    /**
     * A purchase or sale.
     *
     * @param price   per share, in {@code currency}
     * @param fees    broker fees and other costs of the trade, in {@code currency}
     * @param eurRate units of {@code currency} per euro on the day (the ECB reference rate), 1 for euro
     * @param costEur for a sale whose purchase isn't recorded: what the shares sold cost, in euro, with fees
     */
    public record Trade(long id, Kind kind, LocalDate date, String symbol, BigDecimal quantity, BigDecimal price,
                        String currency, BigDecimal fees, BigDecimal eurRate, @Nullable BigDecimal costEur) {

        public Trade(long id, Kind kind, LocalDate date, String symbol, BigDecimal quantity, BigDecimal price, String currency,
                     BigDecimal fees, BigDecimal eurRate) {
            this(id, kind, date, symbol, quantity, price, currency, fees, eurRate, null);
        }
    }

    /** A split: from its day, {@code ratio} shares for each one held (20 for 20-for-1), for the same cost. */
    public record Split(LocalDate date, String symbol, BigDecimal ratio) {
    }

    /** Which rule matched shares with a sale. */
    public enum Rule {
        /** bought in the four weeks up to the sale */
        FOUR_WEEKS,
        /** the earliest shares still held */
        FIRST_IN_FIRST_OUT
    }

    /** Shares of one purchase matched with a sale, and their cost in euro. */
    public record Match(long purchaseId, LocalDate purchased, BigDecimal quantity, BigDecimal costEur, Rule rule) {
    }

    /**
     * A sale and its gain.
     *
     * @param proceedsEur          the sale price (the consideration), before its fees
     * @param gainEur              proceeds less fees and cost; negative for a loss
     * @param restrictedLossUsedEur an earlier sale's restricted loss set against this gain (these are the shares bought back)
     * @param restrictedLossLostEur an earlier sale's restricted loss these shares carried that this sale couldn't use
     * @param restrictedLossEur    the part of this sale's loss that is restricted: the shares were bought back within four weeks
     * @param allowableEur         what counts for the tax year: the gain less a restricted loss used, or the loss less its restricted part
     * @param ratePercent          the rate of the sale's day: 33%, or 31% from 7 October 2026
     * @param unmatchedQuantity    shares sold that were never bought (a purchase is missing): their cost is unknown
     */
    public record Disposal(long saleId, LocalDate date, String symbol, BigDecimal quantity, BigDecimal proceedsEur,
                           BigDecimal feesEur, BigDecimal costEur, BigDecimal gainEur, BigDecimal restrictedLossUsedEur,
                           BigDecimal restrictedLossLostEur, BigDecimal restrictedLossEur, BigDecimal allowableEur,
                           BigDecimal ratePercent, BigDecimal unmatchedQuantity, List<Match> matches) {
    }

    /** Shares still held, and what they cost in euro. */
    public record Holding(String symbol, BigDecimal quantity, BigDecimal costEur) {
    }

    /** A purchase's shares still held, and what they cost in euro (fees included). */
    public record OpenLot(long tradeId, LocalDate date, String symbol, BigDecimal quantity, BigDecimal costEur) {
    }

    /** An amount at a rate (%). */
    public record AtRate(BigDecimal ratePercent, BigDecimal amountEur) {
    }

    /** Form 11's net gain at one rate, by payment period (after the losses and the exemption). */
    public record RateLine(BigDecimal ratePercent, BigDecimal initialNetGainEur, BigDecimal laterNetGainEur) {
    }

    /** The gains and losses of a payment period. */
    public record Period(BigDecimal gainsEur, BigDecimal lossesEur) {
    }

    /**
     * The figures of Form 11's capital gains panel (L) that aren't in the year's summary already.
     *
     * @param gainsNetOfLossesEur            the year's gains less its losses (none when they're a loss): before earlier
     *                                       years' losses and the exemption
     * @param currentLossesCarriedForwardEur the year's net loss, carried forward
     * @param earlierLossesCarriedForwardEur earlier years' losses this year didn't use, carried forward
     * @param initialNetGainEur              the net chargeable gain of January to November (taxed by the first payment)
     * @param laterNetGainEur                the rest of the year's net chargeable gain: December's
     * @param netGainsByRate                 the same by rate: a line each on the form (the year's rates, the highest first)
     * @param sharesAcquired                 the year's purchases (RSU vests and ESPP purchases included), for panel M
     * @param sharesAcquiredEur              what they cost in euro, fees included (an RSU vest's: its market value)
     */
    public record Form11(BigDecimal gainsNetOfLossesEur, BigDecimal currentLossesCarriedForwardEur,
                         BigDecimal earlierLossesCarriedForwardEur, BigDecimal initialNetGainEur, BigDecimal laterNetGainEur,
                         List<RateLine> netGainsByRate, int sharesAcquired, BigDecimal sharesAcquiredEur) {
    }

    /**
     * A tax year: the figures for Form 11 (panel L, quoted shares) and what to pay by when.
     *
     * @param disposalCount           the number of disposals (sales)
     * @param considerationEur        their aggregate consideration (the sale prices)
     * @param gainsByRate             the year's gains (before losses) by the rate of their sales' days
     * @param lossesBroughtForwardEur unused losses of earlier years available this year
     * @param lossesUsedEur           how much of those this year's gains used up (all they can, before the exemption)
     * @param chargeableGainEur       the gains less the year's losses and earlier years' losses
     * @param taxEur                  the year's CGT
     * @param initialPaymentEur       due by {@code initialDue}: the tax on January to November's disposals
     * @param laterPaymentEur         due by {@code laterDue}: the rest; negative when December's losses make it a refund
     * @param lossesCarriedForwardEur unused losses left for later years
     * @param form11                  the rest of Form 11's capital gains figures
     * @param problems                what makes the figures unreliable (a sale without its purchase, an unsupported year)
     */
    public record YearSummary(int year, int disposalCount, BigDecimal considerationEur, Period initialPeriod,
                              Period laterPeriod, BigDecimal gainsEur, BigDecimal lossesEur, List<AtRate> gainsByRate,
                              BigDecimal lossesBroughtForwardEur, BigDecimal lossesUsedEur, BigDecimal chargeableGainEur,
                              BigDecimal exemptionEur, BigDecimal taxableGainEur, BigDecimal taxEur,
                              BigDecimal initialPaymentEur, LocalDate initialDue, BigDecimal laterPaymentEur,
                              LocalDate laterDue, LocalDate returnDue, BigDecimal lossesCarriedForwardEur, Form11 form11,
                              List<Disposal> disposals, List<String> problems) {
    }

    /** A purchase's shares not sold yet, with their cost and any restricted loss they carry. */
    private static final class Lot {
        final long tradeId;
        final LocalDate date;
        BigDecimal quantity;
        BigDecimal cost;
        BigDecimal restricted;

        Lot(long tradeId, LocalDate date, BigDecimal quantity, BigDecimal cost, BigDecimal restricted) {
            this.tradeId = tradeId;
            this.date = date;
            this.quantity = quantity;
            this.cost = cost;
            this.restricted = restricted;
        }
    }

    private final List<Disposal> disposals = new ArrayList<>();
    private final List<Trade> purchases;
    private final List<Holding> holdings = new ArrayList<>();
    private final List<OpenLot> openLots = new ArrayList<>();
    private final BigDecimal lossesBefore;
    /** about trades left out, for every year's problems */
    private final List<String> warnings;

    /**
     * @param lossesBefore unused losses from years before the first sale recorded here
     */
    public CgtCalculator(List<Trade> trades, BigDecimal lossesBefore) {
        this(trades, List.of(), lossesBefore);
    }

    /**
     * @param splits       the companies' splits
     * @param lossesBefore unused losses from years before the first sale recorded here
     */
    public CgtCalculator(List<Trade> trades, List<Split> splits, BigDecimal lossesBefore) {
        this(trades, splits, lossesBefore, List.of());
    }

    /**
     * @param splits       the companies' splits
     * @param lossesBefore unused losses from years before the first sale recorded here
     * @param warnings     about trades left out, told with every year's figures
     */
    public CgtCalculator(List<Trade> trades, List<Split> splits, BigDecimal lossesBefore, List<String> warnings) {
        this.lossesBefore = lossesBefore.max(ZERO);
        this.warnings = List.copyOf(warnings);
        this.purchases = trades.stream().filter(t -> t.kind() == Kind.BUY).toList();
        // by company, its ticker however written (BRK.B, BRK-B); shown as first recorded
        Map<String, List<Trade>> byCompany = new TreeMap<>();
        for (Trade trade : trades) byCompany.computeIfAbsent(ShareTradeService.symbolKey(trade.symbol()), s -> new ArrayList<>()).add(trade);
        byCompany.forEach((key, list) -> match(list.getFirst().symbol(), list,
                splits.stream().filter(x -> ShareTradeService.symbolKey(x.symbol()).equals(key)).toList()));
        disposals.sort(Comparator.comparing(Disposal::date).thenComparing(Disposal::saleId));
    }

    public List<Disposal> disposals() {
        return disposals;
    }

    public List<Holding> holdings() {
        return holdings;
    }

    /** The purchases' shares still held, each with its cost: the oldest first, by company. */
    public List<OpenLot> openLots() {
        return openLots;
    }

    private void match(String symbol, List<Trade> trades, List<Split> splits) {
        // by day; a purchase on the day of a sale counts as before it; a day's in the order entered
        List<Trade> ordered = new ArrayList<>(trades);
        ordered.sort(Comparator.comparing(Trade::date).thenComparing(t -> t.kind() == Kind.BUY ? 0 : 1).thenComparingLong(Trade::id));
        List<Split> pending = new ArrayList<>(splits);
        pending.sort(Comparator.comparing(Split::date));
        List<Lot> lots = new ArrayList<>();
        Map<Long, BigDecimal> restrictedFor = new HashMap<>();

        for (Trade trade : ordered) {
            // a split from before the trade's day (on its day, the trade is in the new shares)
            while (!pending.isEmpty() && !pending.getFirst().date().isAfter(trade.date())) {
                BigDecimal ratio = pending.removeFirst().ratio();
                for (Lot lot : lots) lot.quantity = lot.quantity.multiply(ratio, MC);
            }
            if (trade.kind() == Kind.BUY) {
                lots.add(new Lot(trade.id(), trade.date(), trade.quantity(), cost(trade), restrictedFor.getOrDefault(trade.id(), ZERO)));
                continue;
            }
            disposals.add(sell(trade, lots, ordered, restrictedFor, splits));
        }
        // the splits since the last trade: the shares held now
        for (Split split : pending) {
            for (Lot lot : lots) lot.quantity = lot.quantity.multiply(split.ratio(), MC);
        }
        BigDecimal quantity = ZERO;
        BigDecimal cost = ZERO;
        for (Lot lot : lots) {
            quantity = quantity.add(lot.quantity);
            cost = cost.add(lot.cost);
            if (lot.quantity.signum() > 0) openLots.add(new OpenLot(lot.tradeId, lot.date, symbol, plain(lot.quantity), euro(lot.cost)));
        }
        if (quantity.signum() > 0) holdings.add(new Holding(symbol, quantity.stripTrailingZeros(), euro(cost)));
    }

    private Disposal sell(Trade sale, List<Lot> lots, List<Trade> all, Map<Long, BigDecimal> restrictedFor, List<Split> splits) {
        BigDecimal left = sale.quantity();
        List<Match> matches = new ArrayList<>();
        BigDecimal cost = ZERO;
        BigDecimal carriedRestricted = ZERO;

        // shares bought in the four weeks up to the sale, the latest first; then the earliest still held
        LocalDate windowStart = sale.date().minusDays(CgtRules.FOUR_WEEKS);
        List<Lot> recent = lots.stream().filter(l -> !l.date.isBefore(windowStart)).sorted(Comparator.comparing((Lot l) -> l.date).reversed()).toList();
        for (Rule rule : Rule.values()) {
            List<Lot> candidates = rule == Rule.FOUR_WEEKS ? recent : lots;
            for (Lot lot : candidates) {
                if (left.signum() == 0) break;
                if (lot.quantity.signum() == 0) continue;
                BigDecimal take = left.min(lot.quantity);
                BigDecimal share = take.divide(lot.quantity, MC);
                BigDecimal lotCost = lot.cost.multiply(share, MC);
                BigDecimal lotRestricted = lot.restricted.multiply(share, MC);
                lot.cost = lot.cost.subtract(lotCost);
                lot.restricted = lot.restricted.subtract(lotRestricted);
                lot.quantity = lot.quantity.subtract(take);
                cost = cost.add(lotCost);
                carriedRestricted = carriedRestricted.add(lotRestricted);
                left = left.subtract(take);
                matches.add(new Match(lot.tradeId, lot.date, take.stripTrailingZeros(), euro(lotCost), rule));
            }
        }
        lots.removeIf(l -> l.quantity.signum() == 0);
        // shares whose purchase isn't recorded, at the cost the sale gives for them
        if (left.signum() > 0 && sale.costEur() != null) {
            cost = cost.add(sale.costEur().multiply(left, MC).divide(sale.quantity(), MC));
            left = ZERO;
        }

        // in euro and cent first, so that the gain shown is the difference of the amounts shown
        BigDecimal proceeds = euro(sale.quantity().multiply(sale.price(), MC).divide(sale.eurRate(), MC));
        BigDecimal fees = euro(sale.fees().divide(sale.eurRate(), MC));
        cost = euro(cost);
        BigDecimal gain = proceeds.subtract(fees).subtract(cost);

        // a restricted loss these shares carry from an earlier sale: only against this gain
        BigDecimal used = gain.signum() > 0 ? carriedRestricted.min(gain) : ZERO;
        BigDecimal lost = carriedRestricted.subtract(used);

        // a loss, and the same shares bought back within four weeks: that share of the loss is restricted to them
        BigDecimal restricted = ZERO;
        if (gain.signum() < 0) {
            restricted = restrictLoss(sale, gain.negate(), all, restrictedFor, splits);
        }
        BigDecimal allowable = gain.signum() < 0 ? gain.add(restricted) : gain.subtract(used);
        return new Disposal(sale.id(), sale.date(), sale.symbol(), sale.quantity().stripTrailingZeros(), euro(proceeds), euro(fees),
                euro(cost), euro(gain), euro(used), euro(lost), euro(restricted), euro(allowable), percent(CgtRules.rate(sale.date())),
                left.stripTrailingZeros(), matches);
    }

    /**
     * Restricts the loss by the share of the sale bought back within four weeks after it; returns the restricted amount.
     * Shares bought back after a split are counted in the shares sold (10 after a 10-for-1 split are one sold).
     */
    private static BigDecimal restrictLoss(Trade sale, BigDecimal loss, List<Trade> all, Map<Long, BigDecimal> restrictedFor, List<Split> splits) {
        LocalDate windowEnd = sale.date().plusDays(CgtRules.FOUR_WEEKS);
        Map<Long, BigDecimal> covered = new LinkedHashMap<>();
        BigDecimal left = sale.quantity();
        for (Trade buy : all) {
            if (left.signum() == 0) break;
            if (buy.kind() != Kind.BUY || !buy.date().isAfter(sale.date()) || buy.date().isAfter(windowEnd)) continue;
            BigDecimal ratio = splits.stream().filter(x -> x.date().isAfter(sale.date()) && !x.date().isAfter(buy.date()))
                    .map(Split::ratio).reduce(BigDecimal.ONE, BigDecimal::multiply);
            BigDecimal take = left.min(buy.quantity().divide(ratio, MC));
            covered.put(buy.id(), take);
            left = left.subtract(take);
        }
        BigDecimal boughtBack = sale.quantity().subtract(left);
        if (boughtBack.signum() == 0) return ZERO;
        BigDecimal restricted = loss.multiply(boughtBack, MC).divide(sale.quantity(), MC);
        // carried by the shares bought back, in proportion
        covered.forEach((buyId, quantity) -> restrictedFor.merge(buyId, restricted.multiply(quantity, MC).divide(boughtBack, MC), BigDecimal::add));
        return restricted;
    }

    /** A purchase's cost in euro: its shares and fees at the day's rate. */
    private static BigDecimal cost(Trade purchase) {
        return purchase.quantity().multiply(purchase.price(), MC).add(purchase.fees(), MC).divide(purchase.eurRate(), MC);
    }

    /** The tax year's figures; losses are carried forward from the first year with a sale. */
    public YearSummary year(int year) {
        BigDecimal broughtForward = lossesBefore;
        int first = disposals.isEmpty() ? year : Math.min(year, disposals.getFirst().date().getYear());
        YearSummary summary = null;
        for (int y = first; y <= year; y++) {
            summary = yearFrom(y, broughtForward);
            broughtForward = summary.lossesCarriedForwardEur();
        }
        return summary;
    }

    private YearSummary yearFrom(int year, BigDecimal broughtForward) {
        List<Disposal> inYear = disposals.stream().filter(d -> d.date().getYear() == year).toList();
        // gains by the rate of their days, the highest first; losses count whatever their rate
        Map<BigDecimal, BigDecimal> initialGains = byRate(year);
        Map<BigDecimal, BigDecimal> laterGains = byRate(year);
        BigDecimal[] losses = {ZERO, ZERO};
        BigDecimal consideration = ZERO;
        List<String> problems = new ArrayList<>();
        for (Disposal d : inYear) {
            boolean later = CgtRules.laterPeriod(d.date());
            if (d.allowableEur().signum() >= 0) (later ? laterGains : initialGains).merge(CgtRules.rate(d.date()), d.allowableEur(), BigDecimal::add);
            else losses[later ? 1 : 0] = losses[later ? 1 : 0].add(d.allowableEur().negate());
            consideration = consideration.add(d.proceedsEur());
            if (d.unmatchedQuantity().signum() > 0) {
                problems.add("The sale of " + d.quantity().toPlainString() + " " + d.symbol() + " on " + d.date() + " is more than was bought ("
                        + d.unmatchedQuantity().toPlainString() + " missing): add the missing purchase, or the gain is too high.");
            }
        }
        problems.addAll(warnings);
        if (year < CgtRules.FIRST_SUPPORTED_YEAR) {
            problems.add(year + " had other CGT rates: its figures here use 33%.");
        }
        Map<BigDecimal, BigDecimal> gainsByRate = byRate(year);
        initialGains.forEach((rate, gain) -> gainsByRate.merge(rate, gain, BigDecimal::add));
        laterGains.forEach((rate, gain) -> gainsByRate.merge(rate, gain, BigDecimal::add));
        BigDecimal initialGain = sum(initialGains);
        BigDecimal laterGain = sum(laterGains);
        BigDecimal gains = initialGain.add(laterGain);
        BigDecimal yearLosses = losses[0].add(losses[1]);

        Tax whole = tax(gainsByRate, yearLosses, broughtForward);
        // the January to November payment: those months' gains and losses alone
        Tax initialOnly = tax(initialGains, losses[0], broughtForward);
        BigDecimal carriedForward = whole.net.signum() < 0 ? broughtForward.add(whole.net.negate()) : broughtForward.subtract(whole.lossesUsed);
        BigDecimal laterNetGain = whole.taxable.subtract(initialOnly.taxable);
        if (laterNetGain.signum() < 0) {
            problems.add("December's losses lower the year's gain below January to November's: check with Revenue how to split the "
                    + "net chargeable gain between the two periods on Form 11.");
        }
        List<RateLine> lines = whole.taxableByRate.keySet().stream()
                .map(rate -> new RateLine(percent(rate), euro(initialOnly.taxableByRate.get(rate)),
                        euro(whole.taxableByRate.get(rate).subtract(initialOnly.taxableByRate.get(rate)))))
                .toList();
        List<Trade> acquired = purchases.stream().filter(p -> p.date().getYear() == year).toList();
        Form11 form11 = new Form11(euro(whole.net.max(ZERO)), euro(whole.net.min(ZERO).negate()),
                euro(broughtForward.subtract(whole.lossesUsed)), euro(initialOnly.taxable), euro(laterNetGain), lines, acquired.size(),
                euro(acquired.stream().map(CgtCalculator::cost).reduce(ZERO, BigDecimal::add)));

        return new YearSummary(year, inYear.size(), consideration, new Period(initialGain, losses[0]), new Period(laterGain, losses[1]),
                gains, yearLosses, gainsByRate.entrySet().stream().map(e -> new AtRate(percent(e.getKey()), euro(e.getValue()))).toList(),
                euro(broughtForward), euro(whole.lossesUsed), euro(whole.chargeable), euro(whole.exemption),
                euro(whole.taxable), euro(whole.tax), euro(initialOnly.tax), CgtRules.initialPaymentDue(year),
                euro(whole.tax.subtract(initialOnly.tax)), CgtRules.laterPaymentDue(year), CgtRules.returnDue(year),
                euro(carriedForward), form11, inYear, problems);
    }

    /** The year's rates, the highest first, at nothing yet. */
    private static Map<BigDecimal, BigDecimal> byRate(int year) {
        Map<BigDecimal, BigDecimal> rates = new TreeMap<>(Comparator.reverseOrder());
        CgtRules.rates(year).forEach(rate -> rates.put(rate, ZERO));
        return rates;
    }

    private static BigDecimal sum(Map<BigDecimal, BigDecimal> byRate) {
        return byRate.values().stream().reduce(ZERO, BigDecimal::add);
    }

    /**
     * @param taxableByRate what's left of the gains at each rate after the losses and the exemption: what's taxed
     */
    private record Tax(BigDecimal net, BigDecimal lossesUsed, BigDecimal chargeable, BigDecimal exemption, BigDecimal taxable,
                       BigDecimal tax, Map<BigDecimal, BigDecimal> taxableByRate) {
    }

    /**
     * The year's losses, then earlier years' as far as the gains go (they can't be kept for later), then the exemption,
     * come off the gains; with gains at two rates, off the higher rate's first, which leaves the least tax.
     */
    private static Tax tax(Map<BigDecimal, BigDecimal> gains, BigDecimal losses, BigDecimal broughtForward) {
        BigDecimal net = sum(gains).subtract(losses);
        Map<BigDecimal, BigDecimal> left = new TreeMap<>(Comparator.reverseOrder());
        left.putAll(gains);
        takeOff(left, losses);
        BigDecimal used = net.signum() > 0 ? broughtForward.min(net) : ZERO;
        takeOff(left, used);
        BigDecimal chargeable = net.signum() > 0 ? net.subtract(used) : ZERO;
        BigDecimal exemption = CgtRules.EXEMPTION.min(chargeable);
        takeOff(left, exemption);
        BigDecimal taxable = chargeable.subtract(exemption);
        BigDecimal tax = left.entrySet().stream().map(e -> e.getValue().multiply(e.getKey(), MC)).reduce(ZERO, BigDecimal::add);
        return new Tax(net, used, chargeable, exemption, taxable, euro(tax), left);
    }

    /** Takes an amount off the gains, the highest rate's first. */
    private static void takeOff(Map<BigDecimal, BigDecimal> gains, BigDecimal amount) {
        BigDecimal rest = amount;
        for (Map.Entry<BigDecimal, BigDecimal> entry : gains.entrySet()) {
            BigDecimal taken = entry.getValue().min(rest).max(ZERO);
            entry.setValue(entry.getValue().subtract(taken));
            rest = rest.subtract(taken);
        }
    }

    /** 0.31 → 31 */
    private static BigDecimal percent(BigDecimal rate) {
        return plain(rate.movePointRight(2));
    }

    /** Without trailing zeros, and whole numbers as such: 10, not 1E+1. */
    static BigDecimal plain(BigDecimal value) {
        BigDecimal stripped = value.stripTrailingZeros();
        return stripped.scale() < 0 ? stripped.setScale(0) : stripped;
    }

    /** Euro and cent. */
    static BigDecimal euro(BigDecimal value) {
        return value.setScale(2, RoundingMode.HALF_UP);
    }
}
