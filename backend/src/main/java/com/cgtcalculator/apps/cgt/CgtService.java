package com.cgtcalculator.apps.cgt;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.HashSet;
import java.util.Set;
import java.util.TreeSet;

import org.jspecify.annotations.Nullable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import com.cgtcalculator.apps.cgt.CgtCalculator.Holding;
import com.cgtcalculator.apps.cgt.CgtCalculator.Kind;
import com.cgtcalculator.apps.cgt.CgtCalculator.YearSummary;
import com.cgtcalculator.platform.ledger.ShareTrade;
import com.cgtcalculator.platform.ledger.ShareTrade.Source;
import com.cgtcalculator.platform.ledger.ShareTradeService;
import com.cgtcalculator.platform.market.EcbRates;
import com.cgtcalculator.platform.web.ApiExceptionHandler.ValidationException;

/**
 * Each user's CGT, from their share trades ({@link ShareTradeService}): their own
 * shares' purchases and sales, not a partner's or joint ones, nor ETFs (exit tax); and the companies' splits. Users
 * only ever see and change their own.
 */
@Service
@Transactional
public class CgtService {

    /** A purchase or sale as entered; without a rate, the ECB's rate of the day is used. */
    public record Fields(Kind kind, LocalDate date, String symbol, BigDecimal quantity, BigDecimal price, String currency,
                         @Nullable BigDecimal fees, @Nullable BigDecimal eurRate, @Nullable Source source, @Nullable String note) {
    }

    /**
     * A user's CGT for a tax year.
     *
     * @param years        the years with sales, and this year, newest first
     * @param summary      the year asked for; by default the latest with sales, else this year
     * @param holdings     the shares held now, with their cost
     * @param lossesBefore unused losses from before the first sale recorded here
     */
    public record CgtOverview(List<Integer> years, YearSummary summary, List<Holding> holdings, BigDecimal lossesBefore) {
    }

    private final ShareTradeService trades;
    private final CgtSettingsRepository settings;
    private final EcbRates rates;
    private final Clock clock;
    private final TransactionTemplate transaction;

    public CgtService(ShareTradeService trades, CgtSettingsRepository settings, EcbRates rates, Clock clock,
                      PlatformTransactionManager transactionManager) {
        this.transaction = new TransactionTemplate(transactionManager);
        this.trades = trades;
        this.settings = settings;
        this.rates = rates;
        this.clock = clock;
    }

    /** A trade the CGT counts as the user's: their own shares bought or sold. */
    public static boolean counted(ShareTrade t) {
        return t.getKind() != ShareTrade.Kind.SPLIT && t.getOwner() == ShareTrade.Owner.YOU && t.getAsset() == ShareTrade.Asset.SHARES;
    }

    /**
     * The user's purchases and sales the CGT counts, by day; whichever app they were entered in. Not one it can't count
     * (an amount in one currency only, from a spreadsheet): {@link #calculator} says so.
     */
    @Transactional(readOnly = true)
    public List<ShareTrade> list(Long userId) {
        return trades.list(userId).stream().filter(t -> counted(t) && t.countable()).toList();
    }

    /**
     * The rates the trades are worked out at: each at the rate it was entered with (what the money came to, a broker's
     * say), or at the ECB's of its day (Revenue's rule: the rate of the day bought or sold). The trades stay as entered.
     */
    public enum Rates {
        ENTERED, ECB
    }

    /** A trade as the calculator has it: its price a share and fees in its currency, at its rate. */
    static CgtCalculator.Trade toTrade(ShareTrade t) {
        return toTrade(t, t.getEurRate());
    }

    private static CgtCalculator.Trade toTrade(ShareTrade t, @Nullable BigDecimal eurRate) {
        return new CgtCalculator.Trade(t.getId(), t.getKind() == ShareTrade.Kind.BUY ? Kind.BUY : Kind.SELL, t.getDate(), t.getSymbol(),
                t.getQuantity(), t.price(), t.getCurrency(), t.getFees(), eurRate, t.getCostEur());
    }

    public ShareTrade create(Long userId, Fields fields) {
        return trades.save(apply(new ShareTrade(userId, ShareTrade.App.CGT, clock.instant()), fields));
    }

    /**
     * Records the rows of an import, all of them or none: the rows that can't be recorded (no ECB rate for their day)
     * are all reported, each by its place, e.g. "transactions[3].eurRate". The rates are looked up first, outside a
     * transaction: that can take a while for many days, and a transaction kept open meanwhile would hold up a deploy's
     * migration of the records.
     */
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    public List<ShareTrade> importAll(Long userId, List<Fields> rows) {
        if (rows.size() > ShareTradeService.MAX_TRADES) {
            throw new ValidationException("transactions", "That would be more than the " + ShareTradeService.MAX_TRADES + " trades allowed.");
        }
        List<ShareTrade> recorded = new ArrayList<>();
        Map<String, List<String>> errors = new LinkedHashMap<>();
        for (int i = 0; i < rows.size(); i++) {
            try {
                recorded.add(apply(new ShareTrade(userId, ShareTrade.App.CGT, clock.instant()), rows.get(i)));
            } catch (ValidationException e) {
                errors.put("transactions[" + i + "]." + e.getField(), List.of("Row " + (i + 1) + ": " + e.getMessage()));
            }
        }
        if (!errors.isEmpty()) {
            throw new ValidationException(errors.size() == 1 ? errors.values().iterator().next().getFirst()
                    : errors.size() + " rows can't be recorded.", errors);
        }
        return transaction.execute(status -> trades.saveAll(userId, recorded, t -> false));
    }

    /** Changes a purchase or sale. */
    public ShareTrade update(Long userId, Long id, Fields fields) {
        return apply(trades.get(userId, id), fields);
    }

    public void delete(Long userId, Long id) {
        trades.delete(trades.get(userId, id));
    }

    /** Deletes the user's purchases and sales from one day to another (both included), e.g. to import a period again. */
    public int deletePeriod(Long userId, LocalDate from, LocalDate to) {
        if (from.isAfter(to)) {
            throw new ValidationException("to", "The last day can't be before the first.");
        }
        return trades.deleteBetween(userId, from, to, CgtService::counted);
    }

    /** The user's purchases and sales worked out, with the companies' splits: what each sale matched, the years, the shares held. */
    @Transactional(readOnly = true)
    public CgtCalculator calculator(Long userId) {
        return calculator(userId, Rates.ENTERED);
    }

    /** The same, each trade at the rates asked for (an ECB rate not known yet: its own, and a warning). */
    @Transactional(readOnly = true)
    public CgtCalculator calculator(Long userId, Rates rates) {
        List<CgtCalculator.Trade> counted = new ArrayList<>();
        int withoutEcbRate = 0;
        List<CgtCalculator.Split> splits = new ArrayList<>();
        List<String> warnings = new ArrayList<>();
        Set<String> splitDays = new HashSet<>();
        for (ShareTrade t : trades.list(userId)) {
            if (t.getKind() == ShareTrade.Kind.SPLIT) {
                // a split is the company's, whoever's shares it was entered for: once a share and day
                if (t.getQuantity().signum() > 0 && splitDays.add(ShareTradeService.symbolKey(t.getSymbol()) + "|" + t.getDate())) {
                    splits.add(new CgtCalculator.Split(t.getDate(), t.getSymbol(), t.getQuantity()));
                }
            } else if (counted(t)) {
                if (!t.countable()) {
                    warnings.add("The " + (t.getKind() == ShareTrade.Kind.BUY ? "purchase" : "sale") + " of " + t.getSymbol() + " on "
                            + t.getDate() + " is left out: it has an amount in only one currency. Correct it.");
                } else if (rates == Rates.ECB && t.getEcbRate() != null) {
                    counted.add(toTrade(t, t.getEcbRate()));
                } else {
                    if (rates == Rates.ECB) withoutEcbRate++;
                    counted.add(toTrade(t));
                }
            }
        }
        for (ShareTrade[] pair : trades.possibleDuplicates(userId)) {
            if (!counted(pair[0]) || !counted(pair[1])) continue;
            ShareTrade later = pair[1];
            warnings.add("The " + (later.getKind() == ShareTrade.Kind.BUY ? "purchase" : "sale") + " of "
                    + later.getQuantity().stripTrailingZeros().toPlainString() + " " + later.getSymbol() + " on " + later.getDate()
                    + " may be the one on " + pair[0].getDate() + " (a trade's day and its settlement's?): if so, delete one, or it counts twice.");
        }
        if (withoutEcbRate > 0) {
            warnings.add("The ECB rate isn't known yet for " + withoutEcbRate + (withoutEcbRate == 1 ? " trade: it's" : " trades: they're")
                    + " worked out at the rate entered.");
        }
        return new CgtCalculator(counted, splits, lossesBefore(userId), warnings);
    }

    @Transactional(readOnly = true)
    public CgtOverview overview(Long userId, @Nullable Integer year) {
        return overview(userId, year, Rates.ENTERED);
    }

    /** The same, each trade at the rates asked for. */
    @Transactional(readOnly = true)
    public CgtOverview overview(Long userId, @Nullable Integer year, Rates rates) {
        CgtCalculator calculator = calculator(userId, rates);
        TreeSet<Integer> years = new TreeSet<>();
        calculator.disposals().forEach(d -> years.add(d.date().getYear()));
        // by default the latest year with sales (the one to pay or file for), else this year
        int shown = year != null ? year : years.isEmpty() ? LocalDate.now(clock).getYear() : years.last();
        years.add(LocalDate.now(clock).getYear());
        return new CgtOverview(List.copyOf(years.descendingSet()), calculator.year(shown), calculator.holdings(), lossesBefore(userId));
    }

    @Transactional(readOnly = true)
    public BigDecimal lossesBefore(Long userId) {
        return settings.findById(userId).map(CgtSettings::getLossesBefore).orElse(BigDecimal.ZERO);
    }

    public void setLossesBefore(Long userId, BigDecimal amount) {
        CgtSettings mine = settings.findById(userId).orElseGet(() -> new CgtSettings(userId, amount));
        mine.setLossesBefore(amount.setScale(2, RoundingMode.HALF_UP));
        settings.save(mine);
    }

    /** The trade's value in euro (shares × price, before fees), for the list. */
    public static BigDecimal eurValue(ShareTrade trade) {
        return trade.getAmountEur().setScale(2, RoundingMode.HALF_UP);
    }

    private ShareTrade apply(ShareTrade trade, Fields fields) {
        String currency = fields.currency().trim().toUpperCase(Locale.ROOT);
        BigDecimal rate = fields.eurRate();
        if (currency.equals("EUR")) {
            rate = BigDecimal.ONE;
        } else if (rate == null) {
            rate = rates.rate(currency, fields.date()).map(EcbRates.Rate::rate).orElseThrow(() -> new ValidationException("eurRate",
                    "The ECB has no " + currency + " rate for that day, or couldn't be reached: enter the rate (" + currency + " per euro)."));
        }
        ShareTrade.Kind kind = fields.kind() == Kind.BUY ? ShareTrade.Kind.BUY : ShareTrade.Kind.SELL;
        trade.byPrice(kind, fields.date(), fields.symbol(), fields.quantity(), fields.price(), currency,
                fields.fees() == null ? BigDecimal.ZERO : fields.fees(), rate, clock.instant());
        // a trade entered here is the user's own shares
        trade.describe(trade.getName(), ShareTrade.Asset.SHARES, ShareTrade.Owner.YOU);
        trade.setSource(fields.kind() == Kind.BUY ? (fields.source() == null ? Source.BUY : fields.source()) : null);
        trade.setNote(fields.note());
        return trade;
    }
}
